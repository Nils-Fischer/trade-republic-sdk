import { accountClientNow, accountClientWatch, type TRClient } from "./client.ts";
import { TRAbortError, TRConnectionError, TRValidationError } from "./errors.ts";
import type { AllDocuments } from "./resources.ts";
import type {
  AvailableCashResponse,
  CashResponse,
  TimelineTransaction,
  TimelineTransactionsResponse,
  TopicResponse,
} from "./topics.ts";

export type TRQuery<Value> =
  | {
      readonly status: "pending";
      readonly data: undefined;
      readonly error: undefined;
      readonly isPending: true;
      readonly isSuccess: false;
      readonly isError: false;
    }
  | {
      readonly status: "success";
      readonly data: Value;
      readonly error: undefined;
      readonly isPending: false;
      readonly isSuccess: true;
      readonly isError: false;
    }
  | {
      readonly status: "error";
      readonly data: Value | undefined;
      readonly error: Error;
      readonly isPending: false;
      readonly isSuccess: false;
      readonly isError: true;
    };

const pendingTRQuery = Object.freeze({
  status: "pending",
  data: undefined,
  error: undefined,
  isPending: true,
  isSuccess: false,
  isError: false,
});

/** @internal Mint the shared pending query member. */
export function pendingQuery<Value>(): TRQuery<Value> {
  return pendingTRQuery;
}

/** @internal Mint the shared success query member. */
export function successQuery<Value>(data: Value): TRQuery<Value> {
  return Object.freeze({
    status: "success",
    data,
    error: undefined,
    isPending: false,
    isSuccess: true,
    isError: false,
  });
}

/** @internal Mint the shared error query member. */
export function errorQuery<Value>(error: Error, data?: Value): TRQuery<Value> {
  return Object.freeze({
    status: "error",
    data,
    error,
    isPending: false,
    isSuccess: false,
    isError: true,
  });
}

export type AccountQuery<Value> = TRQuery<Value> & {
  readonly dataUpdatedAt: number | undefined;
  readonly isStale: boolean;
};

export interface AccountSlice<Value> {
  getSnapshot(): AccountQuery<Value>;
  subscribe(onChange: () => void): () => void;
}

export interface MaterializedRange {
  readonly from: string;
  readonly to: string;
}

export type RangeQuery<Value> = AccountQuery<Value> & {
  readonly materializedRange: MaterializedRange | undefined;
};

export type TransactionQuery = RangeQuery<readonly Transaction[]>;

/**
 * Raw timeline rows in the Window, hidden and deleted rows included, newest first.
 * Rows arrive page by page and from the Watch; `materializedRange` says how much
 * of the Window a completed traversal covers.
 */
export type TimelineQuery = RangeQuery<readonly TimelineTransaction[]> & {
  /**
   * When a traversal of the whole Window last completed. A Watch push moves
   * `materializedRange.to` but not this, so it marks a finished Sync.
   */
  readonly traversedAt: number | undefined;
};

export interface TimelineSlice {
  getSnapshot(): TimelineQuery;
  subscribe(onChange: () => void): () => void;
}

export interface TransactionSlice {
  getSnapshot(): TransactionQuery;
  subscribe(onChange: () => void): () => void;
  read(options: TransactionRange): Promise<readonly Transaction[]>;
}

export interface TransactionRange {
  readonly from: Date;
  readonly to?: Date;
  readonly signal?: AbortSignal;
}

export type AccountSliceName = "cash" | "transactions" | "documents";

export interface TRAccountOptions {
  /** A function is read again at every Sync, so the Window can follow the app's own state. */
  readonly transactionWindow: { readonly from: Date | (() => Date) };
  /** Slices to keep current. Defaults to all; a Slice left out stays pending and costs no I/O. */
  readonly slices?: readonly AccountSliceName[];
}

export interface AccountCashBalance {
  readonly accountNumber: string;
  readonly currency: string;
  readonly amount: number;
}

export interface AccountCash {
  readonly balances: readonly AccountCashBalance[];
  readonly available: readonly AccountCashBalance[];
}

export interface Money {
  readonly currency: string;
  readonly minorUnits: number;
  readonly fractionDigits: number;
}

interface TransactionBase {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
  readonly counterparty: string | null;
  readonly amount: Money;
  readonly subAmount: Money | null;
  readonly cashAccountNumber: string | null;
}

export type Transaction =
  | (TransactionBase & { readonly kind: "cash"; readonly eventType: "CASH" })
  | (TransactionBase & { readonly kind: "other"; readonly eventType: string });

export interface AccountDocument {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly contentType: string;
  readonly version: number;
  readonly url: string;
}

type CashQuery = AccountQuery<AccountCash>;
type DocumentQuery = AccountQuery<readonly AccountDocument[]>;
type WatchName = "cash" | "availableCash" | "timelineTransactions";

interface ProjectedTransaction {
  readonly id: string;
  readonly timestamp: number;
  readonly row: TimelineTransaction;
  readonly value: Transaction | undefined;
}

interface WatchedTransaction {
  readonly transaction: ProjectedTransaction;
  readonly revision: number;
}

interface WatchSlot {
  readonly controller: AbortController;
  readonly ready: Deferred<void>;
  readonly started: Deferred<void>;
  readonly token: number;
}

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  resolve(value: Value): void;
  reject(error: Error): void;
}

interface SyncContext {
  readonly controller: AbortController;
  readonly token: number;
  readonly createdWatches: WatchName[];
  readonly firstMaintenance: boolean;
  readonly watchRevision: number;
}

