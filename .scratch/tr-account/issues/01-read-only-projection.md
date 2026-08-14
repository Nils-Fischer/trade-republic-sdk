# 01 — TRAccount read-only projection

**What to build:** add `TRAccount`, a read-only projection over an existing `TRClient`. It holds
cash, normalized Transactions, and document metadata behind three stable external-store slices.
One `sync()` call fills the configured transaction Window and starts the Watches that keep current
Banking data fresh.

```ts
const client = new TRClient({ session });
const account = new TRAccount(client, {
  transactionWindow: { from: new Date("2026-01-01T00:00:00.000Z") },
});

await account.sync();

const { value, freshness } = account.transactions.getSnapshot();
const unsubscribe = account.cash.subscribe(() => {
  render(account.cash.getSnapshot());
});

// Later:
unsubscribe();
account.stop();
```

`TRAccount` is a deep module. Its interface hides Topic selection, concurrent initial reads,
pagination, Watch lifecycle, normalization, deduplication, referential stability, and error state.
Deleting it would force every caller to rebuild those policies.

### Public interface

Add `src/account.ts` and export its public values and types from the package root.

```ts
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

export class TRAccount {
  readonly cash: AccountSlice<AccountCash>;
  readonly transactions: TransactionSlice;
  readonly documents: AccountSlice<readonly AccountDocument[]>;

  constructor(client: TRClient, options: TRAccountOptions);
  sync(options?: { signal?: AbortSignal }): Promise<void>;
  stop(): void;
}
```

This is the complete public surface for this ticket. Do not expose setters, raw Subscription
controls, Topic names, retry controls, a whole-account snapshot, or implementation state. Do not
add a second environment seam: tests inject `fetch`, socket, and clock through `TRClient`.

The constructor validates the Window and performs no I/O. `transactionWindow.from` must be a valid
Date. The Window is open-ended: it starts at `from` and includes later Transactions received after
Sync.

### Slice contract

Every slice begins with one stable Snapshot:

```ts
{ value: undefined, freshness: "empty" }
```

`getSnapshot()` is referentially stable. It returns the identical Snapshot object until that
slice's semantic value, Freshness, Materialized Range, or error changes. A repeated equivalent
server Snapshot must not mint a new object or notify listeners.

`subscribe()` does not call the listener immediately. It returns an idempotent unsubscribe
function. A slice notifies its current listeners once after committing a real change. A cash
change must not notify Transaction or document listeners. Values and arrays exposed by snapshots
are immutable; mutable Maps and arrays remain private.

Freshness means:

- `empty` — the slice has not completed a successful read;
- `fresh` — its last initial read or Watch payload succeeded;
- `stale` — a later read or Watch failed, or `stop()` ended live maintenance.

Keep the last good value when a slice becomes stale. Store the typed error on the affected
Snapshot. A failed first read remains `empty` and carries its error. Clear the error when that
slice next succeeds. Connection recovery is invisible here because `TRClient` keeps Watches
pending; `TRAccount` reacts only if a Watch actually throws.

### Sync and lifecycle

`sync()` has two jobs: materialize the initial Window and establish live maintenance.

1. Start one `cash.watch({})`, one `availableCash.watch({})`, and one
   `timelineTransactions.watch({})` before the bounded history read. This prevents a change during
   pagination from being lost.
2. Await the first payload from each Watch.
3. Read `allDocuments` and call `getTimelineTransactions()` for the configured Window.
4. Merge the first and later timeline Watch payloads with the paginated result by Transaction ID.
5. Resolve after all three slices have a successful initial value and the transaction Window is
   fully materialized.

The two cash Watches form one cash slice. `AccountCash` contains both the total `cash` balances and
the `availableCash` balances. Each side can update independently, but the slice is fresh only when
both have produced a value in the current Sync.

Concurrent `sync()` calls share one in-flight promise. A later Sync keeps the active Watches and
uses one `cash.get({})` and one `availableCash.get({})` to refresh cash instead of waiting for
Watches that may not emit again. It also refreshes documents and the full configured Window. It
must not start duplicate Watches. Successful slices publish even if another slice fails. After all
work settles, reject with the first error in the fixed order cash, transactions, documents;
callers can inspect each slice for all failures.

