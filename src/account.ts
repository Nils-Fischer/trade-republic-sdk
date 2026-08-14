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

export type Freshness = "empty" | "fresh" | "stale";

export interface SliceSnapshot<Value> {
  readonly value: Value | undefined;
  readonly freshness: Freshness;
  readonly error?: Error;
}

export interface AccountSlice<Value> {
  getSnapshot(): SliceSnapshot<Value>;
  subscribe(onChange: () => void): () => void;
}

export interface MaterializedRange {
  readonly from: string;
  readonly to: string;
}

export interface TransactionSnapshot extends SliceSnapshot<readonly Transaction[]> {
  readonly materializedRange?: MaterializedRange;
}

export interface TransactionSlice {
  getSnapshot(): TransactionSnapshot;
  subscribe(onChange: () => void): () => void;
  read(options: TransactionRange): Promise<readonly Transaction[]>;
}

export interface TransactionRange {
  readonly from: Date;
  readonly to?: Date;
  readonly signal?: AbortSignal;
}

export interface TRAccountOptions {
  readonly transactionWindow: { readonly from: Date };
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

type CashSnapshot = SliceSnapshot<AccountCash>;
type DocumentSnapshot = SliceSnapshot<readonly AccountDocument[]>;
type WatchName = "cash" | "availableCash" | "timelineTransactions";

interface ProjectedTransaction {
  readonly id: string;
  readonly timestamp: number;
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

interface MutableSliceSnapshot<Value> {
  value: Value | undefined;
  freshness: Freshness;
  error?: Error;
}

interface MutableTransactionSnapshot extends MutableSliceSnapshot<readonly Transaction[]> {
  materializedRange?: MaterializedRange;
}

class SnapshotStore<Value, Snapshot extends SliceSnapshot<Value>> {
  #snapshot: Snapshot;
  readonly #listeners = new Set<() => void>();
  readonly #transition: (
    snapshot: Snapshot,
    freshness: "stale" | "empty",
    error?: Error,
  ) => Snapshot;

