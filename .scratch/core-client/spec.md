# Spec: TRClient — the core layer

Status: ready-for-agent

## Problem Statement

There is no usable programmatic access to Trade Republic. The previous SDK exists but is
broken in ways that only show up after the code is already in production:

- It never sends an Echo, so Trade Republic closes the socket after about 60 seconds and every
  long-lived Subscription dies silently, looking like a network fault.
- It has no Refresh, so a Session dies after 300 seconds and the only recovery is a full Login
  with a phone approval — which is why its own live test suite cannot keep a cached Session
  working for more than a few minutes.
- It treats the Unsub Ack as a completion signal, so any code waiting for Trade Republic to say
  "done" waits forever.
- It offers two incompatible ways to read a Topic — a callback API whose errors go to
  `console.error`, and a single promise-shaped method built for one Topic — so there is no
  consistent way to read anything.
- Its WebSocket is a public mutable field that gets replaced on Login and Logout, so any
  reference taken before authenticating silently points at a dead object.
- It cannot be tested without a live Session, which expires in 300 seconds and requires a phone
  tap to renew.

A developer who wants to read their own Trade Republic data has to discover all of this
themselves, from the wire.

## Solution

`TRClient` — a complete, unopinionated surface over Trade Republic. Every Topic and REST
resource, reachable two ways: **Get** it once, or **Watch** it until you stop.

The client holds a Session and keeps it alive by itself, Refreshing ahead of expiry without a
PIN and without the user present. Login — phone number, PIN, and an approval tap — is needed
once, and again only when Refresh can no longer save the Session. Reads that require a Session
fail with a typed error when there isn't one, rather than hanging or returning empty.

The socket is an implementation detail. It connects when first needed, keeps itself alive with
an Echo, and reconnects on drop with Watches resubscribing automatically.

Everything is testable without touching Trade Republic, by replaying a recorded session of real
Frames.

## User Stories

### Reading data

1. As an SDK consumer, I want to Get any Topic and receive a typed value, so that reading Trade
   Republic feels like calling an ordinary async function.
2. As an SDK consumer, I want to Watch any Topic as an async iterable, so that I can consume
   updates with a `for await` loop and stop by breaking out of it.
3. As an SDK consumer, I want both Get and Watch available on every Topic, so that I am not
   blocked when Trade Republic pushes updates on a Topic nobody expected to stream.
4. As an SDK consumer, I want Get to complete as soon as the first payload arrives, so that a
   Topic which never sends a second Frame does not hang forever.
5. As an SDK consumer, I want the Subscription behind a Get to be cancelled once I have my
   value, so that reading a Topic does not silently leak a live registration.
6. As an SDK consumer, I want named accessors per Topic with real autocomplete, so that I can
   discover what is available without reading the source.
7. As an SDK consumer, I want a generic escape hatch that takes a Topic name as a value, so that
   I can address Topics chosen at runtime.
8. As an SDK consumer, I want REST resources in the same namespace as Topics, so that I do not
   have to know which transport Trade Republic happens to use for a given piece of data.
9. As an SDK consumer, I want Watch to be absent on REST resources, so that the type system
   tells me what can and cannot stream rather than failing at runtime.
10. As an SDK consumer, I want a Watch to yield complete Snapshots, so that I never have to know
    that Deltas exist or apply one myself.
11. As an SDK consumer, I want Delta application exposed as a standalone utility, so that I can
    still work with the raw wire format if I am doing something the SDK does not cover.
12. As an SDK consumer, I want a slow consumer to receive the newest Snapshot and skip
    intermediate ones, so that a fast Topic cannot grow an unbounded buffer in my process.
13. As an SDK consumer, I want to pass an `AbortSignal` to a Get, so that I can cancel a read
    that is no longer needed.
14. As an SDK consumer, I want a Get to time out with a typed error, so that a Topic that never
    answers does not stall my program indefinitely.
15. As an SDK consumer, I want Watches to be independent of each other, so that one failing
    Subscription does not disturb the others sharing the socket.

### Session and identity

16. As an SDK consumer, I want to Login with a phone number and PIN and be told to approve on my
    phone, so that I can establish a Session.
17. As an SDK consumer, I want the Login to poll until Trade Republic confirms the approval, so
    that I do not have to implement the waiting myself.
18. As an SDK consumer, I want my PIN used and discarded, so that no long-lived object in my
    process is holding a credential.
