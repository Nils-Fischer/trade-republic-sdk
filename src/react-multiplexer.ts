import { errorQuery, pendingQuery, successQuery, type TRQuery } from "./account.ts";
import { accountClientWatch, type ResourceAccessor, type TRClient } from "./client.ts";
import { TRAbortError, TRValidationError } from "./errors.ts";
import type { ResourceName, ResourceResponse } from "./resources.ts";
import type { TopicName, TopicRequest, TopicResponse } from "./topics.ts";

export interface QueryStore<Value> {
  getSnapshot(): TRQuery<Value>;
  subscribe(onChange: () => void): () => void;
}

export interface GetQueryStore<Value> extends QueryStore<Value> {
  refetch(): void;
}

interface StoredEntry {
  readonly key: string;
  readonly isUnused: boolean;
  retain(): void;
  release(): boolean;
  stop(): void;
}

type StartOperation<Value> = (
  signal: AbortSignal,
  next: (value: Value) => void,
  fail: (cause: unknown) => void,
) => void;

type SerializableValue =
  | null
  | boolean
  | number
  | string
  | readonly SerializableValue[]
  | SerializableObject;

interface SerializableObject {
  readonly [key: string]: SerializableValue;
}

/** Share active React reads without retaining results after the last subscriber leaves. */
export class RequestMultiplexer {
  readonly #client: TRClient;
  readonly #entries = new Map<string, StoredEntry>();

  constructor(client: TRClient) {
    this.#client = client;
  }

  watch<Name extends TopicName>(
    name: Name,
    request: TopicRequest<Name>,
  ): QueryStore<TopicResponse<Name>> {
    // SAFETY: Topic request schemas accept JSON payload values only.
    const serializableRequest = request as SerializableValue;
    const key = requestKey("watch", name, serializableRequest);
    return this.#entry(key, (signal, next, fail) => {
      void consume(
        accountClientWatch(this.#client, name, request, signal, () => undefined),
        signal,
        next,
        fail,
      );
    });
  }

  getTopic<Name extends TopicName>(
    name: Name,
    request: TopicRequest<Name>,
  ): GetQueryStore<TopicResponse<Name>> {
    // SAFETY: Topic request schemas accept JSON payload values only.
    const serializableRequest = request as SerializableValue;
    const key = requestKey("get", name, serializableRequest);
    return this.#entry(key, (signal, next, fail) => {
      void this.#client.topic(name).get(request, { signal }).then(next, fail);
    });
  }

  getResource<Name extends ResourceName>(name: Name): GetQueryStore<ResourceResponse<Name>> {
    const key = requestKey("get", name, null);
    return this.#entry(key, (signal, next, fail) => {
      const accessor: ResourceAccessor<ResourceResponse<Name>> = this.#client[name];
      void accessor.get({ signal }).then(next, fail);
    });
  }

  retain(entry: StoredEntry): void {
    const current = this.#entries.get(entry.key);
    if (!current) this.#entries.set(entry.key, entry);
    entry.retain();
  }

  release(entry: StoredEntry): void {
    if (!entry.release()) return;
    if (this.#entries.get(entry.key) !== entry) return;
    this.#entries.delete(entry.key);
  }

  #entry<Value>(key: string, start: StartOperation<Value>): QueryEntry<Value> {
    const current = this.#entries.get(key);
    if (current) {
      // SAFETY: A key includes the operation, registry name, and serialized request, which fix Value.
      return current as QueryEntry<Value>;
    }
    const entry = new QueryEntry(this, key, start);
    this.#entries.set(key, entry);
    queueMicrotask(() => {
      if (entry.isUnused && this.#entries.get(key) === entry) this.#entries.delete(key);
    });
    return entry;
  }
}

class QueryEntry<Value> implements GetQueryStore<Value>, StoredEntry {
  readonly key: string;
  readonly #owner: RequestMultiplexer;
  readonly #startOperation: StartOperation<Value>;
  readonly #listeners = new Set<() => void>();
  #snapshot: TRQuery<Value> = pendingQuery();
  #lastData: Value | undefined;
  #controller: AbortController | undefined;
  #referenceCount = 0;

