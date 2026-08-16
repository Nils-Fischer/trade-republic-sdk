import { type } from "arktype";
import { decodeBase64 } from "./encoding.ts";
import type { ResolvedEnvironment, TimerHandle } from "./environment.ts";
import {
  TRAbortError,
  TRAuthError,
  TRHttpError,
  TRTimeoutError,
  TRValidationError,
} from "./errors.ts";
import { parseJson } from "./json.ts";

const API_URL = "https://api.traderepublic.com";
const LOGIN_PATH = "/api/v2/auth/web/login";
const REFRESH_PATH = "/api/v1/auth/web/session";
const DEFAULT_LOGIN_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const INITIAL_REFRESH_RETRY_MS = 5_000;
const MAX_REFRESH_RETRY_MS = 60_000;

const loginResponseSchema = type({ processId: "string" });
const loginStatusSchema = type({
  status: "string",
  "expiresAt?": "string | null",
});
const sessionDataSchema = type({
  version: "1",
  cookies: "string[]",
});
const jwtClaimsSchema = type({
  iat: "number",
  exp: "number",
});

export type SessionValidity = "absent" | "presumed-valid" | "rejected";

export interface LoginOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  pollIntervalMs?: number;
  onApprovalPending?: () => void;
}

export interface GetOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface Session {
  readonly validity: SessionValidity;
  readonly cookieHeader: string | undefined;
  getSnapshot(): SessionSnapshot;
  subscribe(onChange: () => void): () => void;
  login(phoneNumber: string, pin: string, options?: LoginOptions): Promise<void>;
  refresh(): Promise<void>;
  markRejected(cause?: unknown): TRAuthError;
  recover(cause?: unknown): Promise<void>;
  get(path: string, options?: GetOptions): Promise<Response>;
  export(): string | undefined;
  logout(): void;
}

export interface SessionSnapshot {
  readonly validity: SessionValidity;
  readonly revision: number;
}

interface RequestOptions {
  method: "GET" | "POST";
  path: string;
  body?: object;
  cookies?: readonly string[];
  signal?: AbortSignal;
  rejectSession?: boolean;
  sessionRevision?: number;
  cancellation?: () => TRAbortError | TRTimeoutError;
}

function cookieName(cookie: string): string {
  if (/[\r\n]/.test(cookie)) throw new TRValidationError("A Session cookie contains a newline");
  const separator = cookie.indexOf("=");
  const name = separator > 0 ? cookie.slice(0, separator).trim() : "";
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) {
    throw new TRValidationError("A Session cookie has an invalid name");
  }
  if (cookie.split(";").some((part) => part.trim() === "")) {
    throw new TRValidationError(`Session cookie "${name}" has an empty attribute`);
  }
  return name;
}

function cookiePair(cookie: string): string {
  return cookie.split(";", 1)[0]?.trim() ?? "";
}

function cookieHeader(cookies: readonly string[]): string {
  const pairs: string[] = [];
  for (const cookie of cookies) {
    const pair = cookiePair(cookie);
    if (pair) pairs.push(pair);
  }
  return pairs.join("; ");
}

function hasCookieValue(cookies: readonly string[], name: string): boolean {
  return cookies.some((cookie) => {
    if (cookieName(cookie) !== name) return false;
    const pair = cookiePair(cookie);
    return pair.slice(pair.indexOf("=") + 1).length > 0;
  });
}

function mergeCookies(current: readonly string[], received: readonly string[]): string[] {
  const merged = new Map<string, string>();

  for (const cookie of [...current, ...received]) {
    const name = cookieName(cookie);
    merged.set(name, cookie);
  }

  return [...merged.values()];
}

function splitCombinedCookies(header: string): string[] {
  const cookies: string[] = [];
  let start = 0;
  let quoted = false;

  for (let index = 0; index < header.length; index += 1) {
    if (header[index] === '"') quoted = !quoted;
    if (header[index] !== "," || quoted) continue;

    const rest = header.slice(index + 1);
    if (!/^\s*[^=;,\s]+\s*=/.test(rest)) continue;
    cookies.push(header.slice(start, index).trim());
    start = index + 1;
  }

  const last = header.slice(start).trim();
  if (last) cookies.push(last);
  return cookies;
}

function responseCookies(response: Response): string[] {
  // SAFETY: getSetCookie is an optional Fetch extension implemented by some runtimes.
  const getSetCookie = (response.headers as { getSetCookie?: () => string[] }).getSetCookie;
  const separate = getSetCookie?.call(response.headers) ?? [];
  if (separate.length > 0) return separate;

  const combined = response.headers.get("set-cookie");
  return combined ? splitCombinedCookies(combined) : [];
}

interface AssertiveSchema<Input, Value> {
  assert(value: Input): Value;
}

