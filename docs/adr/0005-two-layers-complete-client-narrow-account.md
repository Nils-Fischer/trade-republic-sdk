# TRClient is complete, TRAccount is deliberately narrow

`TRClient` covers every Topic and REST resource Trade Republic exposes. `TRAccount` is a
read-only projection built on top of it, covering only the Banking Topics.

`TRAccount` cannot be the whole SDK, because roughly half the Topics are parameterized over an
instrument or a query — `ticker`, `instrument`, `stockDetails`, `neonSearch`. There are
thousands of instruments, so there is no "all state" to hold locally. Those Topics stay
on-demand reads through `TRClient`, which is therefore not optional.

`TRClient` stays complete even though this project's own use case is the banking side. In a
registry design an unused Topic costs one table row, and the schemas are the library's public
value to everyone who isn't us.
