# Freshness is derived, not a stored state

Every read returns a `TRQuery` — `pending`, `success`, or `error`, carrying the last known value
and the time it last changed. There is no stored `freshness` field. Every stale state the
projection could record already coincides with an error alongside a retained value, so recording
it separately duplicates a fact the error already carries, and invites the two to disagree.

## Consequences

A dropped socket produces no per-slice signal at all. `createConnection` keeps `resume`-policy
Subscriptions across a transport loss and replays them on a backoff, so a Watch goes quiet and
resumes without the projection ever seeing an error — the value stays `success` while being
minutes old. Staleness is therefore derived by the binding, from connection liveness, and never
stored on the value. `trade-republic-sdk/react` folds this into a computed `isStale`; any other
binding derives the same thing from the same two stores.

What survives as a genuine per-slice error is narrower than it looks: Topic Errors, which Trade
Republic scopes to a single Subscription, and projection failures from schema drift. Those are
real divergences between slices and are why liveness is not modelled as one account-wide flag.

`dataUpdatedAt` is when the value last **changed**, not when Trade Republic last confirmed it.
Confirmation time would require minting a new snapshot for every identical Frame, which ADR 0009
forbids — referential stability is what keeps `useSyncExternalStore` from re-rendering a
transaction list every 2.5 seconds. This diverges from TanStack Query, which advances
`dataUpdatedAt` on every successful fetch and absorbs the churn in its observer layer.
