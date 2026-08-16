import {
  createConnection,
  type Connection,
  type ConnectionSnapshot,
  type SubscriptionControl,
} from "./connection.ts";
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
  type SessionSnapshot,
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

export interface ClientStateStore<Snapshot> {
  getSnapshot(): Snapshot;
  subscribe(onChange: () => void): () => void;
}

type NamedTopicAccessors = {
  readonly [Name in TopicName]: TopicAccessor<Name>;
};

type NamedResourceAccessors = {
  readonly [Name in ResourceName]: ResourceAccessor<ResourceResponse<Name>>;
};

interface AccountClientInternals {
  now(): number;
  subscriptionCount(): number;
  watch<Name extends TopicName>(
    name: Name,
    request: TopicRequest<Name>,
    signal: AbortSignal,
    onSubscribed: () => void,
  ): AsyncIterable<TopicResponse<Name>>;
}

const accountClientInternals = new WeakMap<TRClient, AccountClientInternals>();

const DEFAULT_TIMELINE_PAGE_TIMEOUT_MS = 15_000;

const topicNameSet = new Set<string>(topicNames);
const duplicateAccessorName = resourceNames.find((name) => topicNameSet.has(name));
if (duplicateAccessorName) {
  throw new Error(`Duplicate TRClient accessor name "${duplicateAccessorName}"`);
}

/** The complete client for Trade Republic Topics and HTTP resources. */
// oxlint-disable-next-line typescript/no-unsafe-declaration-merging -- The Registry installs the merged accessors in the constructor.
export class TRClient {
  readonly session: ClientStateStore<SessionSnapshot>;
  readonly connection: ClientStateStore<ConnectionSnapshot>;
  readonly #environment: ResolvedEnvironment;
  readonly #session: Session;
  readonly #connection: Connection;
  readonly #responseValidation: ResponseValidation;
  #connectionUpdate: Promise<void> | undefined;
  #subscriptionCount = 0;