class SnapshotStore<Value, Snapshot extends AccountQuery<Value>> {
  #snapshot: Snapshot;
  readonly #listeners = new Set<() => void>();
  readonly #failure: (snapshot: Snapshot, error: Error) => Snapshot;
  readonly #pending: () => Snapshot;
  readonly #stale: (snapshot: Snapshot, isStale: boolean) => Snapshot;

  constructor(
    initial: Snapshot,
    failure: (snapshot: Snapshot, error: Error) => Snapshot,
    pending: () => Snapshot,
    stale: (snapshot: Snapshot, isStale: boolean) => Snapshot,
  ) {
    this.#snapshot = initial;
    this.#failure = failure;
    this.#pending = pending;
    this.#stale = stale;
  }

  getSnapshot = (): Snapshot => this.#snapshot;

  subscribe = (onChange: () => void): (() => void) => {
    this.#listeners.add(onChange);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#listeners.delete(onChange);
    };
  };

  replace(snapshot: Snapshot): void {
    if (snapshot === this.#snapshot) return;
    this.#snapshot = snapshot;
    for (const listener of Array.from(this.#listeners)) listener();
  }

  fail(error: Error): void {
    if (this.#snapshot.status === "error" && this.#snapshot.error === error) return;
    this.replace(this.#failure(this.#snapshot, error));
  }

  clear(): void {
    if (this.#snapshot.status === "pending") return;
    this.replace(this.#pending());
  }

  setStale(isStale: boolean): void {
    const next = this.#snapshot.data === undefined ? false : isStale;
    if (this.#snapshot.isStale === next) return;
    this.replace(this.#stale(this.#snapshot, next));
  }
}

/** A read-only, live account projection over one TRClient. */
export class TRAccount {
  readonly cash: AccountSlice<AccountCash>;
  readonly transactions: TransactionSlice;
  readonly timeline: TimelineSlice;
  readonly documents: AccountSlice<readonly AccountDocument[]>;

  readonly #client: TRClient;
  readonly #slices: ReadonlySet<AccountSliceName>;
  readonly #windowSource: Date | (() => Date);
  #windowFrom: number;
  #windowFromIso: string;
  readonly #cashStore = new SnapshotStore<AccountCash, CashQuery>(
    snapshot("pending", undefined, undefined, false),
    (current, error) =>
      snapshot("error", current.data, current.dataUpdatedAt, current.isStale, error),
    () => snapshot("pending", undefined, undefined, false),
    (current, isStale) => accountQueryWithStaleness(current, isStale),
  );
  readonly #transactionStore = rangeStore<readonly Transaction[]>();
  readonly #timelineStore = new SnapshotStore<readonly TimelineTransaction[], TimelineQuery>(
    withTraversal(rangeSnapshot("pending", undefined, undefined, false, undefined), undefined),
    (current, error) =>
      withTraversal(
        rangeSnapshot(
          "error",
          current.data,
          current.dataUpdatedAt,
          current.isStale,
          current.materializedRange,
          error,
        ),
        current.traversedAt,
      ),
    () =>
      withTraversal(rangeSnapshot("pending", undefined, undefined, false, undefined), undefined),
    (current, isStale) =>
      withTraversal(rangeQueryWithStaleness(current, isStale), current.traversedAt),
  );
  readonly #documentStore = new SnapshotStore<readonly AccountDocument[], DocumentQuery>(
    snapshot("pending", undefined, undefined, false),
    (current, error) => snapshot("error", current.data, current.dataUpdatedAt, false, error),
    () => snapshot("pending", undefined, undefined, false),
    (current) => current,
  );
  readonly #watchSlots = new Map<WatchName, WatchSlot>();
  readonly #pendingReads = new Set<AbortController>();
  readonly #transactionsById = new Map<string, Transaction>();
  readonly #rowsById = new Map<string, TimelineTransaction>();
  #timelineChanged = false;
  #traversedAt: number | undefined;
  readonly #watchTransactions = new Map<string, WatchedTransaction>();
  #cashBalances: readonly AccountCashBalance[] | undefined;
  #availableBalances: readonly AccountCashBalance[] | undefined;
  #cashWatchSeen = { cash: false, availableCash: false };
  #materializedTo: number | undefined;
  #lastTimelineWatchAt: number | undefined;
  #watchRevision = 0;
  #syncPromise: Promise<void> | undefined;
  #syncController: AbortController | undefined;
  #token = 0;
  #connectionAlive = false;
  #recoveryObserved = false;

  constructor(client: TRClient, options: TRAccountOptions) {
    this.#client = client;
    this.#slices = new Set(options.slices ?? ["cash", "transactions", "documents"]);
    this.#windowSource = options.transactionWindow.from;
    this.#windowFrom = this.#readWindow();
    this.#windowFromIso = new Date(this.#windowFrom).toISOString();
    this.#connectionAlive = client.connection.getSnapshot().isAlive;

    this.cash = Object.freeze({
      getSnapshot: this.#cashStore.getSnapshot,
      subscribe: this.#cashStore.subscribe,
    });
    this.transactions = Object.freeze({
      getSnapshot: this.#transactionStore.getSnapshot,
      subscribe: this.#transactionStore.subscribe,
      read: (range: TransactionRange) => this.#readTransactions(range),
    });
    this.timeline = Object.freeze({
      getSnapshot: this.#timelineStore.getSnapshot,
      subscribe: this.#timelineStore.subscribe,
    });
    this.documents = Object.freeze({
      getSnapshot: this.#documentStore.getSnapshot,
      subscribe: this.#documentStore.subscribe,
    });
    client.session.subscribe(() => {
      if (client.session.getSnapshot().validity === "absent") this.#clear("Session cleared");
    });
    client.connection.subscribe(() => this.#handleConnectionChange());
  }

  sync(options: { signal?: AbortSignal } = {}): Promise<void> {
    if (this.#syncPromise) return this.#syncPromise;
    try {
      this.#moveWindow();
    } catch (error) {
      return Promise.reject(errorFrom(error));
    }

    const controller = new AbortController();
    const context: SyncContext = {
      controller,
      token: this.#token,
      createdWatches: [],
      firstMaintenance: this.#watchSlots.size === 0,
      watchRevision: this.#watchRevision,
    };
    this.#syncController = controller;

    const abort = (): void => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });

    const operation = this.#runSync(context).finally(() => {
      options.signal?.removeEventListener("abort", abort);
    });
    this.#syncPromise = operation;
    void operation.then(
      () => this.#clearSync(operation, controller),
      () => this.#clearSync(operation, controller),
    );
    return operation;
  }

  stop(): void {
    this.#clear("TRAccount stopped");
  }

  #readWindow(): number {
    const source = this.#windowSource;
    return validDate(source instanceof Date ? source : source(), "transactionWindow.from");
  }

  /**
   * A Window that starts later drops the rows before it. One that starts
   * earlier is not covered until the next traversal completes.
   */
  #moveWindow(): void {
    const from = this.#readWindow();
    if (from === this.#windowFrom) return;
    const previous = this.#windowFrom;
    this.#windowFrom = from;
    this.#windowFromIso = new Date(from).toISOString();
    if (from < previous) {
      this.#materializedTo = undefined;
      return;
    }
    for (const row of this.#rowsById.values()) {
      if (Date.parse(row.timestamp) < from) this.#removeTransaction(row.id);
    }
  }

  #clear(reason: string): void {
    this.#token += 1;
    this.#syncController?.abort(reason);
    this.#syncController = undefined;
    this.#syncPromise = undefined;
    for (const slot of this.#watchSlots.values()) slot.controller.abort(reason);
    this.#watchSlots.clear();
    for (const controller of this.#pendingReads) controller.abort(reason);
    this.#pendingReads.clear();
    this.#cashWatchSeen = { cash: false, availableCash: false };
    this.#watchTransactions.clear();
    this.#transactionsById.clear();
    this.#rowsById.clear();
    this.#timelineChanged = false;
    this.#traversedAt = undefined;
    this.#cashBalances = undefined;
    this.#availableBalances = undefined;
    this.#materializedTo = undefined;
    this.#lastTimelineWatchAt = undefined;
    this.#recoveryObserved = false;
    this.#cashStore.clear();
    this.#transactionStore.clear();
    this.#timelineStore.clear();
    this.#documentStore.clear();
  }

  #handleConnectionChange(): void {
    const connection = this.#client.connection.getSnapshot();
    const wasAlive = this.#connectionAlive;
    this.#connectionAlive = connection.isAlive;
    if (connection.isRecovering) this.#recoveryObserved = true;
    this.#cashStore.setStale(!connection.isAlive);
    this.#transactionStore.setStale(!connection.isAlive);
    this.#timelineStore.setStale(!connection.isAlive);
    if (connection.isAlive && !wasAlive && this.#recoveryObserved && this.#watchSlots.size > 0) {
      this.#recoveryObserved = false;
      void this.sync().catch(() => undefined);
    }
  }

  async #runSync(context: SyncContext): Promise<void> {
    const skipped = [
      !this.#slices.has("cash"),
      !this.#slices.has("transactions"),
      !this.#slices.has("documents"),
    ];
    if (context.controller.signal.aborted) return this.#finishAbortedSync(context, skipped);

    this.#ensureWatches(context);
    const cancelCreatedWatches = (): void => {
      for (const name of context.createdWatches) {
        const slot = this.#watchSlots.get(name);
        if (slot?.token === context.token) slot.controller.abort(context.controller.signal.reason);
      }
    };
    context.controller.signal.addEventListener("abort", cancelCreatedWatches, { once: true });
    // Each Slice runs on its own: history starts as soon as the timeline Watch is
    // subscribed, without waiting for cash or for the Watch's first value.
    const results = await Promise.allSettled([
      skipped[0] ? Promise.resolve() : this.#syncCash(context),
      skipped[1] ? Promise.resolve() : this.#refreshTransactionsAfterWatch(context),
      skipped[2] ? Promise.resolve() : this.#refreshDocuments(context),
    ]);
    context.controller.signal.removeEventListener("abort", cancelCreatedWatches);
    const completed = results.map((result) => result.status === "fulfilled");

    if (context.controller.signal.aborted || context.token !== this.#token) {
      return this.#finishAbortedSync(context, completed);
    }

    for (const result of results) {
      if (result.status === "rejected") throw errorFrom(result.reason);
    }
  }

  #syncCash(context: SyncContext): Promise<void> {
    if (!context.firstMaintenance) return this.#refreshCash(context);
    return this.#waitForInitialCash(context, [
      this.#watchReady("cash"),
      this.#watchReady("availableCash"),
    ]);
  }

  #ensureWatches(context: SyncContext): void {
    if (this.#slices.has("cash")) {
      this.#ensureWatch("cash", context);
      this.#ensureWatch("availableCash", context);
    }
    if (this.#slices.has("transactions")) this.#ensureWatch("timelineTransactions", context);
  }

  #watchReady(name: WatchName): Promise<void> {
    return (
      this.#watchSlots.get(name)?.ready.promise ??
      Promise.reject(new TRConnectionError(`Watch for Topic "${name}" is not active`))
    );
  }

  #ensureWatch(name: WatchName, context: SyncContext): void {
    if (this.#watchSlots.has(name)) return;

    const controller = new AbortController();
    const ready = deferred<void>();
    const started = deferred<void>();
    const slot: WatchSlot = { controller, ready, started, token: context.token };
    void ready.promise.catch(() => undefined);
    void started.promise.catch(() => undefined);
    this.#watchSlots.set(name, slot);
    context.createdWatches.push(name);

    let consume: Promise<void>;
    if (name === "cash") {
      consume = this.#consumeWatch(name, slot, (value) => this.#acceptCashWatch(value));
    } else if (name === "availableCash") {
      consume = this.#consumeWatch(name, slot, (value) => this.#acceptAvailableCashWatch(value));
    } else {
      consume = this.#consumeWatch(name, slot, (value) => this.#acceptTimelineWatch(value));
    }
    void consume.catch(() => undefined);
  }

  async #consumeWatch<Name extends WatchName>(
    name: Name,
    slot: WatchSlot,
    accept: (value: TopicResponse<Name>) => void,
  ): Promise<void> {
    let waitingForFirst = true;
    let waitingForStart = true;
    try {
      const values = accountClientWatch(this.#client, name, {}, slot.controller.signal, () => {
        waitingForStart = false;
        slot.started.resolve();
      });
      for await (const value of values) {
        if (slot.token !== this.#token || this.#watchSlots.get(name) !== slot) return;
        try {
          accept(value);
          if (waitingForFirst) slot.ready.resolve();
        } catch (error) {
          const failure = errorFrom(error);
          this.#failWatchSlice(name, failure);
          if (waitingForFirst) slot.ready.reject(failure);
        }
        waitingForFirst = false;
      }
      if (!slot.controller.signal.aborted) {
        throw new TRConnectionError(`Watch for Topic "${name}" ended`);
      }
    } catch (error) {
      if (slot.controller.signal.aborted || slot.token !== this.#token) return;
      const failure = errorFrom(error);
      this.#failWatchSlice(name, failure);
      if (waitingForFirst) slot.ready.reject(failure);
    } finally {
      if (waitingForStart) {
        slot.started.reject(
          new TRAbortError(`Watch for Topic "${name}" ended before it started`, {
            cause: slot.controller.signal.reason,
          }),
        );
      }
      if (waitingForFirst) {
        slot.ready.reject(
          new TRAbortError(`Watch for Topic "${name}" ended before its first value`, {
            cause: slot.controller.signal.reason,
          }),
        );
      }
      if (this.#watchSlots.get(name) === slot) this.#watchSlots.delete(name);
    }
  }

  #acceptCashWatch(value: CashResponse): void {
    this.#cashBalances = projectCash(value);
    this.#cashWatchSeen.cash = true;
    if (this.#cashWatchSeen.availableCash) this.#commitCash();
  }

  #acceptAvailableCashWatch(value: AvailableCashResponse): void {
    this.#availableBalances = projectCash(value);
    this.#cashWatchSeen.availableCash = true;
    if (this.#cashWatchSeen.cash) this.#commitCash();
  }

  #acceptTimelineWatch(value: TimelineTransactionsResponse): void {
    const receivedAt = accountClientNow(this.#client);
    const projected = projectTransactions(value.items);
    const revision = ++this.#watchRevision;
    for (const transaction of projected) {
      this.#watchTransactions.set(transaction.id, { transaction, revision });
      this.#applyTransaction(transaction);
    }
    this.#lastTimelineWatchAt = Math.max(this.#lastTimelineWatchAt ?? 0, receivedAt);
    if (this.#materializedTo !== undefined) {
      this.#materializedTo = Math.max(this.#materializedTo, receivedAt);
      this.#commitTransactions();
    }
    this.#commitTimeline();
  }

  async #waitForInitialCash(context: SyncContext, ready: readonly Promise<void>[]): Promise<void> {
    const results = await Promise.allSettled(ready);
    try {
      this.#assertCurrent(context);
      for (const result of results) {
        if (result.status === "rejected") throw errorFrom(result.reason);
      }
      this.#commitCash();
    } catch (error) {
      if (!context.controller.signal.aborted) this.#commitCashFailure(errorFrom(error));
      throw error;
    }
  }

  async #refreshCash(context: SyncContext): Promise<void> {
    const [cashResult, availableResult] = await Promise.allSettled([
      this.#client.cash.get({}, { signal: context.controller.signal }),
      this.#client.availableCash.get({}, { signal: context.controller.signal }),
    ]);
    this.#assertCurrent(context);

    let cashError: Error | undefined;
    let availableError: Error | undefined;
    if (cashResult.status === "fulfilled") {
      try {
        this.#cashBalances = projectCash(cashResult.value);
      } catch (error) {
        cashError = errorFrom(error);
      }
    } else cashError = errorFrom(cashResult.reason);
    if (availableResult.status === "fulfilled") {
      try {
        this.#availableBalances = projectCash(availableResult.value);
      } catch (error) {
        availableError = errorFrom(error);
      }
    } else availableError = errorFrom(availableResult.reason);

    const failure = cashError ?? availableError;
    if (failure) {
      this.#commitCashFailure(failure);
      throw failure;
    }
    this.#commitCash();
  }

  async #refreshTransactions(
    context: SyncContext,
    upperBound: number,
    timelineReady?: Promise<void>,
  ): Promise<void> {
    const watchThreshold = context.firstMaintenance ? 0 : context.watchRevision + 1;
    // A Watch value received since this Sync began is newer than any history page.
    const watchWins = (id: string): boolean =>
      (this.#watchTransactions.get(id)?.revision ?? -1) >= watchThreshold;
    try {
      const [historyResult, readyResult] = await Promise.allSettled([
        this.#client.getTimelineTransactions({
          from: new Date(this.#windowFrom),
          to: new Date(upperBound),
          signal: context.controller.signal,
          onPage: (items) => {
            if (context.controller.signal.aborted || context.token !== this.#token) return;
            for (const transaction of projectTransactions(items)) {
              if (!watchWins(transaction.id)) this.#applyTransaction(transaction);
            }
            this.#commitTimeline();
          },
        }),
        timelineReady,
      ]);
      this.#assertCurrent(context);
      if (historyResult.status === "rejected") throw errorFrom(historyResult.reason);
      const kept = new Set(historyResult.value.map((item) => item.id));
      for (const watched of this.#watchTransactions.values()) {
        if (watched.revision >= watchThreshold) kept.add(watched.transaction.id);
      }
      for (const row of this.#rowsById.values()) {
        if (Date.parse(row.timestamp) < upperBound && !kept.has(row.id)) {
          this.#removeTransaction(row.id);
        }
      }
      this.#watchTransactions.clear();
      this.#materializedTo = Math.max(upperBound, this.#lastTimelineWatchAt ?? upperBound);
      this.#traversedAt = accountClientNow(this.#client);
      this.#commitTransactions();
      this.#commitTimeline();
      if (readyResult.status === "rejected") throw errorFrom(readyResult.reason);
    } catch (error) {
      if (!context.controller.signal.aborted) this.#failTransactions(errorFrom(error));
      throw error;
    }
  }

  async #refreshTransactionsAfterWatch(context: SyncContext): Promise<void> {
    if (context.createdWatches.includes("timelineTransactions")) {
      const started =
        this.#watchSlots.get("timelineTransactions")?.started.promise ??
        Promise.reject(new TRAbortError('Watch for Topic "timelineTransactions" was cancelled'));
      await started;
      this.#assertCurrent(context);
    }
    return this.#refreshTransactions(
      context,
      accountClientNow(this.#client),
      context.firstMaintenance ? this.#watchReady("timelineTransactions") : undefined,
    );
  }

  async #refreshDocuments(context: SyncContext): Promise<void> {
    try {
      const value = await this.#client.allDocuments.get({ signal: context.controller.signal });
      this.#assertCurrent(context);
      this.#commitDocuments(projectDocuments(value));
    } catch (error) {
      if (!context.controller.signal.aborted) this.#documentStore.fail(errorFrom(error));
      throw error;
    }
  }

  async #readTransactions(range: TransactionRange): Promise<readonly Transaction[]> {
    const from = validDate(range.from, "from");
    const to = validDate(range.to ?? new Date(accountClientNow(this.#client)), "to");
    if (from >= to) throw new TRValidationError("from must be before to");

    const snapshot = this.#transactionStore.getSnapshot();
    if (
      snapshot.status === "success" &&
      this.#materializedTo !== undefined &&
      from >= this.#windowFrom &&
      to <= this.#materializedTo
    ) {
      return this.#transactionsInRange(from, to);
    }

    const controller = new AbortController();
    const token = this.#token;
    const abort = (): void => controller.abort(range.signal?.reason);
    if (range.signal?.aborted) abort();
    else range.signal?.addEventListener("abort", abort, { once: true });
    this.#pendingReads.add(controller);

    try {
      const items = await this.#client.getTimelineTransactions({
        from: new Date(from),
        to: new Date(to),
        signal: controller.signal,
      });
      if (token !== this.#token) {
        throw new TRAbortError("Transaction read was stopped");
      }
      const projected = projectTransactions(items);
      const result = projected
        .flatMap((transaction) => (transaction.value ? [transaction.value] : []))
        .sort(compareTransactions);
      if (to > this.#windowFrom) {
        for (const transaction of projected) {
          if (transaction.timestamp >= this.#windowFrom) this.#applyTransaction(transaction);
        }
        const heldFrom = Math.max(from, this.#windowFrom);
        if (this.#materializedTo === undefined) {
          if (heldFrom === this.#windowFrom) this.#materializedTo = to;
        } else if (heldFrom <= this.#materializedTo) {
          this.#materializedTo = Math.max(this.#materializedTo, to);
        }
        this.#commitTransactions();
        this.#commitTimeline();
      }
      return Object.freeze(result);
    } catch (error) {
      if (token === this.#token) this.#failTransactions(errorFrom(error));
      throw error;
    } finally {
      range.signal?.removeEventListener("abort", abort);
      this.#pendingReads.delete(controller);
    }
  }

  #transactionsInRange(from: number, to: number): readonly Transaction[] {
    return Object.freeze(
      [...this.#transactionsById.values()]
        .filter((transaction) => {
          const timestamp = Date.parse(transaction.timestamp);
          return timestamp >= from && timestamp < to;
        })
        .sort(compareTransactions),
    );
  }

  #applyTransaction(transaction: ProjectedTransaction): void {
    if (transaction.timestamp < this.#windowFrom) return;
    const current = this.#rowsById.get(transaction.id);
    if (current === undefined || !equalRow(current, transaction.row)) {
      this.#rowsById.set(transaction.id, transaction.row);
      this.#timelineChanged = true;
    }
    if (transaction.value) this.#transactionsById.set(transaction.id, transaction.value);
    else this.#transactionsById.delete(transaction.id);
  }

  #removeTransaction(id: string): void {
    this.#rowsById.delete(id);
    this.#transactionsById.delete(id);
    this.#timelineChanged = true;
  }

  #commitCash(): void {
    if (!this.#cashBalances || !this.#availableBalances) return;
    const value: AccountCash = Object.freeze({
      balances: this.#cashBalances,
      available: this.#availableBalances,
    });
    const current = this.#cashStore.getSnapshot();
    const unchanged = current.data !== undefined && equalCash(current.data, value);
    if (current.status === "success" && unchanged) return;
    this.#cashStore.replace(
      snapshot(
        "success",
        value,
        unchanged ? current.dataUpdatedAt : accountClientNow(this.#client),
        !this.#client.connection.getSnapshot().isAlive,
      ),
    );
  }

  #commitCashFailure(error: Error): void {
    const current = this.#cashStore.getSnapshot();
    if (!this.#cashBalances || !this.#availableBalances) {
      this.#cashStore.fail(error);
      return;
    }
    const value: AccountCash = Object.freeze({
      balances: this.#cashBalances,
      available: this.#availableBalances,
    });
    if (
      current.status === "error" &&
      current.error === error &&
      current.data &&
      equalCash(current.data, value)
    ) {
      return;
    }
    const unchanged = current.data !== undefined && equalCash(current.data, value);
    this.#cashStore.replace(
      snapshot(
        "error",
        value,
        unchanged ? current.dataUpdatedAt : accountClientNow(this.#client),
        !this.#client.connection.getSnapshot().isAlive,
        error,
      ),
    );
  }

  #commitTransactions(): void {
    const value = Object.freeze([...this.#transactionsById.values()].sort(compareTransactions));
    const current = this.#transactionStore.getSnapshot();
    const range = this.#materializedRange();
    if (
      current.status === "success" &&
      current.data &&
      equalTransactions(current.data, value) &&
      equalRange(current.materializedRange, range)
    ) {
      return;
    }
    const unchanged = current.data !== undefined && equalTransactions(current.data, value);
    this.#transactionStore.replace(
      rangeSnapshot(
        "success",
        value,
        unchanged ? current.dataUpdatedAt : accountClientNow(this.#client),
        !this.#client.connection.getSnapshot().isAlive,
        range,
      ),
    );
  }

  /** Unlike the projection, raw rows are published before the Window is materialized. */
  #commitTimeline(): void {
    const current = this.#timelineStore.getSnapshot();
    const range = this.#materializedRange();
    const changed = this.#timelineChanged || current.data === undefined;
    if (
      current.status === "success" &&
      !changed &&
      equalRange(current.materializedRange, range) &&
      current.traversedAt === this.#traversedAt
    ) {
      return;
    }
    this.#timelineChanged = false;
    this.#timelineStore.replace(
      withTraversal(
        rangeSnapshot(
          "success",
          changed
            ? Object.freeze([...this.#rowsById.values()].sort(compareTransactions))
            : current.data!,
          changed ? accountClientNow(this.#client) : current.dataUpdatedAt,
          !this.#client.connection.getSnapshot().isAlive,
          range,
        ),
        this.#traversedAt,
      ),
    );
  }

  #failTransactions(error: Error): void {
    this.#transactionStore.fail(error);
    this.#timelineStore.fail(error);
  }

  #commitDocuments(value: readonly AccountDocument[]): void {
    const current = this.#documentStore.getSnapshot();
    const unchanged = current.data !== undefined && equalDocuments(current.data, value);
    if (current.status === "success" && unchanged) return;
    this.#documentStore.replace(
      snapshot(
        "success",
        value,
        unchanged ? current.dataUpdatedAt : accountClientNow(this.#client),
        false,
      ),
    );
  }

  #materializedRange(): MaterializedRange | undefined {
    if (this.#materializedTo === undefined) return undefined;
    return Object.freeze({
      from: this.#windowFromIso,
      to: new Date(this.#materializedTo).toISOString(),
    });
  }

  #failWatchSlice(name: WatchName, error: Error): void {
    if (name === "timelineTransactions") this.#failTransactions(error);
    else this.#cashStore.fail(error);
  }

  #assertCurrent(context: SyncContext): void {
    if (context.controller.signal.aborted || context.token !== this.#token) {
      throw new TRAbortError("Account sync was aborted", {
        cause: context.controller.signal.reason,
      });
    }
  }

  #finishAbortedSync(context: SyncContext, completed: readonly boolean[]): never {
    for (const name of context.createdWatches) {
      const slot = this.#watchSlots.get(name);
      if (slot?.token === context.token) slot.controller.abort("Account sync was aborted");
    }
    const error = new TRAbortError("Account sync was aborted", {
      cause: context.controller.signal.reason,
    });
    if (context.token === this.#token) {
      if (!completed[0]) this.#cashStore.fail(error);
      if (!completed[1]) this.#failTransactions(error);
      if (!completed[2]) this.#documentStore.fail(error);
    }
    throw error;
  }

  #clearSync(operation: Promise<void>, controller: AbortController): void {
    if (this.#syncPromise === operation) this.#syncPromise = undefined;
    if (this.#syncController === controller) this.#syncController = undefined;
  }
}

