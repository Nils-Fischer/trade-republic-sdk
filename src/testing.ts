import type { Clock, TimerHandle } from "./environment.ts";
import { TRValidationError } from "./errors.ts";

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
    this.#timers.delete(handle as number);
  }

  setInterval(callback: () => void, intervalMs: number): TimerHandle {
    return this.#schedule(callback, Math.max(1, intervalMs), Math.max(1, intervalMs));
  }

  clearInterval(handle: TimerHandle): void {
    this.#timers.delete(handle as number);
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