  constructor(
    initial: Snapshot,
    transition: (snapshot: Snapshot, freshness: "stale" | "empty", error?: Error) => Snapshot,
  ) {
    this.#snapshot = initial;
    this.#transition = transition;
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
    const freshness = this.#snapshot.freshness === "empty" ? "empty" : "stale";
    if (this.#snapshot.error === error && this.#snapshot.freshness === freshness) return;
    this.replace(this.#transition(this.#snapshot, freshness, error));
  }

  markStopped(): void {
    if (this.#snapshot.freshness !== "fresh") return;
    this.replace(this.#transition(this.#snapshot, "stale"));
  }
}

/** A read-only, live account projection over one TRClient. */
export class TRAccount {
  readonly cash: AccountSlice<AccountCash>;
  readonly transactions: TransactionSlice;
  readonly documents: AccountSlice<readonly AccountDocument[]>;

  readonly #client: TRClient;
  readonly #windowFrom: number;
  readonly #windowFromIso: string;
  readonly #cashStore = new SnapshotStore<AccountCash, CashSnapshot>(
    emptySnapshot(),
    (current, freshness, error) => snapshot(current.value, freshness, error),
  );
  readonly #transactionStore = new SnapshotStore<readonly Transaction[], TransactionSnapshot>(
    emptySnapshot(),
    (current, freshness, error) =>
      transactionSnapshot(current.value, freshness, current.materializedRange, error),
  );
  readonly #documentStore = new SnapshotStore<readonly AccountDocument[], DocumentSnapshot>(
    emptySnapshot(),
    (current, freshness, error) => snapshot(current.value, freshness, error),
  );
  readonly #watchSlots = new Map<WatchName, WatchSlot>();
  readonly #pendingReads = new Set<AbortController>();
  readonly #transactionsById = new Map<string, Transaction>();
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

  constructor(client: TRClient, options: TRAccountOptions) {
    this.#client = client;
    this.#windowFrom = validDate(options.transactionWindow.from, "transactionWindow.from");
    this.#windowFromIso = new Date(this.#windowFrom).toISOString();

    this.cash = Object.freeze({
      getSnapshot: this.#cashStore.getSnapshot,
      subscribe: this.#cashStore.subscribe,
    });
    this.transactions = Object.freeze({
      getSnapshot: this.#transactionStore.getSnapshot,
      subscribe: this.#transactionStore.subscribe,
      read: (range: TransactionRange) => this.#readTransactions(range),
    });
    this.documents = Object.freeze({
      getSnapshot: this.#documentStore.getSnapshot,
      subscribe: this.#documentStore.subscribe,
    });
  }

  sync(options: { signal?: AbortSignal } = {}): Promise<void> {
    if (this.#syncPromise) return this.#syncPromise;

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
    this.#token += 1;
    this.#syncController?.abort("TRAccount stopped");
    this.#syncController = undefined;
    this.#syncPromise = undefined;
    for (const slot of this.#watchSlots.values()) slot.controller.abort("TRAccount stopped");
    this.#watchSlots.clear();
    for (const controller of this.#pendingReads) controller.abort("TRAccount stopped");
    this.#pendingReads.clear();
    this.#cashWatchSeen = { cash: false, availableCash: false };
    this.#watchTransactions.clear();
    this.#lastTimelineWatchAt = undefined;
    this.#cashStore.markStopped();
    this.#transactionStore.markStopped();
    this.#documentStore.markStopped();
  }

  async #runSync(context: SyncContext): Promise<void> {
    if (context.controller.signal.aborted)
      return this.#finishAbortedSync(context, [false, false, false]);

    this.#ensureWatches(context);
    const cancelCreatedWatches = (): void => {
      for (const name of context.createdWatches) {
        const slot = this.#watchSlots.get(name);
        if (slot?.token === context.token) slot.controller.abort(context.controller.signal.reason);
      }
    };
    context.controller.signal.addEventListener("abort", cancelCreatedWatches, { once: true });
    let cashWork: Promise<void>;
    let transactionWork: Promise<void>;
    let documentWork: Promise<void>;
    if (context.firstMaintenance) {
      const cashReady = this.#watchReady("cash");
      const availableCashReady = this.#watchReady("availableCash");
      const timelineReady = this.#watchReady("timelineTransactions");
      await Promise.allSettled([cashReady, availableCashReady, timelineReady]);
      if (context.controller.signal.aborted || context.token !== this.#token) {
        context.controller.signal.removeEventListener("abort", cancelCreatedWatches);
        return this.#finishAbortedSync(context, [
          this.#cashStore.getSnapshot().freshness === "fresh",
          false,
          false,
        ]);
      }
      cashWork = this.#waitForInitialCash(context, [cashReady, availableCashReady]);
      transactionWork = this.#refreshTransactions(
        context,
        accountClientNow(this.#client),
        timelineReady,
      );
      documentWork = this.#refreshDocuments(context);
    } else {
      cashWork = this.#refreshCash(context);
      transactionWork = this.#refreshTransactionsAfterWatches(context);
      documentWork = this.#refreshDocuments(context);
    }
    const results = await Promise.allSettled([cashWork, transactionWork, documentWork]);
    context.controller.signal.removeEventListener("abort", cancelCreatedWatches);
    const completed = results.map((result) => result.status === "fulfilled");

    if (context.controller.signal.aborted || context.token !== this.#token) {
      return this.#finishAbortedSync(context, completed);
    }

    for (const result of results) {
      if (result.status === "rejected") throw errorFrom(result.reason);
    }
  }

  #ensureWatches(context: SyncContext): void {
    this.#ensureWatch("cash", context);
    this.#ensureWatch("availableCash", context);
    this.#ensureWatch("timelineTransactions", context);
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
    try {
      const [historyResult, readyResult] = await Promise.allSettled([
        this.#client.getTimelineTransactions({
          from: new Date(this.#windowFrom),
          to: new Date(upperBound),
          signal: context.controller.signal,
        }),
        timelineReady,
      ]);
      this.#assertCurrent(context);
      if (historyResult.status === "rejected") throw errorFrom(historyResult.reason);
      const items = historyResult.value;
      for (const transaction of this.#transactionsById.values()) {
        if (Date.parse(transaction.timestamp) < upperBound) {
          this.#transactionsById.delete(transaction.id);
        }
      }
      for (const transaction of projectTransactions(items)) this.#applyTransaction(transaction);
      for (const watched of this.#watchTransactions.values()) {
        if (watched.revision >= watchThreshold) this.#applyTransaction(watched.transaction);
      }
      this.#watchTransactions.clear();
      this.#materializedTo = Math.max(upperBound, this.#lastTimelineWatchAt ?? upperBound);
      this.#commitTransactions();
      if (readyResult.status === "rejected") throw errorFrom(readyResult.reason);
    } catch (error) {
      if (!context.controller.signal.aborted) this.#transactionStore.fail(errorFrom(error));
      throw error;
    }
  }

