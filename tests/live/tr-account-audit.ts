import { accountClientSubscriptionCount } from "../../src/client.ts";
import { TRAccount, TRClient, TRValidationError } from "../../src/index.ts";
import type { LiveReport } from "./report.ts";

const SYNC_TIMEOUT_MS = 30_000;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

export async function auditTRAccount(client: TRClient, report: LiveReport): Promise<void> {
  const account = new TRAccount(client, {
    transactionWindow: { from: new Date(Date.now() - WINDOW_MS) },
  });
  try {
    await account.sync({ signal: AbortSignal.timeout(SYNC_TIMEOUT_MS) });
    const cash = account.cash.getSnapshot();
    const transactions = account.transactions.getSnapshot();
    const documents = account.documents.getSnapshot();
    report.accountSlice("cash", {
      status: cash.status,
      items: (cash.data?.balances.length ?? 0) + (cash.data?.available.length ?? 0),
    });
    report.accountSlice("transactions", {
      status: transactions.status,
      items: transactions.data?.length ?? 0,
      from: transactions.materializedRange?.from,
      to: transactions.materializedRange?.to,
    });
    report.accountSlice("documents", {
      status: documents.status,
      items: documents.data?.length ?? 0,
    });

    const range = transactions.materializedRange;
    if (!range) throw new TRValidationError("TRAccount transaction range unavailable");
    const before = account.transactions.getSnapshot();
    const subscriptionCount = accountClientSubscriptionCount(client);
    await account.transactions.read({ from: new Date(range.from), to: new Date(range.to) });
    if (accountClientSubscriptionCount(client) !== subscriptionCount) {
      throw new TRValidationError("TRAccount covered read started a Subscription");
    }
    if (account.transactions.getSnapshot() !== before) {
      throw new TRValidationError("TRAccount covered read changed its Snapshot");
    }

    account.stop();
    report.accountSlice("cash.stopped", {
      status: account.cash.getSnapshot().status,
    });
    report.accountSlice("transactions.stopped", {
      status: account.transactions.getSnapshot().status,
    });
    report.accountSlice("documents.stopped", {
      status: account.documents.getSnapshot().status,
    });
    if (
      account.cash.getSnapshot().status !== "pending" ||
      account.transactions.getSnapshot().status !== "pending" ||
      account.documents.getSnapshot().status !== "pending"
    ) {
      throw new TRValidationError("TRAccount Stop did not clear every Slice");
    }
  } catch (error) {
    report.failure("TRAccount.sync", error instanceof Error ? error : new Error("unknown"));
  } finally {
    account.stop();
  }
}
