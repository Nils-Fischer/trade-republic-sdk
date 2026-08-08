# Response validation warns by default rather than throwing

Responses are validated against arktype schemas with a configurable `validate` mode of
`"off" | "warn" | "throw"`, defaulting to `"warn"`.

This is an unofficial client for a private API that changes without notice. arktype accepts
unknown keys but rejects a removed or retyped field, so under `"throw"` the day Trade Republic
renames anything is the day the SDK breaks for every user — including the ones who never
touched that field. Warning keeps the SDK working through drift while still surfacing it.

`"throw"` remains the right setting for this project's own test suite, where a schema
mismatch is exactly the signal we want.
