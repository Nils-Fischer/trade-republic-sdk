# Trade Republic SDK

An unofficial TypeScript SDK for Trade Republic's private API.

> This project is not affiliated with Trade Republic. The private API can change without notice.

Trade Republic exposes a small REST surface for account data and one multiplexed WebSocket that
carries everything else. This SDK makes both readable as ordinary TypeScript.

```bash
npm install trade-republic-sdk
```

## Two layers

**`TRClient`** is the complete surface: every Topic and REST resource, no state beyond a Session
and a socket. Use it for anything parameterized, such as prices, instruments, and search, where
there is no "all state" to hold locally.

**`TRAccount`** is a read-only projection over the Banking Topics, built on a TRClient. It keeps
a Window of history current so you read cash, transactions, and documents as plain values. It
never writes.

`trade-republic-sdk/react` binds both to React. It is an optional entry point; React is a
peer dependency.

## TRClient

```ts
import { TRClient } from "trade-republic-sdk";

const client = new TRClient();
await client.login("+49...", "1234"); // Then approve in the Trade Republic app.

// Read a Topic once.
const cash = await client.cash.get({});

// Read a Topic continuously.
for await (const tick of client.ticker.watch({ id: "US88160R1014.LSX" })) {
  console.log(tick.bid.price);
}

// Read a REST resource.
const info = await client.accountInfo.get();
```

Every Topic supports `get` (subscribe, take the first payload, cancel) and `watch` (stay
subscribed until you stop). Accessors are named after the wire Topic: `ticker`, `cash`,
`availableCash`, `timelineTransactions`, `orders`, `portfolioStatus`, `savingsPlans`,
`watchlists`, and the rest. `client.topic(name)` addresses one chosen at runtime.

Secured Topics need a Session; Public Topics such as `ticker` do not. Trade Republic enforces
this per Subscription, so an unauthenticated client connects normally and only Secured Topics
fail.

### Sessions

A Session is proven identity held as cookies. It is never assumed valid, only attempted, so
`client.sessionValidity` reads `absent`, `presumed-valid`, or `rejected`.

```ts
const saved = client.exportSession(); // Opaque string.
const restored = new TRClient({ session: saved });
await restored.refresh(); // No PIN, no user present.
```

Refresh runs on its own timer even while the socket is healthy: an established socket outlives
the Session, but opening the _next_ one needs a valid Session.

### Connection

One socket carries all Subscriptions, held open by the Echo keepalive. On transport loss the
SDK replays resumable Subscriptions on a backoff, so a Watch goes quiet and resumes on its own.
`client.connection` and `client.session` are subscribable stores (`getSnapshot` / `subscribe`).

## TRAccount

```ts
import { TRAccount } from "trade-republic-sdk";

const account = new TRAccount(client, {
  transactionWindow: { from: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
});
await account.sync();

account.cash.getSnapshot(); // AccountQuery<AccountCash>
account.transactions.getSnapshot(); // + materializedRange
account.documents.getSnapshot();

// Reads outside the Window go to Trade Republic instead of failing.
const march = await account.transactions.read({
  from: new Date("2026-03-01"),
  to: new Date("2026-04-01"),
});

account.stop();
```

Each Slice (cash, transactions, documents) fails and updates on its own, so a moving balance
never disturbs a transaction list. Transactions track a **Materialized Range** rather than a
count, which keeps "no transactions in March" distinct from "March was never fetched". Money is
normalized to integer minor units.

## TRQuery

Every read returns the same shape, so Slices, Topics, and resources are all read the same way.

```ts
const query = account.cash.getSnapshot();
if (query.isSuccess) console.log(query.data.balances);
if (query.isError) console.log(query.error, query.data); // Last known value survives.
```

`status` is `pending`, `success`, or `error`. Account queries add `dataUpdatedAt` (when the
value last _changed_) and `isStale`. Freshness is derived from connection liveness, never stored
on the value. A value falls behind when the socket drops, not when credentials lapse.

## React

```tsx
import { TRProvider, useCash, useLogin, useWatch } from "trade-republic-sdk/react";

<TRProvider client={client} account={account} autoSync>
  <Portfolio />
</TRProvider>;

function Portfolio() {
  const cash = useCash();
  const price = useWatch("ticker", { id: "US88160R1014.LSX" });
  if (cash.isPending) return <Spinner />;
  return <Balance value={cash.data} stale={cash.isStale} />;
}
```

Slices: `useCash`, `useTransactions`, `useDocuments`, `useAccountSlice`,
`useTransactionRange`. Direct reads: `useWatch`, `useGet` (with `refetch`). State:
`useSession`, `useConnection`. Actions: `useLogin` (exposes `awaiting-approval`), `useSync`.
Equal requests inside one provider share a single Subscription. Snapshots are referentially
stable, so an unchanged list does not re-render.

## Errors

Every failure inherits from `TRError`. Catch the root type, or distinguish `TRAuthError`,
`TRHttpError`, `TRTopicError`, `TRValidationError`, `TRTimeoutError`, `TRConnectionError`, and
`TRAbortError`.

```ts
import { TRError, TRTopicError } from "trade-republic-sdk";

try {
  await client.cash.get({});
} catch (error) {
  if (error instanceof TRTopicError)
    console.log(error.errorCode); // e.g. AUTHENTICATION_ERROR.
  else if (error instanceof TRError) console.log(error.message);
}
```

A Topic Error rejects one Subscription while the connection stays healthy.

## Validation

Responses are validated against ArkType schemas. The default mode is `warn`: schema drift is
reported, not thrown.

```ts
new TRClient({ validate: "warn", onValidationWarning: (warning) => log(warning) });
```

Schemas and the `topicRegistry` / `resourceRegistry` are exported, so callers can validate raw
payloads themselves.

## Runtimes

Public Topics target Node.js 22.4+, Bun, browsers, and React Native. Sessions work directly in
Node, Bun, and React Native. In browsers, Session export and Refresh scheduling need an injected
cookie-capable transport, because browser `fetch` hides `HttpOnly` cookies. Inject `fetch`,
`socket`, and `clock` through `TRClientOptions`; `trade-republic-sdk/testing` provides
`FakeClock` and `FakeSocket`.

## Development

```bash
vp install
vp check
vp test
vp run build
```

Run the opt-in, read-only account contract test before a release:

```bash
vp run test:live
```

It prompts for the phone number and PIN without echo, then waits for approval in the app. It
keeps credentials, the Session, and responses in memory, and prints only accessor status,
counts, and normalized schema paths. It is not part of `vp test` or CI.

## Releasing

Run the one-time setup wizard to configure npm Trusted Publishing:

```bash
./scripts/setup-release.sh
```

For each release, choose the next semantic version, create the tag, and push it:

```bash
vp run release
git push --follow-tags
```

GitHub Actions then runs `vp check`, `vp test`, and `vp pack`, and publishes the tagged package
to npm with provenance. The release workflow uses npm only for the registry upload.

## License

[MIT](./LICENSE)
