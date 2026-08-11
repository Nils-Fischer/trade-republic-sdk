# 05 — Read-only account surface

**What to build:** expose the raw Trade Republic resources needed to reconstruct an account through
`TRClient`, then verify the complete read path against a live account without printing or storing
private account data.

This ticket proves that the core client can recover the inputs for a future `TRAccount`. It does
not build that projection yet. `TRClient` remains the unopinionated wire surface: REST resources
return their validated server shapes, and Banking Topics keep their ordinary Get and Watch
interfaces.

```ts
const tr = new TRClient({ session: saved });

const identity = await tr.accountInfo.get();
const pairs = await tr.accountPairs.get({});
const portfolio = await tr.compactPortfolioByType.get({
  secAccNo: pairs.accounts[0].securitiesAccountNumber,
});
const transactions = await tr.timelineTransactions.get({});
```

### One namespace, two capabilities

REST resources and Topics use the same named namespace on `TRClient`. Their interfaces remain
honest about what each transport can do:

```ts
interface ResourceAccessor<Response> {
  get(options?: GetOptions): Promise<Response>;
}

interface TopicAccessor<Request, Response> {
  get(request: Request, options?: GetOptions): Promise<Response>;
  watch(request: Request): AsyncIterable<Response>;
}
```

A REST resource has no `watch`. Do not add a method that throws at runtime. Keep a separate
`resourceRegistry` because HTTP paths and Topic wire names are different concepts, but derive all
named resource accessors and types from it. The Topic registry remains the single source of truth
for Topics. Reject duplicate names between the two registries during development rather than
letting one accessor overwrite another.

Add `src/resources.ts` for the resource registry and its schemas. Named resources need no generic
escape hatch in this ticket; the generic `topic(name)` form remains Topic-only.

### Authenticated HTTP reads

Deepen Session's internal interface just enough to perform an authenticated HTTP Get. Session
continues to own cookies and Trade Republic headers; callers never receive or assemble a Cookie
header. The HTTP read path must:

- use the injected `fetch` and current Session cookies;
- use the same app, platform, device, locale, and `credentials: "include"` headers as Login;
- fail locally with `TRAuthError` when no Session is presumed valid;
- turn unsuccessful HTTP responses into `TRHttpError`;
- on a 401 or 403, share one reactive Refresh, retry the resource once, then surface the typed
  failure without recursion;
- accept the existing abort and fake-clock timeout controls;
- validate through the client's existing `off`, `warn`, or `throw` response policy.

Do not create a second cookie store or duplicate Session rejection logic in the resource module.
Keep JSON parsing and schema failures as `TRValidationError`.

### REST resources

Port these observed read-only resources from `~/Code/tr-sdk/src/rest/client.ts` and
`validation/rest.ts`:

| Accessor             | Path                                    |
| -------------------- | --------------------------------------- |
| `accountInfo`        | `GET /api/v2/auth/account`              |
| `personalDetails`    | `GET /api/v1/customer/personal-details` |
| `paymentMethods`     | `GET /api/v2/payment/methods`           |
| `taxResidency`       | `GET /api/v1/country/taxresidency`      |
| `taxInformation`     | `GET /api/v1/taxes/information`         |
| `taxExemptionOrders` | `GET /api/v1/taxes/exemptionorders`     |
| `allDocuments`       | `GET /api/v1/documents/all`             |

`allDocuments` returns document metadata only. Do not download document URLs. `trendingStocks` is
a Market resource and is outside this account-focused ticket.

### Banking Topics

Port the request and response schemas for these observed Secured Topics from
`~/Code/tr-sdk/src/validation/subscriptions.ts` and add one row per Topic to `topicRegistry`:

- `accountPairs`
- `availableCash`
- `compactPortfolioByType`
- `customerPermissions`
- `fincrimeBanner`
- `orders`
- `portfolioStatus`
- `savingsPlans`
- `timelineActionsV2`
- `timelineDetailV2`
- `timelineTransactions`
- `tradingPerkConditionStatus`
- `watchlists`
- `namedWatchlist`

Keep the existing `cash` Topic. Empty requests must use an exact empty-object schema. Preserve the
wire field names such as `secAccNo` and `after`; this layer represents Trade Republic, not a
normalized account model.

The old schemas are starting evidence, not unquestionable truth. Fix structural mistakes found by
offline fixtures or live validation. Use `unknown` only for genuinely opaque or varying leaves,
not as a substitute for porting an observed shape. Default validation still warns on additive
server drift; `throw` mode must identify the resource or Topic that drifted.

### Timeline pagination

