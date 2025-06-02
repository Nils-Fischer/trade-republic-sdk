import { input, password } from "@inquirer/prompts";
import { TradeRepublicClient } from "../index";
import { loadTestCookies, saveCookies, validateCookies } from "./cookie-utils";

/**
 * Centralized authentication setup for all test files.
 * This function replaces the logic that was previously in smart-test.ts and test-runner.ts.
 *
 * It automatically:
 * 1. Checks if test cookies exist and are valid
 * 2. If not valid, prompts for interactive authentication
 * 3. Returns valid cookies for use in tests
 * 4. Throws an error if authentication cannot be completed
 *
 * This allows test files to call this function in their beforeAll() hooks
 * and proceed with testing only if authentication is successful.
 */

async function performLogin(client: TradeRepublicClient): Promise<string[]> {
  console.log("\n🔐 Authentication required for testing");
  console.log("Please provide your Trade Republic credentials:");

  const phoneNumber = await input({
    message: "Enter your phone number:",
  });

  const pin = await password({
    message: "Enter your 4-digit PIN:",
    mask: "*",
  });

  console.log("📱 Initiating login...");
  await client.initiateLogin(phoneNumber, pin);

  const otpCode = await password({
    message: "Enter the 4-digit SMS verification code:",
    mask: "*",
  });

  console.log("✅ Completing login...");
  const cookies = await client.completeLogin(otpCode);

  saveCookies(cookies);
  return cookies;
}
export async function ensureAuthenticationForTests(): Promise<string[]> {
  console.log("🔍 Checking test cookies...");

  const testCookies = loadTestCookies();
  let needsAuth = false;

  if (!testCookies) {
    console.log("❌ No test cookies found.");
    needsAuth = true;
  } else {
    console.log("🔍 Validating existing cookies...");
    const areCookiesValid = await validateCookies(testCookies);

    if (!areCookiesValid) {
      console.log("❌ Test cookies are expired or invalid.");
      needsAuth = true;
    } else {
      console.log("✅ Cookies are valid!");
    }
  }

  if (needsAuth) {
    console.log("🔧 Starting authentication setup...");
    try {
      const client = new TradeRepublicClient();
      const cookies = await performLogin(client);
      console.log("✅ Authentication complete!");
      return cookies;
    } catch (error) {
      console.log("❌ Authentication failed or was cancelled.");
      throw new Error(
        "Authentication required for tests. Please run authentication setup manually.",
      );
    }
  }

  return testCookies!;
}
