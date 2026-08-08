# The SDK never holds a PIN

`login(phoneNumber, pin)` takes the PIN, uses it, and drops it. Nothing in the SDK stores,
caches, or persists it, and there is no PIN-provider callback.

Login always requires approval in the Trade Republic app, so it is always an interactive
moment where the caller is already showing UI and can prompt. A held PIN therefore removes no
interaction — it only changes who calls whom, while creating a credential that lives in a
long-running object. With Refresh handling ordinary Session renewal, a PIN is needed perhaps
once every few weeks; storing one means holding a credential for weeks to spend it once.

This is the kind of "no" that gets helpfully undone. A client object with a `pin` field will
eventually be serialized into a log line or a crash report.