19. As an SDK consumer, I want the Session Refreshed automatically before it expires, so that a
    long-running process keeps working without my involvement.
20. As an SDK consumer, I want Refresh to keep running even while I am making no requests, so
    that a socket that drops hours later can still be replaced without a phone approval.
21. As an SDK consumer, I want concurrent operations to share a single in-flight Refresh, so
    that waking from background does not fire one renewal per queued request.
22. As an SDK consumer, I want a rejected Session to surface as a typed authentication error, so
    that I can prompt for a fresh Login rather than guessing why a read failed.
23. As an SDK consumer, I want to export my Session as a serializable value, so that I can
    persist it and resume tomorrow.
24. As an SDK consumer, I want to restore a client from an exported Session, so that a restart
    does not require a phone approval.
25. As an SDK consumer, I want the exported Session to be opaque, so that a future change to how
    Trade Republic represents identity does not break my stored data.
26. As an SDK consumer, I want to know the Session Validity without making a request, so that my
    UI can show a signed-in state without a round trip.
27. As an SDK consumer, I want to read Public Topics with no Session at all, so that market data
    and search work before anyone logs in.
28. As an SDK consumer, I want a Get on a Secured Topic with no Session to fail immediately, so
    that I am not waiting on a round trip to learn something the client already knew.
29. As an SDK consumer, I want to log out and have the Session and socket torn down, so that no
    credential or connection outlives the session in my app.

### Connection

30. As an SDK consumer, I want the socket opened lazily on first use, so that constructing a
    client does no I/O.
31. As an SDK consumer, I want one socket shared by every Subscription, so that reading twenty
    Topics does not open twenty connections.
32. As an SDK consumer, I want the client's socket never replaced by a new object, so that a
    reference I took earlier keeps working after Login.
33. As an SDK consumer, I want the Echo sent automatically, so that my Subscriptions do not die
    after a minute.
34. As an SDK consumer, I want the connection reported as established only once Trade Republic
    acknowledges the handshake, so that a successful connect actually means connected.
35. As an SDK consumer, I want the socket to reconnect automatically after a drop, so that a
    momentary network blip does not end my Watches.
36. As an SDK consumer, I want active Watches resubscribed after a reconnect, so that I keep
    receiving updates without writing recovery logic.
37. As an SDK consumer, I want a fresh Snapshot after a reconnect rather than a Delta, so that I
    am never shown a value patched against state the server has forgotten.
38. As an SDK consumer, I want an in-flight Get to fail with a typed connection error when the
    socket drops, so that I can retry a single operation rather than having it hang.
39. As an SDK consumer, I want reconnection to back off, so that an outage does not turn my
    client into a reconnect loop.

### Types, validation and errors

40. As an SDK consumer, I want every Topic's request and response fully typed, so that my editor
    catches mistakes before I run anything.
41. As an SDK consumer, I want unexpected response shapes to warn by default rather than throw,
    so that a change on Trade Republic's side does not break my app over a field I never read.
42. As an SDK consumer, I want to configure validation to throw, so that my own test suite fails
    loudly when a schema drifts.
43. As an SDK consumer, I want to turn validation off, so that I can trade safety for throughput
    when I know what I am doing.
44. As an SDK consumer, I want every failure to be an instance of a common error type, so that I
    can catch everything from this SDK in one place.
45. As an SDK consumer, I want to distinguish authentication, connection, timeout, validation,
    HTTP and Topic errors by type, so that I can respond to each appropriately.
46. As an SDK consumer, I want a Topic Error to carry Trade Republic's own error code, so that I
    can branch on the real cause rather than parse a message string.
47. As an SDK consumer, I want a Topic Error to be thrown into the async iterable I am consuming,
    so that ordinary `try`/`catch` around my loop works.
48. As an SDK consumer, I want cancellation to surface as an abort error distinguishable from a
    timeout, so that I can tell "I stopped this" apart from "it never answered".
49. As an SDK consumer, I want the library to never write to the console, so that my logs contain
    only what I chose to put there.

### Testing and packaging

50. As an SDK consumer, I want to inject my own `fetch` and socket, so that I can test my code
    against this SDK without a live Session.
51. As an SDK consumer, I want a ready-made fake that replays recorded Trade Republic Frames, so
    that my tests exercise realistic payloads without my writing fixtures.
