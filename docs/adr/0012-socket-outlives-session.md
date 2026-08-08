# An established WebSocket outlives `tr_session`, but opening one does not

Measured: with a 300-second `tr_session`, Secured Topic reads on an already-open socket kept
succeeding 77s, 167s and 257s after the session expired, with the socket never closing and
every Echo replied to. The connection-level token is minted at handshake and is not
re-validated against the session JWT — consistent with `sessionId` being stable across
Refreshes.

Separately measured: Trade Republic **refuses the WebSocket handshake** when the cookie
presented is expired. (An entirely unauthenticated handshake succeeds and yields a socket on
which only Public Topics work — an absent credential is anonymous, a stale one is rejected.)

## Consequences

TRAccount does not need a reconnect-and-resubscribe cycle every five minutes. Long-lived
Watches cost only the Echo keepalive.

**Refresh must continue on its timer even when nothing is making HTTP requests.** It is
tempting to skip renewal while the socket is healthy, since the socket plainly does not need
it. But a socket that drops at hour three can only be replaced using a valid Session, and a
client that stopped refreshing has none — turning a momentary network blip into a phone-
approval prompt. The Refresh timer exists to serve the _next_ connection, not the current one.
