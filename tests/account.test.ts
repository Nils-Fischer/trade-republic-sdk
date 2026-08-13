import { describe, expect, expectTypeOf, test, vi } from "vite-plus/test";
import {
  TRAbortError,
  TRAuthError,
  TRClient,
  TRHttpError,
  TRTimeoutError,
  TRValidationError,
  type AccountInfo,
  type Fetch,
  type ResourceAccessor,
  type TaxInformation,
  type TimelineTransaction,
  type TopicRequest,
} from "../src/index.ts";
import { resourceNames } from "../src/resources.ts";
import { FakeClock, FakeSocket } from "../src/testing.ts";

const startTime = 1_000_000;
const taxInformation: TaxInformation = {
  syncTimestamp: "2026-01-01T00:00:00.000Z",
  fsaApplied: 1,
  fsaUsed: 2,
  fsaRemaining: 3,
  lossSetOffStocks: 4,
  lossSetOffOthers: 5,
  lossSetOffWithholdingTax: 6,
};

function accountInfoWithAddressAddendum(): object {
  const experience = { tradeCount: 0, level: "NONE", showsRiskWarning: false };
  const account = { iban: "DE00000000000000000000", bic: null };
  const enhancedAccount = { ...account, bankName: "Example Bank", logoUrl: null };
  return {
    phoneNumber: "+49000000000",
    jurisdiction: "DE",
    name: { first: "Example", last: "Person" },
    email: { address: "example.invalid@example.test", verified: true },
    duplicateTradingEmail: null,
    postalAddress: {
      street: "Example Street",
      houseNo: "1",
      addressAddendum: null,
      zip: "00000",
      city: "Example City",
      country: "DE",
    },
    birthdate: "1970-01-01",
    birthplace: { birthplace: "Example City", birthcountry: "DE" },
    mainNationality: "DE",
    additionalNationalities: [],
    mainTaxResidency: { tin: "00000000000", countryCode: "DE" },
    usTaxResidency: false,
    additionalTaxResidencies: [],
    taxInformationSyncTimestamp: 0,
    taxExemptionOrder: {
      minimum: 0,
      maximum: 0,
      current: 0,
      applied: 0,
      syncStatus: "SYNCED",
      validFrom: "2026-01-01",
      validUntil: null,
    },
    registrationAccount: false,
    cashAccount: enhancedAccount,
    referenceAccount: account,
    referenceAccountV2: enhancedAccount,
    referenceAccountList: [enhancedAccount],
    securitiesAccountNumber: "SEC-EXAMPLE",
    experience: {
      stock: experience,
      fund: experience,
      derivative: experience,
      crypto: experience,
      bond: { level: "NONE", showsRiskWarning: false },
    },
    referralDetails: null,
    supportDocuments: {
      accountClosing: "https://example.test/account-closing",
      imprint: "https://example.test/imprint",
      addressConfirmation: "https://example.test/address-confirmation",
    },
    tinFormat: { placeholder: "00000000000", keyboardLayout: "numeric" },
    personId: "00000000-0000-4000-8000-000000000000",
  };
}

