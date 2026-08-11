import { TRConnectionError } from "./errors.ts";
import { encodeBase64 } from "./encoding.ts";

export type TimerHandle = number | ReturnType<typeof globalThis.setTimeout>;

/** Time and timer operations used by the SDK. */
export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(callback: () => void, intervalMs: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
}

/** The WebSocket surface used by the transport. */
export interface Socket {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: SocketMessageEvent) => void) | null;
  onerror: ((event: SocketErrorEvent) => void) | null;
  onclose: ((event: SocketCloseEvent) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface SocketMessageEvent {
  readonly data: string;
}

export interface SocketCloseEvent {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}

export interface SocketErrorEvent {
  readonly error?: unknown;
}

export interface SocketOptions {
  readonly headers?: Readonly<Record<string, string>>;
}

/** Creates a socket using the runtime's standard WebSocket implementation. */
export type SocketFactory = (
  url: string,
  protocols?: string | string[],
  options?: SocketOptions,
) => Socket;

export type Fetch = typeof globalThis.fetch;

/** The SDK's only injection point for impure dependencies. */
export interface Environment {
  fetch?: Fetch;
  socket?: SocketFactory;
  clock?: Clock;
}

export interface ResolvedEnvironment {
  fetch: Fetch;
  socket: SocketFactory;
  clock: Clock;
  createAbortController(): AbortController;
  parseDate(value: string): number;
  deviceInfo: string;
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
  setInterval: (callback, intervalMs) => globalThis.setInterval(callback, intervalMs),
  clearInterval: (handle) => globalThis.clearInterval(handle),
};

const stableDeviceId =
  globalThis.crypto?.randomUUID?.().replaceAll("-", "") ??
  Math.random().toString(16).slice(2).padEnd(32, "0").slice(0, 32);

function createDeviceInfo(): string {
  const runtimeNavigator = globalThis.navigator as
    | (Navigator & { deviceMemory?: number })
    | undefined;
  const runtimeScreen = (
    globalThis as typeof globalThis & {
      screen?: { width: number; height: number; colorDepth: number };
    }
  ).screen;

  return encodeBase64(
    JSON.stringify({
      stableDeviceId,
      model: "Apple Macintosh",
      browser: "Chrome",
      browserVersion: "150.0.0.0",
      os: "Mac OS",
      osVersion: "10.15.7",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timezoneOffset: new Date().getTimezoneOffset(),
      screen: runtimeScreen
        ? `${runtimeScreen.width}x${runtimeScreen.height}x${runtimeScreen.colorDepth}`
        : "1470x956x30",
      preferredLanguages: runtimeNavigator?.languages ?? ["en-US"],
      numberOfCores: runtimeNavigator?.hardwareConcurrency ?? 4,
      deviceMemory: runtimeNavigator?.deviceMemory ?? 16,
    }),
  );
}

interface ReactNativeSocketConstructor {
  new (url: string, protocols?: string | string[], options?: SocketOptions): Socket;
}

interface NodeSocketConstructor {
  new (url: string, options: SocketOptions & { protocols?: string | string[] }): Socket;
}

function isReactNative(): boolean {
  return (
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { product?: string }).product === "ReactNative"
  );
}

function isNode(): boolean {
  return typeof process !== "undefined" && process.versions?.node !== undefined;
}

const realSocket: SocketFactory = (url, protocols, options) => {
  const NativeSocket = globalThis.WebSocket;
  if (!NativeSocket) {
    throw new TRConnectionError(
      "This runtime has no WebSocket. Inject environment.socket to provide one.",
    );
  }

  if (isReactNative()) {
    return new (NativeSocket as unknown as ReactNativeSocketConstructor)(url, protocols, options);
  }
  if (isNode() && options) {
    return new (NativeSocket as unknown as NodeSocketConstructor)(url, {
      ...options,
      ...(protocols === undefined ? {} : { protocols }),
    });
  }
  return new NativeSocket(url, protocols) as Socket;
};

/** @internal Resolve omitted environment values to their real runtime implementations. */
export function resolveEnvironment(environment: Environment = {}): ResolvedEnvironment {
  return {
    fetch: environment.fetch ?? globalThis.fetch,
    socket: environment.socket ?? realSocket,
    clock: environment.clock ?? realClock,
    createAbortController: () => new AbortController(),
    parseDate: (value) => Date.parse(value),
    deviceInfo: createDeviceInfo(),
  };
}
