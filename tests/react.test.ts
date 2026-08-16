import { act, render, renderHook, waitFor } from "@testing-library/react";
import { createElement, Fragment, StrictMode, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test, vi } from "vite-plus/test";
import {
  TRAccount,
  TRClient,
  TRHttpError,
  TRValidationError,
  type AccountQuery,
  type AccountSlice,
  type Fetch,
  type TickerResponse,
  type TimelineTransaction,
} from "../src/index.ts";
import { accountClientSubscriptionCount } from "../src/client.ts";
import {
  TRProvider,
  useAccountSlice,
  useCash,
  useConnection,
  useDocuments,
  useGet,
  useLogin,
  useSession,
  useSync,
  useTRAccount,
  useTRClient,
  useTransactionRange,
  useTransactions,
  useWatch,
} from "../src/react.ts";
import { FakeClock, FakeSocket } from "../src/testing.ts";
import { RequestMultiplexer } from "../src/react-multiplexer.ts";

const now = Date.parse("2026-01-10T00:00:00.000Z");
const windowFrom = new Date("2026-01-01T00:00:00.000Z");

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

function response<Body>(body: Body | undefined, status = 200): Response {
  const headers = body === undefined ? undefined : { "content-type": "application/json" };
  const result = new Response(body === undefined ? undefined : JSON.stringify(body), {
    headers,
    status,
  });
  if (body !== undefined) Object.defineProperty(result, "json", { value: async () => body });
  return result;
}

function loginResponse<Body>(body: Body, cookies: readonly string[] = []): Response {
  const headers: [string, string][] = cookies.map((cookie) => ["set-cookie", cookie]);
  headers.push(["content-type", "application/json"]);
  const result = new Response(JSON.stringify(body), { headers });
  Object.defineProperty(result, "json", { value: async () => body });
  return result;
}

function documentResponse(): Response {
  return response({ documents: [] });
}

function transaction(id: string, timestamp: string): TimelineTransaction {
  return {
    id,
    timestamp,
    title: "Transaction",
    icon: "timeline",
    badge: null,
    subtitle: "Counterparty",
    amount: { currency: "EUR", value: 12.34, fractionDigits: 2 },
    subAmount: null,
    status: "EXECUTED",
    action: { type: "timelineDetail", payload: id },
    eventType: "CASH",
    cashAccountNumber: "cash-1",
    hidden: false,
    deleted: false,
  };
}