An AbortSignal cancels only that Sync attempt. It must not stop Watches that were already active
before the call. If the first Sync is aborted, cancel Watches created by that attempt and mark only
unfinished slices with `TRAbortError`.

`stop()` is synchronous and idempotent. It cancels all active Watches and pending internal work,
prevents late values from publishing, and marks every fresh slice stale without discarding data.
The same `TRAccount` can Sync again after Stop. Logout remains a `TRClient` concern; if Logout makes
a Watch throw, the affected slice becomes stale.

### Cash projection

Project the existing `cash` and `availableCash` responses without inventing currency precision
that is absent from their wire shape:

```ts
export interface AccountCashBalance {
  readonly accountNumber: string;
  readonly currency: string;
  readonly amount: number;
}

export interface AccountCash {
  readonly balances: readonly AccountCashBalance[];
  readonly available: readonly AccountCashBalance[];
}
```

Map `currencyId` to `currency`. Sort each array by account number and then currency so server order
does not create false slice changes. Reject duplicate `(accountNumber, currency)` pairs with
`TRValidationError`; do not silently choose one.

### Transaction projection

Normalize raw timeline items into an immutable domain value:

```ts
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
```

This initial union has one evidenced semantic case and an honest fallback. Add later kinds only
when sanitized fixtures prove their meaning. Callers can switch exhaustively on `kind`, while
unknown Trade Republic event types remain readable instead of breaking Sync.

Normalize as follows:

- `title` becomes `description`;
- `subtitle ?? null` becomes `counterparty`;
- `eventType === "CASH"` becomes `kind: "cash"`; every other value becomes `kind: "other"`;
- exclude raw items whose `hidden` or `deleted` flag is true;
- convert `amount` and `subAmount` to integer minor units with
  `Math.round(value * 10 ** fractionDigits)`;
- reject non-finite values, invalid fraction digits, and unsafe integer results with
  `TRValidationError`;
- sort newest first, using ID as the stable tie-breaker;
- deduplicate by ID; the newest received representation wins.

Do not expose raw presentation fields or retain a raw payload inside `Transaction`; callers that
need the wire shape use `TRClient`.

After a successful initial history read, `materializedRange` covers the configured `from` through
the Sync upper bound even when the range contains no Transactions. Later Watch values extend its
upper bound. This distinction proves that an empty period was read rather than never loaded.

`transactions.read({ from, to })` returns normalized Transactions newest first:

- if the requested range is covered and the slice is fresh, answer from held values without I/O;
- otherwise call `TRClient.getTimelineTransactions()` for the exact range;
- merge only the portion inside the configured Window into the held slice;
- return out-of-Window results to the caller without widening the held Window;
- apply the same normalization, hidden/deleted policy, ordering, and validation as Sync.

Reject invalid or reversed dates before I/O. Concurrent identical uncovered reads may share work;
this is an implementation choice, not a public guarantee.

### Document projection

Use `allDocuments.get()` and expose metadata only:

```ts
export interface AccountDocument {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly contentType: string;
  readonly version: number;
  readonly url: string;
}
```

Preserve server order. A document value changes when any exposed field changes. Do not download,
prefetch, validate the contents of, or write to document URLs. Documents refresh only during
explicit Sync because the supported client surface has no document Watch.

### Errors and ownership

`TRAccount` owns projection and lifecycle errors. `TRClient` continues to own Session,
authentication recovery, transport recovery, validation of raw responses, and typed read errors.
Preserve `TRAuthError`, `TRConnectionError`, `TRTimeoutError`, `TRAbortError`, and
`TRValidationError` instead of wrapping them in a generic account error.

The module never writes to the console. Background Watch failures are observable through the
affected slice Snapshot and listener notification.

### Offline verification

Drive all tests through public `TRAccount` and `TRClient` interfaces with injected `FakeSocket`,
`FakeClock`, and fake fetch. Do not test private projection state or mock modules.

Tests must prove:

- construction performs no I/O and rejects an invalid Window;
- the first Sync starts one of each Watch before transaction pagination;
- concurrent Sync calls share work; repeated Sync uses one-shot cash reads and does not duplicate
  Watches;