function deferred<Value>(): Deferred<Value> {
  let resolvePromise: ((value: Value) => void) | undefined;
  let rejectPromise: ((error: Error) => void) | undefined;
  const promise = new Promise<Value>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
    reject: (error) => rejectPromise?.(error),
  };
}

function snapshot<Value>(
  status: "pending",
  data: undefined,
  dataUpdatedAt: undefined,
  isStale: false,
): AccountQuery<Value>;
function snapshot<Value>(
  status: "success",
  data: Value,
  dataUpdatedAt: number | undefined,
  isStale: boolean,
): AccountQuery<Value>;
function snapshot<Value>(
  status: "error",
  data: Value | undefined,
  dataUpdatedAt: number | undefined,
  isStale: boolean,
  error: Error,
): AccountQuery<Value>;
function snapshot<Value>(
  status: TRQuery<Value>["status"],
  data: Value | undefined,
  dataUpdatedAt: number | undefined,
  isStale: boolean,
  error?: Error,
): AccountQuery<Value> {
  if (status === "pending") {
    return Object.freeze({
      ...pendingQuery<Value>(),
      dataUpdatedAt: undefined,
      isStale: false,
    });
  }
  if (status === "success") {
    if (data === undefined) throw new Error("A successful TRQuery requires data");
    return Object.freeze({
      ...successQuery(data),
      dataUpdatedAt,
      isStale,
    });
  }
  if (!error) throw new Error("An error TRQuery requires an Error");
  return Object.freeze({
    ...errorQuery(error, data),
    dataUpdatedAt,
    isStale: data === undefined ? false : isStale,
  });
}

