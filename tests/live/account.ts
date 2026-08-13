import { TRClient } from "../../src/index.ts";
import { LiveAccountAudit } from "./audit.ts";
import { readCredentials } from "./input.ts";
import { createLiveReport } from "./report.ts";

const report = createLiveReport((line) => console.log(line));
const audit = new LiveAccountAudit(report);
const client = new TRClient(audit.clientOptions);
let restored: TRClient | undefined;

try {
  const credentials = await readCredentials();
  console.log("Approve the login request in the Trade Republic app when it appears.");
  if (await audit.login(client, credentials.phoneNumber, credentials.pin)) {
    restored = await audit.run(client);
  }
} catch (error) {
  report.failure("setup", error instanceof Error ? error : new Error("unknown"));
} finally {
  restored?.logout();
  client.logout();
}

if (!report.finish()) process.exitCode = 1;
