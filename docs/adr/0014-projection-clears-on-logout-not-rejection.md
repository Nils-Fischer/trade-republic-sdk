# The projection clears on logout, never on rejection

`TRAccount` observes the Session and clears every Slice back to `pending` when Session Validity
becomes `absent`. It does nothing when validity becomes `rejected`.

The asymmetry is the whole decision. `absent` means the user logged out, and holding one person's
balances and transactions after that is indefensible. `rejected` means a Refresh failed — the held
values are still correct, merely unrefreshable, and Refresh may well recover on its next attempt.
Clearing there would turn a momentary credential problem into a blank screen and a re-fetch of the
entire transaction Window.

## Consequences

`TRAccount` gains a dependency on Session state that it did not previously have, which is why the
Session is exposed as a store rather than the getter it started as. `stop()` clears the same way
`absent` does; it is the one stale state that was never expressible as an error plus a value.
