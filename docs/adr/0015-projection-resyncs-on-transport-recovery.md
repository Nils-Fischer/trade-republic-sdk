# The projection re-syncs itself when the transport recovers

`TRAccount` watches connection liveness and runs `sync()` again each time a lost transport comes
back. This looks redundant — `createConnection` already replays every `resume`-policy Subscription
on reconnect, and Trade Republic answers with a fresh Snapshot — so the Watches heal on their own.

They heal incompletely. The `timelineTransactions` Watch carries a bounded recent page, and an
outage long enough for new Transactions to push older ones off that page leaves a hole between
`materializedTo` and now. The replayed Subscription cannot reveal the hole, and the projection
would report `success` over missing Transactions. Only the paginated history read closes it.

## Consequences

The re-sync is unconditional rather than gated on outage duration, because no threshold is
defensible: the page size is Trade Republic's business and can change without notice. The cost of
being wrong in the cheap direction is one page — `getTimelineTransactions` stops as soon as it
crosses the Window's `from` — so a five-second blip costs a single request.
