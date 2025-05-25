import { makeSignedRequest } from "./utils";

// Run interactive CLI if this file is executed directly
if (import.meta.main) {
  const result = await makeSignedRequest("/api/v1/auth/web/login", {
    phoneNumber: "[REDACTED] ",
    pin: "[REDACTED] ",
  });
  console.log(result);
}