- cash, Transaction, and document slices update independently;
- initial, fresh, and stale snapshots follow the contract and preserve last good values;
- identical semantic values preserve Snapshot identity and do not notify;
- each real slice change mints one Snapshot and notifies once;
- unsubscribe and Stop are idempotent;
- Stop cancels Watches, ignores late values, marks data stale, and permits a later Sync;
- a Watch remains pending across `TRClient` connection recovery without making its slice stale;
- a terminal Watch error marks only its slice stale;
- one failed slice does not prevent successful slices from publishing;
- Sync abort cancels only work owned by that attempt;
- cash arrays have deterministic order and duplicate keys fail validation;
- Transaction normalization maps names, converts integer money, filters hidden/deleted items,
  deduplicates, and orders newest first;
- unsafe money and malformed ranges throw `TRValidationError`;
- an empty successful Window still records its Materialized Range;
- Watch updates merge with a concurrent history read without being lost;
- a covered fresh Transaction read performs no I/O;
- an uncovered or stale read performs one bounded client read and does not retain values outside
  the configured Window;
- document Sync exposes metadata and performs no document download;
- no test sleeps, performs network I/O, or writes to the console;
- package-root exports contain the new runtime values and types, while `trade-republic-sdk/react`
  stays empty in this ticket.

### Live verification

Extend the opt-in live account audit with a `TRAccount` section. Use a short Window such as the
last seven days. Print only slice names, Freshness, counts, and Materialized Range dates. Do not
print balances, descriptions, counterparties, document metadata, URLs, account numbers,
Transaction IDs, Session data, or raw values.

The live check must Sync, read each slice, verify a covered Transaction read causes no extra
Subscription, Stop, and confirm all three slices become stale. It must remain outside the default
offline suite.

### Out of scope

- additional account slices such as positions, orders, savings plans, tax, identity, permissions,
  or payment methods;
- Market Topics, unsupported Topics, and `trendingStocks`;
- persistence or hydration of projected data;
- configurable background polling or timers;
- writes, document downloads, orders, savings-plan changes, or money movement;
- React hooks and all UI bindings;
- event-type kinds not backed by sanitized evidence;
- replacing or widening the public `TRClient` interface unless the implementation proves one
  small lower-level seam is necessary.

**Blocked by:** core-client 03 — Session, 04 — Connection recovery, and 05 — Read-only account
surface

**Uses:** ADR-0006 normalized Transactions, ADR-0009 per-slice external-store contract, and
ADR-0010 read-only account

**Status:** ready-for-agent

- [ ] `TRAccount` is a read-only projection over an injected `TRClient`
- [ ] Construction is lazy and the public interface stays small
- [ ] Cash, Transactions, and documents expose independent external-store slices
- [ ] Slice Snapshots are immutable and referentially stable
- [ ] Sync materializes the configured Window and starts one set of Watches
- [ ] Concurrent and repeated Sync calls do not duplicate work or Watches
- [ ] Freshness and typed background failures are observable per slice
- [ ] Stop cancels live work, preserves values as stale, and permits later Sync
- [ ] Transactions use integer minor units and explicit hidden/deleted policy
- [ ] Materialized Range distinguishes an empty read range from an unread range
- [ ] Reads outside the Window use `TRClient` without widening held state
- [ ] Documents remain metadata-only and are never downloaded
- [ ] React bindings and extra account slices remain out of scope
- [ ] Offline tests use only public interfaces and the injected environment
- [ ] The opt-in live audit prints no account values or credentials
- [ ] `vp check`, `vp test`, `vp run build`, and `git diff --check` pass

## Notes

The deletion test explains the module's depth. Without `TRAccount`, every consumer must coordinate
three initial reads, two cash Watches, a timeline Watch, paginated history, connection recovery,
normalization, deduplication, Window coverage, stale data, immutable Snapshots, and listener
identity. This ticket puts that policy behind three slices, Sync, and Stop.

Do not build one generic slice abstraction whose type parameters expose the implementation. Small
private helpers are useful; the public interface should describe account behavior, not its storage
machinery.
