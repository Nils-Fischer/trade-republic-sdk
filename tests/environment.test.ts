import { describe, expect, test, vi } from "vite-plus/test";
import { resolveEnvironment } from "../src/environment.ts";
import { TRClient, TRValidationError } from "../src/index.ts";
import { FakeClock } from "../src/testing.ts";

describe("environment", () => {
  test("keeps injected dependencies", () => {
    const clock = new FakeClock();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const socket = vi.fn();

    expect(resolveEnvironment({ clock, fetch, socket })).toEqual({ clock, fetch, socket });
  });

  test("resolves real defaults", () => {
    const environment = resolveEnvironment();

    expect(environment.fetch).toBe(globalThis.fetch);
    expect(environment.socket).toBeTypeOf("function");
    expect(environment.clock.now()).toBeGreaterThan(0);
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
