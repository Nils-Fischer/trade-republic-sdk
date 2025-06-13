export const TR_API_URL = "https://api.traderepublic.com";

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

export function extractCookiesFromResponse(response: Response): string[] {
  // Handle environments with or without `headers.getSetCookie()` (React Native lacks it).
  let rawCookies: string[] = [];

  // Bun / Node >= 20 provide `getSetCookie()` which returns an array of header strings.
  if (typeof response.headers.getSetCookie === "function") {
    rawCookies = response.headers.getSetCookie() || [];
  }

  // Fallback for React-Native fetch: use the standard `set-cookie` header.
  if (rawCookies.length === 0 && typeof response.headers.get === "function") {
    const sc = response.headers.get("set-cookie") || response.headers.get("Set-Cookie");
    if (sc) {
      if (Array.isArray(sc)) {
        rawCookies = sc;
      } else {
        // More sophisticated parsing for comma-separated cookies
        rawCookies = [];
        let current = "";
        let inQuotes = false;

        for (let i = 0; i < sc.length; i++) {
          const char = sc[i];

          if (char === '"') {
            inQuotes = !inQuotes;
          }

          if (char === "," && !inQuotes) {
            const nextPart = sc.slice(i + 1).trim();
            // A new cookie should start with `key=` and not be part of a date string
            if (
              /^\s*[^=;\s]+\s*=/.test(nextPart) &&
              !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(nextPart)
            ) {
              rawCookies.push(current.trim());
              current = "";
              continue;
            }
          }

          current += char;
        }

        if (current.trim()) {
          rawCookies.push(current.trim());
        }
      }
    }
  }

  return rawCookies
    .map((cookie: string) => {
      const cookieValue = cookie.split(";")[0];
      return cookieValue || null;
    })
    .filter((cookie: string | null) => cookie !== null);
}

// Make a signed request to TR API
export async function makeSignedRequest(
  path: string,
  payload: object,
  method: "GET" | "POST" = "POST",
  cookies?: string[],
  language?: string,
): Promise<Response> {
  const url = `${TR_API_URL}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Add Accept-Language header if language is provided
  if (language) {
    headers["Accept-Language"] = language;
  }

  // Add cookies if requested
  if (cookies && cookies.length > 0) {
    headers["Cookie"] = cookies.join("; ");
  }

  const requestOptions: RequestInit = {
    method,
    headers,
  };

  // Only add body for POST requests
  if (method === "POST") {
    requestOptions.body = JSON.stringify(payload);
  }

  const response = await fetch(url, requestOptions);

  if (!response.ok) {
    return Promise.reject(
      new Error(
        `Request failed: ${response.status} ${
          response.statusText
        } - ${await response.text()}`,
      ),
    );
  }

  return response;
}
