import { TRConnectionError } from "./errors.ts";

export type TimerHandle = unknown;

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
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

/** Creates a socket using the runtime's standard WebSocket implementation. */
export type SocketFactory = (url: string, protocols?: string | string[]) => Socket;

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
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, intervalMs) => globalThis.setInterval(callback, intervalMs),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
};

const realSocket: SocketFactory = (url, protocols) => {
  const NativeSocket = globalThis.WebSocket;
  if (!NativeSocket) {
    throw new TRConnectionError(
      "This runtime has no WebSocket. Inject environment.socket to provide one.",
    );
  }

  return new NativeSocket(url, protocols) as Socket;
};

/** @internal Resolve omitted environment values to their real runtime implementations. */
export function resolveEnvironment(environment: Environment = {}): ResolvedEnvironment {
  return {
    fetch: environment.fetch ?? globalThis.fetch,
    socket: environment.socket ?? realSocket,
    clock: environment.clock ?? realClock,
  };
}