function validate<Input, Value>(
  schema: AssertiveSchema<Input, Value>,
  value: Input,
  name: string,
): Value {
  try {
    return schema.assert(value);
  } catch (cause) {
    throw new TRValidationError(`Invalid ${name}`, { cause });
  }
}

function decodeClaims(cookie: string): typeof jwtClaimsSchema.infer {
  try {
    const jwt = cookiePair(cookie).slice(cookiePair(cookie).indexOf("=") + 1);
    const payload = jwt.split(".")[1];
    if (!payload) throw new Error("The JWT has no payload");
    const base64 = payload
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const claims = parseJson(decodeBase64(base64), (value) => jwtClaimsSchema.assert(value), {
      onInvalidJson: "throw",
      errorMessage: "The tr_session cookie has invalid JSON claims",
    });
    if (claims.exp <= claims.iat) throw new Error("The JWT lifetime is not positive");
    return claims;
  } catch (cause) {
    throw new TRValidationError("The tr_session cookie has invalid JWT claims", { cause });
  }
}

function wait(
  environment: ResolvedEnvironment,
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(loginCancellation(signal));
  }
  if (delayMs === 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const timer = environment.clock.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = (): void => {
      environment.clock.clearTimeout(timer);
      reject(loginCancellation(signal));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function loginCancellation(signal?: AbortSignal): TRAbortError | TRTimeoutError {
  return signal?.reason instanceof TRTimeoutError
    ? signal.reason
    : new TRAbortError("Login was aborted", { cause: signal?.reason });
}

export function createSession(environment: ResolvedEnvironment, serialized?: string): Session {
  let cookies: string[] = [];
  let validity: SessionValidity = "absent";
  let refreshTimer: TimerHandle | undefined;
  let refreshPromise: Promise<void> | undefined;
  let refreshRetryMs = INITIAL_REFRESH_RETRY_MS;
  let revision = 0;
  let sessionSnapshot: SessionSnapshot = Object.freeze({ validity, revision });
  const listeners = new Set<() => void>();
  const deviceInfoHeader = environment.deviceInfo;

  const publish = (): void => {
    if (sessionSnapshot.validity === validity && sessionSnapshot.revision === revision) return;
    sessionSnapshot = Object.freeze({ validity, revision });
    for (const listener of Array.from(listeners)) listener();
  };

  const clearRefreshTimer = (): void => {
    if (refreshTimer === undefined) return;
    environment.clock.clearTimeout(refreshTimer);
    refreshTimer = undefined;
  };

  const markRejected = (cause?: unknown): TRAuthError => {
    clearRefreshTimer();
    validity = cookies.length > 0 ? "rejected" : "absent";
    publish();
    return new TRAuthError("Trade Republic rejected the Session", { cause });
  };

  const request = async (options: RequestOptions): Promise<Response> => {
    const baseHeaders = {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en",
      "Content-Type": "application/json",
      "X-TR-App-Version": "15.97.5",
      "X-TR-Device-Info": deviceInfoHeader,
      "X-TR-Platform": "web-pro",
    };
    const cookie = options.cookies ? cookieHeader(options.cookies) : undefined;
    const headers = cookie ? { ...baseHeaders, Cookie: cookie } : baseHeaders;

    let response: Response;
    try {
      response = await environment.fetch(`${API_URL}${options.path}`, {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        credentials: "include",
        signal: options.signal,
      });
    } catch (cause) {
      if (options.signal?.aborted) {
        throw options.cancellation?.() ?? loginCancellation(options.signal);
      }
      throw new TRHttpError(0, "Could not reach Trade Republic", { cause });
    }

    if (response.ok) return response;
    if (options.rejectSession && (response.status === 401 || response.status === 403)) {
      if (options.sessionRevision !== undefined && options.sessionRevision !== revision) {
        throw new TRAbortError("The Session changed while Refresh was in flight");
      }
      throw markRejected(response);
    }
    throw new TRHttpError(response.status, `Trade Republic returned HTTP ${response.status}`);
  };

  const scheduleRefresh = (
    nextCookies: readonly string[] = cookies,
    timerRevision = revision,
  ): void => {
    const sessionCookie = nextCookies.find((cookie) => cookieName(cookie) === "tr_session");
    if (!sessionCookie) throw new TRValidationError("The Session has no tr_session cookie");

    const claims = decodeClaims(sessionCookie);
    const expiresAt = claims.exp * 1_000;
    const startsAt = claims.iat * 1_000;
    const refreshAt = startsAt + (expiresAt - startsAt) * 0.8;
    clearRefreshTimer();
    refreshTimer = environment.clock.setTimeout(
      () => {
        refreshTimer = undefined;
        void runScheduledRefresh(timerRevision);
      },
      Math.max(0, refreshAt - environment.clock.now()),
    );
  };

  const scheduleRefreshRetry = (timerRevision: number): void => {
    if (validity !== "presumed-valid" || timerRevision !== revision) return;
    clearRefreshTimer();
    const delayMs = refreshRetryMs;
    refreshRetryMs = Math.min(refreshRetryMs * 2, MAX_REFRESH_RETRY_MS);
    refreshTimer = environment.clock.setTimeout(() => {
      refreshTimer = undefined;
      void runScheduledRefresh(timerRevision);
    }, delayMs);
  };

  const runScheduledRefresh = async (timerRevision: number): Promise<void> => {
    if (timerRevision !== revision) return;
    try {
      await refresh();
    } catch {
      scheduleRefreshRetry(timerRevision);
    }
  };

  const performRefresh = async (): Promise<void> => {
    if (validity === "absent") throw markRejected();
    const sessionRevision = revision;
    const response = await request({
      method: "GET",
      path: REFRESH_PATH,
      cookies,
      rejectSession: true,
      sessionRevision,
    });
    if (sessionRevision !== revision) {
      throw new TRAbortError("The Session changed while Refresh was in flight");
    }
    const received = responseCookies(response);
    if (!received.some((cookie) => cookieName(cookie) === "tr_session")) {
      throw new TRValidationError("Refresh returned no tr_session cookie");
    }
    const refreshedCookies = mergeCookies(cookies, received);
    scheduleRefresh(refreshedCookies, revision + 1);
    refreshRetryMs = INITIAL_REFRESH_RETRY_MS;
    revision += 1;
    cookies = refreshedCookies;
    validity = "presumed-valid";
    publish();
  };

  const refresh = (): Promise<void> => {
    if (refreshPromise) return refreshPromise;
    const current = performRefresh().finally(() => {
      if (refreshPromise === current) refreshPromise = undefined;
    });
    refreshPromise = current;
    return current;
  };

  const recover = async (cause?: unknown): Promise<void> => {
    markRejected(cause);
    await refresh();
  };

  const get = (path: string, options: GetOptions = {}): Promise<Response> => {
    if (validity !== "presumed-valid") {
      return Promise.reject(new TRAuthError(`Resource "${path}" requires a Session`));
    }
    if (options.signal?.aborted) {
      return Promise.reject(
        new TRAbortError(`Get for Resource "${path}" was aborted`, {
          cause: options.signal.reason,
        }),
      );
    }

    const controller = environment.createAbortController();
    const abort = (): void => controller.abort(options.signal?.reason);
    const timeoutError = new TRTimeoutError(
      `Get for Resource "${path}" timed out after ${options.timeoutMs} ms`,
      options.timeoutMs,
    );
    const cancellation = (): TRAbortError | TRTimeoutError =>
      controller.signal.reason instanceof TRTimeoutError
        ? controller.signal.reason
        : new TRAbortError(`Get for Resource "${path}" was aborted`, {
            cause: controller.signal.reason,
          });
    const timeout =
      options.timeoutMs === undefined
        ? undefined
        : environment.clock.setTimeout(() => controller.abort(timeoutError), options.timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });

    const perform = async (): Promise<Response> => {
      const read = (): Promise<Response> =>
        request({
          method: "GET",
          path,
          cookies,
          signal: controller.signal,
          cancellation,
        });

      try {
        return await read();
      } catch (error) {
        if (!(error instanceof TRHttpError) || (error.status !== 401 && error.status !== 403)) {
          throw error;
        }
        const recovery = recover(error);
        const interrupted = new Promise<never>((_resolve, reject) => {
          const interrupt = (): void => reject(cancellation());
          if (controller.signal.aborted) {
            interrupt();
            return;
          }
          controller.signal.addEventListener("abort", interrupt, { once: true });
          const removeInterrupt = (): void =>
            controller.signal.removeEventListener("abort", interrupt);
          void recovery.then(removeInterrupt, removeInterrupt);
        });
        await Promise.race([recovery, interrupted]);
        if (controller.signal.aborted) throw cancellation();
        return request({
          method: "GET",
          path,
          cookies,
          signal: controller.signal,
          rejectSession: true,
          sessionRevision: revision,
          cancellation,
        });
      }
    };

    return perform().finally(() => {
      if (timeout !== undefined) environment.clock.clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    });
  };

  const performLogin = async (
    phoneNumber: string,
    pin: string,
    pollIntervalMs: number,
    signal: AbortSignal,
    sessionRevision: number,
    onApprovalPending?: () => void,
  ): Promise<void> => {
    const initial = await request({
      method: "POST",
      path: LOGIN_PATH,
      body: { phoneNumber, pin },
      cookies,
      signal,
    });
    const loginResponse = await parseJson(
      initial,
      (value) => validate(loginResponseSchema, value, "Login response"),
      { onInvalidJson: "throw", errorMessage: "Trade Republic returned invalid JSON" },
    );
    if (signal.aborted) throw loginCancellation(signal);
    onApprovalPending?.();
    let receivedLoginCookies = responseCookies(initial);
    let pendingCookies = mergeCookies(cookies, receivedLoginCookies);

    for (;;) {
      const response = await request({
        method: "GET",
        path: `${LOGIN_PATH}/processes/${encodeURIComponent(loginResponse.processId)}`,
        cookies: pendingCookies,
        signal,
      });
      const received = responseCookies(response);
      receivedLoginCookies = mergeCookies(receivedLoginCookies, received);
      pendingCookies = mergeCookies(pendingCookies, received);
      const status = await parseJson(
        response,
        (value) => validate(loginStatusSchema, value, "Login status"),
        { onInvalidJson: "throw", errorMessage: "Trade Republic returned invalid JSON" },
      );

      if (status.status === "CONFIRMED") {
        if (
          !hasCookieValue(receivedLoginCookies, "tr_session") ||
          !hasCookieValue(receivedLoginCookies, "tr_refresh")
        ) {
          throw new TRValidationError("Login returned no fresh Session cookies");
        }
        if (sessionRevision !== revision) {
          throw new TRAbortError("The Session changed while Login was in flight");
        }
        scheduleRefresh(pendingCookies, revision + 1);
        revision += 1;
        refreshPromise = undefined;
        refreshRetryMs = INITIAL_REFRESH_RETRY_MS;
        cookies = pendingCookies;
        validity = "presumed-valid";
        publish();
        return;
      }
      if (status.status !== "PENDING") {
        throw new TRAuthError(`Login failed with status ${status.status}`);
      }
      if (status.expiresAt) {
        const expiresAt = environment.parseDate(status.expiresAt);
        if (!Number.isFinite(expiresAt)) {
          throw new TRValidationError("Login status has an invalid expiresAt value");
        }
        if (expiresAt <= environment.clock.now()) {
          throw new TRAuthError("Login approval expired");
        }
      }

      await wait(environment, pollIntervalMs, signal);
    }
  };

  const login = (phoneNumber: string, pin: string, options: LoginOptions = {}): Promise<void> => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    if (timeoutMs <= 0) {
      return Promise.reject(new TRValidationError("timeoutMs must be greater than zero"));
    }
    if (pollIntervalMs < 0) {
      return Promise.reject(new TRValidationError("pollIntervalMs must not be negative"));
    }
    if (options.signal?.aborted) {
      return Promise.reject(loginCancellation(options.signal));
    }

    const controller = environment.createAbortController();
    const timeoutError = new TRTimeoutError(`Login timed out after ${timeoutMs} ms`, timeoutMs);
    const timeout = environment.clock.setTimeout(() => controller.abort(timeoutError), timeoutMs);
    const abort = (): void => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });

    const sessionRevision = revision;
    return performLogin(
      phoneNumber,
      pin,
      pollIntervalMs,
      controller.signal,
      sessionRevision,
      options.onApprovalPending,
    ).finally(() => {
      environment.clock.clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    });
  };

  const restore = (value: string): void => {
    const data = parseJson(
      value,
      (parsed) => validate(sessionDataSchema, parsed, "exported Session"),
      { onInvalidJson: "throw", errorMessage: "Invalid exported Session" },
    );
    const names = data.cookies.map(cookieName);
    if (new Set(names).size !== names.length) {
      throw new TRValidationError("The exported Session has duplicate cookie names");
    }
    const restoredCookies = mergeCookies([], data.cookies);
    if (!hasCookieValue(restoredCookies, "tr_refresh")) {
      throw new TRValidationError("The Session has no tr_refresh cookie");
    }
    scheduleRefresh(restoredCookies, revision + 1);
    revision += 1;
    refreshPromise = undefined;
    refreshRetryMs = INITIAL_REFRESH_RETRY_MS;
    cookies = restoredCookies;
    validity = "presumed-valid";
    publish();
  };

  if (serialized !== undefined) restore(serialized);

  return {
    get validity() {
      return validity;
    },
    get cookieHeader() {
      if (validity !== "presumed-valid") return undefined;
      return cookieHeader(cookies);
    },
    getSnapshot: () => sessionSnapshot,
    subscribe: (onChange) => {
      listeners.add(onChange);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(onChange);
      };
    },
    login,
    refresh,
    markRejected,
    recover,
    get,
    export: () =>
      cookies.length > 0
        ? JSON.stringify({
            version: 1,
            cookies,
          })
        : undefined,
    logout: () => {
      clearRefreshTimer();
      revision += 1;
      refreshPromise = undefined;
      refreshRetryMs = INITIAL_REFRESH_RETRY_MS;
      cookies = [];
      validity = "absent";
      publish();
    },
  };
}