function base64Url(value: object): string {
  return btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function jwt(iat: number, exp: number): string {
  return `${base64Url({ alg: "ES256" })}.${base64Url({ iat, exp })}.signature`;
}

function savedSession(): string {
  return JSON.stringify({
    version: 1,
    cookies: [
      `tr_session=${jwt(1_000, 1_300)}; Path=/; Secure`,
      `tr_refresh=${jwt(1_000, 87_400)}; Path=/; Secure`,
      "mapper-lb-affinity=mapper; Path=/; Secure",
    ],
  });
}

function response(body: unknown, status = 200, cookies: readonly string[] = []): Response {
  const headers: [string, string][] = cookies.map((cookie) => ["set-cookie", cookie]);
  headers.push(["content-type", "application/json"]);
  return new Response(JSON.stringify(body), { status, headers });
}

function requestUrl(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function transaction(id: string, timestamp: string): TimelineTransaction {
  const amount = { currency: "EUR", value: 1, fractionDigits: 2 };
  return {
    id,
    timestamp,
    title: "Sanitized transaction",
    icon: "timeline",
    badge: null,
    amount,
    subAmount: null,
    status: "EXECUTED",
    action: { type: "timelineDetail", payload: id },
    eventType: "CASH",
    cashAccountNumber: null,
    hidden: false,
    deleted: false,
  };
}

function snapshot(requestId: number, value: unknown): string {
  return `${requestId} A ${JSON.stringify(value)}`;
}

function subscriptions(socket: FakeSocket): Array<{ id: number; payload: unknown }> {
  return socket.sent
    .filter((line) => line.startsWith("sub "))
    .map((line) => {
      const [, id, payload] = line.split(" ", 3);
      return { id: Number(id), payload: JSON.parse(payload!) as unknown };
    });
}

async function flush(): Promise<void> {
  for (let count = 0; count < 12; count += 1) await Promise.resolve();
}

async function accept(socket: FakeSocket): Promise<void> {
  socket.open();
  socket.receive("connected");
  await flush();
}

function authenticatedClient(options: ConstructorParameters<typeof TRClient>[0] = {}): TRClient {
  return new TRClient({
    session: savedSession(),
    clock: new FakeClock(startTime),
    validate: "throw",
    ...options,
  });
}

describe("account resources", () => {
  test("derives typed Get-only accessors from the resource registry", () => {
    const client = authenticatedClient({ fetch: vi.fn() as Fetch });

    resourceNames.forEach((name) => {
      expect(client[name]).toEqual({ get: expect.any(Function) });
      expect("watch" in client[name]).toBe(false);
    });
    expectTypeOf(client.accountInfo).toEqualTypeOf<ResourceAccessor<AccountInfo>>();
    expectTypeOf<{ unexpected: true }>().not.toExtend<TopicRequest<"accountPairs">>();
    expect(() => client.accountPairs.get({ unexpected: true } as never)).toThrow(TRValidationError);
  });

  test("fails secured HTTP and Topic reads locally when the Session is absent", async () => {
    const fetch = vi.fn() as Fetch;
    const socket = vi.fn(() => new FakeSocket());
    const client = new TRClient({ fetch, socket });

    await expect(client.taxInformation.get()).rejects.toBeInstanceOf(TRAuthError);
    await expect(client.accountPairs.get({})).rejects.toBeInstanceOf(TRAuthError);
    expect(fetch).not.toHaveBeenCalled();
    expect(socket).not.toHaveBeenCalled();
  });

  test("sends the method, path, shared headers, and Session cookie pairs", async () => {
    const fetch = vi.fn(async () => response(taxInformation)) as Fetch;
    const client = authenticatedClient({ fetch });

    await expect(client.taxInformation.get()).resolves.toEqual(taxInformation);
    const [url, options] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://api.traderepublic.com/api/v1/taxes/information");
    expect(options).toMatchObject({ method: "GET", credentials: "include" });
    expect(options?.headers).toMatchObject({
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en",
      "Content-Type": "application/json",
      "X-TR-App-Version": expect.any(String),
      "X-TR-Device-Info": expect.any(String),
      "X-TR-Platform": "web-pro",
      Cookie: expect.stringMatching(/^tr_session=.*; tr_refresh=.*; mapper-lb-affinity=mapper$/),
    });
  });

  test("accepts the observed optional postal address addendum", async () => {
    const accountInfo = accountInfoWithAddressAddendum();
    const client = authenticatedClient({
      fetch: vi.fn(async () => response(accountInfo)) as Fetch,
    });

    await expect(client.accountInfo.get()).resolves.toEqual(accountInfo);
  });

  test("accepts the observed numeric document metadata version", async () => {
    const allDocuments = {
      documents: [
        {
          id: "document-example",
          title: "Example document",
          url: "https://example.test/document",
          description: "Sanitized document metadata",
          contentType: "application/pdf",
          version: 1,
        },
      ],
    };
    const client = authenticatedClient({
      fetch: vi.fn(async () => response(allDocuments)) as Fetch,
    });

    await expect(client.allDocuments.get()).resolves.toEqual(allDocuments);
  });

  test("applies off, warn, and throw validation policies, including additive drift", async () => {
    const changed = { ...taxInformation, serverAddition: true };
    const warnings: TRValidationError[] = [];
    const warn = authenticatedClient({
      fetch: vi.fn(async () => response(changed)) as Fetch,
      validate: "warn",
      onValidationWarning: (warning) => warnings.push(warning),
    });
    await expect(warn.taxInformation.get()).resolves.toEqual(changed);
    expect(warnings[0]?.message).toContain('Resource "taxInformation"');

    const strict = authenticatedClient({ fetch: vi.fn(async () => response(changed)) as Fetch });
    await expect(strict.taxInformation.get()).rejects.toBeInstanceOf(TRValidationError);

    const off = authenticatedClient({
      fetch: vi.fn(async () => response(changed)) as Fetch,
      validate: "off",
      onValidationWarning: () => {
        throw new Error("Validation must be off");
      },
    });
    await expect(off.taxInformation.get()).resolves.toEqual(changed);
  });

  test("shares one reactive Refresh across concurrent 401 responses", async () => {
    let resolveRefresh: ((value: Response) => void) | undefined;
    const pendingRefresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    let resourceReads = 0;
    let refreshes = 0;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/auth/web/session")) {
        refreshes += 1;
        return pendingRefresh;
      }
      resourceReads += 1;
      return resourceReads <= 2 ? response({}, 401) : response(taxInformation);
    }) as Fetch;
    const client = authenticatedClient({ fetch });

    const first = client.taxInformation.get();
    const second = client.taxInformation.get();
    await flush();
    expect(refreshes).toBe(1);
    resolveRefresh?.(response(undefined, 200, [`tr_session=${jwt(1_240, 1_540)}; Path=/; Secure`]));

    await expect(Promise.all([first, second])).resolves.toEqual([taxInformation, taxInformation]);
    expect(resourceReads).toBe(4);
  });

  test("retries authentication once, then marks the Session rejected", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) =>
      requestUrl(input).endsWith("/api/v1/auth/web/session")
        ? response(undefined, 200, [`tr_session=${jwt(1_240, 1_540)}; Path=/; Secure`])
        : response({}, 403),
    ) as Fetch;
    const client = authenticatedClient({ fetch });

    await expect(client.taxInformation.get()).rejects.toBeInstanceOf(TRAuthError);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(client.sessionValidity).toBe("rejected");
  });

  test("can time out while waiting for a shared reactive Refresh", async () => {
    let resolveRefresh: ((value: Response) => void) | undefined;
    const pendingRefresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const clock = new FakeClock(startTime);
    let resourceReads = 0;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      if (requestUrl(input).endsWith("/api/v1/auth/web/session")) return pendingRefresh;
      resourceReads += 1;
      return response({}, 401);
    }) as Fetch;
    const client = authenticatedClient({ clock, fetch });
    const result = client.taxInformation.get({ timeoutMs: 10 });
    await flush();

    clock.advanceBy(10);
    await expect(result).rejects.toBeInstanceOf(TRTimeoutError);
    expect(resourceReads).toBe(1);

    resolveRefresh?.(response(undefined, 200, [`tr_session=${jwt(1_240, 1_540)}; Path=/; Secure`]));
    await flush();
  });

  test("keeps HTTP and Topic reads independent", async () => {
    const socket = new FakeSocket();
    const client = authenticatedClient({
      fetch: vi.fn(async () => response(taxInformation)) as Fetch,
      socket: () => socket,
    });
    const rest = client.taxInformation.get();
    const topic = client.availableCash.get({});
    await accept(socket);
    const [{ id }] = subscriptions(socket);
    socket.receive(snapshot(id, [{ accountNumber: "cash", currencyId: "EUR", amount: 1 }]));

    await expect(rest).resolves.toEqual(taxInformation);
    await expect(topic).resolves.toHaveLength(1);
  });

  test("uses accountPairs securities account numbers in dependent Topic requests", async () => {
    const socket = new FakeSocket();
    const client = authenticatedClient({ socket: () => socket });
    const pairs = client.accountPairs.get({});
    await accept(socket);
    const [{ id }] = subscriptions(socket);
    socket.receive(
      snapshot(id, {
        authAccountId: "0194b436-5e9d-4000-8000-000000000001",
        accounts: [
          {
            securitiesAccountNumber: "SEC-1",
            cashAccountNumber: "CASH-1",
            productType: "BROKERAGE",
            currency: "EUR",
            accountAccessType: "FULL",
          },
        ],
      }),
    );
    const account = (await pairs).accounts[0]!;
    const portfolio = client.compactPortfolioByType.get({
      secAccNo: account.securitiesAccountNumber,
    });
    await flush();
    let request = subscriptions(socket).at(-1)!;
    expect(request.payload).toEqual({ type: "compactPortfolioByType", secAccNo: "SEC-1" });
    socket.receive(snapshot(request.id, { categories: [] }));
    await expect(portfolio).resolves.toEqual({ categories: [] });

    const savingsPlans = client.savingsPlans.get({
      secAccNo: account.securitiesAccountNumber,
    });
    await flush();
    request = subscriptions(socket).at(-1)!;
    expect(request.payload).toEqual({ type: "savingsPlans", secAccNo: "SEC-1" });
    socket.receive(snapshot(request.id, { savingsPlans: [] }));
    await expect(savingsPlans).resolves.toEqual({ savingsPlans: [] });
  });

  test("accepts the observed portfolio DMA requirement", async () => {
    const socket = new FakeSocket();
    const client = authenticatedClient({ socket: () => socket });
    const result = client.portfolioStatus.get({});
    await accept(socket);
    const [{ id }] = subscriptions(socket);
    const status = {
      status: "ACTIVE",
      hasInvested: true,
      firstCashReceived: true,
      firstPortfolioUsage: true,
      bitgoTermsRequired: false,
      proprietaryTradingTermsRequired: false,
      dmaTermsRequired: false,
      reKycRequired: [],
      sourceOfFundsRequired: false,
      tradingBlockedOnIdentification: null,
      bondsTermsRequired: false,
      privateFundTermsRequired: false,
    };
    socket.receive(snapshot(id, status));

    await expect(result).resolves.toEqual(status);
  });

  test("accepts the observed timeline transaction avatar", async () => {
    const socket = new FakeSocket();
    const client = authenticatedClient({ socket: () => socket });
    const result = client.timelineTransactions.get({});
    await accept(socket);
    const [{ id }] = subscriptions(socket);
    const item = {
      ...transaction("transaction-1", "2026-01-01T00:00:00.000Z"),
      avatar: {
        asset: "timeline",
        badge: { asset: "timeline-badge", type: "icon" },
      },
    };
    const page = { items: [item], cursors: {} };
    socket.receive(snapshot(id, page));

    await expect(result).resolves.toEqual(page);
  });

  test("accepts observed structured timeline detail sections", async () => {
    const socket = new FakeSocket();
    const client = authenticatedClient({ socket: () => socket });
    const result = client.timelineDetailV2.get({
      id: "0194b436-5e9d-4000-8000-000000000001",
    });
    await accept(socket);
    const [{ id }] = subscriptions(socket);
    const detail = {
      id: "sanitized-timeline-detail",
      sections: [
        {
          title: "Sanitized header",
          data: {
            icon: { asset: "timeline", badge: null },
            timestamp: "2026-01-01T00:00:00.000Z",
            status: "EXECUTED",
          },
          type: "header",
        },
        {
          data: [{ title: "Sanitized row", detail: {}, style: "plain" }],
          type: "table",
        },
        {
          title: "Sanitized documents",
          data: [
            {
              title: "Sanitized document",
              action: {
                payload: { path: "/sanitized", shareable: false, title: "Sanitized document" },
                type: "authenticatedBrowserModal",
              },
              id: "sanitized-document",
              postboxType: "DOCUMENT",
            },
            {
              title: "Sanitized legacy document",
              action: { payload: "/sanitized", type: "browserModal" },
              id: "sanitized-legacy-document",
              postboxType: "DOCUMENT",
            },
          ],
          type: "documents",
        },
      ],
    };
    socket.receive(snapshot(id, detail));

    await expect(result).resolves.toEqual(detail);
  });

  test("accepts observed named watchlist instrument timestamp variants", async () => {
    const socket = new FakeSocket();
    const client = authenticatedClient({ socket: () => socket });
    const result = client.namedWatchlist.get({ watchlistId: "favorites" });
    await accept(socket);
    const [{ id }] = subscriptions(socket);
    const watchlist = {
      id: "favorites",
      cover: { small: [], medium: [], large: [] },
      size: 1,
      title: "Sanitized watchlist",
      description: null,
      description_short: null,
      created_at: null,
      updated_at: null,
      instruments: [
        {
          instrument_id: "SANITIZED",
          created_at: [2026, 1, 1],
          holding_percent: null,
        },
      ],
      following: false,
      following_allowed: false,
      editing_allowed: true,
      investable_isin: null,
      sharing_allowed: false,
      jurisdiction_mismatch: false,
      share_text: null,
    };
    socket.receive(snapshot(id, watchlist));

    await expect(result).resolves.toEqual(watchlist);
  });

  test("keeps HTTP errors, invalid JSON, cancellation, and timeout distinct", async () => {
    const http = authenticatedClient({ fetch: vi.fn(async () => response({}, 500)) as Fetch });
    await expect(http.taxInformation.get()).rejects.toBeInstanceOf(TRHttpError);

    const invalid = authenticatedClient({
      fetch: vi.fn(async () => new Response("not-json")) as Fetch,
    });
    await expect(invalid.taxInformation.get()).rejects.toBeInstanceOf(TRValidationError);

    const controller = new AbortController();
    const aborted = authenticatedClient({
      fetch: vi.fn(
        (_input, options) =>
          new Promise<Response>((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
          }),
      ) as Fetch,
    }).taxInformation.get({ signal: controller.signal });
    controller.abort("stop");
    await expect(aborted).rejects.toBeInstanceOf(TRAbortError);

    const clock = new FakeClock(startTime);
    const timedOut = authenticatedClient({
      clock,
      fetch: vi.fn(
        (_input, options) =>
          new Promise<Response>((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
          }),
      ) as Fetch,
    }).taxInformation.get({ timeoutMs: 10 });
    clock.advanceBy(10);
    await expect(timedOut).rejects.toBeInstanceOf(TRTimeoutError);
  });
});