function accountQueryWithStaleness<Value>(
  query: AccountQuery<Value>,
  isStale: boolean,
): AccountQuery<Value> {
  if (query.status === "pending") return snapshot("pending", undefined, undefined, false);
  if (query.status === "success") {
    return snapshot("success", query.data, query.dataUpdatedAt, isStale);
  }
  return snapshot("error", query.data, query.dataUpdatedAt, isStale, query.error);
}

function rangeSnapshot<Value>(
  status: "pending",
  data: undefined,
  dataUpdatedAt: undefined,
  isStale: false,
  materializedRange: undefined,
): RangeQuery<Value>;
function rangeSnapshot<Value>(
  status: "success",
  data: Value,
  dataUpdatedAt: number | undefined,
  isStale: boolean,
  materializedRange: MaterializedRange | undefined,
): RangeQuery<Value>;
function rangeSnapshot<Value>(
  status: "error",
  data: Value | undefined,
  dataUpdatedAt: number | undefined,
  isStale: boolean,
  materializedRange: MaterializedRange | undefined,
  error: Error,
): RangeQuery<Value>;
function rangeSnapshot<Value>(
  status: TRQuery<Value>["status"],
  data: Value | undefined,
  dataUpdatedAt: number | undefined,
  isStale: boolean,
  materializedRange: MaterializedRange | undefined,
  error?: Error,
): RangeQuery<Value> {
  let query: AccountQuery<Value>;
  if (status === "pending") {
    query = snapshot("pending", undefined, undefined, false);
  } else if (status === "success") {
    if (data === undefined) throw new Error("A successful RangeQuery requires data");
    query = snapshot("success", data, dataUpdatedAt, isStale);
  } else {
    if (!error) throw new Error("An error RangeQuery requires an Error");
    query = snapshot("error", data, dataUpdatedAt, isStale, error);
  }
  return Object.freeze({ ...query, materializedRange });
}