  async #refreshTransactionsAfterWatches(context: SyncContext): Promise<void> {
    const starts = context.createdWatches.map(
      (name) =>
        this.#watchSlots.get(name)?.started.promise ??
        Promise.reject(new TRAbortError(`Watch for Topic "${name}" was cancelled`)),
    );
    const results = await Promise.allSettled(starts);
    this.#assertCurrent(context);
    for (const result of results) {
      if (result.status === "rejected") throw errorFrom(result.reason);
    }
    return this.#refreshTransactions(context, accountClientNow(this.#client));
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
      snapshot.freshness === "fresh" &&
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
      }
      return Object.freeze(result);
    } catch (error) {
      if (token === this.#token) this.#transactionStore.fail(errorFrom(error));
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
    if (transaction.value) this.#transactionsById.set(transaction.id, transaction.value);
    else this.#transactionsById.delete(transaction.id);
  }

  #commitCash(): void {
    if (!this.#cashBalances || !this.#availableBalances) return;
    const value: AccountCash = Object.freeze({
      balances: this.#cashBalances,
      available: this.#availableBalances,
    });
    const current = this.#cashStore.getSnapshot();
    if (current.freshness === "fresh" && current.value && equalCash(current.value, value)) return;
    this.#cashStore.replace(snapshot(value, "fresh"));
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
      current.freshness === "stale" &&
      current.error === error &&
      current.value &&
      equalCash(current.value, value)
    ) {
      return;
    }
    this.#cashStore.replace(snapshot(value, "stale", error));
  }

  #commitTransactions(): void {
    const value = Object.freeze([...this.#transactionsById.values()].sort(compareTransactions));
    const current = this.#transactionStore.getSnapshot();
    const range = this.#materializedRange();
    if (
      current.freshness === "fresh" &&
      current.value &&
      equalTransactions(current.value, value) &&
      equalRange(current.materializedRange, range)
    ) {
      return;
    }
    this.#transactionStore.replace(transactionSnapshot(value, "fresh", range));
  }

  #commitDocuments(value: readonly AccountDocument[]): void {
    const current = this.#documentStore.getSnapshot();
    if (current.freshness === "fresh" && current.value && equalDocuments(current.value, value))
      return;
    this.#documentStore.replace(snapshot(value, "fresh"));
  }

  #materializedRange(): MaterializedRange | undefined {
    if (this.#materializedTo === undefined) return undefined;
    return Object.freeze({
      from: this.#windowFromIso,
      to: new Date(this.#materializedTo).toISOString(),
    });
  }

  #failWatchSlice(name: WatchName, error: Error): void {
    if (name === "timelineTransactions") this.#transactionStore.fail(error);
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
      if (!completed[1]) this.#transactionStore.fail(error);
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

function emptySnapshot<Value>(): SliceSnapshot<Value> {
  return Object.freeze({ value: undefined, freshness: "empty" });
}

function snapshot<Value>(
  value: Value | undefined,
  freshness: Freshness,
  error?: Error,
): SliceSnapshot<Value> {
  const result: MutableSliceSnapshot<Value> = {
    value,
    freshness,
  };
  if (error) result.error = error;
  return Object.freeze(result);
}

function transactionSnapshot(
  value: readonly Transaction[] | undefined,
  freshness: Freshness,
  range?: MaterializedRange,
  error?: Error,
): TransactionSnapshot {
  const result: MutableTransactionSnapshot = { value, freshness };
  if (range) result.materializedRange = range;
  if (error) result.error = error;
  return Object.freeze(result);
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

function compareTransactions(left: Transaction, right: Transaction): number {
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
