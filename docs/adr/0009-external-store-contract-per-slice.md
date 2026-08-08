# TRAccount exposes the useSyncExternalStore contract, per slice

Each slice of `TRAccount` — transactions, cash, documents — exposes `subscribe(onChange)` and
`getSnapshot()` rather than an `EventEmitter`. The React binding in `trade-republic-sdk/react`
is a thin wrapper over `useSyncExternalStore`; Vue, Svelte and Solid can bind to the same two
methods.

An `EventEmitter` satisfies neither half of what a UI needs: no snapshot to read, and no
guarantee about value identity.

## Consequences

`getSnapshot()` must be **referentially stable** — returning the identical object when nothing
changed. React re-renders infinitely if a snapshot returns a fresh object each call, so
`TRAccount` holds immutable values and mints a new reference only on real change. This is a
constraint on the projection's internals and cannot be added by the React package afterwards.

Snapshots are per slice rather than account-wide so that a changed cash balance does not
re-render a transaction list.