function rangeQueryWithStaleness<Value>(
  query: RangeQuery<Value>,
  isStale: boolean,
): RangeQuery<Value> {
  if (query.status === "pending") {
    return rangeSnapshot("pending", undefined, undefined, false, undefined);
  }
  if (query.status === "success") {
    return rangeSnapshot(
      "success",
      query.data,
      query.dataUpdatedAt,
      isStale,
      query.materializedRange,
    );
  }
  return rangeSnapshot(
    "error",
    query.data,
    query.dataUpdatedAt,
    isStale,
    query.materializedRange,
    query.error,
  );
}

function withTraversal(
  query: RangeQuery<readonly TimelineTransaction[]>,
  traversedAt: number | undefined,
): TimelineQuery {
  return Object.freeze({ ...query, traversedAt });
}

function rangeStore<Value>(): SnapshotStore<Value, RangeQuery<Value>> {
  return new SnapshotStore<Value, RangeQuery<Value>>(
    rangeSnapshot("pending", undefined, undefined, false, undefined),
    (current, error) =>
      rangeSnapshot(
        "error",
        current.data,
        current.dataUpdatedAt,
        current.isStale,
        current.materializedRange,
        error,
      ),
    () => rangeSnapshot("pending", undefined, undefined, false, undefined),
    (current, isStale) => rangeQueryWithStaleness(current, isStale),
  );
}

