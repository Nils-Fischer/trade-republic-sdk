# TRAccount is read-only

`TRAccount` never writes. It projects Banking Topics and exposes reads; it has no method that
places an order, creates a savings plan, or moves money.

Trade Republic's real API is writable, so this is a deliberate no rather than a missing
feature. Writes through a projection mean optimistic updates and reconciliation — a much
larger machine than the one we are building — and a mistake in a reverse-engineered write path
moves real money, a failure mode no test suite makes comfortable.

If writes are ever added they belong on `TRClient`, where the caller is explicitly making one
request rather than mutating a local model and hoping it lands.
