import { describe, expect, test, vi } from "vite-plus/test";
import {
  TRAbortError,
  TRAccount,
  TRClient,
  TRTopicError,
  TRValidationError,
  type Fetch,
  type TimelineTransaction,
} from "../src/index.ts";
import { FakeClock, FakeSocket } from "../src/testing.ts";

const now = Date.parse("2026-01-10T00:00:00.000Z");
const from = new Date("2026-01-01T00:00:00.000Z");

function base64Url<Value>(value: Value): string {
  return btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function savedSession(): string {
  const token = `${base64Url({ alg: "ES256" })}.${base64Url({ iat: 1_768_003_000, exp: 1_768_003_500 })}.signature`;
  return JSON.stringify({
    version: 1,
    cookies: [`tr_session=${token}; Path=/; Secure`, `tr_refresh=${token}; Path=/; Secure`],
  });
}

function documentResponse(version = 1): Response {
  return Response.json({
    documents: [
      {
        id: "document-1",
        title: "Document",
        description: "Metadata",
        contentType: "application/pdf",
        version,
        url: "https://example.test/document.pdf",
      },
    ],
  });
}

function transaction(id: string, timestamp: string, title = "Transaction"): TimelineTransaction {
  return {
    id,
    timestamp,
    title,
    icon: "timeline",
    badge: null,
    subtitle: "Counterparty",
    amount: { currency: "EUR", value: 12.34, fractionDigits: 2 },
    subAmount: { currency: "EUR", value: -0.5, fractionDigits: 2 },
    status: "EXECUTED",
    action: { type: "timelineDetail", payload: id },
    eventType: "CASH",
    cashAccountNumber: "cash-1",
    hidden: false,
    deleted: false,
  };
}

function snapshot<Value>(requestId: number, value: Value): string {
  return `${requestId} A ${JSON.stringify(value)}`;
}

interface Subscription {
  readonly id: number;
  readonly payload: { readonly type: string };
}

function subscriptions(socket: FakeSocket): Subscription[] {
  return socket.sent
    .filter((line) => line.startsWith("sub "))
    .map((line) => {
      const [, id, payload] = line.split(" ", 3);
      return { id: Number(id), payload: JSON.parse(payload!) };
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

function setup(fetch: Fetch = vi.fn<Fetch>(async () => documentResponse())) {
  const clock = new FakeClock(now);
  const socket = new FakeSocket(clock);
  const client = new TRClient({
    clock,
    fetch,
    socket: () => socket,
    session: savedSession(),
    validate: "throw",
  });
  const account = new TRAccount(client, { transactionWindow: { from } });
  return { account, clock, fetch, socket };
}

function initialRequests(socket: FakeSocket) {
  const requests = subscriptions(socket);
  const cash = requests.find((request) => request.payload.type === "cash")!;
  const available = requests.find((request) => request.payload.type === "availableCash")!;
  const timeline = requests.filter((request) => request.payload.type === "timelineTransactions");
  return { cash, available, timeline };
}

async function completeInitialSync(
  account: TRAccount,
  socket: FakeSocket,
  watchItems: readonly TimelineTransaction[] = [],
  historyItems: readonly TimelineTransaction[] = [],
): Promise<void> {
  const syncing = account.sync();
  await accept(socket);
  const { cash, available, timeline } = initialRequests(socket);
  expect(
    subscriptions(socket)
      .slice(0, 3)
      .map((request) => request.payload.type)
      .sort(),
  ).toEqual(["availableCash", "cash", "timelineTransactions"]);
  expect(subscriptions(socket)).toHaveLength(3);
  socket.receive(snapshot(cash.id, [{ accountNumber: "cash-1", currencyId: "EUR", amount: 100 }]));
  socket.receive(
    snapshot(available.id, [{ accountNumber: "cash-1", currencyId: "EUR", amount: 80 }]),
  );
  socket.receive(snapshot(timeline[0]!.id, { items: watchItems, cursors: {} }));
  await flush();
  const history = subscriptions(socket).filter(
    (request) => request.payload.type === "timelineTransactions",
  )[1]!;
  socket.receive(snapshot(history.id, { items: historyItems, cursors: {} }));
  await syncing;
}

describe("TRAccount", () => {
  test("constructs without I/O and validates its Window", () => {
    const fetch = vi.fn<Fetch>();
    const socket = vi.fn(() => new FakeSocket());
    const client = new TRClient({ fetch, socket, session: savedSession() });

    const account = new TRAccount(client, { transactionWindow: { from } });
    const initial = { value: undefined, freshness: "empty" };
    expect(account.cash.getSnapshot()).toEqual(initial);
    expect(account.transactions.getSnapshot()).toEqual(initial);
    expect(account.documents.getSnapshot()).toEqual(initial);
    expect(fetch).not.toHaveBeenCalled();
    expect(socket).not.toHaveBeenCalled();
    expect(
      () => new TRAccount(client, { transactionWindow: { from: new Date(Number.NaN) } }),
    ).toThrow(TRValidationError);
  });

  test("syncs independent immutable slices and lets Watch values win over history", async () => {
    const { account, socket } = setup();
    const older = transaction("same", "2026-01-05T00:00:00.000Z", "History");
    const newer = transaction("same", "2026-01-05T00:00:00.000Z", "Watch");

    await completeInitialSync(account, socket, [newer], [older]);

    expect(account.cash.getSnapshot()).toMatchObject({
      freshness: "fresh",
      value: {
        balances: [{ accountNumber: "cash-1", currency: "EUR", amount: 100 }],
        available: [{ accountNumber: "cash-1", currency: "EUR", amount: 80 }],
      },
    });
    expect(account.transactions.getSnapshot()).toMatchObject({
      freshness: "fresh",
      materializedRange: {
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-01-10T00:00:00.000Z",
      },
      value: [
        {
          id: "same",
          description: "Watch",
          kind: "cash",
          amount: { currency: "EUR", minorUnits: 1234, fractionDigits: 2 },
          subAmount: { currency: "EUR", minorUnits: -50, fractionDigits: 2 },
        },
      ],
    });
    expect(account.documents.getSnapshot()).toMatchObject({
      freshness: "fresh",
      value: [{ id: "document-1", contentType: "application/pdf", version: 1 }],
    });
    expect(Object.isFrozen(account.cash.getSnapshot().value?.balances)).toBe(true);
    expect(Object.isFrozen(account.transactions.getSnapshot().value?.[0]?.amount)).toBe(true);
  });

  test("keeps Snapshot identity for repeats, reads covered ranges locally, and stops", async () => {
    const { account, socket } = setup();
    const item = transaction("transaction-1", "2026-01-05T00:00:00.000Z");
    await completeInitialSync(account, socket, [item], []);
    const { timeline } = initialRequests(socket);
    const before = account.transactions.getSnapshot();
    const listener = vi.fn();
    const unsubscribe = account.transactions.subscribe(listener);

    await expect(
      account.transactions.read({
        from: new Date("2026-01-02T00:00:00.000Z"),
        to: new Date("2026-01-09T00:00:00.000Z"),
      }),
    ).resolves.toHaveLength(1);
    expect(subscriptions(socket)).toHaveLength(4);
    await flush();
    socket.receive(snapshot(timeline[0]!.id, { items: [item], cursors: {} }));
    await flush();
    expect(account.transactions.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
    unsubscribe();
    account.stop();
    account.stop();
    expect(account.cash.getSnapshot().freshness).toBe("stale");
    expect(account.transactions.getSnapshot()).toMatchObject({
      freshness: "stale",
      value: [{ id: item.id }],
    });
    expect(account.documents.getSnapshot().freshness).toBe("stale");
    expect(socket.sent.filter((line) => line.startsWith("unsub "))).toHaveLength(4);
  });

  test("shares concurrent Sync and uses one-shot cash reads on the next Sync", async () => {
    const { account, socket } = setup();
    const first = account.sync();
    expect(account.sync()).toBe(first);
    await accept(socket);
    const requests = initialRequests(socket);
    socket.receive(snapshot(requests.cash.id, []));
    socket.receive(snapshot(requests.available.id, []));
    socket.receive(snapshot(requests.timeline[0]!.id, { items: [], cursors: {} }));
    await flush();
    const history = subscriptions(socket).filter(
      (request) => request.payload.type === "timelineTransactions",
    )[1]!;
    socket.receive(snapshot(history.id, { items: [], cursors: {} }));
    await first;
    expect(account.transactions.getSnapshot()).toMatchObject({
      value: [],
      materializedRange: {
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-01-10T00:00:00.000Z",
      },
    });

    const repeated = account.sync();
    await flush();
    const added = subscriptions(socket).slice(4);
    expect(added.map((request) => request.payload.type)).toEqual([
      "cash",
      "availableCash",
      "timelineTransactions",
    ]);
    for (const request of added) {
      const value =
        request.payload.type === "timelineTransactions" ? { items: [], cursors: {} } : [];
      socket.receive(snapshot(request.id, value));
    }
    await repeated;
    expect(subscriptions(socket)).toHaveLength(7);
  });

  test("aborts work and marks only unfinished first-Sync slices", async () => {
    const fetch = vi.fn<Fetch>(
      (_input, options) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
        }),
    );
    const { account, socket } = setup(fetch);
    const controller = new AbortController();
    const syncing = account.sync({ signal: controller.signal });
    await accept(socket);
    controller.abort("cancel");

    await expect(syncing).rejects.toBeInstanceOf(TRAbortError);
    expect(account.cash.getSnapshot().freshness).toBe("empty");
    expect(account.cash.getSnapshot().error).toBeInstanceOf(TRAbortError);
    expect(account.transactions.getSnapshot().freshness).toBe("empty");
    expect(account.transactions.getSnapshot().error).toBeInstanceOf(TRAbortError);
    expect(account.documents.getSnapshot().freshness).toBe("empty");
    expect(account.documents.getSnapshot().error).toBeInstanceOf(TRAbortError);
    expect(socket.sent.filter((line) => line.startsWith("unsub "))).toHaveLength(3);
  });

  test("publishes successful slices when cash validation fails", async () => {
    const { account, socket } = setup();
    const syncing = account.sync();
    await accept(socket);
    const { cash, available, timeline } = initialRequests(socket);
    const duplicate = { accountNumber: "cash-1", currencyId: "EUR", amount: 1 };
    socket.receive(snapshot(cash.id, [duplicate, duplicate]));
    socket.receive(snapshot(available.id, []));
    socket.receive(snapshot(timeline[0]!.id, { items: [], cursors: {} }));
    await flush();
    const history = subscriptions(socket).filter(
      (request) => request.payload.type === "timelineTransactions",
    )[1]!;
    socket.receive(snapshot(history.id, { items: [], cursors: {} }));

    await expect(syncing).rejects.toThrow("Duplicate cash balance");
    expect(account.cash.getSnapshot().freshness).toBe("empty");
    expect(account.cash.getSnapshot().error).toBeInstanceOf(TRValidationError);
    expect(account.transactions.getSnapshot().freshness).toBe("fresh");
    expect(account.documents.getSnapshot().freshness).toBe("fresh");
  });

  test("keeps a failed first transaction read empty and validates ranges before I/O", async () => {
    const { account, socket } = setup();
    const unsafe = transaction("unsafe", "2026-01-05T00:00:00.000Z");
    unsafe.amount.value = Number.MAX_SAFE_INTEGER;
    const syncing = account.sync();
    await accept(socket);
    const { cash, available, timeline } = initialRequests(socket);
    socket.receive(snapshot(cash.id, []));
    socket.receive(snapshot(available.id, []));
    socket.receive(snapshot(timeline[0]!.id, { items: [], cursors: {} }));
    await flush();
    const history = subscriptions(socket).filter(
      (request) => request.payload.type === "timelineTransactions",
    )[1]!;
    socket.receive(snapshot(history.id, { items: [unsafe], cursors: {} }));

    await expect(syncing).rejects.toThrow("unsafe minor units");
    expect(account.transactions.getSnapshot().value).toBeUndefined();
    expect(account.transactions.getSnapshot().freshness).toBe("empty");
    const subscriptionCount = subscriptions(socket).length;
    await expect(
      account.transactions.read({
        from: new Date("2026-01-05T00:00:00.000Z"),
        to: new Date("2026-01-04T00:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(TRValidationError);
    expect(subscriptions(socket)).toHaveLength(subscriptionCount);
  });

  test("marks only Transactions stale after a terminal timeline Watch error", async () => {
    const { account, socket } = setup();
    await completeInitialSync(account, socket);
    const { timeline } = initialRequests(socket);

    socket.receive(
      `${timeline[0]!.id} E ${JSON.stringify({
        errors: [{ errorCode: "INVALID_REQUEST", errorMessage: "Sanitized failure" }],
      })}`,
    );
    await flush();

    expect(account.transactions.getSnapshot().freshness).toBe("stale");
    expect(account.transactions.getSnapshot().error).toBeInstanceOf(TRTopicError);
    expect(account.cash.getSnapshot().freshness).toBe("fresh");
    expect(account.documents.getSnapshot().freshness).toBe("fresh");
  });

  test("returns out-of-Window reads without retaining their Transactions", async () => {
    const { account, socket } = setup();
    await completeInitialSync(account, socket);
    const reading = account.transactions.read({
      from: new Date("2025-12-20T00:00:00.000Z"),
      to: new Date("2026-01-06T00:00:00.000Z"),
    });
    await flush();
    const request = subscriptions(socket).at(-1)!;
    socket.receive(
      snapshot(request.id, {
        items: [
          transaction("inside", "2026-01-05T00:00:00.000Z"),
          transaction("outside", "2025-12-25T00:00:00.000Z"),
        ],
        cursors: {},
      }),
    );

    await expect(reading).resolves.toMatchObject([{ id: "inside" }, { id: "outside" }]);
    expect(account.transactions.getSnapshot().value).toMatchObject([{ id: "inside" }]);
    expect(account.transactions.getSnapshot().materializedRange).toEqual({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-10T00:00:00.000Z",
    });
  });

  test("notifies only Cash once per semantic change and sorts both balance arrays", async () => {
    const { account, socket } = setup();
    await completeInitialSync(account, socket);
    const { cash, available } = initialRequests(socket);
    const cashListener = vi.fn();
    const transactionListener = vi.fn();
    const documentListener = vi.fn();
    account.cash.subscribe(cashListener);
    account.transactions.subscribe(transactionListener);
    account.documents.subscribe(documentListener);

    const balances = [
      { accountNumber: "cash-2", currencyId: "USD", amount: 2 },
      { accountNumber: "cash-1", currencyId: "EUR", amount: 1 },
    ];
    socket.receive(snapshot(cash.id, balances));
    await flush();
    const afterCash = account.cash.getSnapshot();
    expect(afterCash.value?.balances).toMatchObject([
      { accountNumber: "cash-1", currency: "EUR" },
      { accountNumber: "cash-2", currency: "USD" },
    ]);
    expect(cashListener).toHaveBeenCalledTimes(1);
    expect(transactionListener).not.toHaveBeenCalled();
    expect(documentListener).not.toHaveBeenCalled();

    socket.receive(snapshot(cash.id, [...balances].reverse()));
    await flush();
    expect(account.cash.getSnapshot()).toBe(afterCash);
    expect(cashListener).toHaveBeenCalledTimes(1);

    socket.receive(
      snapshot(available.id, [
        { accountNumber: "cash-2", currencyId: "USD", amount: 2 },
        { accountNumber: "cash-1", currencyId: "EUR", amount: 1 },
      ]),
    );
    await flush();
    expect(account.cash.getSnapshot().value?.available).toMatchObject([
      { accountNumber: "cash-1", currency: "EUR" },
      { accountNumber: "cash-2", currency: "USD" },
    ]);
    expect(cashListener).toHaveBeenCalledTimes(2);
  });

  test("notifies once for each real Transaction and document change", async () => {
    let documentRead = 0;
    const fetch = vi.fn<Fetch>(async () => documentResponse(++documentRead));
    const { account, socket } = setup(fetch);
    await completeInitialSync(account, socket);
    const timeline = initialRequests(socket).timeline[0]!;
    const transactionListener = vi.fn();
    const documentListener = vi.fn();
    account.transactions.subscribe(transactionListener);
    account.documents.subscribe(documentListener);
    const beforeTransaction = account.transactions.getSnapshot();
    const beforeDocument = account.documents.getSnapshot();
    const item = transaction("watch-change", "2026-01-06T00:00:00.000Z");

    socket.receive(snapshot(timeline.id, { items: [item], cursors: {} }));
    await flush();
    expect(account.transactions.getSnapshot()).not.toBe(beforeTransaction);
    expect(transactionListener).toHaveBeenCalledTimes(1);
    expect(documentListener).not.toHaveBeenCalled();

    const subscriptionCount = subscriptions(socket).length;
    const syncing = account.sync();
    await flush();
    const reads = subscriptions(socket).slice(subscriptionCount);
    const cash = reads.find((request) => request.payload.type === "cash")!;
    const available = reads.find((request) => request.payload.type === "availableCash")!;
    const history = reads.find((request) => request.payload.type === "timelineTransactions")!;
    socket.receive(
      snapshot(cash.id, [{ accountNumber: "cash-1", currencyId: "EUR", amount: 100 }]),
    );
    socket.receive(
      snapshot(available.id, [{ accountNumber: "cash-1", currencyId: "EUR", amount: 80 }]),
    );
    socket.receive(snapshot(history.id, { items: [item], cursors: {} }));
    await syncing;

    expect(account.documents.getSnapshot()).not.toBe(beforeDocument);
    expect(account.documents.getSnapshot().value?.[0]?.version).toBe(2);
    expect(documentListener).toHaveBeenCalledTimes(1);
    expect(transactionListener).toHaveBeenCalledTimes(1);
  });

  test("filters, deduplicates, and tie-orders normalized Transactions", async () => {
    const { account, socket } = setup();
    const duplicateFirst = transaction("duplicate", "2026-01-06T00:00:00.000Z", "First");
    const duplicateLast = transaction("duplicate", "2026-01-06T00:00:00.000Z", "Last");
    const hidden = transaction("hidden", "2026-01-04T00:00:00.000Z");
    hidden.hidden = true;
    const deleted = transaction("deleted", "2026-01-03T00:00:00.000Z");
    deleted.deleted = true;
    await completeInitialSync(
      account,
      socket,
      [],
      [
        transaction("newest", "2026-01-07T00:00:00.000Z"),
        duplicateFirst,
        duplicateLast,
        transaction("b", "2026-01-05T00:00:00.000Z"),
        transaction("a", "2026-01-05T00:00:00.000Z"),
        hidden,
        deleted,
      ],
    );

    expect(account.transactions.getSnapshot().value?.map((value) => value.id)).toEqual([
      "newest",
      "duplicate",
      "a",
      "b",
    ]);
    expect(account.transactions.getSnapshot().value?.[1]?.description).toBe("Last");
  });

  test("ignores late Watch values after Stop and can Sync again", async () => {
    const { account, socket } = setup();
    await completeInitialSync(account, socket, [
      transaction("initial", "2026-01-05T00:00:00.000Z"),
    ]);
    const oldTimeline = initialRequests(socket).timeline[0]!;
    const subscriptionCount = subscriptions(socket).length;
    account.stop();
    const stopped = account.transactions.getSnapshot();
    socket.receive(
      snapshot(oldTimeline.id, {
        items: [transaction("late", "2026-01-06T00:00:00.000Z")],
        cursors: {},
      }),
    );
    await flush();
    expect(account.transactions.getSnapshot()).toBe(stopped);

    const syncing = account.sync();
    await flush();
    const watchRequests = subscriptions(socket).slice(subscriptionCount);
    expect(watchRequests.map((request) => request.payload.type).sort()).toEqual([
      "availableCash",
      "cash",
      "timelineTransactions",
    ]);
    const cash = watchRequests.find((request) => request.payload.type === "cash")!;
    const available = watchRequests.find((request) => request.payload.type === "availableCash")!;
    const timeline = watchRequests.find(
      (request) => request.payload.type === "timelineTransactions",
    )!;
    socket.receive(snapshot(cash.id, []));
    socket.receive(snapshot(available.id, []));
    socket.receive(
      snapshot(timeline.id, {
        items: [transaction("current", "2026-01-07T00:00:00.000Z")],
        cursors: {},
      }),
    );
    await flush();
    const history = subscriptions(socket).at(-1)!;
    socket.receive(snapshot(history.id, { items: [], cursors: {} }));
    await syncing;

    expect(account.transactions.getSnapshot().freshness).toBe("fresh");
    expect(account.transactions.getSnapshot().value?.map((value) => value.id)).toEqual(["current"]);
  });

  test("keeps slices fresh while TRClient recovers the Watch connection", async () => {
    const clock = new FakeClock(now);
    const sockets: FakeSocket[] = [];
    const client = new TRClient({
      clock,
      fetch: vi.fn<Fetch>(async () => documentResponse()),
      socket: () => {
        const socket = new FakeSocket(clock);
        sockets.push(socket);
        return socket;
      },
      session: savedSession(),
      validate: "throw",
    });
    const account = new TRAccount(client, { transactionWindow: { from } });
    const syncing = account.sync();
    await accept(sockets[0]!);
    const { cash, available, timeline } = initialRequests(sockets[0]!);
    sockets[0]!.receive(snapshot(cash.id, []));
    sockets[0]!.receive(snapshot(available.id, []));
    sockets[0]!.receive(snapshot(timeline[0]!.id, { items: [], cursors: {} }));
    await flush();
    const history = subscriptions(sockets[0]!).filter(
      (request) => request.payload.type === "timelineTransactions",
    )[1]!;
    sockets[0]!.receive(snapshot(history.id, { items: [], cursors: {} }));
    await syncing;

    const listener = vi.fn();
    account.transactions.subscribe(listener);
    sockets[0]!.drop();
    expect(account.transactions.getSnapshot().freshness).toBe("fresh");
    clock.advanceBy(1_000);
    await flush();
    await accept(sockets[1]!);
    expect(account.transactions.getSnapshot().freshness).toBe("fresh");
    expect(listener).not.toHaveBeenCalled();
    account.stop();
  });

  test("aborting a repeated Sync leaves its existing Watches active", async () => {
    const { account, socket } = setup();
    await completeInitialSync(account, socket);
    const watches = initialRequests(socket);
    const controller = new AbortController();
    const syncing = account.sync({ signal: controller.signal });
    await flush();
    expect(subscriptions(socket)).toHaveLength(7);
    controller.abort("cancel refresh");

    await expect(syncing).rejects.toBeInstanceOf(TRAbortError);
    const unsubscribed = new Set(
      socket.sent
        .filter((line) => line.startsWith("unsub "))
        .map((line) => Number(line.slice("unsub ".length))),
    );
    expect(unsubscribed.has(watches.cash.id)).toBe(false);
    expect(unsubscribed.has(watches.available.id)).toBe(false);
    expect(unsubscribed.has(watches.timeline[0]!.id)).toBe(false);

    socket.receive(
      snapshot(watches.timeline[0]!.id, {
        items: [transaction("still-live", "2026-01-06T00:00:00.000Z")],
        cursors: {},
      }),
    );
    await flush();
    expect(account.transactions.getSnapshot()).toMatchObject({
      freshness: "fresh",
      value: [{ id: "still-live" }],
    });
  });

  test("refreshes a stale covered range with one bounded read", async () => {
    const { account, socket } = setup();
    await completeInitialSync(account, socket);
    account.stop();
    const subscriptionCount = subscriptions(socket).length;
    const reading = account.transactions.read({
      from: new Date("2026-01-02T00:00:00.000Z"),
      to: new Date("2026-01-09T00:00:00.000Z"),
    });
    await flush();
    expect(subscriptions(socket)).toHaveLength(subscriptionCount + 1);
    const request = subscriptions(socket).at(-1)!;
    socket.receive(
      snapshot(request.id, {
        items: [transaction("refreshed", "2026-01-05T00:00:00.000Z")],
        cursors: {},
      }),
    );

    await expect(reading).resolves.toMatchObject([{ id: "refreshed" }]);
    expect(account.transactions.getSnapshot().freshness).toBe("fresh");
  });

  test("downloads no document and keeps the React entry point empty", async () => {
    const fetch = vi.fn<Fetch>(async () => documentResponse());
    const { account, socket } = setup(fetch);
    await completeInitialSync(account, socket);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new Request(vi.mocked(fetch).mock.calls[0]![0]).url).toBe(
      "https://api.traderepublic.com/api/v1/documents/all",
    );
    const root = await import("../src/index.ts");
    const react = await import("../src/react.ts");
    expect(root.TRAccount).toBe(TRAccount);
    expect(Object.keys(react)).toEqual([]);
  });
});
