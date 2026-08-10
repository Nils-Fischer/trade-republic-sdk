import type {
  Clock,
  Socket,
  SocketCloseEvent,
  SocketErrorEvent,
  SocketMessageEvent,
  TimerHandle,
} from "./environment.ts";
import { TRConnectionError, TRValidationError } from "./errors.ts";

interface ScheduledTimer {
  callback: () => void;
  dueAt: number;
  intervalMs?: number;
}

/** A deterministic clock for tests that exercise timer-driven SDK behaviour. */
export class FakeClock implements Clock {
  #now: number;
  #nextId = 1;
  readonly #timers = new Map<number, ScheduledTimer>();

  constructor(startTime = 0) {
    this.#now = startTime;
  }

  now(): number {
    return this.#now;
  }

  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    return this.#schedule(callback, delayMs);
  }

  clearTimeout(handle: TimerHandle): void {
    if (typeof handle === "number") this.#timers.delete(handle);
  }

  setInterval(callback: () => void, intervalMs: number): TimerHandle {
    return this.#schedule(callback, Math.max(1, intervalMs), Math.max(1, intervalMs));
  }

  clearInterval(handle: TimerHandle): void {
    if (typeof handle === "number") this.#timers.delete(handle);
  }

  advanceBy(durationMs: number): void {
    if (durationMs < 0) {
      throw new TRValidationError("durationMs must not be negative");
    }

    this.advanceTo(this.#now + durationMs);
  }

  advanceTo(time: number): void {
    if (time < this.#now) {
      throw new TRValidationError("time must not move backwards");
    }

    for (;;) {
      const next = this.#nextTimer(time);
      if (!next) break;

      const [id, timer] = next;
      this.#now = timer.dueAt;

      if (timer.intervalMs === undefined) {
        this.#timers.delete(id);
      } else {
        timer.dueAt += timer.intervalMs;
      }

      timer.callback();
    }

    this.#now = time;
  }

  get pendingTimerCount(): number {
    return this.#timers.size;
  }

  #schedule(callback: () => void, delayMs: number, intervalMs?: number): number {
    const id = this.#nextId++;
    this.#timers.set(id, {
      callback,
      dueAt: this.#now + Math.max(0, delayMs),
      intervalMs,
    });
    return id;
  }

  #nextTimer(limit: number): [number, ScheduledTimer] | undefined {
    let next: [number, ScheduledTimer] | undefined;

    for (const entry of this.#timers) {
      if (entry[1].dueAt > limit) continue;
      if (
        !next ||
        entry[1].dueAt < next[1].dueAt ||
        (entry[1].dueAt === next[1].dueAt && entry[0] < next[0])
      ) {
        next = entry;
      }
    }

    return next;
  }
}

/** A controllable WebSocket for tests that drive the SDK through its environment seam. */
export class FakeSocket implements Socket {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readonly sent: string[] = [];
  readonly #clock?: Clock;
  onopen: (() => void) | null = null;
  onmessage: ((event: SocketMessageEvent) => void) | null = null;
  onerror: ((event: SocketErrorEvent) => void) | null = null;
  onclose: ((event: SocketCloseEvent) => void) | null = null;
  readyState = this.CONNECTING;

  constructor(clock?: Clock) {
    this.#clock = clock;
  }

  send(data: string): void {
    if (this.readyState !== this.OPEN) {
      throw new TRConnectionError("The fake socket is not open");
    }
    this.sent.push(data);
  }

  close(code = 1_000, reason = ""): void {
    this.#close(code, reason, true);
  }

  /** Report that the transport is open. The server handshake remains separate. */
  open(): void {
    if (this.readyState !== this.CONNECTING) {
      throw new TRValidationError("Only a connecting fake socket can open");
    }
    this.readyState = this.OPEN;
    this.onopen?.();
  }

  /** Deliver any server line now, or after fake-clock time advances. */
  receive(data: string, delayMs = 0): void {
    if (delayMs < 0) throw new TRValidationError("delayMs must not be negative");
    if (delayMs === 0) {
      this.#deliver(data);
      return;
    }
    if (!this.#clock) {
      throw new TRValidationError("A delayed reply requires a FakeSocket clock");
    }
    this.#clock.setTimeout(() => this.#deliver(data), delayMs);
  }

  /** Drop the transport as if the network disappeared. */
  drop(code = 1_006, reason = "Connection lost"): void {
    this.#close(code, reason, false);
  }

  fail(cause: unknown = new Error("Fake socket failure")): void {
    this.onerror?.({ error: cause });
  }

  #deliver(data: string): void {
    if (this.readyState !== this.OPEN) {
      throw new TRConnectionError("The fake socket is not open");
    }
    this.onmessage?.({ data });
  }

  #close(code: number, reason: string, wasClean: boolean): void {
    if (this.readyState === this.CLOSED) return;
    this.readyState = this.CLOSED;
    this.onclose?.({ code, reason, wasClean });
  }
}
