# Sessions Refresh proactively from the JWT expiry

Trade Republic issues `tr_session` and `tr_refresh` as ES256 JWTs. Observed:
**`tr_session` lasts 300 seconds; `tr_refresh` lasts 24 hours.** Refreshing is
`GET /api/v1/auth/web/session` with cookies attached — no body, no PIN, no phone approval —
and the response is `content-length: 0`, delivering everything via `Set-Cookie`.

Refresh is **proactive**: the client decodes the `exp` claim of `tr_session` and renews at
about 80% of the token's lifetime, which is what the web app itself does — a renewal was
observed 241 seconds into a 300-second window. Reactive refresh on rejection stays as a
backstop but cannot be primary; at a five-minute lifetime it would turn a long-running
TRAccount into a retry loop.

## Consequences

**The JWT claim is the only expiry signal.** No cookie carries `Max-Age` or `Expires` —
`tr_session` is `Path=/; Secure; HttpOnly; SameSite=Strict` and nothing more. Any scheme that
looks for cookie expiry attributes will find nothing and silently never refresh.

Reading `exp` means base64-decoding our own token to schedule a timer, not trusting a third
party's assertion. No signature verification is needed, and nothing in the SDK should imply
the token has been verified.

**Refresh does not roll `tr_refresh`.** A refresh eight minutes into the 24-hour window
returned no new refresh token, so unattended operation is capped at 24 hours from Login and a
phone approval is then unavoidable. Background sync must be designed around a daily
interactive moment rather than assuming indefinite autonomy. (Unconfirmed whether Trade
Republic rolls it lazily near expiry.)

`sessionId` is stable across refreshes — only the bearer token rotates.

Refresh needs a shared in-flight guard: one attempt at a time, never recursive, with
concurrent callers awaiting the same Refresh. Without it, an app waking from background fires
one renewal per queued request.

`mapper-lb-affinity` pins the caller to a backend, and the WebSocket's auth errors identify
their source as `MAPPER`. Preserve it rather than sending only the auth cookies.
