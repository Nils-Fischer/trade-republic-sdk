# Thrown typed errors rather than Effect or Result

We considered `effect` and `neverthrow` for the failure model and chose a thrown hierarchy
rooted at `TRError` (`TRAuthError`, `TRHttpError`, `TRTopicError`, `TRValidationError`,
`TRTimeoutError`, `TRConnectionError`).

## Considered Options

**Effect** is a paradigm, not a dependency: `Effect<A, E, R>` propagates through every
signature, so a public SDK either imposes Effect on every consumer or discards it at the
boundary and pays the cost for nothing. The problems here — one socket, request/response
correlation, one paginator — are not the problems Effect solves. Building this as a
deliberately Effect-ecosystem library remains a legitimate but different product.

**`Result`** taxes every call site with a `.match()` for a library whose ecosystem convention
is thrown errors.

Trade Republic's own Topic Errors carry a structured `errorCode` (`AUTHENTICATION_ERROR` and
friends), which gives thrown subclasses a genuinely rich discriminant to switch on.