function projectCash(value: CashResponse): readonly AccountCashBalance[] {
  const keys = new Set<string>();
  const balances = value.map((balance) => {
    const key = `${balance.accountNumber}\u0000${balance.currencyId}`;
    if (keys.has(key)) {
      throw new TRValidationError(
        `Duplicate cash balance for account "${balance.accountNumber}" and currency "${balance.currencyId}"`,
      );
    }
    keys.add(key);
    return Object.freeze({
      accountNumber: balance.accountNumber,
      currency: balance.currencyId,
      amount: balance.amount,
    });
  });
  balances.sort(
    (left, right) =>
      compareText(left.accountNumber, right.accountNumber) ||
      compareText(left.currency, right.currency),
  );
  return Object.freeze(balances);
}

function projectTransactions(items: readonly TimelineTransaction[]): ProjectedTransaction[] {
  const values = new Map<string, ProjectedTransaction>();
  for (const item of items) {
    const timestamp = Date.parse(item.timestamp);
    if (!Number.isFinite(timestamp)) {
      throw new TRValidationError(`Transaction "${item.id}" has an invalid timestamp`);
    }
    values.set(item.id, {
      id: item.id,
      timestamp,
      row: item,
      value: item.hidden || item.deleted ? undefined : projectTransaction(item),
    });
  }
  return [...values.values()];
}

