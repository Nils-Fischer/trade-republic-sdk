import { type } from "arktype";
import { TRTopicError, TRValidationError } from "./errors.ts";
import { parseJson } from "./json.ts";

const topicErrorEnvelopeSchema = type({
  errors: type({
    errorCode: "string",
    "errorMessage?": "string",
  }).array(),
});

export type ProtocolFrame =
  | { requestId: number; kind: "snapshot"; payload: string }
  | { requestId: number; kind: "delta"; payload: string }
  | { requestId: number; kind: "topicError"; error: TRTopicError }
  | { requestId: number; kind: "unsubAck" };

/** Apply a Trade Republic character delta to its preceding JSON payload. */
export function applyDelta(original: string, delta: string): string {
  if (delta === "") return "";

  let result = "";
  let originalIndex = 0;

  for (const token of delta.split("\t")) {
    const operation = token[0];
    const operand = token.slice(1);

    if (operation === "+") {
      try {
        result += decodeURIComponent(operand.replace(/\+/g, " "));
      } catch (cause) {
        throw new TRValidationError(`Invalid encoded delta insertion: ${token}`, { cause });
      }
      continue;
    }

    if ((operation !== "=" && operation !== "-") || !/^\d+$/.test(operand)) {
      throw new TRValidationError(`Invalid delta operation: ${token}`);
    }

    const count = Number.parseInt(operand, 10);
    if (originalIndex + count > original.length) {
      throw new TRValidationError(`Delta operation exceeds its source: ${token}`);
    }

    if (operation === "=") {
      result += original.slice(originalIndex, originalIndex + count);
    }
    originalIndex += count;
  }

  return result;
}

/** Parse one server line. Malformed and unknown lines have no result. */
export function parseFrame(raw: string): ProtocolFrame | undefined {
  const match = /^(\d+) ([ACDE])(?: (.*))?$/s.exec(raw);
  if (!match) return undefined;

  const requestId = Number.parseInt(match[1]!, 10);
  if (!Number.isSafeInteger(requestId)) return undefined;
  const payload = match[3] ?? "";

  switch (match[2]) {
    case "A":
      return { requestId, kind: "snapshot", payload };
    case "D":
      return { requestId, kind: "delta", payload };
    case "C":
      return { requestId, kind: "unsubAck" };
    case "E": {
      const error = parseTopicError(payload);
      return error ? { requestId, kind: "topicError", error } : undefined;
    }
  }

  return undefined;
}

function parseTopicError(payload: string): TRTopicError | undefined {
  return parseJson(
    payload,
    (value) => {
      const envelope = topicErrorEnvelopeSchema(value);
      if (envelope instanceof type.errors || envelope.errors.length === 0) return undefined;

      const first = envelope.errors[0]!;
      return new TRTopicError(
        first.errorCode,
        first.errorMessage ?? "Trade Republic rejected the Topic",
      );
    },
    { onInvalidJson: "ignore" },
  );
}
