# Trade Republic SDK

An unofficial TypeScript SDK for Trade Republic's private API.

> This project is not affiliated with Trade Republic. Its private API can change without notice.

The package is under active development. Public Topics target Node.js 22.4 and newer, Bun,
browsers, and React Native. Sessions work directly in Node, Bun, and React Native. Browser Session
export and Refresh scheduling require an injected cookie-capable transport because browser
`fetch` hides `HttpOnly` cookies. React bindings are isolated in the optional
`trade-republic-sdk/react` entry point.

## Install

```bash
npm install trade-republic-sdk
```

## Errors

Every SDK failure inherits from `TRError`. Consumers can catch that root type or distinguish
authentication, HTTP, Topic, validation, timeout, connection, and abort failures by class.

```ts
import { TRError, TRTopicError } from "trade-republic-sdk";

try {
  // Call the SDK.
} catch (error) {
  if (error instanceof TRTopicError) {
    console.log(error.errorCode);
  } else if (error instanceof TRError) {
    console.log(error.message);
  }
}
```

## Development

```bash
vp install
vp check
vp test
vp run build
```

## License

[MIT](./LICENSE)
