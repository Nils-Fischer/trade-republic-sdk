# Every Topic supports both Get and Watch

A recorded session of 11,449 frames shows most Topics delivering exactly one payload, with
only `ticker` streaming (up to 473 updates on a single Subscription). That invites a
`cardinality: "once" | "stream"` field on each Topic. We deliberately do not have one.

A short capture cannot prove a Topic never pushes again — it proves only that nothing arrived
during the capture. `timelineTransactions` plausibly updates when a transaction settles, which
is very likely why these are WebSocket Topics rather than REST endpoints in the first place.
Cardinality is therefore a property of the call, not of the Topic.

## Consequences

Get is implemented as subscribe → take first payload → unsubscribe, because Trade Republic
sends no completion signal. The `C` frame is an acknowledgement of the client's _own_
unsubscribe: in the capture all six arrived after a client unsubscribe and none arrived
unprompted. Any implementation that waits for the server to say "done" will hang forever.