  constructor(owner: RequestMultiplexer, key: string, startOperation: StartOperation<Value>) {
    this.#owner = owner;
    this.key = key;
    this.#startOperation = startOperation;
  }

  getSnapshot = (): TRQuery<Value> => this.#snapshot;

  get isUnused(): boolean {
    return this.#referenceCount === 0;
  }

  subscribe = (onChange: () => void): (() => void) => {
    this.#listeners.add(onChange);
    this.#owner.retain(this);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#listeners.delete(onChange);
      this.#owner.release(this);
    };
  };

  refetch = (): void => {
    if (this.#referenceCount === 0) return;
    this.#start();
  };

  retain(): void {
    this.#referenceCount += 1;
    if (this.#referenceCount === 1) this.#start();
  }

  release(): boolean {
    this.#referenceCount -= 1;
    if (this.#referenceCount !== 0) return false;
    this.stop();
    return true;
  }

  stop(): void {
    this.#abort();
    this.#lastData = undefined;
    this.#snapshot = pendingQuery();
  }

  #abort(): void {
    this.#controller?.abort("The last React subscriber unmounted");
    this.#controller = undefined;
  }

  #start(): void {
    this.#abort();
    const controller = new AbortController();
    this.#controller = controller;
    this.#setSnapshot(pendingQuery());
    const next = (value: Value): void => {
      if (this.#controller !== controller || controller.signal.aborted) return;
      this.#lastData = value;
      this.#setSnapshot(successQuery(value));
    };
    const fail = (cause: unknown): void => {
      if (
        this.#controller !== controller ||
        controller.signal.aborted ||
        cause instanceof TRAbortError
      ) {
        return;
      }
      this.#setSnapshot(errorQuery(actionError(cause), this.#lastData));
    };
    try {
      this.#startOperation(controller.signal, next, fail);
    } catch (cause) {
      fail(cause);
    }
  }

  #setSnapshot(snapshot: TRQuery<Value>): void {
    if (samePending(this.#snapshot, snapshot)) return;
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }
}

async function consume<Value>(
  source: AsyncIterable<Value>,
  signal: AbortSignal,
  next: (value: Value) => void,
  fail: (cause: unknown) => void,
): Promise<void> {
  try {
    for await (const value of source) next(value);
  } catch (cause) {
    if (!signal.aborted) fail(cause);
  }
}

function requestKey(kind: "get" | "watch", name: string, request: SerializableValue): string {
  try {
    return `${kind}:${name}:${stableSerialize(request)}`;
  } catch (cause) {
    throw new TRValidationError(`Request for "${name}" is not serializable`, { cause });
  }
}

function stableSerialize(value: SerializableValue): string {
  const tag = Object.prototype.toString.call(value);
  if (tag === "[object Number]" && !Number.isFinite(value)) {
    throw new TypeError("Non-finite numbers are not serializable");
  }
  if (tag === "[object Array]") {
    // SAFETY: The tag check proves this is an Array; every child is validated recursively.
    const values = value as readonly SerializableValue[];
    return `[${values.map(stableSerialize).join(",")}]`;
  }
  if (tag === "[object Object]") {
    // SAFETY: The tag check proves this is a plain request object; children are validated below.
    const object = value as SerializableObject;
    return `{${Object.keys(object)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key]!)}`)
      .join(",")}}`;
  }
  if (
    tag !== "[object Null]" &&
    tag !== "[object String]" &&
    tag !== "[object Number]" &&
    tag !== "[object Boolean]"
  ) {
    throw new TypeError(`Unsupported serializable value ${tag}`);
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Request did not serialize");
  return serialized;
}

function actionError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error("Trade Republic request failed", { cause });
}

function samePending<Value>(left: TRQuery<Value>, right: TRQuery<Value>): boolean {
  return left.isPending && right.isPending;
}
