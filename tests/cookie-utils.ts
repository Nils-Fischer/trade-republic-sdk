import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { TradeRepublicClient } from "../index";

const COOKIES_FILE = join(process.cwd(), "test-cookies.json");

export function loadTestCookies(): string[] | null {
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
    return null;
  }
}

export function saveCookies(cookies: string[]): void {
  try {
    writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
    console.log("✅ Test cookies saved");
  } catch (error) {
    console.error("❌ Failed to save test cookies:", error);
  }
}

export async function validateCookies(cookies: string[]): Promise<boolean> {
  if (!cookies || cookies.length === 0) {
    return false;
  }

  try {
    const client = new TradeRepublicClient();
    await client.loginWithCookies(cookies);

    // Try a quick authenticated request to validate cookies
    await client.getAccountInfo();
    return true;
  } catch (error) {
    return false;
  }
}

export async function ensureValidCookies(): Promise<string[]> {
  const cookies = loadTestCookies();

  if (!cookies) {
    throw new Error(
      'No test cookies found. Please run "bun run test:setup" first to authenticate.',
    );
  }

  const isValid = await validateCookies(cookies);

  if (!isValid) {
    throw new Error(
      'Test cookies are expired or invalid. Please run "bun run test:setup" to refresh authentication.',
    );
  }

  return cookies;
}
