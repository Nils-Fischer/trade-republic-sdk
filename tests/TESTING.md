# Testing Guide

A concise guide for running tests with the Trade Republic SDK.

## Prerequisites

- Valid Trade Republic account with phone access for SMS verification
- Your Trade Republic PIN

## Quick Start

### Run All Tests

```bash
bun test
```

### Run Specific Tests

```bash
bun run test:client    # Client API tests
bun run test:ws        # WebSocket tests
```

### Watch Mode

```bash
bun run test:watch     # Re-run tests on file changes
```

## Authentication

Tests automatically handle authentication:

1. **First run**: You'll be prompted for your phone number, PIN, and SMS verification code
2. **Subsequent runs**: Saved cookies are automatically validated and reused
3. **Expired cookies**: You'll be prompted to re-authenticate automatically

No manual setup required - just run the tests and authenticate when prompted!

## Test Files

- `tests/client.test.ts` - Core API functionality
- `tests/websocket.test.ts` - WebSocket and real-time features

## Troubleshooting

**Clear saved authentication**:

```bash
rm test-cookies.json
```

**Network issues**: Ensure stable internet connection and check Trade Republic service status.

That's it! The testing setup is designed to be simple and automatic.
