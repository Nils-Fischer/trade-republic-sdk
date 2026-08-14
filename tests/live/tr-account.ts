import { TRClient } from "../../src/index.ts";
import { readCredentials } from "./input.ts";
import { createLiveReport } from "./report.ts";
import { auditTRAccount } from "./tr-account-audit.ts";

const report = createLiveReport((line) => console.log(line));
const client = new TRClient({
  validate: "warn",
  onValidationWarning: (warning) => report.capture("TRAccount.sync", warning),
});

try {
  const credentials = await readCredentials();
  console.log("Approve the login request in the Trade Republic app when it appears.");
  await client.login(credentials.phoneNumber, credentials.pin);
  await auditTRAccount(client, report);
} catch (error) {
  report.failure("setup", error instanceof Error ? error : new Error("unknown"));
} finally {
  client.logout();
}

if (!report.finish()) process.exitCode = 1;
