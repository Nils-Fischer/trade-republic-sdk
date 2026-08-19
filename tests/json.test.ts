import { describe, expect, test } from "vite-plus/test";
import { parseJson } from "../src/json.ts";

describe("parseJson", () => {
  test("accepts a response-like value without the global Response brand", async () => {
    const source = {
      text: async () => JSON.stringify({ processId: "process-id" }),
    };

    expect(source instanceof Response).toBe(false);
    await expect(
      parseJson(source, (value: { processId: string }) => value, {
        onInvalidJson: "throw",
        errorMessage: "invalid JSON",
      }),
    ).resolves.toEqual({ processId: "process-id" });
  });
});