52. As an SDK maintainer, I want the entire suite runnable offline, so that CI does not depend on
    a Session that expires in 300 seconds and needs a phone tap.
53. As an SDK maintainer, I want to simulate a rejected Session, a dropped socket and an expiring
    token deterministically, so that recovery paths are tested rather than hoped for.
54. As an SDK consumer, I want the SDK importable without pulling in React, so that a server-side
    consumer installs nothing it does not need.
55. As an SDK consumer, I want it to work in Node, Bun, the browser and React Native, so that I
    can share code across my app and my scripts.
56. As an SDK consumer, I want `ws` to remain an optional peer dependency, so that runtimes with
    a built-in WebSocket install nothing extra.

## Implementation Decisions

### Layering

Modules, from the bottom: **Errors**, **Transport**, **Session**, **Protocol**, **Registry**,
**TRClient**, and a **Testing** module published under its own entry point. Each depends only on
those below it. `TRAccount` sits above `TRClient` and is out of scope here.

### The environment seam

`TRClient` is constructed with an environment carrying every impure dependency. This is the
only injection point in the SDK, and the only seam tests use:

```
{ fetch?, socket?, clock? }
```

`clock` covers both current time and timer scheduling, because Refresh fires at 80% of a
300-second token and Echo runs every 2.5 seconds. Defaults are the real global `fetch`, the
environment-appropriate socket, and real timers. Nothing else in the SDK reaches for a global.

### Errors

A single root error type with subtypes for authentication, HTTP, Topic, validation, timeout and
connection failures. A Topic Error carries Trade Republic's own `errorCode` and message.
Cancellation produces an abort error distinguishable from a timeout. Nothing in the SDK writes
to the console — the previous implementation logged every Subscription's payload to stdout.

### Session

Sessions are held as cookies and expire in 300 seconds; the refresh token lasts 24 hours and is
**not** rolled by a Refresh. Expiry is read from the session token's `exp` claim by decoding the
payload — no cookie carries `Max-Age` or `Expires`, so there is no other source. This is reading
our own token to schedule a timer, not verifying a third party's assertion, and nothing should
imply the token has been verified.

Refresh is proactive at ~80% of the token's lifetime, matching what Trade Republic's own web app
does. Reactive Refresh on a rejected request remains as a backstop. A shared in-flight guard
ensures one Refresh at a time with concurrent callers awaiting the same one, never recursive.

**Refresh continues on its timer even when nothing is using HTTP** — see ADR-0012. An established
socket does not need a valid Session, but opening one does, so a client that stops Refreshing
cannot reconnect.

Login takes the phone number and PIN as arguments, uses them, and retains neither. The Session is
exported and restored as an opaque serializable value; the cookie array is not the public
contract. Cookie handling preserves attributes rather than reducing each cookie to `name=value`,
and retains the load-balancer affinity cookie alongside the auth cookies.

### Protocol

The wire is line-oriented: a Request ID, a Frame kind, and a payload. Snapshot and Delta carry
data, Topic Error carries a structured error envelope, and **Unsub Ack acknowledges the client's
own unsubscribe and never arrives unprompted** — there is no completion signal, so Get is
implemented as subscribe, take the first payload, unsubscribe.

The connection is established only when Trade Republic returns its handshake acknowledgement, not
when the transport reports the socket open.

**Echo is sent every 2.5 seconds and is not a tunable.** Trade Republic closes an idle socket
after roughly 60 seconds; the safe margin below that is unknown, so the web app's own interval is
copied rather than derived. The echoed reply doubles as the liveness signal and works when
markets are closed, unlike watching a price Topic.

Deltas are applied internally to produce complete Snapshots. Delta application is also exported as
a standalone utility. Request IDs are minted by the client and never reused within a connection.

### Registry

One table describes every Topic: its wire name, request schema, response schema, and whether it
is a Secured Topic. Named accessors and the generic form are both derived from it, so adding a
Topic is adding a row. The registry is the only place a Topic is described — the previous
implementation kept the list in three places and they had already drifted.

Secured Topics requested without a Session fail locally rather than round-tripping. Public Topics
work with no Session at all.

### Reading

Get returns a promise and accepts an abort signal and a timeout. Watch returns an async iterable;
breaking the loop unsubscribes. Watches survive reconnects by resubscribing and receive a fresh
Snapshot afterwards. In-flight Gets fail with a connection error on drop, since a single logical
operation is the caller's to retry. Slow consumers get keep-latest rather than an unbounded
buffer.