describe("timeline pagination", () => {
  test("handles empty pages, bounds, and duplicate transaction IDs", async () => {
    const socket = new FakeSocket();
    const client = authenticatedClient({ socket: () => socket });
    const result = client.getTimelineTransactions({
      from: new Date("2026-01-02T00:00:00.000Z"),
      to: new Date("2026-01-05T00:00:00.000Z"),
    });
    await accept(socket);
    let request = subscriptions(socket).at(-1)!;
    socket.receive(snapshot(request.id, { items: [], cursors: { after: "page-2" } }));
    await flush();
    request = subscriptions(socket).at(-1)!;
    socket.receive(
      snapshot(request.id, {
        items: [
          transaction("new", "2026-01-06T00:00:00.000Z"),
          transaction("keep", "2026-01-04T00:00:00.000Z"),
          transaction("keep", "2026-01-04T00:00:00.000Z"),
          transaction("old", "2026-01-01T00:00:00.000Z"),
        ],
        cursors: { after: "unused" },
      }),
    );

    await expect(result).resolves.toEqual([transaction("keep", "2026-01-04T00:00:00.000Z")]);
  });

  test("rejects repeated cursors and out-of-order pages", async () => {
    const repeatedSocket = new FakeSocket();
    const repeatedClient = authenticatedClient({ socket: () => repeatedSocket });
    const repeated = repeatedClient.getTimelineTransactions({
      from: new Date("2020-01-01T00:00:00.000Z"),
      to: new Date("2030-01-01T00:00:00.000Z"),
    });
    await accept(repeatedSocket);
    let request = subscriptions(repeatedSocket).at(-1)!;
    repeatedSocket.receive(snapshot(request.id, { items: [], cursors: { after: "same" } }));
    await flush();
    request = subscriptions(repeatedSocket).at(-1)!;
    repeatedSocket.receive(snapshot(request.id, { items: [], cursors: { after: "same" } }));
    await expect(repeated).rejects.toThrow("repeated cursor");

    const orderSocket = new FakeSocket();
    const orderClient = authenticatedClient({ socket: () => orderSocket });
    const unordered = orderClient.getTimelineTransactions({
      from: new Date("2020-01-01T00:00:00.000Z"),
      to: new Date("2030-01-01T00:00:00.000Z"),
    });
    await accept(orderSocket);
    request = subscriptions(orderSocket).at(-1)!;
    orderSocket.receive(
      snapshot(request.id, {
        items: [
          transaction("older", "2026-01-02T00:00:00.000Z"),
          transaction("newer", "2026-01-03T00:00:00.000Z"),
        ],
        cursors: {},
      }),
    );
    await expect(unordered).rejects.toThrow("newest-first");
  });

  test("observes cancellation, per-page timeout, and maxPages", async () => {
    const abortSocket = new FakeSocket();
    const abortClient = authenticatedClient({ socket: () => abortSocket });
    const controller = new AbortController();
    const aborted = abortClient.getTimelineTransactions({
      from: new Date("2020-01-01T00:00:00.000Z"),
      signal: controller.signal,
    });
    controller.abort("stop");
    await expect(aborted).rejects.toBeInstanceOf(TRAbortError);

    const clock = new FakeClock(startTime);
    const timeoutSocket = new FakeSocket(clock);
    const timeoutClient = authenticatedClient({ clock, socket: () => timeoutSocket });
    const timedOut = timeoutClient.getTimelineTransactions({
      from: new Date(0),
      pageTimeoutMs: 10,
    });
    await accept(timeoutSocket);
    clock.advanceBy(10);
    await expect(timedOut).rejects.toBeInstanceOf(TRTimeoutError);

    const defaultClock = new FakeClock(startTime);
    const defaultTimeoutSocket = new FakeSocket(defaultClock);
    const defaultTimeoutClient = authenticatedClient({
      clock: defaultClock,
      socket: () => defaultTimeoutSocket,
    });
    const defaultTimedOut = defaultTimeoutClient.getTimelineTransactions({ from: new Date(0) });
    await accept(defaultTimeoutSocket);
    for (let delay = 2_500; delay < 15_000; delay += 2_500) {
      defaultTimeoutSocket.receive(`echo ${startTime + delay}`, delay);
    }
    defaultClock.advanceBy(14_999);
    await flush();
    defaultClock.advanceBy(1);
    await expect(defaultTimedOut).rejects.toBeInstanceOf(TRTimeoutError);

    const limitSocket = new FakeSocket();
    const limitClient = authenticatedClient({ socket: () => limitSocket });
    const limited = limitClient.getTimelineTransactions({
      from: new Date(0),
      maxPages: 1,
    });
    await accept(limitSocket);
    const request = subscriptions(limitSocket).at(-1)!;
    limitSocket.receive(snapshot(request.id, { items: [], cursors: { after: "more" } }));
    await expect(limited).rejects.toThrow("maxPages");
    await expect(
      limitClient.getTimelineTransactions({ from: new Date(0), maxPages: 0 }),
    ).rejects.toThrow("positive integer");
  });
});
