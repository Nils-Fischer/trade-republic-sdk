# Testing Guide

This guide explains how to run tests for the Trade Republic SDK.

## Overview

The testing framework uses **Bun's built-in test runner** which provides:

- Fast TypeScript execution without compilation
- Jest-compatible API
- Built-in mocking capabilities
- Excellent error reporting

## Prerequisites

Before running tests, you need:

1. A valid Trade Republic account
2. Access to your phone for SMS verification
3. Your Trade Republic PIN

## Setup

### 1. Install Dependencies

```bash
bun install
```

### 2. Authentication Setup

Before running tests, you need to authenticate once. This will save your session cookies for subsequent test runs:

```bash
bun run test:setup
```

This will prompt you for:

- Your phone number (e.g., +4912345678910)
- Your 4-digit PIN
- The SMS verification code sent to your phone

The authentication tokens will be saved to `test-cookies.json` and reused for future test runs.

## Running Tests

### Basic Test Run

```bash
bun test
```

### Watch Mode (re-run tests on file changes)

```bash
bun run test:watch
```

### Run Specific Test File

```bash
bun test tests/client.test.ts
```

### Run Tests with Pattern Matching

```bash
bun test --grep "Authentication"
```

## Test Structure

### Main Test Files

- **`tests/client.test.ts`** - Core client functionality tests
- **`tests/test-runner.ts`** - Authentication setup script

### Test Categories

1. **Authentication Tests**

   - Session validation
   - WebSocket initialization
   - Error handling for unauthenticated requests

2. **API Integration Tests**

   - Account information retrieval
   - Personal details
   - Payment methods
   - Financial data (trending stocks)
   - Tax information
   - Document retrieval

3. **Error Handling Tests**

   - Invalid authentication attempts
   - Network error scenarios
   - Malformed request handling

4. **State Management Tests**
   - Login/logout functionality
   - Session persistence
   - Language configuration

## Authentication Management

### Session Cookies

Test session cookies are stored in `test-cookies.json`. These cookies:

- Are automatically reused across test runs
- Are validated before each test session
- Are refreshed automatically if expired

### Manual Cookie Refresh

If you encounter authentication errors, refresh your test cookies:

```bash
# Clear existing cookies and re-authenticate
rm test-cookies.json
bun run test:setup
```

### Security Notes

- Test cookies are stored locally and never committed to version control
- Use test credentials separate from your main trading account if possible
- Cookies expire periodically and need refreshing

## Writing New Tests

### Basic Test Structure

```typescript
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { TradeRepublicClient } from "../index";

describe("Your Test Suite", () => {
  let client: TradeRepublicClient;

  beforeAll(async () => {
    // Setup authenticated client
    const cookies = loadTestCookies();
    client = new TradeRepublicClient();
    await client.loginWithCookies(cookies);
  });

  afterAll(() => {
    client.logout();
  });

  test("your test case", async () => {
    const result = await client.someMethod();
    expect(result).toBeDefined();
  });
});
```

### Testing Best Practices

1. **Use meaningful test descriptions**

   ```typescript
   test("should fetch account information successfully", async () => {
     // test implementation
   });
   ```

2. **Group related tests**

   ```typescript
   describe("Account Information", () => {
     test("should fetch account info", async () => {});
     test("should fetch personal details", async () => {});
   });
   ```

3. **Test both success and error cases**

   ```typescript
   test("should handle network errors gracefully", async () => {
     // Mock network failure and test error handling
   });
   ```

4. **Clean up resources**
   ```typescript
   afterAll(() => {
     client.logout();
   });
   ```

## Integration with CI/CD

For automated testing in CI/CD pipelines:

1. Store authentication credentials as environment variables
2. Modify `test-runner.ts` to use environment variables when available
3. Add test timeouts for network-dependent tests
4. Consider using mock servers for unit tests vs integration tests

## Troubleshooting

### Common Issues

**"No test cookies found" Error**

```bash
# Solution: Run authentication setup
bun run test:setup
```

**Authentication Expired**

```bash
# Solution: Clear and re-authenticate
rm test-cookies.json
bun run test:setup
```

**Network Timeouts**

- Ensure stable internet connection
- Check Trade Republic service status
- Increase timeout values in test configuration

**API Rate Limiting**

- Add delays between test runs
- Reduce concurrent test execution
- Use test data instead of live API calls where possible

### Debug Mode

Run tests with debug output:

```bash
DEBUG=1 bun test
```

## Test Coverage

Currently tested functionality:

- ✅ Authentication flow
- ✅ Account information retrieval
- ✅ Personal details
- ✅ Payment methods
- ✅ Tax information
- ✅ Document retrieval
- ✅ Error handling
- ✅ State management

Planned test coverage:

- [ ] WebSocket real-time data
- [ ] Order placement (if available)
- [ ] Portfolio management
- [ ] Transaction history

## Contributing

When adding new tests:

1. Follow the existing test structure
2. Add both positive and negative test cases
3. Update this documentation
4. Ensure tests are deterministic and don't depend on specific account data
5. Use mocks for external dependencies where appropriate
