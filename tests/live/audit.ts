import {
  TRClient,
  TRValidationError,
  type TRClientOptions,
  type TimelineTransaction,
  type TimelineTransactionsResponse,
} from "../../src/index.ts";
import type { AccessorCounts, LiveReport } from "./report.ts";
import { auditTRAccount } from "./tr-account-audit.ts";

const READ_TIMEOUT_MS = 30_000;
const MAX_TIMELINE_PAGES = 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Counts<Value> = (value: Value) => AccessorCounts;

export class LiveAccountAudit {
  readonly #report: LiveReport;
  #activeAccessor = "login";

  constructor(report: LiveReport) {
    this.#report = report;
  }

  get clientOptions(): Pick<TRClientOptions, "validate" | "onValidationWarning"> {
    return {
      validate: "warn",
      onValidationWarning: (warning) => this.#report.capture(this.#activeAccessor, warning),
    };
  }

  async login(client: TRClient, phoneNumber: string, pin: string): Promise<boolean> {
    this.#activeAccessor = "login";
    try {
      await client.login(phoneNumber, pin);
      this.#report.accessor("login");
      return true;
    } catch (error) {
      this.#report.failure("login", error instanceof Error ? error : new Error("unknown"));
      return false;
    }
  }

  async run(client: TRClient): Promise<TRClient | undefined> {
    await this.#readResources(client);

    const accountPairs = await this.#read(
      "accountPairs",
      () => client.accountPairs.get({}, readOptions()),
      (value) => ({ items: value.accounts.length }),
    );
    await this.#read("cash", () => client.cash.get({}, readOptions()), arrayCounts);
    await this.#read(
      "availableCash",
      () => client.availableCash.get({}, readOptions()),
      arrayCounts,
    );
    await this.#read("customerPermissions", () =>
      client.customerPermissions.get({}, readOptions()),
    );
    await this.#read("fincrimeBanner", () => client.fincrimeBanner.get({}, readOptions()));
    await this.#read("portfolioStatus", () => client.portfolioStatus.get({}, readOptions()));
    await this.#read(
      "timelineActionsV2",
      () => client.timelineActionsV2.get({}, readOptions()),
      (value) => ({ items: value.items?.length ?? 0 }),
    );
    await this.#read("tradingPerkConditionStatus", () =>
      client.tradingPerkConditionStatus.get({}, readOptions()),
    );
    const watchlists = await this.#read(
      "watchlists",
      () => client.watchlists.get({}, readOptions()),
      (value) => ({ items: value.watchlists.length }),
    );

    if (accountPairs) {
      await this.#read(
        "compactPortfolioByType",
        async () => {
          let count = 0;
          for (const account of accountPairs.accounts) {
            const value = await client.compactPortfolioByType.get(
              { secAccNo: account.securitiesAccountNumber },
              readOptions(),
            );
            count += value.categories.length;
          }
          return count;
        },
        itemCounts,
      );
      await this.#read(
        "savingsPlans",
        async () => {
          let count = 0;
          for (const account of accountPairs.accounts) {
            const value = await client.savingsPlans.get(
              { secAccNo: account.securitiesAccountNumber },
              readOptions(),
            );
            count += value.savingsPlans.length;
          }
          return count;
        },
        itemCounts,
      );
    } else {
      this.#report.skipped("compactPortfolioByType", "accountPairs-unavailable");
      this.#report.skipped("savingsPlans", "accountPairs-unavailable");
    }

    await this.#read(
      "orders.active",
      () => client.orders.get({ terminated: false }, readOptions()),
      (value) => ({ items: value.orders.length }),
    );
    await this.#read(
      "orders.terminated",
      () => client.orders.get({ terminated: true }, readOptions()),
      (value) => ({ items: value.orders.length }),
    );

    const firstTransaction = await this.#readTimeline(client);
    if (firstTransaction && UUID.test(firstTransaction.id)) {
      await this.#read("timelineDetailV2", () =>
        client.timelineDetailV2.get({ id: firstTransaction.id }, readOptions()),
      );
    } else {
      this.#report.skipped("timelineDetailV2", "timeline-item-unavailable");
    }

    if (watchlists) {
      await this.#read(
        "namedWatchlist",
        async () => {
          let count = 0;
          for (const watchlist of watchlists.watchlists) {
            const value = await client.namedWatchlist.get(
              { watchlistId: watchlist.id },
              readOptions(),
            );
            count += value.instruments?.length ?? 0;
          }
          return count;
        },
        itemCounts,
      );
    } else {
      this.#report.skipped("namedWatchlist", "watchlists-unavailable");
    }

    this.#activeAccessor = "TRAccount.sync";
    await auditTRAccount(client, this.#report);

    return this.#restoreAndRead(client);
  }

  async #readResources(client: TRClient): Promise<void> {
    await this.#read("accountInfo", () => client.accountInfo.get(readOptions()));
    await this.#read("personalDetails", () => client.personalDetails.get(readOptions()));
    await this.#read(
      "paymentMethods",
      () => client.paymentMethods.get(readOptions()),
      (value) => ({ items: value.availablePaymentMethods.length }),
    );
    await this.#read("taxResidency", () => client.taxResidency.get(readOptions()), arrayCounts);
    await this.#read("taxInformation", () => client.taxInformation.get(readOptions()));
    await this.#read("taxExemptionOrders", () => client.taxExemptionOrders.get(readOptions()));
    await this.#read(
      "allDocuments",
      () => client.allDocuments.get(readOptions()),
      (value) => ({ items: value.documents.length }),
    );
  }

  async #readTimeline(client: TRClient): Promise<TimelineTransaction | undefined> {
    let first: TimelineTransaction | undefined;
    const result = await this.#read(
      "timelineTransactions",
      async () => {
        const cursors = new Set<string>();
        let after: string | undefined;
        let items = 0;

        for (let pages = 1; pages <= MAX_TIMELINE_PAGES; pages += 1) {
          const page: TimelineTransactionsResponse = await client.timelineTransactions.get(
            after ? { after } : {},
            readOptions(),
          );
          first ??= page.items[0];
          items += page.items.length;
          const next = page.cursors.after ?? undefined;
          if (!next) return { pages, items };
          if (cursors.has(next)) throw new TRValidationError("Timeline returned a repeated cursor");
          cursors.add(next);
          after = next;
        }
        throw new TRValidationError("Timeline reached its page limit");
      },
      (counts) => counts,
    );
    return result ? first : undefined;
  }

  async #restoreAndRead(client: TRClient): Promise<TRClient | undefined> {
    const session = client.exportSession();
    if (!session) {
      this.#report.failure("restored.session", new TRValidationError("Session unavailable"));
      return undefined;
    }

    let restored: TRClient;
    try {
      restored = new TRClient({ ...this.clientOptions, session });
    } catch (error) {
      this.#report.failure(
        "restored.session",
        error instanceof Error ? error : new Error("unknown"),
      );
      return undefined;
    }
    await this.#read("restored.accountInfo", () => restored.accountInfo.get(readOptions()));
    await this.#read("restored.availableCash", () => restored.availableCash.get({}, readOptions()));
    return restored;
  }

  async #read<Value>(
    accessor: string,
    operation: () => Promise<Value>,
    counts?: Counts<Value>,
  ): Promise<Value | undefined> {
    this.#activeAccessor = accessor;
    try {
      const value = await operation();
      this.#report.accessor(accessor, counts?.(value));
      return value;
    } catch (error) {
      this.#report.failure(accessor, error instanceof Error ? error : new Error("unknown"));
      return undefined;
    }
  }
}

function readOptions() {
  return { timeoutMs: READ_TIMEOUT_MS };
}

function arrayCounts(value: readonly unknown[]): AccessorCounts {
  return { items: value.length };
}

function itemCounts(value: number): AccessorCounts {
  return { items: value };
}
