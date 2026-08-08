# TRAccount returns normalized Transactions with integer money

`TRAccount` maps Trade Republic's timeline payload to a domain `Transaction` rather than
passing it through. `TRClient` still returns the raw shape for anything normalization drops.

Trade Republic's payload is roughly half presentation (`title`, `icon`, `badge`, `subtitle`,
`status`, `action`) and carries amounts as a float `value` alongside a separate
`fractionDigits`. Normalizing buys three things: amounts become integer minor units, so IEEE754
never touches an account balance; `eventType` becomes a discriminated union that can be
switched on exhaustively; and `hidden`/`deleted` get an explicit policy instead of leaking.

## Consequences

Normalization must keep `title` and `subtitle` as `description` and `counterparty`. The
merchant name exists nowhere else in the payload — dropping the presentation fields wholesale
would lose the single most useful piece of information in a bank transaction.
