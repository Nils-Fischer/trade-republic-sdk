import { type } from "arktype";
import { TRValidationError } from "./errors.ts";

export type ValidationMode = "off" | "warn" | "throw";

export interface ResponseValidation {
  readonly mode: ValidationMode;
  warn(error: TRValidationError): void;
}

interface ResponseSchema {
  (value: unknown): unknown;
}

export function validateResponse<Response>(
  schema: ResponseSchema,
  value: unknown,
  subject: string,
  validation: ResponseValidation,
): Response {
  if (validation.mode === "off") return value as Response;

  const result = schema(value);
  if (!(result instanceof type.errors)) return result as Response;

  const error = new TRValidationError(`Invalid response for ${subject}`, { cause: result });
  if (validation.mode === "throw") throw error;
  validation.warn(error);
  return value as Response;
}
