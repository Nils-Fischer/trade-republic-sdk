# Auth is checked at runtime, not encoded in types

Secured operations are callable on an unauthenticated client and fail with `TRAuthError`;
there is no `AuthenticatedClient` type and `login()` does not return a narrowed client.

A Session can be rejected at any moment, so a type-level proof of authentication would claim a
guarantee it cannot keep — the compiler would be satisfied while the request fails. Trade
Republic itself enforces auth per Subscription rather than per connection: an anonymous socket
connects normally and only Secured Topics fail, which a captured session confirms. The runtime
model mirrors the server's.

## Consequences

Each Topic records whether it is Secured, so Secured calls on a client with no Session fail
locally rather than round-tripping to learn what we already knew. Public Topics — market data,
search, instrument lookup — genuinely work with no Login at all.
