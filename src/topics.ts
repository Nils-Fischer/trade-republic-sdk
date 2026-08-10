import { type } from "arktype";
import { TRValidationError } from "./errors.ts";

const quoteSchema = type({
  time: "number",
  price: "string",
  size: "number",
});

export const TickerRequestSchema = type({
  id: type("string").matching(/^[A-Z0-9.]+\.[A-Z]{2,6}$/),
});

export type TickerRequest = typeof TickerRequestSchema.infer;

export const TickerResponseSchema = type({
  bid: quoteSchema,
  ask: quoteSchema,
  last: quoteSchema,
  pre: quoteSchema,
  "open?": quoteSchema,
  qualityId: "string",
  leverage: "null",
  delta: "null",
});

export type TickerResponse = typeof TickerResponseSchema.infer;

/** The single source of truth for Trade Republic WebSocket Topics. */
export const topicRegistry = {
  ticker: {
    request: TickerRequestSchema,
    response: TickerResponseSchema,
    secured: false,
  },
} as const;

export type TopicName = keyof typeof topicRegistry;
export type TopicRequest<Name extends TopicName> = (typeof topicRegistry)[Name]["request"]["infer"];
export type TopicResponse<Name extends TopicName> =
  (typeof topicRegistry)[Name]["response"]["infer"];

export type ValidationMode = "off" | "warn" | "throw";

export interface ResponseValidation {
  readonly mode: ValidationMode;
  warn(error: TRValidationError): void;
}

export const topicNames = Object.keys(topicRegistry).filter(isTopicName);

function isTopicName(name: string): name is TopicName {
  return Object.hasOwn(topicRegistry, name);
}

function assertTopicRequest<Name extends TopicName>(
  name: Name,
  request: TopicRequest<Name>,
): TopicRequest<Name> {
  try {
    return topicRegistry[name].request.assert(request) as TopicRequest<Name>;
  } catch (cause) {
    throw new TRValidationError(`Invalid request for Topic "${name}"`, { cause });
  }
}

export function encodeTopicRequest<Name extends TopicName>(
  name: Name,
  request: TopicRequest<Name>,
) {
  return {
    type: name,
    ...assertTopicRequest(name, request),
  };
}

export function decodeTopicResponse<Name extends TopicName>(
  name: Name,
  payload: string,
  validation: ResponseValidation,
): TopicResponse<Name> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    // A malformed Frame is ignored in every validation mode.
    return undefined;
  }

  if (validation.mode === "off") return value as TopicResponse<Name>;

  const response = topicRegistry[name].response(value);
  if (!(response instanceof type.errors)) return response as TopicResponse<Name>;

  reportInvalidResponse(
    validation,
    new TRValidationError(`Invalid response for Topic "${name}"`, { cause: response }),
  );
  return value as TopicResponse<Name>;
}

function reportInvalidResponse(validation: ResponseValidation, error: TRValidationError): void {
  if (validation.mode === "throw") throw error;
  if (validation.mode === "warn") validation.warn(error);
}