### Validation

Responses validate against arktype schemas with a mode of off, warn or throw, defaulting to warn.
Schemas port over from the previous implementation largely unchanged, plus two Topics observed on
the wire that the old catalog was missing.

### Packaging

One package with subpath exports: the root, a React entry point, and a testing entry point. React
is an optional peer dependency; `ws` remains an optional peer dependency. Published under the
existing package name as a new minor with no compatibility layer.

## Testing Decisions

### What makes a good test here

Tests drive `TRClient` through its public surface and assert on what a consumer would observe —
values returned, errors thrown, Frames put on the wire. They never reach into Session, Protocol
or Registry directly, never assert on private state, and never mock a module. If a behaviour
cannot be provoked through the public surface with a fake environment, that is a signal the
surface is wrong, not that a lower seam is needed.

### The single seam

Every test constructs a `TRClient` with a fake environment. There is no other test double
anywhere in the suite.

- **`socket`** — a fake implementing the same minimal interface as the real transport, which can
  be driven from the test: deliver a Frame, drop the connection, delay a response.
- **`fetch`** — a fake returning canned responses with the cookie headers under test, including
  expired and rejected Sessions.
- **`clock`** — a controllable clock so a 300-second token, an 80% Refresh point and a 2.5-second
  Echo can all be advanced instantly.

### The replay fake

A recorded session of 11,449 real Frames exists and is the basis of the shipped fake. It is keyed
**by Topic payload, not by Request ID** — the recording's IDs will never match the ones a client
mints, so the fake matches an outgoing subscribe against the recorded payload for that Topic and
replies with the recorded response under the caller's own Request ID. This fake is also exported
for consumers to test their own code against.

### What must be covered

Get completing on first payload and unsubscribing. Watch yielding successive Snapshots and
unsubscribing on break. Deltas applied to produce correct Snapshots. Topic Errors thrown into the
iterable. Secured Topics failing locally without a Session and succeeding with one. Public Topics
working with no Session. Echo emitted every 2.5 seconds. Connection not reported established until
acknowledged. Socket drop failing in-flight Gets while Watches resubscribe. Fresh Snapshot after
reconnect rather than a Delta. Refresh firing at 80% of token lifetime. Refresh continuing while
no HTTP is in flight. Concurrent callers sharing one in-flight Refresh. Rejected Session
surfacing as an authentication error. Session export and restore round-tripping. Validation
warning by default and throwing when configured. Keep-latest under a slow consumer. No console
output under any path.

### Prior art

None in this repo — it is new. The previous implementation's tests are not a model to follow:
they depended on a live Session that expires in 300 seconds, which is why two of its nine test
files fail unless someone has just tapped their phone. Everything here runs offline.

## Out of Scope

- **`TRAccount`** — the projection, its Window, Materialized Range, persistence, Sync, and the
  external-store contract. Separate spec.
- **The React entry point.** The subpath exists in packaging; the bindings come with `TRAccount`.
- **Writes of any kind.** No orders, no savings plans, no money movement. See ADR-0010.
- **Trusted-device authentication.** The login-process response hints at a device registration
  flow that might permit unattended re-Login. Unexplored, deliberately deferred.
- **Working around AWS WAF.** Trade Republic's web app sends a WAF token to the API. The SDK
  works without one today, so nothing is built for it; it is a known standing risk.
- **Reconciling app version and platform headers** against the values the browser currently
  sends. Worth doing, not part of this.

## Further Notes

Every non-obvious constraint in this spec was measured against the live API or a recorded
session, not assumed. The ADRs carry the evidence; ADR-0003, ADR-0007, ADR-0011 and ADR-0012 are
the ones whose conclusions are most likely to look wrong to someone reading the code later:

- Cardinality is deliberately not modelled per Topic (ADR-0003).
- 2.5 seconds is not a tunable (ADR-0011).
- Refresh runs even when idle, for the sake of the next connection (ADR-0012).
- The 24-hour refresh-token ceiling is real: unattended operation ends a day after Login, and a
  phone approval is then unavoidable (ADR-0007).

Build order should be one vertical slice first — Login, Refresh, connect, Get and Watch a single
Topic end to end — before widening the Registry to the full set. The replay fake should be built
early rather than last: live testing costs a phone tap and expires in 300 seconds, so every layer
built before the fake exists has to be verified the hard way.
