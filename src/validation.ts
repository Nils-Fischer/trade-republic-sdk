import { type } from "arktype";
import { TRValidationError } from "./errors.ts";

export type ValidationMode = "off" | "warn" | "throw";

export interface ResponseValidation {
  readonly mode: ValidationMode;
  warn(error: TRValidationError): void;
}

interface ResponseSchema<Input, Output> {
  (value: Input): Output | type.errors;
}

function uncheckedResponse<Response, Input>(value: Input): Response {
  // SAFETY: The caller explicitly selected a validation mode that permits invalid responses.
  return value as Input & Response;
}

export function validateResponse<Response, Input = unknown>(
  schema: ResponseSchema<Input, Response>,
  value: Input,
  subject: string,
  validation: ResponseValidation,
): Response {
  if (validation.mode === "off") {
    return uncheckedResponse<Response, Input>(value);
  }

  const result = schema(value);
  if (!(result instanceof type.errors)) return result;

  const error = new TRValidationError(`Invalid response for ${subject}`, { cause: result });
  if (validation.mode === "throw") throw error;
  validation.warn(error);
  return uncheckedResponse<Response, Input>(value);
}
