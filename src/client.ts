import { createConnection, type Connection, type SubscriptionControl } from "./connection.ts";
import {
  resolveEnvironment,
  type Environment,
  type ResolvedEnvironment,
  type TimerHandle,
} from "./environment.ts";
import {
  TRAbortError,
  TRAuthError,
  TRTimeoutError,
  TRTopicError,
  TRValidationError,
} from "./errors.ts";
import {
  decodeResourceResponse,
  resourceNames,
  resourceRegistry,
  type ResourceName,
  type ResourceResponse,
} from "./resources.ts";
import {
  createSession,
  type GetOptions as SessionGetOptions,
  type LoginOptions,
  type Session,
  type SessionValidity,
} from "./session.ts";
import {
  decodeTopicResponse,
  encodeTopicRequest,
  isSecuredTopic,
  topicNames,
  type TopicName,
  type TopicRequest,
  type TopicResponse,
  type TimelineTransaction,
} from "./topics.ts";
import type { ResponseValidation, ValidationMode } from "./validation.ts";

export type GetOptions = SessionGetOptions;

export interface TRClientOptions extends Environment {
  validate?: ValidationMode;
  onValidationWarning?: (warning: TRValidationError) => void;
  session?: string;
}

export interface TopicAccessor<Name extends TopicName> {
  get(request: TopicRequest<Name>, options?: GetOptions): Promise<TopicResponse<Name>>;
  watch(request: TopicRequest<Name>): AsyncIterable<TopicResponse<Name>>;
}

export interface ResourceAccessor<Response> {
  get(options?: GetOptions): Promise<Response>;
}

export interface GetTimelineTransactionsOptions {
  from: Date;
  to?: Date;
  signal?: AbortSignal;
  pageTimeoutMs?: number;
  maxPages?: number;
}

type NamedTopicAccessors = {
  readonly [Name in TopicName]: TopicAccessor<Name>;
};

type NamedResourceAccessors = {
  readonly [Name in ResourceName]: ResourceAccessor<ResourceResponse<Name>>;
};

const DEFAULT_TIMELINE_PAGE_TIMEOUT_MS = 15_000;

const duplicateAccessorName = resourceNames.find((name) => topicNames.includes(name as TopicName));
if (duplicateAccessorName) {
  throw new Error(`Duplicate TRClient accessor name "${duplicateAccessorName}"`);
}

/** The complete client for Trade Republic Topics and HTTP resources. */
// oxlint-disable-next-line typescript/no-unsafe-declaration-merging -- The Registry installs the merged accessors in the constructor.
export class TRClient {
  readonly #environment: ResolvedEnvironment;
  readonly #session: Session;
  readonly #connection: Connection;
  readonly #responseValidation: ResponseValidation;
  #connectionUpdate: Promise<void> | undefined;

