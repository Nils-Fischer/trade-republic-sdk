# 03 — Session

**What to build:** add Login, Refresh, Session persistence, Session Validity, and Logout to
`TRClient`. This turns the unauthenticated socket spine from ticket 02 into a client that can keep
Trade Republic identity alive without retaining a PIN.

```ts
const tr = new TRClient();

await tr.login("+49123456789", "1234");
const saved = tr.exportSession();

const restored = new TRClient({ session: saved });
console.log(restored.sessionValidity); // "presumed-valid"
```

Login is one operation. It starts the web Login process, then polls until the user approves it in
the Trade Republic app. The phone number and PIN exist only as arguments to `login`; neither is
stored on the client or included in exported Session data.

### HTTP and cookies

Login starts with `POST /api/v2/auth/web/login` and polls
`GET /api/v2/auth/web/login/processes/:processId`. Refresh uses
`GET /api/v1/auth/web/session`. Every request uses the injected environment `fetch`, the Trade
Republic web headers, and the current Session cookies.

Native browser `fetch` hides `Set-Cookie`, so the default browser environment cannot export or
schedule Refresh for an `HttpOnly` Session. Public Topics still work in browsers. Full browser
Session support requires an injected cookie-capable transport, such as an application proxy.

Keep each complete `Set-Cookie` value, including its attributes. Merge replacements by cookie
name, and retain unrelated cookies such as `mapper-lb-affinity`. Build the outbound `Cookie`
header from each cookie's `name=value` pair. Support both `Headers.getSetCookie()` and runtimes
that expose one combined `set-cookie` header.

An unsuccessful HTTP response throws `TRHttpError`. A response that rejects a Session throws
`TRAuthError` and changes Session Validity to `rejected`. Invalid response data or malformed
restored data throws `TRValidationError`.

### Refresh

Read `iat` and `exp` from the `tr_session` JWT payload only to schedule Refresh; this does not
verify the JWT. Refresh at 80% of its lifetime. The timer runs while the client is otherwise idle.
If several callers require Refresh at once, all await one in-flight request.

If Trade Republic rejects a Topic operation for authentication, Refresh once, reconnect with the
new cookies, and retry that operation once. Preserve unrelated subscriptions during recovery.

Refresh replaces cookies returned by Trade Republic but preserves cookies it does not return,
including `tr_refresh` and `mapper-lb-affinity`. A successful Refresh returns Session Validity to
`presumed-valid` and schedules the next Refresh.

A failed proactive Refresh retries after 5 seconds. Repeated failures use exponential backoff
capped at 60 seconds. A successful Refresh resets the delay. Session rejection and Logout stop
the retry timer.

### Persistence and lifecycle

`exportSession()` returns an opaque serializable string. Passing it as `new TRClient({ session })`
restores the Session and its Refresh timer. The string's internal cookie representation is not a
public contract.

Session Validity is `absent`, `presumed-valid`, or `rejected`; it is never called `valid` because
the client cannot prove future acceptance without making a request.

Logout clears the Session and Refresh timer and closes the connection. A later Public Topic read
may lazily open a new unauthenticated connection. The stable connection object owned by
`TRClient` is never replaced.

Add `cash` as the first Secured Topic. A Get or Watch on a Secured Topic with no presumed Session
fails locally with `TRAuthError`, before opening a socket.

**Blocked by:** 02 — TRClient, unauthenticated

**Status:** claimed

- [ ] `login(phoneNumber, pin)` starts Login and polls until app approval
- [ ] Login accepts an abort signal, timeout, and fake-clock poll interval
- [ ] The client never stores the phone number or PIN
- [ ] Login and Refresh use the injected `fetch`; the suite performs no network I/O
- [ ] HTTP failures throw `TRHttpError`; Session rejection throws `TRAuthError`
- [ ] Complete cookie values and attributes survive merge, export, and restore
- [ ] `mapper-lb-affinity` and `tr_refresh` survive a Refresh that does not replace them
- [ ] Refresh runs at 80% of the `tr_session` JWT lifetime, even while idle
- [ ] Concurrent Refresh callers share one in-flight request
- [ ] Exported Session data is opaque, serializable, and round-trips through the constructor
- [ ] Session Validity reports `absent`, `presumed-valid`, or `rejected`
- [ ] Logout clears the Session and timer and closes the connection
- [ ] `cash` is a typed Secured Topic
- [ ] Secured Get and Watch fail locally without a Session and perform no I/O
- [ ] The connection object is not replaced when Login, restore, Refresh, or Logout changes Session
- [ ] Type checking, linting, formatting, build, and the offline test suite pass

## Notes

General socket-drop reconnection, backoff, and resubscription belong to ticket 04. This ticket
only reconnects and restores subscriptions as part of the required reactive authentication
recovery. It also makes a closed connection reusable so Logout and Session changes do not replace
the stable connection object.