  constructor(options: TRClientOptions = {}) {
    this.#environment = resolveEnvironment(options);
    this.#session = createSession(this.#environment, options.session);
    this.#connection = createConnection(this.#environment, () => this.#session.cookieHeader);
    this.session = Object.freeze({
      getSnapshot: () => this.#session.getSnapshot(),
      subscribe: (onChange: () => void) => this.#session.subscribe(onChange),
    });
    this.connection = Object.freeze({
      getSnapshot: () => this.#connection.getSnapshot(),
      subscribe: (onChange: () => void) => this.#connection.subscribeState(onChange),
    });
    this.#responseValidation = {
      mode: options.validate ?? "warn",
      warn: options.onValidationWarning ?? ((warning) => console.warn(warning)),
    };
    accountClientInternals.set(this, {
      now: () => this.#environment.clock.now(),
      subscriptionCount: () => this.#subscriptionCount,
      watch: (name, request, signal, onSubscribed) =>
        this.#watch(name, request, signal, onSubscribed),
    });
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
        if (timestamp >= from && timestamp < to) {
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

      const unsubscribe = (): void => {
        subscription = this.#closeSubscription(subscription);
      };

      const cleanUp = (): void => {
        if (hasTimeout) this.#environment.clock.clearTimeout(timeoutHandle);
        options.signal?.removeEventListener("abort", abort);
      };
      const finish = (action: () => void): void => {
        if (finished) return;
        finished = true;
        cleanUp();
        unsubscribe();
        action();
      };
      const fail = (error: Error): void => {
        if (this.#isAuthenticationError(error)) {
          unsubscribe();
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
          "fail",
        );
        this.#subscriptionCount += 1;
      };

      void this.#connect().then(subscribe).catch(fail);
    });
  }

  async *#watch<Name extends TopicName>(
    name: Name,
    request: TopicRequest<Name>,
    signal?: AbortSignal,
    onSubscribed?: () => void,
  ): AsyncIterableIterator<TopicResponse<Name>> {
    if (isSecuredTopic(name) && this.#session.validity !== "presumed-valid") {
      throw new TRAuthError(`Topic "${name}" requires a Session`);
    }
    const payload = encodeTopicRequest(name, request);

    yield* this.#watchWithRecovery(name, payload, signal, onSubscribed, false);
  }

  async *#watchWithRecovery<Name extends TopicName, Payload>(
    name: Name,
    payload: Payload,
    signal: AbortSignal | undefined,
    onSubscribed: (() => void) | undefined,
    recovered: boolean,
  ): AsyncIterableIterator<TopicResponse<Name>> {
    try {
      yield* this.#watchSubscription(name, payload, signal, onSubscribed);
    } catch (error) {
      if (!(error instanceof Error) || !this.#isAuthenticationError(error)) throw error;
      if (recovered) throw this.#session.markRejected(error);
      await this.#recoverConnection(error);
      yield* this.#watchWithRecovery(name, payload, signal, onSubscribed, true);
    }
  }

  async *#watchSubscription<Name extends TopicName, Payload>(
    name: Name,
    payload: Payload,
    signal?: AbortSignal,
    onSubscribed?: () => void,
  ): AsyncIterableIterator<TopicResponse<Name>> {
    let pendingValues: TopicResponse<Name>[] = [];
    let pendingValueIndex = 0;
    let failure: Error | undefined;
    let wake: (() => void) | undefined;
    let rejectConnection: ((error: Error) => void) | undefined;
    let subscription: SubscriptionControl | undefined;

    const unsubscribe = (): void => {
      subscription = this.#closeSubscription(subscription);
    };

    const abort = (): void => {
      failure = new TRAbortError(`Watch for Topic "${name}" was aborted`, {
        cause: signal?.reason,
      });
      unsubscribe();
      rejectConnection?.(failure);
      wake?.();
      wake = undefined;
    };

    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
      if (failure) throw failure;
      try {
        await new Promise<void>((resolve, reject) => {
          rejectConnection = reject;
          void this.#connect().then(resolve, reject);
        });
      } catch (error) {
        signal.removeEventListener("abort", abort);
        throw error;
      }
      rejectConnection = undefined;
      if (failure) {
        signal.removeEventListener("abort", abort);
        throw failure;
      }
    } else {
      await this.#connect();
    }
    subscription = this.#connection.subscribe(
      payload,
      (rawPayload) => decodeTopicResponse(name, rawPayload, this.#responseValidation),
      {
        next: (value) => {
          pendingValues.push(value);
          wake?.();
          wake = undefined;
        },
        error: (error) => {
          failure = error;
          wake?.();
          wake = undefined;
        },
      },
      "resume",
    );
    this.#subscriptionCount += 1;
    onSubscribed?.();

    try {
      for (;;) {
        if (failure) throw failure;
        if (pendingValueIndex < pendingValues.length) {
          const value = pendingValues[pendingValueIndex]!;
          pendingValueIndex += 1;
          if (pendingValueIndex === pendingValues.length) {
            pendingValues = [];
            pendingValueIndex = 0;
          }
          yield value;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      unsubscribe();
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

  #closeSubscription(subscription: SubscriptionControl | undefined): undefined {
    if (!subscription) return undefined;
    subscription.unsubscribe();
    this.#subscriptionCount -= 1;
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

/** @internal Account projection clock seam. */
export function accountClientNow(client: TRClient): number {
  return accountInternalsFor(client).now();
}

/** @internal Live account audit seam. */
export function accountClientSubscriptionCount(client: TRClient): number {
  return accountInternalsFor(client).subscriptionCount();
}

/** @internal Account projection Watch seam. */
export function accountClientWatch<Name extends TopicName>(
  client: TRClient,
  name: Name,
  request: TopicRequest<Name>,
  signal: AbortSignal,
  onSubscribed: () => void,
): AsyncIterable<TopicResponse<Name>> {
  return accountInternalsFor(client).watch(name, request, signal, onSubscribed);
}

function accountInternalsFor(client: TRClient): AccountClientInternals {
  const internals = accountClientInternals.get(client);
  if (!internals) throw new TRValidationError("TRAccount requires a TRClient instance");
  return internals;
}