  constructor(options: TRClientOptions = {}) {
    this.#environment = resolveEnvironment(options);
    this.#session = createSession(this.#environment, options.session);
    this.#connection = createConnection(this.#environment, () => this.#session.cookieHeader);
    this.#responseValidation = {
      mode: options.validate ?? "warn",
      warn: options.onValidationWarning ?? ((warning) => console.warn(warning)),
    };
    topicNames.forEach((name) => {
      Object.defineProperty(this, name, {
        enumerable: true,
        value: this.topic(name),
      });
    });
    resourceNames.forEach((name) => {
      Object.defineProperty(this, name, {
        enumerable: true,
        value: {
          get: (options?: GetOptions) => this.#getResource(name, options),
        },
      });
    });
  }

  /** True after the latest Echo has returned unchanged. */
  get isAlive(): boolean {
    return this.#connection.isAlive;
  }

  /** Whether this client has a Session that Trade Republic has not rejected. */
  get sessionValidity(): SessionValidity {
    return this.#session.validity;
  }

  /** Establish a Session and wait for approval in the Trade Republic app. */
  async login(phoneNumber: string, pin: string, options?: LoginOptions): Promise<void> {
    await this.#session.login(phoneNumber, pin, options);
    const update = this.#connection.reconnectAfterLogin();
    if (!update) return;
    this.#connectionUpdate = update;
    void update
      .finally(() => {
        if (this.#connectionUpdate === update) this.#connectionUpdate = undefined;
      })
      .catch(() => undefined);
  }

  /** Refresh the current Session. Concurrent callers share the same request. */
  refresh(): Promise<void> {
    return this.#session.refresh();
  }

  /** Return the current Session as an opaque serializable string. */
  exportSession(): string | undefined {
    return this.#session.export();
  }

  /** Clear the Session and close the connection. */
  logout(): void {
    this.#session.logout();
    this.#connection.disconnect();
    this.#connectionUpdate = undefined;
  }

  /** Address a Topic whose name is chosen at runtime. */
  topic<Name extends TopicName>(name: Name): TopicAccessor<Name> {
    return {
      get: (request, options) => this.#get(name, request, options),
      watch: (request) => this.#watch(name, request),
    };
  }

  /** Read and combine bounded raw timeline pages, newest first. */
  async getTimelineTransactions(
    options: GetTimelineTransactionsOptions,
  ): Promise<TimelineTransaction[]> {
    const from = validDateTimestamp(options.from, "from");
    const to = validDateTimestamp(options.to ?? new Date(), "to");
    if (from >= to) throw new TRValidationError("from must be before to");

    const maxPages = options.maxPages ?? 1_000;
    if (!Number.isInteger(maxPages) || maxPages <= 0) {
      throw new TRValidationError("maxPages must be a positive integer");
    }
    if (options.signal?.aborted) {
      throw new TRAbortError("Timeline pagination was aborted", {
        cause: options.signal.reason,
      });
    }

    const transactions = new Map<string, TimelineTransaction>();
    const cursors = new Set<string>();
    let after: string | undefined;
    let previousPageOldest = Number.POSITIVE_INFINITY;

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const page = await this.timelineTransactions.get(after ? { after } : {}, {
        signal: options.signal,
        timeoutMs: options.pageTimeoutMs ?? DEFAULT_TIMELINE_PAGE_TIMEOUT_MS,
      });
      let previousTimestamp = Number.POSITIVE_INFINITY;
      let pageNewest: number | undefined;
      let pageOldest: number | undefined;
      let crossedFrom = false;

      for (const transaction of page.items) {
        const timestamp = Date.parse(transaction.timestamp);
        if (!Number.isFinite(timestamp)) {
          throw new TRValidationError(
            `Timeline transaction "${transaction.id}" has an invalid timestamp`,
          );
        }
        if (timestamp > previousTimestamp) {
          throw new TRValidationError("Timeline page is not ordered newest-first");
        }
        previousTimestamp = timestamp;
        pageNewest ??= timestamp;
        pageOldest = timestamp;

        if (timestamp < from) crossedFrom = true;
        if (timestamp >= from && timestamp < to && !transactions.has(transaction.id)) {
          transactions.set(transaction.id, transaction);
        }
      }

      if (pageNewest !== undefined && pageNewest > previousPageOldest) {
        throw new TRValidationError("Timeline pages overlap out of order");
      }
      if (pageOldest !== undefined) previousPageOldest = pageOldest;
      if (crossedFrom) return newestFirst(transactions);

      const next = page.cursors.after;
      if (!next) return newestFirst(transactions);
      if (cursors.has(next)) {
        throw new TRValidationError(`Timeline pagination returned repeated cursor "${next}"`);
      }
      cursors.add(next);
      if (pageNumber === maxPages) {
        throw new TRValidationError(`Timeline pagination reached maxPages (${maxPages})`);
      }
      after = next;
    }

    throw new TRValidationError("Timeline pagination ended unexpectedly");
  }

  async #getResource<Name extends ResourceName>(
    name: Name,
    options: GetOptions = {},
  ): Promise<ResourceResponse<Name>> {
    const response = await this.#session.get(resourceRegistry[name].path, options);
    return decodeResourceResponse(name, response, this.#responseValidation);
  }

  #get<Name extends TopicName>(
    name: Name,
    request: TopicRequest<Name>,
    options: GetOptions = {},
  ): Promise<TopicResponse<Name>> {
    if (isSecuredTopic(name) && this.#session.validity !== "presumed-valid") {
      return Promise.reject(new TRAuthError(`Topic "${name}" requires a Session`));
    }
    const payload = encodeTopicRequest(name, request);

    return new Promise<TopicResponse<Name>>((resolve, reject) => {
      let subscription: SubscriptionControl | undefined;
      let timeoutHandle: TimerHandle;
      let hasTimeout = false;
      let finished = false;
      let recovered = false;

      const cleanUp = (): void => {
        if (hasTimeout) this.#environment.clock.clearTimeout(timeoutHandle);
        options.signal?.removeEventListener("abort", abort);
      };
      const finish = (action: () => void): void => {
        if (finished) return;
        finished = true;
        cleanUp();
        subscription?.unsubscribe();
        action();
      };
      const fail = (error: Error): void => {
        if (this.#isAuthenticationError(error)) {
          if (recovered) {
            finish(() => reject(this.#session.markRejected(error)));
            return;
          }
          recovered = true;
          void this.#recoverConnection(error).then(subscribe).catch(fail);
          return;
        }
        finish(() => reject(error));
      };
      const abort = (): void => {
        fail(
          new TRAbortError(`Get for Topic "${name}" was aborted`, {
            cause: options.signal?.reason,
          }),
        );
      };

      if (options.signal?.aborted) {
        abort();
        return;
      }
      options.signal?.addEventListener("abort", abort, { once: true });

      if (options.timeoutMs !== undefined) {
        hasTimeout = true;
        timeoutHandle = this.#environment.clock.setTimeout(() => {
          fail(
            new TRTimeoutError(
              `Get for Topic "${name}" timed out after ${options.timeoutMs} ms`,
              options.timeoutMs,
            ),
          );
        }, options.timeoutMs);
      }

      const subscribe = (): void => {
        if (finished) return;
        subscription = this.#connection.subscribe(
          payload,
          (rawPayload) => decodeTopicResponse(name, rawPayload, this.#responseValidation),
          {
            next: (value) => finish(() => resolve(value)),
            error: fail,
          },
        );
      };

      void this.#connect().then(subscribe).catch(fail);
    });
  }

  async *#watch<Name extends TopicName>(
    name: Name,
    request: TopicRequest<Name>,
  ): AsyncIterableIterator<TopicResponse<Name>> {
    if (isSecuredTopic(name) && this.#session.validity !== "presumed-valid") {
      throw new TRAuthError(`Topic "${name}" requires a Session`);
    }
    const payload = encodeTopicRequest(name, request);
    let recovered = false;

    for (;;) {
      try {
        yield* this.#watchSubscription(name, payload);
        return;
      } catch (error) {
        if (!(error instanceof Error) || !this.#isAuthenticationError(error)) throw error;
        if (recovered) throw this.#session.markRejected(error);
        recovered = true;
        await this.#recoverConnection(error);
      }
    }
  }

  async *#watchSubscription<Name extends TopicName>(
    name: Name,
    payload: object,
  ): AsyncIterableIterator<TopicResponse<Name>> {
    let latest: TopicResponse<Name> | undefined;
    let failure: Error | undefined;
    let wake: (() => void) | undefined;

    await this.#connect();
    const subscription = this.#connection.subscribe(
      payload,
      (rawPayload) => decodeTopicResponse(name, rawPayload, this.#responseValidation),
      {
        next: (value) => {
          latest = value;
          wake?.();
          wake = undefined;
        },
        error: (error) => {
          failure = error;
          wake?.();
          wake = undefined;
        },
      },
    );

    try {
      for (;;) {
        if (failure) throw failure;
        if (latest !== undefined) {
          const value = latest;
          latest = undefined;
          yield value;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      subscription.unsubscribe();
    }
  }

  #isAuthenticationError(error: Error): error is TRTopicError {
    return error instanceof TRTopicError && error.errorCode === "AUTHENTICATION_ERROR";
  }

  #connect(): Promise<void> {
    return (
      this.#connectionUpdate?.then(() => this.#connection.connect()) ?? this.#connection.connect()
    );
  }

  async #recoverConnection(error: TRTopicError): Promise<void> {
    await this.#session.recover(error);
    if (this.#session.validity !== "presumed-valid") {
      throw new TRAuthError("The Session changed during authentication recovery");
    }
    await this.#connection.reconnect();
  }
}

function validDateTimestamp(date: Date, optionName: string): number {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TRValidationError(`${optionName} must be a valid Date`);
  }
  return date.getTime();
}

function newestFirst(
  transactions: ReadonlyMap<string, TimelineTransaction>,
): TimelineTransaction[] {
  return [...transactions.values()].sort(
    (left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp),
  );
}

export interface TRClient extends NamedTopicAccessors, NamedResourceAccessors {}