function ticker(price: string, time = 1): TickerResponse {
  const quote = { time, price, size: 10 };
  return {
    bid: quote,
    ask: quote,
    last: quote,
    pre: quote,
    open: quote,
    qualityId: "realtime",
    leverage: null,
    delta: null,
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
  const account = new TRAccount(client, { transactionWindow: { from: windowFrom } });
  return { account, client, clock, fetch, socket };
}

function provider(client: TRClient, account?: TRAccount) {
  return function TestProvider({ children }: { readonly children: ReactNode }) {
    return createElement(TRProvider, { client, account, children });
  };
}

async function completeSync(account: TRAccount, socket: FakeSocket): Promise<void> {
  const syncing = account.sync();
  await accept(socket);
  const initial = subscriptions(socket);
  const cash = initial.find((request) => request.payload.type === "cash")!;
  const available = initial.find((request) => request.payload.type === "availableCash")!;
  const timeline = initial.find((request) => request.payload.type === "timelineTransactions")!;
  socket.receive(snapshot(cash.id, []));
  socket.receive(snapshot(available.id, []));
  socket.receive(snapshot(timeline.id, { items: [], cursors: {} }));
  await flush();
  const history = subscriptions(socket).filter(
    (request) => request.payload.type === "timelineTransactions",
  )[1]!;
  socket.receive(snapshot(history.id, { items: [], cursors: {} }));
  await syncing;
}

describe("React entry point", () => {
  test("throws typed, hook-named errors outside a provider and without an account", () => {
    const pending: AccountQuery<readonly never[]> = Object.freeze({
      status: "pending",
      data: undefined,
      error: undefined,
      isPending: true,
      isSuccess: false,
      isError: false,
      dataUpdatedAt: undefined,
      isStale: false,
    });
    const slice: AccountSlice<readonly never[]> = {
      getSnapshot: () => pending,
      subscribe: () => () => undefined,
    };
    const hooks: ReadonlyArray<readonly [string, () => object]> = [
      ["useTRClient", useTRClient],
      ["useTRAccount", useTRAccount],
      ["useAccountSlice", () => useAccountSlice(slice)],
      ["useCash", useCash],
      ["useTransactions", useTransactions],
      ["useDocuments", useDocuments],
      ["useSession", useSession],
      ["useConnection", useConnection],
      ["useLogin", useLogin],
      ["useSync", useSync],
      ["useTransactionRange", () => useTransactionRange({ from: windowFrom })],
    ];

    for (const [name, hook] of hooks) {
      expect(() => renderHook(hook)).toThrow(
        expect.objectContaining({ name: "TRValidationError" }),
      );
      expect(() => renderHook(hook)).toThrow(name);
    }

    const client = new TRClient({ socket: () => new FakeSocket() });
    expect(() => renderHook(useTRAccount, { wrapper: provider(client) })).toThrow(
      TRValidationError,
    );
    expect(() => renderHook(useTRAccount, { wrapper: provider(client) })).toThrow("useTRAccount");
  });

  test("uses the server snapshot and unsubscribes a generic Slice on unmount", () => {
    const { account, client } = setup();
    let unsubscribeCount = 0;
    const pending: AccountQuery<string> = Object.freeze({
      status: "pending",
      data: undefined,
      error: undefined,
      isPending: true,
      isSuccess: false,
      isError: false,
      dataUpdatedAt: undefined,
      isStale: false,
    });
    const slice: AccountSlice<string> = {
      getSnapshot: () => pending,
      subscribe: () => {
        let active = true;
        return () => {
          if (!active) return;
          active = false;
          unsubscribeCount += 1;
        };
      },
    };
    const result = renderHook(() => useAccountSlice(slice), { wrapper: provider(client, account) });
    expect(result.result.current.status).toBe("pending");
    result.unmount();
    expect(unsubscribeCount).toBe(1);

    function ServerCash() {
      return createElement("span", undefined, useCash().status);
    }
    expect(
      renderToString(
        createElement(TRProvider, { client, account, children: createElement(ServerCash) }),
      ),
    ).toContain("pending");
  });

  test("autoSync survives StrictMode cleanup and isolates Slice renders", async () => {
    const { account, client, socket } = setup();
    let cashRenders = 0;
    let transactionRenders = 0;

    function CashView() {
      cashRenders += 1;
      return createElement("span", undefined, useCash().status);
    }
    function TransactionView() {
      transactionRenders += 1;
      return createElement("span", undefined, useTransactions().status);
    }

    const view = render(
      createElement(
        StrictMode,
        undefined,
        createElement(TRProvider, {
          client,
          account,
          autoSync: true,
          children: createElement(
            Fragment,
            undefined,
            createElement(CashView),
            createElement(TransactionView),
          ),
        }),
      ),
    );
    const syncing = account.sync();
    await act(async () => {
      await accept(socket);
      const initial = subscriptions(socket);
      const cash = initial.find((request) => request.payload.type === "cash")!;
      const available = initial.find((request) => request.payload.type === "availableCash")!;
      const timeline = initial.find((request) => request.payload.type === "timelineTransactions")!;
      socket.receive(snapshot(cash.id, []));
      socket.receive(snapshot(available.id, []));
      socket.receive(snapshot(timeline.id, { items: [], cursors: {} }));
      await flush();
      const history = subscriptions(socket).filter(
        (request) => request.payload.type === "timelineTransactions",
      )[1]!;
      socket.receive(snapshot(history.id, { items: [], cursors: {} }));
      await syncing;
    });
    expect(subscriptions(socket)).toHaveLength(4);
    const cashAfterSync = cashRenders;
    const transactionsAfterSync = transactionRenders;
    const cashWatch = subscriptions(socket).find((request) => request.payload.type === "cash")!;

    await act(async () => {
      socket.receive(snapshot(cashWatch.id, []));
      await flush();
    });
    expect(cashRenders).toBe(cashAfterSync);
    expect(transactionRenders).toBe(transactionsAfterSync);

    await act(async () => {
      socket.receive(
        snapshot(cashWatch.id, [{ accountNumber: "cash-1", currencyId: "EUR", amount: 100 }]),
      );
      await flush();
    });
    expect(cashRenders).toBeGreaterThan(cashAfterSync);
    expect(transactionRenders).toBe(transactionsAfterSync);

    view.unmount();
    expect(account.cash.getSnapshot().status).toBe("success");
  });

  test("surfaces a rejected autoSync through Slices without a render error", async () => {
    const { account, client, socket } = setup(
      vi.fn<Fetch>(async () => new Response(undefined, { status: 500 })),
    );
    expect(() =>
      render(
        createElement(TRProvider, {
          client,
          account,
          autoSync: true,
          children: createElement("div"),
        }),
      ),
    ).not.toThrow();
    const syncing = account.sync();
    await act(async () => {
      await accept(socket);
      const initial = subscriptions(socket);
      for (const request of initial) {
        const value =
          request.payload.type === "timelineTransactions" ? { items: [], cursors: {} } : [];
        socket.receive(snapshot(request.id, value));
      }
      await flush();
      const history = subscriptions(socket).filter(
        (request) => request.payload.type === "timelineTransactions",
      )[1]!;
      socket.receive(snapshot(history.id, { items: [], cursors: {} }));
      await expect(syncing).rejects.toBeInstanceOf(TRHttpError);
    });
    expect(account.documents.getSnapshot()).toMatchObject({ status: "error" });
  });

  test("reports Login approval, rejects a concurrent flow, and resolves abort", async () => {
    let pollSignal: AbortSignal | undefined;
    let requestCount = 0;
    const fetch = vi.fn<Fetch>(async (_input, options) => {
      requestCount += 1;
      if (requestCount === 1) {
        return loginResponse({ processId: "process-id" }, [
          "login_process=process-cookie; Path=/; Secure; HttpOnly",
        ]);
      }
      pollSignal = options?.signal ?? undefined;
      return await new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
      });
    });
    const client = new TRClient({ fetch, clock: new FakeClock(now), validate: "throw" });
    const hook = renderHook(useLogin, { wrapper: provider(client) });
    let login!: Promise<void>;

    act(() => {
      login = hook.result.current.login("+49123456789", "1234");
    });
    await act(flush);
    expect(hook.result.current.status).toBe("awaiting-approval");
    await expect(hook.result.current.login("+49999999999", "9999")).rejects.toBeInstanceOf(
      TRValidationError,
    );
    expect(fetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      hook.result.current.abort();
      await login;
    });
    expect(pollSignal?.aborted).toBe(true);
    expect(hook.result.current).toMatchObject({ status: "idle", error: undefined });
  });

  test("aborts Login on unmount and reports non-abort failures", async () => {
    let pollSignal: AbortSignal | undefined;
    let requestCount = 0;
    const pendingFetch = vi.fn<Fetch>(async (_input, options) => {
      requestCount += 1;
      if (requestCount === 1) return loginResponse({ processId: "process-id" });
      pollSignal = options?.signal ?? undefined;
      return await new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
      });
    });
    const pendingClient = new TRClient({ fetch: pendingFetch, clock: new FakeClock(now) });
    const pendingHook = renderHook(useLogin, { wrapper: provider(pendingClient) });
    let login!: Promise<void>;
    act(() => {
      login = pendingHook.result.current.login("+49123456789", "1234");
    });
    await act(flush);
    pendingHook.unmount();
    await expect(login).resolves.toBeUndefined();
    expect(pollSignal?.aborted).toBe(true);

    const failedClient = new TRClient({
      fetch: vi.fn<Fetch>(async () => new Response(undefined, { status: 401 })),
    });
    const failedHook = renderHook(useLogin, { wrapper: provider(failedClient) });
    await act(async () => {
      await expect(failedHook.result.current.login("+49123456789", "1234")).rejects.toBeInstanceOf(
        TRHttpError,
      );
    });
    expect(failedHook.result.current).toMatchObject({
      status: "failed",
      error: expect.any(TRHttpError),
    });
  });

  test("shares Sync work with autoSync and exposes its action state", async () => {
    const { account, client, socket } = setup();
    const hook = renderHook(useSync, {
      wrapper: function AutoProvider({ children }: { readonly children: ReactNode }) {
        return createElement(TRProvider, { client, account, autoSync: true, children });
      },
    });
    let first!: Promise<void>;
    act(() => {
      first = hook.result.current.sync();
    });
    expect(hook.result.current.status).toBe("pending");
    expect(hook.result.current.sync()).toBe(first);

    await act(async () => {
      await completeSync(account, socket);
      await first;
    });
    expect(hook.result.current).toMatchObject({ status: "idle", error: undefined });
    expect(subscriptions(socket)).toHaveLength(4);
  });

  test("keys transaction reads on timestamps and ignores superseded aborts", async () => {
    const { account, client, socket } = setup();
    const firstRange = {
      from: new Date("2025-12-01T00:00:00.000Z"),
      to: new Date("2025-12-10T00:00:00.000Z"),
    };
    const hook = renderHook(
      ({ from, to }: { readonly from: Date; readonly to: Date }) =>
        useTransactionRange({ from, to }),
      { initialProps: firstRange, wrapper: provider(client, account) },
    );
    await act(async () => {
      await accept(socket);
    });
    const first = subscriptions(socket)[0]!;

    hook.rerender({
      from: new Date("2025-11-01T00:00:00.000Z"),
      to: new Date("2025-11-10T00:00:00.000Z"),
    });
    await act(flush);
    expect(socket.sent).toContain(`unsub ${first.id}`);
    expect(hook.result.current.status).toBe("pending");
    const second = subscriptions(socket)[1]!;
    await act(async () => {
      socket.receive(
        snapshot(second.id, {
          items: [transaction("range-item", "2025-11-05T00:00:00.000Z")],
          cursors: {},
        }),
      );
      await flush();
    });
    await waitFor(() => expect(hook.result.current.status).toBe("success"));
    expect(hook.result.current.data?.[0]?.id).toBe("range-item");

    hook.rerender({
      from: new Date("2025-11-01T00:00:00.000Z"),
      to: new Date("2025-11-10T00:00:00.000Z"),
    });
    await act(flush);
    expect(subscriptions(socket)).toHaveLength(2);

    hook.rerender({
      from: new Date("2025-10-01T00:00:00.000Z"),
      to: new Date("2025-10-10T00:00:00.000Z"),
    });
    await act(flush);
    const third = subscriptions(socket)[2]!;
    hook.unmount();
    expect(socket.sent).toContain(`unsub ${third.id}`);
  });
});

