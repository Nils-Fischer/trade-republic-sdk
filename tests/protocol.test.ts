import { describe, expect, test } from "vite-plus/test";
import { applyDelta, TRValidationError } from "../src/index.ts";

describe("Trade Republic deltas", () => {
  test.each([
    ["Hello World", "=5\t-6\t+Universe", "HelloUniverse"],
    ["Hello World", "", ""],
    ["Hello World", "=11", "Hello World"],
    ["Hello", "=5\t+World", "HelloWorld"],
    ["Hello World", "=5\t-6", "Hello"],
    ["Hello World", "=5\t-1\t+%20\t=5", "Hello World"],
    ["", "+Hello+World%21", "Hello World!"],
  ])("applies character operations", (original, delta, expected) => {
    expect(applyDelta(original, delta)).toBe(expected);
  });

  test.each(["copy", "=12", "--1", "+%ZZ"])("rejects a malformed operation", (delta) => {
    expect(() => applyDelta("Hello World", delta)).toThrow(TRValidationError);
  });
});
