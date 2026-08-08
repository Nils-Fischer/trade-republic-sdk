# Trade Republic SDK

An unofficial client for Trade Republic's private API. Trade Republic exposes a small REST
surface for account data and a single multiplexed WebSocket carrying everything else; this
SDK's job is to make both readable as ordinary TypeScript.

## Language

### Layers

**TRClient**:
The complete, unopinionated surface over Trade Republic — every Topic and REST resource,
Get and Watch, no state beyond a Session and a socket.
_Avoid_: SDK, API, wrapper, base client

**TRAccount**:
A locally held, read-only projection over the Banking Topics, built on a TRClient. Keeps a
Window of history current so callers can read it as ordinary async functions.
_Avoid_: store, cache, repository, model

### Wire

**Topic**:
A named Trade Republic data feed, addressed on the wire by its `type` string (`ticker`,
`cash`, `timelineTransactions`).
_Avoid_: subscription type, channel, feed, endpoint, stream

**Subscription**:
One live registration of a Topic with a particular request payload, correlated to its Frames
by a Request ID. Many Subscriptions share one socket.
_Avoid_: sub, listener, watcher

**Request ID**:
The client-assigned integer that correlates a Subscription to its Frames.
_Avoid_: subscription id, correlation id, seq

**Frame**:
One message on the socket. Four kinds: Snapshot, Delta, Topic Error, Unsub Ack.
_Avoid_: message, event, packet

**Echo**:
The keepalive exchange that holds a socket open — the client sends a timestamp, the server
returns it unchanged. Trade Republic closes an idle socket without it, and its reply is how
the SDK knows the socket is still alive.
_Avoid_: ping, pong, heartbeat, keepalive

**Snapshot**:
A complete payload for a Subscription. Arrives as an `A` frame.
_Avoid_: full, initial data, state

**Delta**:
A patch against a Subscription's previous payload; applying it produces the next Snapshot.
Arrives as a `D` frame.
_Avoid_: diff, patch, update, partial

**Topic Error**:
Trade Republic rejecting one Subscription while the connection stays healthy — carrying an
`errorCode` such as `AUTHENTICATION_ERROR`. Scoped to a single Subscription, never the socket.
_Avoid_: error, failure, server error

**Unsub Ack**:
Trade Republic confirming that a Subscription was cancelled _at the client's request_. It is
not a completion signal — the server never ends a Subscription on its own, so there is no
"this Topic is finished" Frame.
_Avoid_: close, complete, done, end

### Reading

**Get**:
Reading a Topic once — subscribe, take the first payload, cancel. Every Topic supports it.
_Avoid_: fetch, request, query, once

**Watch**:
Reading a Topic continuously until the caller stops. Every Topic supports it; how often
updates actually arrive is Trade Republic's business, not something the SDK declares.
_Avoid_: subscribe, listen, observe, stream

**Freshness**:
How current a locally held value is — distinct from Session Validity, which is about
credentials. A value can be stale while the Session is fine, and vice versa.
_Avoid_: up to date, outdated, dirty, valid

**Window**:
The span of history deliberately held locally — for example the last 90 days of Transactions.
Reads outside the Window are satisfied by going to Trade Republic, not by failing.
_Avoid_: cache size, limit, page, range

**Materialized Range**:
The span actually fetched and held, tracked as a range rather than a count so that "no
Transactions in March" is distinguishable from "March was never fetched".
_Avoid_: loaded, cached, covered

### Identity

**Session**:
Proven identity, held as Trade Republic cookies. Expires on Trade Republic's schedule, so it
is never assumed valid — only attempted.
_Avoid_: auth, token, credentials, login (as a noun)

**Login**:
The act of establishing a Session: phone number plus PIN, then approval in the Trade Republic
app.
_Avoid_: sign in, authenticate, connect

**Refresh**:
Renewing a Session from the credentials it already carries, with no PIN and no user present.
The ordinary way a Session stays alive; Login is the fallback when Refresh fails.
_Avoid_: reauth, renew, revalidate, sync

**Session Validity**:
Whether Trade Republic still accepts a Session — `absent`, `presumed-valid`, or `rejected`.
Never `valid`: acceptance can only be observed by making a request, so validity is presumed
until something is rejected.
_Avoid_: expired, active, logged in, up to date

**Banking Topic**:
A Topic about money held and moved — cash, transactions, documents, payment methods. The set
TRAccount projects.
_Avoid_: account topic, bank data

**Market Topic**:
A Topic about instruments and prices, usually parameterized by instrument and therefore never
projected locally. The only place Deltas have been observed.
_Avoid_: trading topic, stock data

**Secured Topic**:
A Topic that requires a Session. Trade Republic enforces this per Subscription, not per
connection — an unauthenticated socket connects normally and only Secured Topics fail.
_Avoid_: private, protected, authenticated topic

**Public Topic**:
A Topic readable with no Session at all, such as market data and search.
_Avoid_: open, anonymous, unauthenticated topic

**Sync**:
Bringing TRAccount's held values back in line with Trade Republic. Distinct from Login —
a Sync can fail because the Session was rejected, but Syncing is not authenticating.
_Avoid_: refresh, reload, update, reauth

### Market

**Instrument**:
A tradable security, identified by an ISIN optionally suffixed with an exchange
(`US88160R1014`, `US88160R1014.LSX`).
_Avoid_: stock, security, asset, symbol, ticker

Note that **ticker** is the name of a Topic (live prices) and never a synonym for Instrument
or for an Instrument's symbol.
