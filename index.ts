import { input, password } from "@inquirer/prompts";
import { type LoginResponse, LoginResponseDataSchema } from "./types";
import { extractCookiesFromResponse, makeSignedRequest } from "./utils";

async function loginRequest(phoneNumber: string, pin: string): Promise<LoginResponse> {
  const response: Response = await makeSignedRequest(
    "/api/v1/auth/web/login",
    {
      phoneNumber,
      pin,
    },
    "POST",
  );
  const data = LoginResponseDataSchema.parse(await response.json());
  const responseCookies = extractCookiesFromResponse(response);

  return { data, cookies: responseCookies };
}

async function verifyLoginRequest(
  processId: string,
  authCode: string,
  cookies: string[],
): Promise<string[]> {
  const result = await makeSignedRequest(
    `/api/v1/auth/web/login/${processId}/${authCode}`,
    {},
    "POST",
    cookies,
  );
  return extractCookiesFromResponse(result);
}

async function getAccountInfo(cookies: string[]): Promise<unknown> {
  const result = await makeSignedRequest("/api/v2/auth/account", {}, "GET", cookies);
  return result.json();
}

if (import.meta.main) {
  const phoneNumber = await input({
    message: "Enter your phone number:",
    default: "[REDACTED] ",
  });

  const pin = await password({
    message: "Enter your 4-digit PIN:",
    mask: "*",
  });

  const { data, cookies: loginCookies } = await loginRequest(phoneNumber, pin);
  console.log("Login response:", data);

  const authCode = await password({
    message: "Enter the 4-digit SMS verification code:",
    mask: "*",
  });

  const verifiedCookies = await verifyLoginRequest(
    data.processId,
    authCode,
    loginCookies,
  );
  console.log("Verification completed");

  const accountInfo = await getAccountInfo(verifiedCookies);
  console.log("Account info:", accountInfo);
}
