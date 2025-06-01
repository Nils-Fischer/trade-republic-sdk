#!/usr/bin/env bun
import { input, password } from "@inquirer/prompts";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { TradeRepublicClient } from "../index";

const COOKIES_FILE = join(process.cwd(), "test-cookies.json");

function saveCookies(cookies: string[]): void {
  try {
    writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
    console.log("✅ Test cookies saved");
  } catch (error) {
    console.error("❌ Failed to save test cookies:", error);
  }
}

function loadCookies(): string[] | null {
  try {
    if (!existsSync(COOKIES_FILE)) {
      return null;
    }

    const cookiesData = readFileSync(COOKIES_FILE, "utf-8");
    const cookies = JSON.parse(cookiesData);

    if (!Array.isArray(cookies) || cookies.length === 0) {
      return null;
    }

    return cookies;
  } catch (error) {
    console.error("❌ Failed to load test cookies:", error);
    return null;
  }
}

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

async function ensureAuthentication(): Promise<void> {
  const client = new TradeRepublicClient();
  const existingCookies = loadCookies();

  if (existingCookies) {
    try {
      console.log("🍪 Attempting to use existing test cookies...");
      await client.loginWithCookies(existingCookies);

      // Test if cookies are still valid
      await client.getAccountInfo();
      console.log("✅ Existing test cookies are valid!");
      return;
    } catch (error) {
      console.log("❌ Existing test cookies are invalid, performing fresh login");
    }
  }

  // Perform fresh login
  await performLogin(client);
}

async function main() {
  const args = process.argv.slice(2);

  try {
    // Ensure we have valid authentication before running tests
    console.log("🔧 Setting up test environment...");
    await ensureAuthentication();

    console.log("\n🚀 Running tests...");
    console.log("=".repeat(50));

    // Run the actual tests using the test framework
    const testCommand =
      args.length > 0 ? `bun test tests/ ${args.join(" ")}` : "bun test tests/";
    execSync(testCommand, { stdio: "inherit" });

    console.log("\n✅ Tests completed!");
  } catch (error) {
    console.error("❌ Test runner failed:", error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
