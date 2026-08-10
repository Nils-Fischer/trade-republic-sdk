import { createConnection, type Connection, type SubscriptionControl } from "./connection.ts";
import {
  resolveEnvironment,
  type Environment,
  type ResolvedEnvironment,
  type TimerHandle,
} from "./environment.ts";
import { TRAbortError, TRTimeoutError, TRValidationError } from "./errors.ts";
import {
  decodeTopicResponse,
  encodeTopicRequest,
  topicNames,
  type ResponseValidation,
  type TopicName,
  type TopicRequest,
  type TopicResponse,
  type ValidationMode,
} from "./topics.ts";

export interface GetOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface TRClientOptions extends Environment {
  validate?: ValidationMode;
  onValidationWarning?: (warning: TRValidationError) => void;
}

export interface TopicAccessor<Name extends TopicName> {
  get(request: TopicRequest<Name>, options?: GetOptions): Promise<TopicResponse<Name>>;
  watch(request: TopicRequest<Name>): AsyncIterable<TopicResponse<Name>>;
}

type NamedTopicAccessors = {
  readonly [Name in TopicName]: TopicAccessor<Name>;
};

/** The complete client for Trade Republic Topics and HTTP resources. */
// oxlint-disable-next-line typescript/no-unsafe-declaration-merging -- The Registry installs the merged accessors in the constructor.
export class TRClient {
  readonly #environment: ResolvedEnvironment;
  readonly #connection: Connection;
  readonly #responseValidation: ResponseValidation;

  constructor(options: TRClientOptions = {}) {
    this.#environment = resolveEnvironment(options);
    this.#connection = createConnection(this.#environment);
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
  }

  /** True after the latest Echo has returned unchanged. */
  get isAlive(): boolean {
    return this.#connection.isAlive;
  }

  /** Address a Topic whose name is chosen at runtime. */
  topic<Name extends TopicName>(name: Name): TopicAccessor<Name> {
    return {
      get: (request, options) => this.#get(name, request, options),
      watch: (request) => this.#watch(name, request),
    };
  }

  #get<Name extends TopicName>(
    name: Name,
    request: TopicRequest<Name>,
    options: GetOptions = {},
  ): Promise<TopicResponse<Name>> {
    const payload = encodeTopicRequest(name, request);

    return new Promise<TopicResponse<Name>>((resolve, reject) => {
      let subscription: SubscriptionControl | undefined;
      let timeoutHandle: TimerHandle;
      let hasTimeout = false;
      let finished = false;

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
      const fail = (error: Error): void => finish(() => reject(error));
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

      void this.#connection
        .connect()
        .then(() => {
          if (finished) return;
          subscription = this.#connection.subscribe(
            payload,
            (rawPayload) => decodeTopicResponse(name, rawPayload, this.#responseValidation),
            {
              next: (value) => finish(() => resolve(value)),
              error: fail,
            },
          );
        })
        .catch(fail);
    });
  }

  async *#watch<Name extends TopicName>(
    name: Name,
    request: TopicRequest<Name>,
  ): AsyncIterableIterator<TopicResponse<Name>> {
    const payload = encodeTopicRequest(name, request);
    let latest: TopicResponse<Name> | undefined;
    let failure: Error | undefined;
    let wake: (() => void) | undefined;

    await this.#connection.connect();
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
}

// oxlint-disable-next-line typescript/no-unsafe-declaration-merging -- Runtime accessors and this mapped type share the same Registry.
export interface TRClient extends NamedTopicAccessors {}