describe("React Topic and Resource hooks", () => {
  test("removes entries from abandoned renders", async () => {
    const { client } = setup();
    const requests = new RequestMultiplexer(client);
    const first = requests.watch("ticker", { id: "US88160R1014.LSX" });
    expect(requests.watch("ticker", { id: "US88160R1014.LSX" })).toBe(first);

    await flush();

    expect(requests.watch("ticker", { id: "US88160R1014.LSX" })).not.toBe(first);
  });

  test("shares equal Watches, publishes every Frame, and tears down the last subscriber", async () => {
    const { client, socket } = setup();
    const instrumentId = "US88160R1014.LSX";

    function Price() {
      const price = useWatch("ticker", { id: instrumentId });
      return createElement(
        "span",
        undefined,
        price.isSuccess ? price.data.bid.price : price.status,
      );
    }

    const prices = () =>
      createElement(TRProvider, {
        client,
        children: createElement(
          Fragment,
          undefined,
          createElement(Price),
          createElement(Price),
          createElement(Price),
        ),
      });
    const view = render(prices());
    await act(async () => {
      await accept(socket);
    });
    expect(subscriptions(socket)).toHaveLength(1);
    expect(accountClientSubscriptionCount(client)).toBe(1);
    const request = subscriptions(socket)[0]!;

    await act(async () => {
      socket.receive(snapshot(request.id, ticker("10")));
      await flush();
    });
    expect(view.getAllByText("10")).toHaveLength(3);
    await act(async () => {
      socket.receive(snapshot(request.id, ticker("11", 2)));
      await flush();
    });
    expect(view.getAllByText("11")).toHaveLength(3);

    view.rerender(prices());
    await act(flush);
    expect(subscriptions(socket)).toHaveLength(1);

    view.unmount();
    expect(socket.sent).toContain(`unsub ${request.id}`);
    expect(accountClientSubscriptionCount(client)).toBe(0);
  });

  test("separates requests, switches keys, and survives a StrictMode remount", async () => {
    const { client, socket } = setup();
    const firstId = "US88160R1014.LSX";
    const secondId = "IE00B7Y34M31.LSX";
    const strict = renderHook(() => useWatch("ticker", { id: firstId }), {
      wrapper: function StrictProvider({ children }: { readonly children: ReactNode }) {
        return createElement(
          StrictMode,
          undefined,
          createElement(TRProvider, { client, children }),
        );
      },
    });
    await act(async () => {
      await accept(socket);
    });
    expect(accountClientSubscriptionCount(client)).toBe(1);

    const other = renderHook(({ id }: { readonly id: string }) => useWatch("ticker", { id }), {
      initialProps: { id: secondId },
      wrapper: provider(client),
    });
    await act(flush);
    expect(accountClientSubscriptionCount(client)).toBe(2);
    const beforeChange = subscriptions(socket).at(-1)!;

    other.rerender({ id: "US70450Y1038.LSX" });
    await act(flush);
    expect(socket.sent).toContain(`unsub ${beforeChange.id}`);
    expect(accountClientSubscriptionCount(client)).toBe(2);

    other.unmount();
    strict.unmount();
    expect(accountClientSubscriptionCount(client)).toBe(0);
  });

  test("rejects a non-serializable request before I/O", () => {
    const { client, socket } = setup();
    interface CyclicRequest {
      readonly id: string;
      self?: CyclicRequest;
    }
    const request: CyclicRequest = { id: "US88160R1014.LSX" };
    request.self = request;

    expect(() =>
      renderHook(() => useWatch("ticker", request), { wrapper: provider(client) }),
    ).toThrow(TRValidationError);
    expect(socket.sent).toEqual([]);
    expect(accountClientSubscriptionCount(client)).toBe(0);
  });

  test("sorts request keys before sharing an entry", async () => {
    const { client, socket } = setup();
    const left = { terminated: true, alpha: 1, beta: 2 };
    const right = { beta: 2, alpha: 1, terminated: true };
    const hook = renderHook(
      () => ({ left: useWatch("orders", left), right: useWatch("orders", right) }),
      { wrapper: provider(client) },
    );

    await waitFor(() => expect(hook.result.current.left.status).toBe("error"));
    expect(hook.result.current.right.error).toBe(hook.result.current.left.error);
    expect(socket.sent).toEqual([]);
    hook.unmount();
  });

  test("reports local Auth errors but permits a public Watch without an account", async () => {
    const securedSocket = new FakeSocket();
    const securedClient = new TRClient({ socket: () => securedSocket, validate: "throw" });
    const secured = renderHook(() => useWatch("cash", {}), {
      wrapper: provider(securedClient),
    });
    await waitFor(() => expect(secured.result.current.status).toBe("error"));
    expect(secured.result.current.error?.name).toBe("TRAuthError");
    expect(securedSocket.sent).toEqual([]);

    const publicSocket = new FakeSocket();
    const publicClient = new TRClient({ socket: () => publicSocket, validate: "throw" });
    const publicWatch = renderHook(() => useWatch("ticker", { id: "US88160R1014.LSX" }), {
      wrapper: provider(publicClient),
    });
    await act(async () => {
      await accept(publicSocket);
    });
    const request = subscriptions(publicSocket)[0]!;
    await act(async () => {
      publicSocket.receive(snapshot(request.id, ticker("12")));
      await flush();
    });
    expect(publicWatch.result.current).toMatchObject({ status: "success" });
    publicWatch.unmount();
    expect(accountClientSubscriptionCount(publicClient)).toBe(0);
  });

  test("gets Topics and Resources and refetches each one-shot read", async () => {
    const fetch = vi.fn<Fetch>(async () => response({ documents: [] }));
    const { client, socket } = setup(fetch);
    const hook = renderHook(
      () => ({
        topic: useGet("ticker", { id: "US88160R1014.LSX" }),
        resource: useGet("allDocuments"),
      }),
      { wrapper: provider(client) },
    );
    await act(async () => {
      await accept(socket);
      await flush();
    });
    const firstTopic = subscriptions(socket)[0]!;
    await act(async () => {
      socket.receive(snapshot(firstTopic.id, ticker("20")));
      await flush();
    });
    expect(hook.result.current.topic).toMatchObject({ status: "success" });
    expect(hook.result.current.resource).toMatchObject({ status: "success" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(accountClientSubscriptionCount(client)).toBe(0);

    act(() => {
      hook.result.current.topic.refetch();
      hook.result.current.resource.refetch();
    });
    await act(flush);
    expect(hook.result.current.topic.status).toBe("pending");
    expect(fetch).toHaveBeenCalledTimes(2);
    const secondTopic = subscriptions(socket)[1]!;
    await act(async () => {
      socket.receive(snapshot(secondTopic.id, ticker("21")));
      await flush();
    });
    expect(hook.result.current.topic.data?.bid.price).toBe("21");
    hook.unmount();
    expect(accountClientSubscriptionCount(client)).toBe(0);
  });
});
