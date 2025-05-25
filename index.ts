import { access, readFile, writeFile } from "fs/promises";

// Type definitions for Web Crypto API (missing in some environments)
interface CryptoKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

const TR_API_URL = "https://api.traderepublic.com";
const KEY_FILE_PATH = "./tr_key.pem";

interface TRCredentials {
  phoneNumber: string;
  pin: string;
}

interface DeviceResetResponse {
  processId: string;
}

interface DeviceKeyResponse {
  success?: boolean;
}

interface LoginResponse {
  sessionToken: string;
  refreshToken: string;
  accountState: string;
}

interface SessionTokens {
  sessionToken: string;
  refreshToken: string;
}

// Global session state
let currentSession: SessionTokens | null = null;

// Generate ECDSA P-256 key pair
async function generateKeyPair(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    true, // extractable
    ["sign", "verify"],
  );
}

// Convert public key to uncompressed format and base64 encode
async function publicKeyToBase64(publicKey: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey("raw", publicKey);
  return Buffer.from(exported).toString("base64");
}

// Export private key to PEM format
async function privateKeyToPem(privateKey: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey("pkcs8", privateKey);
  const base64 = Buffer.from(exported).toString("base64");

  // Format as PEM
  const pem = [
    "-----BEGIN PRIVATE KEY-----",
    ...base64.match(/.{1,64}/g)!,
    "-----END PRIVATE KEY-----",
  ].join("\n");

  return pem;
}

// Import private key from PEM format
async function privateKeyFromPem(pem: string): Promise<CryptoKey> {
  const base64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const binary = Buffer.from(base64, "base64");

  return await crypto.subtle.importKey(
    "pkcs8",
    binary,
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    true,
    ["sign"],
  );
}

// Save private key to disk
async function savePrivateKey(privateKey: CryptoKey): Promise<void> {
  const pem = await privateKeyToPem(privateKey);
  await writeFile(KEY_FILE_PATH, pem, "utf8");
}

// Load private key from disk
async function loadPrivateKey(): Promise<CryptoKey | null> {
  try {
    await access(KEY_FILE_PATH);
    const pem = await readFile(KEY_FILE_PATH, "utf8");
    return await privateKeyFromPem(pem);
  } catch {
    return null;
  }
}

// Convert ECDSA signature from IEEE P1363 format to DER format
function convertP1363ToDER(p1363Signature: ArrayBuffer): ArrayBuffer {
  const signature = new Uint8Array(p1363Signature);

  // P1363 format: r (32 bytes) || s (32 bytes) for P-256
  const r = signature.slice(0, 32);
  const s = signature.slice(32, 64);

  // Helper function to encode an integer in DER format
  function encodeInteger(value: Uint8Array): Uint8Array {
    // Remove leading zeros, but keep at least one byte
    let start = 0;
    while (start < value.length - 1 && value[start] === 0) {
      start++;
    }
    const trimmed = value.slice(start);

    // If the first bit is set, we need to add a 0x00 byte to indicate positive number
    const needsPadding = trimmed.length > 0 && (trimmed[0] ?? 0) >= 0x80;
    const length = trimmed.length + (needsPadding ? 1 : 0);

    const result = new Uint8Array(2 + length);
    result[0] = 0x02; // INTEGER tag
    result[1] = length; // Length

    if (needsPadding) {
      result[2] = 0x00;
      result.set(trimmed, 3);
    } else {
      result.set(trimmed, 2);
    }

    return result;
  }

  const rDER = encodeInteger(r);
  const sDER = encodeInteger(s);

  // Create the SEQUENCE
  const totalLength = rDER.length + sDER.length;
  const result = new Uint8Array(2 + totalLength);

  result[0] = 0x30; // SEQUENCE tag
  result[1] = totalLength; // Length
  result.set(rDER, 2);
  result.set(sDER, 2 + rDER.length);

  return result.buffer;
}

