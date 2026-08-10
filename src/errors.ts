export interface TRErrorOptions {
  cause?: unknown;
}

/** The root class for every error raised by this SDK. */
export class TRError extends Error {
  constructor(message: string, options?: TRErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Trade Republic rejected or could not establish a Session. */
export class TRAuthError extends TRError {}

/** A Trade Republic HTTP resource returned an unsuccessful status. */
export class TRHttpError extends TRError {
  readonly status: number;

  constructor(status: number, message: string, options?: TRErrorOptions) {
    super(message, options);
    this.status = status;
  }
}

/** Trade Republic rejected one Subscription while the connection stayed open. */
export class TRTopicError extends TRError {
  readonly errorCode: string;

  constructor(errorCode: string, message: string, options?: TRErrorOptions) {
    super(message, options);
    this.errorCode = errorCode;
  }
}

/** A value did not match its runtime schema. */
export class TRValidationError extends TRError {}

/** An operation did not finish before its deadline. */
export class TRTimeoutError extends TRError {
  readonly timeoutMs?: number;

  constructor(message: string, timeoutMs?: number, options?: TRErrorOptions) {
    super(message, options);
    this.timeoutMs = timeoutMs;
  }
}

/** A connection could not be opened or was lost. */
export class TRConnectionError extends TRError {}

export function toConnectionError(message: string, cause: unknown): TRConnectionError {
  return cause instanceof TRConnectionError ? cause : new TRConnectionError(message, { cause });
}

/** The caller cancelled an operation. */
export class TRAbortError extends TRError {}
