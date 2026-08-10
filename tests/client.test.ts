import { describe, expect, test } from "vite-plus/test";
import {
  TRAbortError,
  TRClient,
  TRConnectionError,
  TRTimeoutError,
  TRTopicError,
  TRValidationError,
  type Environment,
  type TickerResponse,
} from "../src/index.ts";
import { FakeClock, FakeSocket } from "../src/testing.ts";
import { topicNames } from "../src/topics.ts";

const instrumentId = "IE00B7Y34M31.LSX";

function createTestClient(environment: Environment): TRClient {
  return new TRClient({ ...environment, validate: "throw" });
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

function snapshotFrame(requestId: number, value: unknown): string {
  return `${requestId} A ${JSON.stringify(value)}`;
}

function subscriptionIds(socket: FakeSocket): number[] {
  return socket.sent
    .filter((line) => line.startsWith("sub "))
    .map((line) => Number.parseInt(line.split(" ")[1]!, 10));
}

async function acceptConnection(socket: FakeSocket): Promise<void> {
  socket.open();
  expect(socket.sent[0]).toMatch(
    /^connect 31 \{"locale":"en","platformId":"webtrading","clientId":"app\.traderepublic\.com","clientVersion":"3\.181\.1"\}$/,
  );
  socket.receive("connected");
  await Promise.resolve();
}

describe("TRClient public Topics", () => {
  test("installs one named accessor for every Registry Topic", () => {
    const client = createTestClient({ socket: () => new FakeSocket() });

    topicNames.forEach((name) => expect(client[name]).toBeDefined());
  });

  test("constructs without opening a socket and waits for the server handshake", async () => {
    const socket = new FakeSocket();
    let creations = 0;
    const client = createTestClient({
      socket: () => {
        creations += 1;
        return socket;
      },
    });

    expect(creations).toBe(0);
    let settled = false;
    const result = client.ticker.get({ id: instrumentId }).then((value) => {
      settled = true;
      return value;
    });

    expect(creations).toBe(1);
    socket.open();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(subscriptionIds(socket)).toEqual([]);

    socket.receive("connected");
    await Promise.resolve();
    const [requestId] = subscriptionIds(socket);
    expect(requestId).toBeDefined();
    socket.receive(snapshotFrame(requestId!, ticker("12.34")));

    await expect(result).resolves.toEqual(ticker("12.34"));
  });

  test("shares one socket, uses unique request IDs, and supports the generic accessor", async () => {
    const socket = new FakeSocket();
    let creations = 0;
    const client = createTestClient({
      socket: () => {
        creations += 1;
        return socket;
      },
    });

    const first = client.ticker.get({ id: instrumentId });
    const second = client.topic("ticker").get({ id: "US70450Y1038.LSX" });
    await acceptConnection(socket);

    const [firstId, secondId] = subscriptionIds(socket);
    expect(creations).toBe(1);
    expect(firstId).not.toBe(secondId);

    socket.receive(snapshotFrame(firstId!, ticker("1")));
    socket.receive(snapshotFrame(secondId!, ticker("2")));
    await expect(Promise.all([first, second])).resolves.toEqual([ticker("1"), ticker("2")]);
  });

  test("Get resolves on its first payload and unsubscribes without waiting for an ack", async () => {
    const socket = new FakeSocket();
    const client = createTestClient({ socket: () => socket });
    const result = client.ticker.get({ id: instrumentId });
    await acceptConnection(socket);
    const [requestId] = subscriptionIds(socket);

    socket.receive("malformed");
    socket.receive(`${requestId} Z {}`);
    socket.receive(`${requestId} A {invalid}`);
    socket.receive(snapshotFrame(requestId!, ticker("3")));

    await expect(result).resolves.toEqual(ticker("3"));
    expect(socket.sent).toContain(`unsub ${requestId}`);
  });

  test("warns about response drift by default and still returns the response", async () => {
    const socket = new FakeSocket();
    const warnings: TRValidationError[] = [];
    const client = new TRClient({
      socket: () => socket,
      onValidationWarning: (warning) => warnings.push(warning),
    });
    const result = client.ticker.get({ id: instrumentId });
    await acceptConnection(socket);
    const [requestId] = subscriptionIds(socket);
    const changedResponse = { renamed: true };

    socket.receive(snapshotFrame(requestId!, changedResponse));

    await expect(result).resolves.toEqual(changedResponse);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toBeInstanceOf(TRValidationError);
  });

  test("can reject response drift in throw mode", async () => {
    const socket = new FakeSocket();
    const client = new TRClient({ socket: () => socket, validate: "throw" });
    const result = client.ticker.get({ id: instrumentId });
    await acceptConnection(socket);
    const [requestId] = subscriptionIds(socket);

    socket.receive(snapshotFrame(requestId!, { renamed: true }));

    await expect(result).rejects.toBeInstanceOf(TRValidationError);
    expect(socket.sent).toContain(`unsub ${requestId}`);
  });

  test("can turn response validation off", async () => {
    const socket = new FakeSocket();
    let warningCount = 0;
    const client = new TRClient({
      socket: () => socket,
      validate: "off",
      onValidationWarning: () => {
        warningCount += 1;
      },
    });
    const result = client.ticker.get({ id: instrumentId });
    await acceptConnection(socket);
    const [requestId] = subscriptionIds(socket);
    const changedResponse = { renamed: true };

    socket.receive(snapshotFrame(requestId!, changedResponse));

    await expect(result).resolves.toEqual(changedResponse);
    expect(warningCount).toBe(0);
  });

  test("tracks the fixed Echo as its liveness signal", async () => {
    const clock = new FakeClock(1_000);
    const socket = new FakeSocket(clock);
    const client = createTestClient({ clock, socket: () => socket });
    const result = client.ticker.get({ id: instrumentId });
    await acceptConnection(socket);

    expect(client.isAlive).toBe(false);
    clock.advanceBy(2_499);
    expect(socket.sent.some((line) => line.startsWith("echo "))).toBe(false);
    clock.advanceBy(1);
    expect(socket.sent.at(-1)).toBe("echo 3500");
    expect(client.isAlive).toBe(false);

    socket.receive("echo 3500");
    expect(client.isAlive).toBe(true);

    const [requestId] = subscriptionIds(socket);
    socket.receive(snapshotFrame(requestId!, ticker("4")));
    await result;
  });

  test("distinguishes aborts and fake-clock timeouts", async () => {
    const abortSocket = new FakeSocket();
    const abortClient = createTestClient({ socket: () => abortSocket });
    const controller = new AbortController();
    const aborted = abortClient.ticker.get({ id: instrumentId }, { signal: controller.signal });
    controller.abort("stopped");
    await expect(aborted).rejects.toBeInstanceOf(TRAbortError);

    const clock = new FakeClock();
    const timeoutSocket = new FakeSocket(clock);
    const timeoutClient = createTestClient({ clock, socket: () => timeoutSocket });
    const timedOut = timeoutClient.ticker.get({ id: instrumentId }, { timeoutMs: 100 });
    clock.advanceBy(100);
    await expect(timedOut).rejects.toMatchObject({
      constructor: TRTimeoutError,
      timeoutMs: 100,
    });
  });

  test("rejects invalid requests before opening a socket", () => {
    let creations = 0;
    const client = createTestClient({
      socket: () => {
        creations += 1;
        return new FakeSocket();
      },
    });

    expect(() => client.ticker.get({ id: "invalid" })).toThrow(TRValidationError);
    expect(creations).toBe(0);
  });

  test("a delayed fake reply resolves only after clock time advances", async () => {
    const clock = new FakeClock();
    const socket = new FakeSocket(clock);
    const client = createTestClient({ clock, socket: () => socket });
    let settled = false;
    const result = client.ticker.get({ id: instrumentId }).then((value) => {
      settled = true;
      return value;
    });
    await acceptConnection(socket);
    const [requestId] = subscriptionIds(socket);

    socket.receive(snapshotFrame(requestId!, ticker("5")), 100);
    clock.advanceBy(99);
    await Promise.resolve();
    expect(settled).toBe(false);
    clock.advanceBy(1);
    await expect(result).resolves.toEqual(ticker("5"));
  });

  test("a dropped connection rejects an in-flight Get", async () => {
    const socket = new FakeSocket();
    const client = createTestClient({ socket: () => socket });
    const result = client.ticker.get({ id: instrumentId });
    await acceptConnection(socket);
    socket.drop();

    await expect(result).rejects.toBeInstanceOf(TRConnectionError);
    expect(client.isAlive).toBe(false);
  });

  test("wraps socket creation failures as connection errors", async () => {
    const cause = new Error("Network unavailable");
    const client = createTestClient({
      socket: () => {
        throw cause;
      },
    });

    await expect(client.ticker.get({ id: instrumentId })).rejects.toMatchObject({
      constructor: TRConnectionError,
      message: "Could not create the WebSocket",
      cause,
    });
  });
});

describe("Topic Watches", () => {
  test("yields Snapshots, keeps only the newest pending value, and unsubscribes on return", async () => {
    const socket = new FakeSocket();
    const client = createTestClient({ socket: () => socket });
    const iterator = client.ticker.watch({ id: instrumentId })[Symbol.asyncIterator]();
    const first = iterator.next();
    await acceptConnection(socket);
    const [requestId] = subscriptionIds(socket);

    socket.receive(snapshotFrame(requestId!, ticker("1")));
    await expect(first).resolves.toEqual({ done: false, value: ticker("1") });

    const next = iterator.next();
    socket.receive(snapshotFrame(requestId!, ticker("2")));
    socket.receive(snapshotFrame(requestId!, ticker("3")));
    await expect(next).resolves.toEqual({ done: false, value: ticker("3") });

    await iterator.return?.();
    expect(socket.sent).toContain(`unsub ${requestId}`);
  });

  test("applies Deltas before yielding", async () => {
    const socket = new FakeSocket();
    const client = createTestClient({ socket: () => socket });
    const iterator = client.ticker.watch({ id: instrumentId })[Symbol.asyncIterator]();
    const first = iterator.next();
    await acceptConnection(socket);
    const [requestId] = subscriptionIds(socket);
    const initial = ticker("10");
    const updated = ticker("11", 2);
    const initialJson = JSON.stringify(initial);
    const updatedJson = JSON.stringify(updated);

    socket.receive(`${requestId} A ${initialJson}`);
    await first;
    const next = iterator.next();
    socket.receive(`${requestId} D -${initialJson.length}\t+${encodeURIComponent(updatedJson)}`);

    await expect(next).resolves.toEqual({ done: false, value: updated });
    await iterator.return?.();
  });

  test("throws one Topic Error into its iterator without disturbing another Watch", async () => {
    const socket = new FakeSocket();
    const client = createTestClient({ socket: () => socket });
    const failed = client.ticker.watch({ id: instrumentId })[Symbol.asyncIterator]();
    const working = client.ticker.watch({ id: "US70450Y1038.LSX" })[Symbol.asyncIterator]();
    const failedNext = failed.next();
    const workingNext = working.next();
    await acceptConnection(socket);
    const [failedId, workingId] = subscriptionIds(socket);

    socket.receive(
      `${failedId} E {"errors":[{"errorCode":"INVALID_REQUEST","errorMessage":"Bad id"}]}`,
    );
    socket.receive(snapshotFrame(workingId!, ticker("20")));

    await expect(failedNext).rejects.toMatchObject({
      constructor: TRTopicError,
      errorCode: "INVALID_REQUEST",
      message: "Bad id",
    });
    await expect(workingNext).resolves.toEqual({ done: false, value: ticker("20") });
    await working.return?.();
  });
});
