import { describe, expect, test, vi } from "vite-plus/test";
import {
  TRAbortError,
  TRAuthError,
  TRClient,
  TRHttpError,
  TRTimeoutError,
  TRValidationError,
  type Fetch,
  type SocketOptions,
} from "../src/index.ts";
import { FakeClock, FakeSocket } from "../src/testing.ts";

const startTime = 1_000_000;

function base64Url<Value>(value: Value): string {
  return btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function jwt(iat: number, exp: number): string {
  return `${base64Url({ alg: "ES256" })}.${base64Url({ iat, exp })}.signature`;
}

function ticker(price: string) {
  const quote = { time: 1, price, size: 10 };
  return {
    bid: quote,
    ask: quote,
    last: quote,
    pre: quote,
    open: quote,
    qualityId: "realtime",
    leverage: null,
    delta: null,
  };
}

function response<Body>(
  body: Body | undefined,
  cookies: readonly string[] = [],
  status = 200,
): Response {
  const headers: [string, string][] = cookies.map((cookie) => ["set-cookie", cookie]);
  if (body) headers.push(["content-type", "application/json"]);
  const result = new Response(body ? JSON.stringify(body) : undefined, { headers, status });
  if (body) Object.defineProperty(result, "json", { value: async () => body });
  return result;
}

function mockFetch(responses: Array<Response | Promise<Response>>): Fetch {
  return vi.fn<Fetch>(async () => {
    const next = responses.shift();
    if (!next) throw new Error("Unexpected HTTP request");
    return next;
  });
}

function subscriptionIds(socket: FakeSocket): number[] {
  return socket.sent
    .filter((line) => line.startsWith("sub "))
    .map((line) => Number.parseInt(line.split(" ")[1]!, 10));
}

async function acceptConnection(socket: FakeSocket): Promise<void> {
  socket.open();
  socket.receive("connected");
  await flush();
}

async function flush(): Promise<void> {
  for (let count = 0; count < 8; count += 1) await Promise.resolve();
}

async function flushUntil(condition: () => boolean): Promise<void> {
  for (let count = 0; count < 100; count += 1) {
    if (condition()) return;
    await Promise.resolve();
  }
  throw new Error("Expected asynchronous work did not settle");
}

function confirmedLoginResponses(sessionJwt = jwt(1_000, 1_300)): Response[] {
  return [
    response({ processId: "process-id" }, [
      "login_process=process-cookie; Path=/; Secure; HttpOnly",
    ]),
    response({ status: "CONFIRMED", expiresAt: null }, [
      `tr_session=${sessionJwt}; Path=/; Secure; HttpOnly; SameSite=Strict`,
      `tr_refresh=${jwt(1_000, 87_400)}; Path=/; Secure; HttpOnly; SameSite=Strict`,
      "mapper-lb-affinity=mapper; Path=/; Secure; SameSite=None",
    ]),
  ];
}

async function loginClient(
  fetch: Fetch,
  clock = new FakeClock(startTime),
): Promise<{ client: TRClient; clock: FakeClock }> {
  const client = new TRClient({ fetch, clock, validate: "throw" });
  await client.login("+49123456789", "1234", { pollIntervalMs: 0 });
  return { client, clock };
}

describe("Session", () => {
  test("starts Login, polls through approval, and does not export Login arguments", async () => {
    const clock = new FakeClock(startTime);
    const fetch = mockFetch([
      response({ processId: "process-id" }, [
        "login_process=process-cookie; Path=/; Secure; HttpOnly",
      ]),
      response({ status: "PENDING", expiresAt: "2999-01-01T00:00:00.000Z" }),
      ...confirmedLoginResponses().slice(1),
    ]);
    const client = new TRClient({ fetch, clock, validate: "throw" });

    const login = client.login("+49123456789", "1234", { pollIntervalMs: 2_000 });
    await flushUntil(() => clock.pendingTimerCount === 2);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(clock.pendingTimerCount).toBe(2);

    clock.advanceBy(2_000);
    await login;

    expect(client.sessionValidity).toBe("presumed-valid");
    expect(client.exportSession()).not.toContain("+49123456789");
    expect(client.exportSession()).not.toContain("1234");

    const [loginUrl, loginOptions] = vi.mocked(fetch).mock.calls[0]!;
    expect(loginUrl).toBe("https://api.traderepublic.com/api/v2/auth/web/login");
    expect(loginOptions).toMatchObject({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ phoneNumber: "+49123456789", pin: "1234" }),
    });
    expect(loginOptions?.headers).toMatchObject({
      "X-TR-App-Version": expect.any(String),
      "X-TR-Device-Info": expect.any(String),
      "X-TR-Platform": "web-pro",
    });

    const [pollUrl, pollOptions] = vi.mocked(fetch).mock.calls[1]!;
    expect(pollUrl).toBe(
      "https://api.traderepublic.com/api/v2/auth/web/login/processes/process-id",
    );
    expect(pollOptions?.method).toBe("GET");
    expect(pollOptions?.headers).toMatchObject({ Cookie: "login_process=process-cookie" });
  });

  test("Refreshes at 80% while idle and preserves cookies not replaced", async () => {
    const refreshedJwt = jwt(1_240, 1_540);
    const fetch = mockFetch([
      ...confirmedLoginResponses(),
      response(undefined, [
        `tr_session=${refreshedJwt}; Path=/; Secure; HttpOnly; SameSite=Strict`,
      ]),
      response(undefined, [
        `tr_session=${jwt(1_480, 1_780)}; Path=/; Secure; HttpOnly; SameSite=Strict`,
      ]),
    ]);
    const { client, clock } = await loginClient(fetch);

    clock.advanceBy(239_999);
    expect(fetch).toHaveBeenCalledTimes(2);
    clock.advanceBy(1);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(3);

    await client.refresh();
    const [url, options] = vi.mocked(fetch).mock.calls[3]!;
    expect(url).toBe("https://api.traderepublic.com/api/v1/auth/web/session");
    expect(options?.headers).toMatchObject({
      Cookie: expect.stringContaining("tr_refresh="),
    });
    expect(new Headers(options?.headers).get("Cookie")).toContain("mapper-lb-affinity=mapper");
  });

  test("retries failed proactive Refreshes with bounded exponential backoff", async () => {
    const fetch = mockFetch([
      ...confirmedLoginResponses(),
      response({}, [], 500),
      response({}, [], 500),
      response(undefined, [
        `tr_session=${jwt(1_255, 1_555)}; Path=/; Secure; HttpOnly; SameSite=Strict`,
      ]),
    ]);
    const { client, clock } = await loginClient(fetch);

    clock.advanceBy(240_000);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(client.sessionValidity).toBe("presumed-valid");

    clock.advanceBy(5_000);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(4);

    clock.advanceBy(9_999);
    expect(fetch).toHaveBeenCalledTimes(4);
    clock.advanceBy(1);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(clock.pendingTimerCount).toBe(1);
  });

  test("shares one in-flight Refresh between concurrent callers", async () => {
    let resolveRefresh: ((response: Response) => void) | undefined;
    const pendingRefresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetch = mockFetch([...confirmedLoginResponses(), pendingRefresh]);
    const { client } = await loginClient(fetch);

    const first = client.refresh();
    const second = client.refresh();
    expect(first).toBe(second);
    expect(fetch).toHaveBeenCalledTimes(3);

    resolveRefresh?.(
      response(undefined, [
        `tr_session=${jwt(1_240, 1_540)}; Path=/; Secure; HttpOnly; SameSite=Strict`,
      ]),
    );
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });

  test("does not restore a Session when Logout overtakes Refresh", async () => {
    let resolveRefresh: ((response: Response) => void) | undefined;
    const pendingRefresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetch = mockFetch([...confirmedLoginResponses(), pendingRefresh]);
    const { client } = await loginClient(fetch);

    const refresh = client.refresh();
    client.logout();
    resolveRefresh?.(
      response(undefined, [
        `tr_session=${jwt(1_240, 1_540)}; Path=/; Secure; HttpOnly; SameSite=Strict`,
      ]),
    );

    await expect(refresh).rejects.toBeInstanceOf(TRAbortError);
    expect(client.sessionValidity).toBe("absent");
    expect(client.exportSession()).toBeUndefined();
  });

  test("does not share an old in-flight Refresh with a replacement Session", async () => {
    let resolveOldRefresh: ((response: Response) => void) | undefined;
    const oldRefresh = new Promise<Response>((resolve) => {
      resolveOldRefresh = resolve;
    });
    const fetch = mockFetch([
      ...confirmedLoginResponses(),
      oldRefresh,
      ...confirmedLoginResponses(jwt(2_000, 2_300)),
      response(undefined, [
        `tr_session=${jwt(2_240, 2_540)}; Path=/; Secure; HttpOnly; SameSite=Strict`,
      ]),
    ]);
    const { client } = await loginClient(fetch);

    const stale = client.refresh();
    client.logout();
    await client.login("+49123456789", "1234", { pollIntervalMs: 0 });
    const current = client.refresh();

    await expect(current).resolves.toBeUndefined();
    resolveOldRefresh?.(
      response(undefined, [
        `tr_session=${jwt(1_240, 1_540)}; Path=/; Secure; HttpOnly; SameSite=Strict`,
      ]),
    );
    await expect(stale).rejects.toBeInstanceOf(TRAbortError);
    expect(client.sessionValidity).toBe("presumed-valid");
  });

  test("exports and restores an opaque Session with its Refresh timer", async () => {
    const fetch = mockFetch(confirmedLoginResponses());
    const { client } = await loginClient(fetch);
    const saved = client.exportSession();
    expect(saved).toBeTypeOf("string");

    const clock = new FakeClock(startTime);
    const restored = new TRClient({ session: saved, fetch: mockFetch([]), clock });
    expect(restored.sessionValidity).toBe("presumed-valid");
    expect(restored.exportSession()).toBe(saved);
    expect(clock.pendingTimerCount).toBe(1);

    restored.logout();
    expect(restored.sessionValidity).toBe("absent");
    expect(restored.exportSession()).toBeUndefined();
    expect(clock.pendingTimerCount).toBe(0);
  });

  test("Logout closes the authenticated socket and reuses the Connection for a Public read", async () => {
    const sockets: FakeSocket[] = [];
    const socketOptions: Array<SocketOptions | undefined> = [];
    const client = new TRClient({
      fetch: mockFetch(confirmedLoginResponses()),
      clock: new FakeClock(startTime),
      socket: (_url, _protocols, options) => {
        const socket = new FakeSocket();
        sockets.push(socket);
        socketOptions.push(options);
        return socket;
      },
      validate: "throw",
    });
    await client.login("+49123456789", "1234", { pollIntervalMs: 0 });

    const secured = client.cash.get({});
    await acceptConnection(sockets[0]!);
    const [securedId] = subscriptionIds(sockets[0]!);
    sockets[0]!.receive(`${securedId} A [{"accountNumber":"1","currencyId":"EUR","amount":42}]`);
    await secured;

    client.logout();
    expect(sockets[0]!.readyState).toBe(sockets[0]!.CLOSED);
    const publicRead = client.ticker.get({ id: "IE00B7Y34M31.LSX" });
    await acceptConnection(sockets[1]!);
    const [publicId] = subscriptionIds(sockets[1]!);
    const responseBody = ticker("1");
    sockets[1]!.receive(`${publicId} A ${JSON.stringify(responseBody)}`);

    await expect(publicRead).resolves.toEqual(responseBody);
    expect(socketOptions[0]?.headers?.Cookie).toContain("tr_session=");
    expect(socketOptions[1]).toBeUndefined();
  });

  test("a stale Login reconnect cannot cancel a Public connection opened after Logout", async () => {
    const sockets: FakeSocket[] = [];
    const client = new TRClient({
      fetch: mockFetch(confirmedLoginResponses()),
      socket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      validate: "throw",
    });
    const firstRead = client.ticker.get({ id: "IE00B7Y34M31.LSX" });
    await acceptConnection(sockets[0]!);
    const [firstId] = subscriptionIds(sockets[0]!);
    sockets[0]!.receive(`${firstId} A ${JSON.stringify(ticker("1"))}`);
    await firstRead;

    await client.login("+49123456789", "1234", { pollIntervalMs: 0 });
    expect(sockets).toHaveLength(2);
    client.logout();
    const publicRead = client.ticker.get({ id: "IE00B7Y34M31.LSX" });
    expect(sockets).toHaveLength(3);
    await flush();
    await acceptConnection(sockets[2]!);
    const [publicId] = subscriptionIds(sockets[2]!);
    const responseBody = ticker("2");
    sockets[2]!.receive(`${publicId} A ${JSON.stringify(responseBody)}`);

    await expect(publicRead).resolves.toEqual(responseBody);
  });

  test("rejects malformed restored Session data", () => {
    expect(() => new TRClient({ session: "not-json" })).toThrow(TRValidationError);
    expect(() => new TRClient({ session: JSON.stringify({ version: 1, cookies: [] }) })).toThrow(
      TRValidationError,
    );
    expect(
      () =>
        new TRClient({
          session: JSON.stringify({
            version: 1,
            cookies: [`tr_session=${jwt(1_000, 1_300)}; Path=/`],
          }),
        }),
    ).toThrow(TRValidationError);
    expect(
      () =>
        new TRClient({
          session: JSON.stringify({
            version: 1,
            cookies: [`tr_session=${jwt(1_000, 1_300)}; Path=/`, "tr_refresh=; Path=/"],
          }),
        }),
    ).toThrow(TRValidationError);
    expect(
      () =>
        new TRClient({
          session: JSON.stringify({
            version: 1,
            cookies: ["tr_session=first", "tr_session=second"],
          }),
        }),
    ).toThrow(TRValidationError);
    expect(
      () =>
        new TRClient({
          session: JSON.stringify({ version: 1, cookies: ["invalid cookie"] }),
        }),
    ).toThrow(TRValidationError);
    expect(
      () =>
        new TRClient({
          session: JSON.stringify({
            version: 1,
            cookies: [`tr_session=${jwt(1_000, 1_300)}; Path=/\r\nInjected: true`],
          }),
        }),
    ).toThrow(TRValidationError);
    expect(
      () =>
        new TRClient({
          session: JSON.stringify({
            version: 1,
            cookies: [`tr_session=${jwt(Number.NaN, 1_300)}; Path=/`],
          }),
        }),
    ).toThrow(TRValidationError);
  });

  test("sends an existing Session with a new Login", async () => {
    const fetch = mockFetch([...confirmedLoginResponses(), ...confirmedLoginResponses()]);
    const { client } = await loginClient(fetch);

    await client.login("+49123456789", "1234", { pollIntervalMs: 0 });

    const options = vi.mocked(fetch).mock.calls[2]?.[1];
    expect(options?.headers).toMatchObject({
      Cookie: expect.stringContaining("tr_session="),
    });
  });

  test("does not accept stale auth cookies as a fresh Login", async () => {
    const fetch = mockFetch([
      ...confirmedLoginResponses(),
      response({ processId: "new-process" }, ["login_process=new; Path=/; Secure; HttpOnly"]),
      response({ status: "CONFIRMED", expiresAt: null }),
    ]);
    const { client } = await loginClient(fetch);
    const previous = client.exportSession();

    await expect(
      client.login("+49123456789", "1234", { pollIntervalMs: 0 }),
    ).rejects.toBeInstanceOf(TRValidationError);
    expect(client.exportSession()).toBe(previous);
  });

  test("rejects a malformed Login approval expiry", async () => {
    const client = new TRClient({
      fetch: mockFetch([
        response({ processId: "process-id" }, ["login_process=value; Path=/"]),
        response({ status: "PENDING", expiresAt: "not-a-date" }),
      ]),
      clock: new FakeClock(startTime),
    });

    await expect(
      client.login("+49123456789", "1234", { pollIntervalMs: 0 }),
    ).rejects.toBeInstanceOf(TRValidationError);
  });

  test("reactively Refreshes, retries the rejected Get, and preserves another Get", async () => {
    const refreshedJwt = jwt(1_200, 1_500);
    const fetch = mockFetch([
      ...confirmedLoginResponses(),
      response(undefined, [
        `tr_session=${refreshedJwt}; Path=/; Secure; HttpOnly; SameSite=Strict`,
      ]),
    ]);
    const clock = new FakeClock(startTime);
    const sockets: FakeSocket[] = [];
    const socketOptions: Array<SocketOptions | undefined> = [];
    const client = new TRClient({
      fetch,
      clock,
      socket: (_url, _protocols, options) => {
        const socket = new FakeSocket(clock);
        sockets.push(socket);
        socketOptions.push(options);
        return socket;
      },
      validate: "throw",
    });
    await client.login("+49123456789", "1234", { pollIntervalMs: 0 });

    const retried = client.cash.get({});
    const preserved = client.cash.get({});
    await flushUntil(() => sockets.length === 1);
    await acceptConnection(sockets[0]!);
    const [rejectedId] = subscriptionIds(sockets[0]!);
    sockets[0]!.receive(
      `${rejectedId} E {"errors":[{"errorCode":"AUTHENTICATION_ERROR","errorMessage":"Expired"}]}`,
    );

    await flushUntil(() => sockets.length === 2);
    await acceptConnection(sockets[1]!);
    const responseBody = [{ accountNumber: "1", currencyId: "EUR", amount: 42 }];
    subscriptionIds(sockets[1]!).forEach((requestId) => {
      sockets[1]!.receive(`${requestId} A ${JSON.stringify(responseBody)}`);
    });

    await expect(Promise.all([retried, preserved])).resolves.toEqual([responseBody, responseBody]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(client.sessionValidity).toBe("presumed-valid");
    expect(socketOptions[1]?.headers?.Cookie).toContain(refreshedJwt);
  });

  test.each([
    ["HTTP", response({}, [], 500), TRHttpError],
    ["validation", response(undefined), TRValidationError],
  ])("preserves a reactive Refresh %s error", async (_name, refreshResponse, ErrorType) => {
    const fetch = mockFetch([...confirmedLoginResponses(), refreshResponse]);
    const socket = new FakeSocket();
    const client = new TRClient({ fetch, socket: () => socket, validate: "throw" });
    await client.login("+49123456789", "1234", { pollIntervalMs: 0 });

    const result = client.cash.get({});
    await acceptConnection(socket);
    const [requestId] = subscriptionIds(socket);
    socket.receive(
      `${requestId} E {"errors":[{"errorCode":"AUTHENTICATION_ERROR","errorMessage":"Expired"}]}`,
    );

    await expect(result).rejects.toBeInstanceOf(ErrorType);
    expect(client.sessionValidity).toBe("rejected");
  });

  test("reactively Refreshes a rejected Watch and gives another Watch a fresh Snapshot", async () => {
    const fetch = mockFetch([
      ...confirmedLoginResponses(),
      response(undefined, [
        `tr_session=${jwt(1_200, 1_500)}; Path=/; Secure; HttpOnly; SameSite=Strict`,
      ]),
    ]);
    const clock = new FakeClock(startTime);
    const sockets: FakeSocket[] = [];
    const client = new TRClient({
      fetch,
      clock,
      socket: () => {
        const socket = new FakeSocket(clock);
        sockets.push(socket);
        return socket;
      },
      validate: "throw",
    });
    await client.login("+49123456789", "1234", { pollIntervalMs: 0 });

    const rejected = client.cash.watch({})[Symbol.asyncIterator]();
    const preserved = client.cash.watch({})[Symbol.asyncIterator]();
    const rejectedNext = rejected.next();
    const preservedFirst = preserved.next();
    await flushUntil(() => sockets.length === 1);
    await acceptConnection(sockets[0]!);
    const [rejectedId, preservedId] = subscriptionIds(sockets[0]!);
    const initialBody = [{ accountNumber: "1", currencyId: "EUR", amount: 10 }];
    sockets[0]!.receive(`${preservedId} A ${JSON.stringify(initialBody)}`);
    await expect(preservedFirst).resolves.toEqual({ done: false, value: initialBody });
    let preservedSettled = false;
    const preservedNext = preserved.next().then((result) => {
      preservedSettled = true;
      return result;
    });
    sockets[0]!.receive(
      `${rejectedId} E {"errors":[{"errorCode":"AUTHENTICATION_ERROR","errorMessage":"Expired"}]}`,
    );

    await flushUntil(() => sockets.length === 2);
    await acceptConnection(sockets[1]!);
    const [restoredId, resumedId] = subscriptionIds(sockets[1]!);
    const responseBody = [{ accountNumber: "1", currencyId: "EUR", amount: 20 }];
    const initialJson = JSON.stringify(initialBody);
    const updatedJson = JSON.stringify(responseBody);
    sockets[1]!.receive(
      `${restoredId} D -${initialJson.length}\t+${encodeURIComponent(updatedJson)}`,
    );
    await flush();
    expect(preservedSettled).toBe(false);
    sockets[1]!.receive(`${restoredId} A ${updatedJson}`);
    sockets[1]!.receive(`${resumedId} A ${updatedJson}`);

    await expect(rejectedNext).resolves.toEqual({ done: false, value: responseBody });
    await expect(preservedNext).resolves.toEqual({ done: false, value: responseBody });
    await rejected.return?.();
    await preserved.return?.();
  });

  test("Login reauthenticates without ending an active Public Watch", async () => {
    const fetch = mockFetch(confirmedLoginResponses());
    const sockets: FakeSocket[] = [];
    const client = new TRClient({
      fetch,
      clock: new FakeClock(startTime),
      socket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      validate: "throw",
    });
    const responseBody = ticker("1");
    const iterator = client.ticker.watch({ id: "IE00B7Y34M31.LSX" })[Symbol.asyncIterator]();
    const first = iterator.next();
    await flushUntil(() => sockets.length === 1);
    await acceptConnection(sockets[0]!);
    const [requestId] = subscriptionIds(sockets[0]!);
    sockets[0]!.receive(`${requestId} A ${JSON.stringify(responseBody)}`);
    await expect(first).resolves.toEqual({ done: false, value: responseBody });

    const next = iterator.next();
    const login = client.login("+49123456789", "1234", { pollIntervalMs: 0 });
    await flushUntil(() => sockets.length === 2);
    await login;
    expect(subscriptionIds(sockets[1]!)).toEqual([]);
    await acceptConnection(sockets[1]!);
    const [restoredId] = subscriptionIds(sockets[1]!);
    sockets[1]!.receive(`${restoredId} A ${JSON.stringify(responseBody)}`);

    await expect(next).resolves.toEqual({ done: false, value: responseBody });
    await iterator.return?.();
  });

  test("fails Secured Topics locally without performing I/O", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const socket = vi.fn();
    const client = new TRClient({ fetch, socket, validate: "throw" });

    await expect(client.cash.get({})).rejects.toBeInstanceOf(TRAuthError);
    const iterator = client.cash.watch({})[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toBeInstanceOf(TRAuthError);
    expect(fetch).not.toHaveBeenCalled();
    expect(socket).not.toHaveBeenCalled();
  });

  test("rejects fields on the empty cash request", async () => {
    const { client: loggedIn } = await loginClient(mockFetch(confirmedLoginResponses()));
    const client = new TRClient({
      session: loggedIn.exportSession(),
      clock: new FakeClock(startTime),
      validate: "throw",
    });

    // @ts-expect-error cash has no request fields.
    expect(() => client.cash.get({ arbitrary: true })).toThrow(TRValidationError);
  });

  test("passes the restored Session to a Secured Topic socket", async () => {
    const loginFetch = mockFetch(confirmedLoginResponses());
    const { client: loggedIn } = await loginClient(loginFetch);
    const socket = new FakeSocket();
    let socketOptions: SocketOptions | undefined;
    const client = new TRClient({
      session: loggedIn.exportSession(),
      clock: new FakeClock(startTime),
      socket: (_url, _protocols, options) => {
        socketOptions = options;
        return socket;
      },
      validate: "throw",
    });

    const cash = client.cash.get({});
    socket.open();
    socket.receive("connected");
    await flush();
    const requestId = Number.parseInt(
      socket.sent.find((line) => line.startsWith("sub "))!.split(" ")[1]!,
      10,
    );
    socket.receive(`${requestId} A [{"accountNumber":"1","currencyId":"EUR","amount":42}]`);

    await expect(cash).resolves.toEqual([{ accountNumber: "1", currencyId: "EUR", amount: 42 }]);
    expect(socketOptions?.headers?.Cookie).toContain("tr_session=");
    expect(socketOptions?.headers?.Cookie).not.toContain("Path=");
    expect(socketOptions?.headers?.Origin).toBe("https://app.traderepublic.com");
  });

  test("marks a Session rejected when Trade Republic rejects Refresh", async () => {
    const fetch = mockFetch([...confirmedLoginResponses(), response({}, [], 401)]);
    const { client, clock } = await loginClient(fetch);

    await expect(client.refresh()).rejects.toBeInstanceOf(TRAuthError);
    expect(client.sessionValidity).toBe("rejected");
    expect(clock.pendingTimerCount).toBe(0);
    await expect(client.cash.get({})).rejects.toBeInstanceOf(TRAuthError);
  });

  test("uses typed HTTP, timeout, and abort failures", async () => {
    const failed = new TRClient({ fetch: mockFetch([response({}, [], 500)]) });
    await expect(failed.login("+49123456789", "1234")).rejects.toMatchObject({
      constructor: TRHttpError,
      status: 500,
    });

    const clock = new FakeClock(startTime);
    const timedOut = new TRClient({
      fetch: vi.fn<Fetch>(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      ),
      clock,
    }).login("+49123456789", "1234", { timeoutMs: 100, pollIntervalMs: 100 });
    clock.advanceBy(100);
    await expect(timedOut).rejects.toBeInstanceOf(TRTimeoutError);

    const controller = new AbortController();
    const aborted = new TRClient({
      fetch: vi.fn<Fetch>(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      ),
    }).login("+49123456789", "1234", { signal: controller.signal });
    controller.abort("stop");
    await expect(aborted).rejects.toBeInstanceOf(TRAbortError);
  });
});