// Sign a request payload (mimics Python's do_request signing)
async function signPayload(
  privateKey: CryptoKey,
  payload: object,
): Promise<{ timestamp: string; signature: string }> {
  const timestamp = Date.now().toString();
  const payloadString = JSON.stringify(payload);
  const message = `${timestamp}.${payloadString}`;

  const p1363Signature = await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-512",
    },
    privateKey,
    new TextEncoder().encode(message),
  );

  // Convert from P1363 to DER format (as expected by Trade Republic)
  const derSignature = convertP1363ToDER(p1363Signature);

  return {
    timestamp,
    signature: Buffer.from(derSignature).toString("base64"),
  };
}

// Make a signed request to TR API
async function makeSignedRequest<T>(
  path: string,
  payload: object,
  privateKey?: CryptoKey,
): Promise<T> {
  const url = `${TR_API_URL}${path}`;

  if (privateKey) {
    const { timestamp, signature } = await signPayload(privateKey, payload);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Zeta-Timestamp": timestamp,
        "X-Zeta-Signature": signature,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `Request failed: ${response.status} ${
          response.statusText
        } - ${await response.text()}`,
      );
    }

    return (await response.json()) as T;
  } else {
    // Unsigned request (for initial device reset)
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `Request failed: ${response.status} ${
          response.statusText
        } - ${await response.text()}`,
      );
    }

    return (await response.json()) as T;
  }
}

// Step 1: Start device registration process
async function startDeviceRegistration(credentials: TRCredentials): Promise<string> {
  console.log("🔄 Starting device registration...");

  const response = await makeSignedRequest<DeviceResetResponse>(
    "/api/v1/auth/account/reset/device",
    {
      phoneNumber: credentials.phoneNumber,
      pin: credentials.pin,
    },
  );

  console.log("✅ Process ID received:", response.processId);
  return response.processId;
}

// Step 2: Complete device registration with SMS code
async function completeDeviceRegistration(
  processId: string,
  smsCode: string,
  keyPair: CryptoKeyPair,
): Promise<void> {
  console.log("🔄 Completing device registration...");

  const publicKeyBase64 = await publicKeyToBase64(keyPair.publicKey);

  const response = await makeSignedRequest<DeviceKeyResponse>(
    `/api/v1/auth/account/reset/device/${processId}/key`,
    {
      code: smsCode,
      deviceKey: publicKeyBase64,
    },
  );

  await savePrivateKey(keyPair.privateKey);
  console.log("✅ Device registration completed and key saved!");
}

// Main registration function
export async function registerDevice(
  credentials: TRCredentials,
  processId?: string,
): Promise<void> {
  // Generate new key pair
  const keyPair = await generateKeyPair();

  // Step 1: Get process ID (if not provided)
  const actualProcessId = processId || (await startDeviceRegistration(credentials));

  // Step 2: Wait for user input (SMS code)
  console.log(`📱 Please enter the SMS code sent to ${credentials.phoneNumber}:`);

  // In a real implementation, you'd prompt for user input here
  // For testing, we'll throw an error asking for the code
  throw new Error(
    `Registration started. Process ID: ${actualProcessId}. Please call completeRegistration("${actualProcessId}", "YOUR_SMS_CODE") next.`,
  );
}

// Helper function to complete registration (for testing)
export async function completeRegistration(
  processId: string,
  smsCode: string,
): Promise<void> {
  const keyPair = await generateKeyPair();
  await completeDeviceRegistration(processId, smsCode, keyPair);
}

