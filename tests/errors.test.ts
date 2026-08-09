import { describe, expect, test } from "vite-plus/test";
import {
  TRAbortError,
  TRAuthError,
  TRConnectionError,
  TRError,
  TRHttpError,
  TRTimeoutError,
  TRTopicError,
  TRValidationError,
} from "../src/index.ts";

describe("SDK errors", () => {
  test.each([
    new TRAuthError("Session rejected"),
    new TRHttpError(503, "Unavailable"),
    new TRTopicError("AUTHENTICATION_ERROR", "Session rejected"),
    new TRValidationError("Invalid payload"),
    new TRTimeoutError("No reply", 1_000),
    new TRConnectionError("Socket closed"),
    new TRAbortError("Stopped"),
  ])("$name inherits from TRError", (error) => {
    expect(error).toBeInstanceOf(TRError);
    expect(error.name).toBe(error.constructor.name);
  });

  test("Topic Error preserves the wire code and message", () => {
    const error = new TRTopicError("AUTHENTICATION_ERROR", "Session rejected");

    expect(error.errorCode).toBe("AUTHENTICATION_ERROR");
    expect(error.message).toBe("Session rejected");
  });

  test("abort and timeout failures are distinct", () => {
    expect(new TRAbortError("Stopped")).not.toBeInstanceOf(TRTimeoutError);
  });
});