`timelineTransactions.get({ after })` returns one raw page. Also port the old client's bounded
pagination helper as:

```ts
tr.getTimelineTransactions({
  from: Date,
  to?: Date,
  signal?: AbortSignal,
  pageTimeoutMs?: number,
  maxPages?: number,
}): Promise<TimelineTransaction[]>;
```

The helper uses the public Topic accessor rather than a second socket path. It returns newest-first,
deduplicates by transaction ID, stops after crossing `from`, rejects repeated cursors and
out-of-order pages, observes abort and timeout controls, and enforces a positive `maxPages` guard.
It returns the raw timeline shape; normalization and integer money belong to `TRAccount`.

### Offline verification

Drive every behavior through `TRClient` with the injected environment. Port only minimal sanitized
fixtures needed for the listed resources and Topics; do not commit a real account response.

Tests must prove:

- every resource and Topic accessor is derived and fully typed;
- REST resources expose Get but no Watch;
- Secured resource and Topic reads fail locally without I/O when the Session is absent;
- HTTP requests contain the expected method, path, headers, and cookie pairs;
- resource validation follows `off`, `warn`, and `throw` modes;
- a REST 401 shares Refresh and retries exactly once;
- independent REST and Topic reads do not disturb each other;
- account-dependent Topic requests use account numbers returned by `accountPairs`;
- timeline pagination covers empty pages, bounds, deduplication, repeated cursors, ordering,
  cancellation, timeout, and page limits;
- the suite remains offline and never prints account data.

### Live account audit

After the offline suite passes, run an ephemeral terminal wizard against Trade Republic with
`validate: "throw"`. It reads the phone number and PIN with hidden input, waits for app approval,
and keeps the Session only in memory. The audit must:

1. read all seven REST resources;
2. read every zero-argument Banking Topic above;
3. derive every securities account number from `accountPairs` and read its portfolio and savings
   plans;
4. read active and terminated orders;
5. walk timeline pages to completion with a high but finite page cap;
6. read named watchlists discovered from `watchlists`;
7. export and restore the Session in memory, then repeat one REST and one Secured Topic read;
8. Logout both clients in `finally` blocks.

Print only accessor names, pass/fail status, page counts, and item counts. Never print field values,
cookies, the serialized Session, balances, instrument identifiers, document URLs, personal data,
or transaction data. Do not save live responses as fixtures. Delete the wizard after the run.

The live audit is manual evidence, not part of CI. A schema drift found live must become a minimal
sanitized offline regression before the fix is considered complete.

### Out of scope

- `TRAccount`, its local projection, persistence, Sync, Window, Materialized Range, and React
  bindings;
- normalized Transactions or integer-money conversion;
- Market Topics and instrument enrichment;
- downloading document contents;
- all writes, including orders, savings-plan changes, and money movement;
- generic drop reconnection and backoff, which remain ticket 04.

**Blocked by:** 03 — Session

**Independent of:** 04 — Connection recovery. Either ticket may land first; this ticket must not
silently absorb ticket 04.

**Status:** ready-for-agent

- [ ] REST resources and Topics share the named `TRClient` namespace
- [ ] REST resource types expose Get and no Watch
- [ ] `resourceRegistry` is the single source of truth for REST paths and schemas
- [ ] Session owns authenticated HTTP headers, cookies, rejection, and reactive recovery
- [ ] All seven account REST resources are typed and validated
- [ ] All listed Banking Topics are present in `topicRegistry`
- [ ] Empty Topic requests reject undeclared fields at compile time and runtime
- [ ] Timeline transactions can be read page-by-page and across a bounded date range
- [ ] Secured REST and Topic reads fail locally without a Session and perform no I/O
- [ ] REST 401/403 recovery Refreshes and retries once without recursion
- [ ] Abort, timeout, validation, HTTP, authentication, and Topic failures remain distinguishable
- [ ] No write path or document download is added
- [ ] Offline tests use sanitized fixtures and perform no network I/O
- [ ] The live account audit completes without printing or storing private field values
- [ ] Type checking, linting, formatting, build, and the offline test suite pass

## Notes

This ticket is deliberately the raw recovery layer. If its work is deleted, callers must rediscover
paths, wire names, pagination, authentication recovery, and response validation themselves. That
is the depth it adds. An aggregate `accountSnapshot()` on `TRClient` would instead mix transport
facts with projection policy, so it belongs in the later `TRAccount` work.

If the ticket exceeds one context window, split implementation internally after the shared HTTP
read path and resource registry: land REST resources first, then Banking Topics plus pagination and
the live audit. Keep this ticket as the common acceptance contract so neither half claims account
recovery alone.