function projectTransaction(item: TimelineTransaction): Transaction {
  const base: TransactionBase = {
    id: item.id,
    timestamp: item.timestamp,
    description: item.title,
    counterparty: item.subtitle ?? null,
    amount: projectMoney(item.amount, item.id),
    subAmount: item.subAmount ? projectMoney(item.subAmount, item.id) : null,
    cashAccountNumber: item.cashAccountNumber,
  };
  if (item.eventType === "CASH") return Object.freeze({ ...base, kind: "cash", eventType: "CASH" });
  return Object.freeze({ ...base, kind: "other", eventType: item.eventType });
}

function projectMoney(value: TimelineTransaction["amount"], transactionId: string): Money {
  if (!Number.isFinite(value.value)) {
    throw new TRValidationError(`Transaction "${transactionId}" has a non-finite amount`);
  }
  if (!Number.isSafeInteger(value.fractionDigits) || value.fractionDigits < 0) {
    throw new TRValidationError(`Transaction "${transactionId}" has invalid fraction digits`);
  }
  const minorUnits = Math.round(value.value * 10 ** value.fractionDigits);
  if (!Number.isSafeInteger(minorUnits)) {
    throw new TRValidationError(`Transaction "${transactionId}" has unsafe minor units`);
  }
  return Object.freeze({
    currency: value.currency,
    minorUnits,
    fractionDigits: value.fractionDigits,
  });
}