// Login function (equivalent to Python's login method)
export async function login(
  credentials: TRCredentials,
  alreadyTriedRegistering = false,
): Promise<LoginResponse> {
  console.log("🔐 Attempting to login...");

  let response: LoginResponse | null = null;

  // Check if we have a private key file (equivalent to os.path.isfile("key"))
  const privateKey = await loadPrivateKey();

  if (privateKey) {
    try {
      console.log("🔑 Using existing private key for login");
      response = await makeSignedRequest<LoginResponse>(
        "/api/v1/auth/login",
        {
          phoneNumber: credentials.phoneNumber,
          pin: credentials.pin,
        },
        privateKey,
      );
    } catch (error) {
      const errorMessage = (error as Error).message;
      console.log("❌ Login request failed:", errorMessage);

      // Check for specific error types
      if (errorMessage.includes("401")) {
        if (errorMessage.includes("PIN_INVALID")) {
          throw new Error("Invalid PIN. Please check your PIN and try again.");
        } else if (
          errorMessage.includes("DEVICE_NOT_PAIRED") ||
          errorMessage.includes("UNAUTHORIZED")
        ) {
          if (!alreadyTriedRegistering) {
            console.log("🔄 Device not paired, attempting re-registration...");
            await registerNewDevice(credentials);
            return await login(credentials, true);
          }
        } else {
          // Generic 401 error
          if (!alreadyTriedRegistering) {
            console.log("🔄 Authentication failed, attempting re-registration...");
            await registerNewDevice(credentials);
            return await login(credentials, true);
          }
        }
      }
      throw error;
    }
  }

  // If no private key exists or login failed, register new device
  if (!response && !alreadyTriedRegistering) {
    console.log("📱 No private key found, registering new device...");
    await registerNewDevice(credentials);
    return await login(credentials, true);
  }

  if (!response) {
    throw new Error("Login failed after device registration");
  }

  // Validate account state
  if (response.accountState !== "ACTIVE") {
    throw new Error(`Account not active. Current state: ${response.accountState}`);
  }

  // Store session tokens
  currentSession = {
    sessionToken: response.sessionToken,
    refreshToken: response.refreshToken,
  };

  console.log("✅ Login successful!");
  return response;
}

// Helper function to trigger device registration during login
async function registerNewDevice(credentials: TRCredentials): Promise<void> {
  // This will throw an error with the process ID, which we need to handle
  try {
    await registerDevice(credentials);
  } catch (error) {
    if ((error as Error).message.includes("Process ID:")) {
      const processId = (error as Error).message.match(/Process ID: ([a-f0-9-]+)/)?.[1];
      if (processId) {
        throw new Error(
          `Device registration started. Process ID: ${processId}. Please complete registration with SMS code before logging in.`,
        );
      }
    }
    throw error;
  }
}

// Get current session tokens
export function getCurrentSession(): SessionTokens | null {
  return currentSession;
}

// Check if user is logged in
export function isLoggedIn(): boolean {
  return currentSession !== null;
}

// Logout (clear session)
export function logout(): void {
  currentSession = null;
  console.log("🚪 Logged out");
}

// Refresh session token (for future use)
export async function refreshSession(): Promise<SessionTokens> {
  if (!currentSession) {
    throw new Error("No active session to refresh");
  }

  const privateKey = await loadPrivateKey();
  if (!privateKey) {
    throw new Error("No private key available for refresh");
  }

  const response = await makeSignedRequest<LoginResponse>(
    "/api/v1/auth/refresh",
    {
      refreshToken: currentSession.refreshToken,
    },
    privateKey,
  );

  currentSession = {
    sessionToken: response.sessionToken,
    refreshToken: response.refreshToken,
  };

  console.log("🔄 Session refreshed");
  return currentSession;
}

// Test login flow
export async function testLogin(): Promise<void> {
  console.log("🧪 Testing login flow...");

  const credentials: TRCredentials = {
    phoneNumber: "[REDACTED] ",
    pin: "1234", // You should replace this with real credentials for testing
  };

  try {
    const loginResult = await login(credentials);
    console.log("✅ Login successful!");
    console.log("📋 Session info:", {
      accountState: loginResult.accountState,
      hasSessionToken: !!loginResult.sessionToken,
      hasRefreshToken: !!loginResult.refreshToken,
    });

    // Test session management
    console.log("🔍 Current session:", isLoggedIn());
    console.log("📊 Session tokens available:", !!getCurrentSession());
  } catch (error) {
    console.log("❌ Login failed:", (error as Error).message);

    // If device registration is needed, inform the user
    if ((error as Error).message.includes("Process ID:")) {
      console.log("💡 You need to complete device registration first");
      console.log("🔧 Run the registration CLI: bun run index.ts");
    }
  }
}

// Run interactive CLI if this file is executed directly
if (import.meta.main) {
  const result = await makeSignedRequest("/api/v1/auth/web/login", {
    phoneNumber: "[REDACTED] ",
    pin: "[REDACTED] ",
  });
  console.log(result);
}
