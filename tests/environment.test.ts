import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { decodeBase64 } from "../src/encoding.ts";
import { resolveEnvironment } from "../src/environment.ts";
import { TRClient, TRValidationError } from "../src/index.ts";
import { FakeClock } from "../src/testing.ts";

interface SocketConstructorCall {
  readonly url: string;
  readonly second?: string | string[] | object;
  readonly third?: object;
}

function recordingWebSocket(calls: SocketConstructorCall[]): typeof WebSocket {
  return class {
    constructor(url: string, second?: string | string[] | object, third?: object) {
      calls.push({ url, second, third });
    }
  } as unknown as typeof WebSocket;
}

afterEach(() => vi.unstubAllGlobals());

describe("environment", () => {
  test("keeps injected dependencies", () => {
    const clock = new FakeClock();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const socket = vi.fn();

    expect(resolveEnvironment({ clock, fetch, socket })).toMatchObject({ clock, fetch, socket });
  });

  test("resolves real defaults", () => {
    const environment = resolveEnvironment();

    expect(environment.fetch).toBe(globalThis.fetch);
    expect(environment.socket).toBeTypeOf("function");
    expect(environment.clock.now()).toBeGreaterThan(0);
  });

  test("passes authenticated headers through Node WebSocketInit", () => {
    const calls: SocketConstructorCall[] = [];
    vi.stubGlobal("WebSocket", recordingWebSocket(calls));

    resolveEnvironment().socket("wss://example.test", ["protocol"], {
      headers: { Cookie: "session=abc" },
    });

    expect(calls).toEqual([
      {
        url: "wss://example.test",
        second: {
          protocols: ["protocol"],
          headers: { Cookie: "session=abc" },
        },
        third: undefined,
      },
    ]);
  });

  test("passes authenticated headers through React Native socket options", () => {
    const calls: SocketConstructorCall[] = [];
    vi.stubGlobal("WebSocket", recordingWebSocket(calls));
    vi.stubGlobal("navigator", { product: "ReactNative" });

    resolveEnvironment().socket("wss://example.test", ["protocol"], {
      headers: { Cookie: "session=abc" },
    });

    expect(calls).toEqual([
      {
        url: "wss://example.test",
        second: ["protocol"],
        third: { headers: { Cookie: "session=abc" } },
      },
    ]);
  });

  test("does not require browser encoding globals in React Native", () => {
    vi.stubGlobal("navigator", { product: "ReactNative" });
    vi.stubGlobal("TextEncoder", undefined);
    vi.stubGlobal("btoa", undefined);
    vi.stubGlobal("atob", undefined);

    const environment = resolveEnvironment();

    expect(environment.deviceInfo).toBeTypeOf("string");
    expect(decodeBase64("eyJpYXQiOjEsImV4cCI6Mn0=")).toBe('{"iat":1,"exp":2}');
    expect(() => new TRClient()).not.toThrow();
  });

  test("advances time and scheduled work without waiting", () => {
    const clock = new FakeClock(1_000);
    const callback = vi.fn();
    const client = new TRClient({ clock });

    clock.setTimeout(callback, 300_000);
    clock.advanceBy(299_999);
    expect(callback).not.toHaveBeenCalled();

    clock.advanceBy(1);
    expect(callback).toHaveBeenCalledOnce();
    expect(clock.now()).toBe(301_000);
    expect(client).toBeInstanceOf(TRClient);
  });

  test("reschedules and cancels intervals", () => {
    const clock = new FakeClock();
    const callback = vi.fn();
    const timer = clock.setInterval(callback, 2_500);

    clock.advanceBy(7_500);
    clock.clearInterval(timer);
    clock.advanceBy(2_500);

    expect(callback).toHaveBeenCalledTimes(3);
    expect(clock.pendingTimerCount).toBe(0);
  });

  test("rejects attempts to move time backwards with an SDK error", () => {
    const clock = new FakeClock(1_000);

    expect(() => clock.advanceBy(-1)).toThrow(TRValidationError);
    expect(() => clock.advanceTo(999)).toThrow(TRValidationError);
  });
});