function projectDocuments(value: AllDocuments): readonly AccountDocument[] {
  return Object.freeze(
    value.documents.map((document) =>
      Object.freeze({
        id: document.id,
        title: document.title,
        description: document.description,
        contentType: document.contentType,
        version: document.version,
        url: document.url,
      }),
    ),
  );
}

function equalCash(left: AccountCash, right: AccountCash): boolean {
  return (
    equalBalances(left.balances, right.balances) && equalBalances(left.available, right.available)
  );
}

function equalBalances(
  left: readonly AccountCashBalance[],
  right: readonly AccountCashBalance[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (balance, index) =>
        balance.accountNumber === right[index]?.accountNumber &&
        balance.currency === right[index]?.currency &&
        balance.amount === right[index]?.amount,
    )
  );
}

function equalTransactions(left: readonly Transaction[], right: readonly Transaction[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => equalTransaction(value, right[index]))
  );
}

function equalTransaction(left: Transaction, right: Transaction | undefined): boolean {
  return (
    right !== undefined &&
    left.id === right.id &&
    left.timestamp === right.timestamp &&
    left.description === right.description &&
    left.counterparty === right.counterparty &&
    left.kind === right.kind &&
    left.eventType === right.eventType &&
    left.cashAccountNumber === right.cashAccountNumber &&
    equalMoney(left.amount, right.amount) &&
    equalNullableMoney(left.subAmount, right.subAmount)
  );
}

function equalMoney(left: Money, right: Money): boolean {
  return (
    left.currency === right.currency &&
    left.minorUnits === right.minorUnits &&
    left.fractionDigits === right.fractionDigits
  );
}

function equalNullableMoney(left: Money | null, right: Money | null): boolean {
  return left === null || right === null ? left === right : equalMoney(left, right);
}

function equalDocuments(
  left: readonly AccountDocument[],
  right: readonly AccountDocument[],
): boolean {
  return (
    left.length === right.length &&
    left.every((document, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        document.id === other.id &&
        document.title === other.title &&
        document.description === other.description &&
        document.contentType === other.contentType &&
        document.version === other.version &&
        document.url === other.url
      );
    })
  );
}

function equalRange(
  left: MaterializedRange | undefined,
  right: MaterializedRange | undefined,
): boolean {
  return left === undefined || right === undefined
    ? left === right
    : left.from === right.from && left.to === right.to;
}

/** Rows come from JSON, so equal text is equal content. */
function equalRow(left: TimelineTransaction, right: TimelineTransaction): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

/** Newest first, then by id. Fits projected Transactions and raw rows alike. */
function compareTransactions(
  left: { readonly timestamp: string; readonly id: string },
  right: { readonly timestamp: string; readonly id: string },
): number {
  return Date.parse(right.timestamp) - Date.parse(left.timestamp) || compareText(left.id, right.id);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function validDate(value: Date, name: string): number {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TRValidationError(`${name} must be a valid Date`);
  }
  return value.getTime();
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Promise failures cross this boundary.
function errorFrom(value: unknown): Error {
  return value instanceof Error ? value : new Error("Account operation failed", { cause: value });
}
