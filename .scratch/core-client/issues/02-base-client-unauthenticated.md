# 02 — TRClient, unauthenticated

**What to build:** the whole socket spine, end to end, with no Session anywhere. A consumer can
construct a client, Get a Public Topic once, and Watch one for updates — without logging in.

```
const tr = new TRClient();
const price = await tr.ticker.get({ id: "IE00B7Y34M31.LSX" });
for await (const tick of tr.ticker.watch({ id: "IE00B7Y34M31.LSX" })) { … }
```

`ticker` is the Topic to build against: it is the only Topic **proven** to work with no Session
(it answered four times on an unauthenticated connection in the recorded capture, while every
Secured Topic tried there was rejected), and the only one proven to stream, with 473 updates on a
single Subscription. Other Market Topics such as `instrument` and `aggregateHistoryLight` are
presumed public but unverified — add them if they work, and record it if they don't.

This ticket carries most of the risk in the project. Everything in it is interlocking, and it is
the point at which the design is either right or isn't.

### Connecting

The socket opens lazily on first use, so constructing a client does no I/O. One socket is shared
by every Subscription, and **the client never replaces the socket object** — the previous SDK
exposed it as a mutable public field and swapped it on Login, so any reference taken earlier
silently pointed at a dead object.

The handshake sends a connect Frame carrying locale and client identification. **The connection
is established only when Trade Republic replies with its bare `connected` Frame** — not when the
transport reports the socket open. The previous SDK resolved on the transport event and reported
success before the server had accepted anything.

### Staying alive

**An Echo carrying the current timestamp goes out every 2.5 seconds; the server returns it
unchanged.** Without it Trade Republic closes the socket after roughly 60 seconds, which is why
every long-lived Subscription in the previous SDK died silently after a minute. See ADR-0011:
2.5 seconds is copied from Trade Republic's own web app and is not a tunable — the safe margin
below 60 seconds is unknown. The echoed reply is the liveness signal, and unlike watching a price
Topic it works when markets are closed.

### Reading

Frames are `<request id> <kind> <payload>`, where the kind is a Snapshot, a Delta, a Topic Error
or an Unsub Ack. Request IDs are minted by the client and never reused within a connection.

**Get is subscribe → take the first payload → unsubscribe.** There is no completion signal:
per ADR-0003, an Unsub Ack acknowledges the client's _own_ unsubscribe and never arrives
unprompted, so anything waiting for the server to say "done" waits forever.

**Watch is an async iterable** that yields complete Snapshots until the caller stops. Deltas are
applied internally to reconstruct complete Snapshots — a consumer never sees one. Breaking the loop
unsubscribes. A Topic Error is thrown into the iterable so an ordinary `try`/`catch` around the
loop works. A consumer slower than the Topic receives the newest Snapshot and skips intermediate
ones rather than accumulating an unbounded buffer.

Both are reached through named accessors generated from a small Registry, with a generic form
taking the Topic name as a value for callers addressing Topics chosen at runtime.

### Testing

Ships the controllable fake socket and fake clock from the environment seam — the only test
doubles in the suite. The fake socket can be driven from a test: deliver a Frame, drop the
connection, delay a reply, send a malformed line. The fake clock advances instantly so the
2.5-second Echo needs no real waiting. Delta application is exercised with synthetic Frames,
since only `aggregateHistoryLight` was observed sending Deltas in the capture.

**Blocked by:** 01 — Setup

**Status:** ready-for-agent

- [ ] Constructing a client performs no I/O; the socket opens on first use
- [ ] All Subscriptions share one socket
- [ ] The socket object is never replaced for the life of the client
- [ ] The connection is reported established only after the server's `connected` Frame, not on
      the transport's open event
- [ ] An Echo is sent every 2.5 seconds while the socket is open, with or without Subscriptions
- [ ] Echo replies are tracked and expose whether the socket is alive
- [ ] Frames are parsed into Snapshot, Delta, Topic Error and Unsub Ack, keyed by Request ID
- [ ] A malformed or unrecognised line is ignored without disturbing other Subscriptions
- [ ] Request IDs are unique within a connection and never reused
- [ ] Get resolves on the first payload and then unsubscribes
- [ ] Get does **not** wait for an Unsub Ack, and a Topic that sends only one payload never hangs
- [ ] Get accepts an abort signal and rejects with an abort error when cancelled
- [ ] Get accepts a timeout and rejects with a timeout error, distinguishable from an abort
- [ ] Watch yields successive Snapshots as an async iterable
- [ ] Breaking out of a `for await` loop unsubscribes
- [ ] Deltas are applied internally; a Watch consumer only ever receives complete Snapshots
- [ ] A slow consumer receives the newest Snapshot and skips intermediate ones
- [ ] A Topic Error is thrown into the iterable and is catchable around the loop
- [ ] A Topic Error on one Subscription leaves other Subscriptions working
- [ ] Named accessors exist per Registry Topic, with request and response fully typed
- [ ] A generic form accepts a Topic name as a value
- [ ] `ticker` Get and Watch both work with no Session
- [ ] The fake socket can deliver Frames, drop the connection and delay replies on demand
- [ ] The fake clock advances time without real waiting; no test sleeps
- [ ] The entire suite runs offline with no Session and no network
- [ ] No console output except response-validation warnings in the default `warn` mode
- [ ] Type checking, linting, formatting and the test suite all pass

## Notes

If this ticket overflows a single context window, the natural split is **connect and stay alive**
(handshake, `connected`, Echo, Frame parsing, correlation) from **read a Topic** (Registry, Get,
Watch, accessors). It was left whole deliberately, because the first half alone delivers nothing
demoable.

Manual verification against the live API is misleading outside market hours — `ticker` delivered
a single Frame and never streamed when this was tried on a Saturday. The fake makes the test
suite immune to this; a human spot-check is not.
