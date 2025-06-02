# Trade Republic SDK

An unofficial TypeScript/JavaScript SDK for the Trade Republic API.

⚠️ **Disclaimer**: This is an unofficial SDK and is not affiliated with Trade Republic.

## Features

- 🔐 Two-step authentication (phone + PIN + SMS OTP)
- 📡 REST API methods for account data, trending stocks, documents, etc.
- 🔌 WebSocket subscriptions for real-time data
- 🍪 Automatic session cookie management
- 📘 Full TypeScript support
- 🎯 Simple, intuitive API

⚠️ **Note**: This SDK is **not complete**. Many API endpoints and WebSocket subscription types are missing, especially on the WebSocket side. Contributions are welcome!

## Installation

```bash
npm install trade-republic-sdk
```

## Quick Start

### REST API Usage

```typescript
import { TradeRepublicClient } from "trade-republic-sdk";

const client = new TradeRepublicClient();

try {
  // Step 1: Initiate login (sends OTP to your device)
  await client.initiateLogin("+491xxxxxxxxxx", "1234");

  // Step 2: Complete login with OTP received via SMS
  await client.completeLogin("5678");

  // Step 3: Use REST API methods
  const accountInfo = await client.getAccountInfo();
  const trendingStocks = await client.getTrendingStocks();

  console.log(accountInfo, trendingStocks);
} catch (error) {
  console.error("Error:", error);
}
```

### WebSocket Subscriptions

```typescript
// After authentication, use WebSocket for real-time data
const ws = client.ws;

// Subscribe to portfolio updates
ws.subscribe("portfolio", {}, (data) => {
  console.log("Portfolio update:", data);
});

// Subscribe to instrument price updates
ws.subscribe("ticker", { id: "US88160R1014" }, (data) => {
  console.log("Price update:", data);
});

// Some subscriptions auto-unsubscribe after sending all data
ws.subscribe("instrument", { id: "US88160R1014" }, (data) => {
  console.log("Instrument details:", data);
  // This subscription will automatically close after receiving the data
});
```

## API Overview

### Authentication

- `initiateLogin(phoneNumber, pin)` - Start login process
- `completeLogin(otpCode)` - Complete with SMS OTP
- `loginWithCookies(cookies)` - Use existing session cookies
- `isAuthenticated()` - Check auth status
- `logout()` - Clear session

### REST API Methods

- `getAccountInfo()` - Account details and balances
- `getTrendingStocks()` - Popular stocks
- `getPersonalDetails()` - Customer information
- `getPaymentMethods()` - Payment options
- `getTaxInformation()` - Tax details
- `getAllDocuments()` - Account documents

### WebSocket Subscriptions

The WebSocket API allows real-time subscriptions to various data streams. Some subscriptions automatically unsubscribe after delivering the requested data, while others provide continuous updates.

```typescript
// Portfolio and account data
ws.subscribe("portfolio", {}, callback);
ws.subscribe("cash", {}, callback);

// Instrument data
ws.subscribe("ticker", { id: "instrumentId" }, callback);
ws.subscribe("instrument", { id: "instrumentId" }, callback);

// Market data
ws.subscribe("neonSearch", { query: "Tesla" }, callback);
```

**Important**: The WebSocket functionality is incomplete. Many subscription types and parameters are not yet implemented.

## Limitations

- **Incomplete**: Many API endpoints are missing
- **WebSocket**: Limited subscription types implemented
- **Unofficial**: Not supported by Trade Republic
- **Rate Limits**: Be mindful of API usage
- **Security**: Handle credentials and session data carefully

## Development

```bash
git clone https://github.com/nilsfischer/trade-republic-sdk.git
cd trade-republic-sdk
npm install
npm run build
npm test
```

## Contributing

This SDK is far from complete. Contributions are welcome.

## License

MIT - See [LICENSE](LICENSE) file.

## Disclaimer

This SDK is not officially supported by Trade Republic. Use responsibly and in accordance with Trade Republic's terms of service.
