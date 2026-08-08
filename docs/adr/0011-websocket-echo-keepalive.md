# The WebSocket requires an `echo` keepalive every 2.5 seconds

Trade Republic closes an idle WebSocket after roughly 60 seconds. The web app prevents this by
sending `echo <unix-millis>` every 2.5 seconds; the server replies with the identical string.
A capture contains 4,433 such exchanges across two connections, at a measured median interval
of 2.5s.

The SDK sends the same keepalive on any open socket, whether or not there are active
Subscriptions.

## Consequences

**2.5 seconds is not a tunable.** It looks aggressive and someone will want to relax it to 30
seconds to "reduce chatter" — the failure that produces is a socket that dies after a minute,
intermittently, in a way that looks like a network problem. The observed close happened at
almost exactly 60s with no keepalive at all; the safe margin below that is unknown, so the
web app's own interval is the number to copy rather than a value to derive.

The echoed reply doubles as the liveness signal: a missing reply detects a half-open socket
long before a TCP timeout would, and it works when markets are closed, unlike watching a
`ticker` for updates.

The server also sends a bare `connected` frame in response to the `connect` handshake. A
connection should not be considered established until that arrives — resolving on the
transport's `open` event alone reports success before the server has accepted the handshake.
