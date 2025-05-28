# Trade Republic SDK

An unofficial TypeScript/JavaScript SDK for the Trade Republic API.

⚠️ **Disclaimer**: This is an unofficial SDK and is not affiliated with Trade Republic. Use at your own risk.

## Features

- 🔐 Two-step authentication with phone number, PIN, and SMS OTP
- 🍪 Automatic session cookie management
- 📘 Full TypeScript support
- 🎯 Simple, intuitive API

## Installation

```bash
npm install trade-republic-sdk
```

## Quick Start

```typescript
import { TradeRepublicClient } from "trade-republic-sdk";

const client = new TradeRepublicClient();

try {
  // Step 1: Initiate login (sends OTP to your device)
  await client.initiateLogin("+49151507xxxxx", "1234");

  // Step 2: Complete login with OTP received via SMS
  await client.completeLogin("5678");

  // Step 3: Use authenticated client
  const accountInfo = await client.getAccountInfo();
  console.log(accountInfo);
} catch (error) {
  console.error("Authentication failed:", error);
}
```

## Authentication Flow

The Trade Republic API uses a two-step authentication process:

1. **Initial Login**: Send phone number and PIN to receive an OTP via SMS
2. **OTP Verification**: Complete authentication with the received OTP code

### Step-by-Step Example

```typescript
import { TradeRepublicClient } from "trade-republic-sdk";

const client = new TradeRepublicClient();

// Step 1: Initiate login
console.log("Sending login request...");
await client.initiateLogin(phoneNumber, pin);
console.log("OTP sent to your device");

// Step 2: Wait for user to receive OTP and enter it
const otpCode = "1234"; // Get this from user input
await client.completeLogin(otpCode);
console.log("Login successful!");

// Step 3: Make authenticated requests
if (client.isAuthenticated()) {
  const accountInfo = await client.getAccountInfo();
  console.log("Account Info:", accountInfo);
}
```

## API Reference

### TradeRepublicClient

#### Methods

##### `initiateLogin(phoneNumber: string, pin: string): Promise<void>`

Initiates the login process by sending phone number and PIN. An OTP will be sent to the registered device.

- `phoneNumber`: Your Trade Republic phone number (with country code, e.g., '+49151507xxxxx')
- `pin`: Your 4-digit PIN

##### `completeLogin(otpCode: string): Promise<void>`

Completes the login process using the OTP received via SMS.

- `otpCode`: The 4-digit verification code received via SMS

##### `getAccountInfo(): Promise<unknown>`

Retrieves account information. Requires successful authentication.

Returns account details including balances, positions, etc.

##### `isAuthenticated(): boolean`

Checks if the client is currently authenticated.

Returns `true` if authenticated, `false` otherwise.

##### `logout(): void`

Clears the current session, requiring re-authentication for future requests.

## Development

### Running the Example

```bash
git clone <repository-url>
cd trade-republic-sdk
npm install
npm run dev
```

### Building

```bash
npm run build
```

## Security Notes

- Never hardcode credentials in your source code
- Store sensitive information in environment variables
- The SDK manages session cookies automatically - no need to handle them manually
- Sessions may expire - implement proper error handling and re-authentication

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Disclaimer

This SDK is not officially supported by Trade Republic. It's a community project for educational and development purposes. Use it responsibly and in accordance with Trade Republic's terms of service.
