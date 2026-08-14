import type {
  ResolvedEnvironment,
  Socket,
  SocketCloseEvent,
  SocketErrorEvent,
  SocketMessageEvent,
  TimerHandle,
} from "./environment.ts";
import { toConnectionError, TRConnectionError } from "./errors.ts";
import { applyDelta, parseFrame } from "./protocol.ts";

const SOCKET_URL = "wss://api.traderepublic.com";
const ECHO_INTERVAL_MS = 2_500;
const RECOVERY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;
const CONNECT_FRAME = `connect 31 ${JSON.stringify({
  locale: "en",
  platformId: "webtrading",
  clientId: "app.traderepublic.com",
  clientVersion: "3.181.1",
})}`;

export interface SubscriptionSink<Value> {
  next(value: Value): void;
  error(error: Error): void;
  reset?(): void;
}

export interface SubscriptionControl {
  unsubscribe(): void;
}

interface ActiveSubscription {
  readonly serializedPayload: string;
  readonly recovery: SubscriptionRecovery;
  previousPayload?: string;
  needsResubscribe: boolean;
  accept(payload: string): boolean;
  fail(error: Error): void;
  reset(): void;
}

type SubscriptionRecovery = "fail" | "resume";

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

export interface Connection {
  readonly isAlive: boolean;
  connect(): Promise<void>;
  reconnect(): Promise<void>;
  reconnectAfterLogin(): Promise<void> | undefined;
  disconnect(): void;
  subscribe<Value, Payload>(
    payload: Payload,
    decode: (payload: string) => Value | undefined,
    sink: SubscriptionSink<Value>,
    recoveryPolicy: SubscriptionRecovery,
  ): SubscriptionControl;
}

export function createConnection(
  environment: ResolvedEnvironment,
  getCookieHeader: () => string | undefined = () => undefined,
): Connection {
  const subscriptions = new Map<number, ActiveSubscription>();
  let socket: Socket | undefined;
  let connectionPromise: Promise<void> | undefined;
  let rejectConnection: ((error: Error) => void) | undefined;
  let reconnectPromise: Promise<void> | undefined;
  let recovery: Deferred | undefined;
  let recoveryTimer: TimerHandle | undefined;
  let recoveryDelayIndex = 0;
  let echoTimer: TimerHandle | undefined;
  let lastEcho: string | undefined;
  let awaitingEcho = false;
  let nextRequestId = 1;
  let connected = false;
  let alive = false;
  let generation = 0;

  const clearEcho = (): void => {
    if (echoTimer !== undefined) environment.clock.clearInterval(echoTimer);
    echoTimer = undefined;
    lastEcho = undefined;
    awaitingEcho = false;
  };

  const clearRecoveryTimer = (): void => {
    if (recoveryTimer !== undefined) environment.clock.clearTimeout(recoveryTimer);
    recoveryTimer = undefined;
  };

  const detachSocket = (): void => {
    const current = socket;
    socket = undefined;
    generation += 1;
    if (!current) return;
    current.onopen = null;
    current.onmessage = null;
    current.onerror = null;
    current.onclose = null;
    current.close();
  };

  const abandonTransport = (): void => {
    connected = false;
    alive = false;
    clearEcho();
    connectionPromise = undefined;
    rejectConnection = undefined;
    detachSocket();
  };

  const failSubscriptions = (
    error: TRConnectionError,
    predicate: (subscription: ActiveSubscription) => boolean,
  ): void => {
    for (const [requestId, subscription] of subscriptions) {
      if (!predicate(subscription)) continue;
      subscriptions.delete(requestId);
      subscription.fail(error);
    }
  };

  const hasRecoverableSubscriptions = (): boolean =>
    [...subscriptions.values()].some((subscription) => subscription.recovery === "resume");

  const send = (line: string): void => {
    if (!socket) throw new TRConnectionError("The WebSocket does not exist");
    socket.send(line);
  };

  const finishRecovery = (): void => {
    const current = recovery;
    recovery = undefined;
    recoveryDelayIndex = 0;
    current?.resolve();
  };

  const cancelRecovery = (error: TRConnectionError): void => {
    clearRecoveryTimer();
    const current = recovery;
    recovery = undefined;
    recoveryDelayIndex = 0;
    current?.reject(error);
  };

  const handleFrame = (raw: string): void => {
    const frame = parseFrame(raw);
    if (!frame) return;

    const subscription = subscriptions.get(frame.requestId);
    if (!subscription) return;

    switch (frame.kind) {
      case "snapshot":
        if (subscription.accept(frame.payload)) subscription.previousPayload = frame.payload;
        return;
      case "delta":
        if (subscription.previousPayload === undefined) return;
        try {
          const payload = applyDelta(subscription.previousPayload, frame.payload);
          if (subscription.accept(payload)) subscription.previousPayload = payload;
        } catch {
          // Malformed Deltas are ignored like other malformed server lines.
        }
        return;
      case "topicError":
        subscriptions.delete(frame.requestId);
        subscription.fail(frame.error);
        return;
      case "unsubAck":
        subscriptions.delete(frame.requestId);
    }
  };

  const restoreSubscriptions = (): void => {
    for (const [requestId, subscription] of subscriptions) {
      if (!subscription.needsResubscribe) continue;
      send(`sub ${requestId} ${subscription.serializedPayload}`);
      subscription.needsResubscribe = false;
    }
  };

  const prepareSubscriptionsForRecovery = (): void => {
    for (const subscription of subscriptions.values()) {
      subscription.previousPayload = undefined;
      subscription.needsResubscribe = true;
      subscription.reset();
    }
  };

  let beginRecovery: (error: TRConnectionError) => void;

  const openTransport = (): Promise<void> => {
    if (connected) return Promise.resolve();
    if (connectionPromise) return connectionPromise;

    const transportGeneration = ++generation;
    let currentSocket: Socket;
    try {
      const cookie = getCookieHeader();
      currentSocket = environment.socket(
        SOCKET_URL,
        undefined,
        cookie
          ? {
              headers: {
                Cookie: cookie,
                Origin: "https://app.traderepublic.com",
              },
            }
          : undefined,
      );
    } catch (cause) {
      return Promise.reject(toConnectionError("Could not create the WebSocket", cause));
    }
    socket = currentSocket;

    const isCurrent = (): boolean => generation === transportGeneration && socket === currentSocket;

    connectionPromise = new Promise<void>((resolve, reject) => {
      rejectConnection = reject;

      const failHandshake = (error: TRConnectionError): void => {
        if (!isCurrent()) return;
        abandonTransport();
        reject(error);
      };

      const loseEstablishedTransport = (error: TRConnectionError): void => {
        if (!isCurrent()) return;
        abandonTransport();
        beginRecovery(error);
        reject(error);
      };

      const sendEcho = (): void => {
        if (!isCurrent() || !connected) return;
        if (awaitingEcho) {
          loseEstablishedTransport(new TRConnectionError("The WebSocket Echo was not returned"));
          return;
        }

        const echo = `echo ${environment.clock.now()}`;
        lastEcho = echo;
        awaitingEcho = true;
        alive = false;
        try {
          send(echo);
        } catch (cause) {
          loseEstablishedTransport(toConnectionError("Could not send the WebSocket Echo", cause));
        }
      };

      currentSocket.onopen = () => {
        if (!isCurrent()) return;
        try {
          send(CONNECT_FRAME);
          echoTimer = environment.clock.setInterval(sendEcho, ECHO_INTERVAL_MS);
        } catch (cause) {
          failHandshake(toConnectionError("Could not send the WebSocket handshake", cause));
        }
      };

      currentSocket.onmessage = ({ data }: SocketMessageEvent) => {
        if (!isCurrent()) return;
        if (data === "connected") {
          if (connected) return;
          connected = true;
          recoveryDelayIndex = 0;
          try {
            restoreSubscriptions();
          } catch (cause) {
            loseEstablishedTransport(
              toConnectionError("Could not restore the Topic subscriptions", cause),
            );
            return;
          }
          connectionPromise = undefined;
          rejectConnection = undefined;
          resolve();
          return;
        }

        if (data.startsWith("echo ")) {
          if (data === lastEcho) {
            awaitingEcho = false;
            alive = true;
          }
          return;
        }

        if (!connected) return;
        handleFrame(data);
      };

      currentSocket.onerror = (event: SocketErrorEvent) => {
        if (!isCurrent()) return;
        const error = toConnectionError(
          connected
            ? "The WebSocket transport failed"
            : "The WebSocket failed before Trade Republic accepted it",
          event.error ?? event,
        );
        if (connected) loseEstablishedTransport(error);
        else failHandshake(error);
      };

      currentSocket.onclose = (event: SocketCloseEvent) => {
        if (!isCurrent()) return;
        const wasConnected = connected;
        const error = new TRConnectionError("The WebSocket connection closed", { cause: event });
        if (wasConnected) loseEstablishedTransport(error);
        else failHandshake(error);
      };
    });

    return connectionPromise;
  };

  const scheduleRecovery = (): void => {
    if (!recovery || recoveryTimer !== undefined || !hasRecoverableSubscriptions()) return;
    const delay = RECOVERY_DELAYS_MS[Math.min(recoveryDelayIndex, RECOVERY_DELAYS_MS.length - 1)]!;
    recoveryDelayIndex += 1;
    recoveryTimer = environment.clock.setTimeout(() => {
      recoveryTimer = undefined;
      const currentRecovery = recovery;
      if (!currentRecovery || !hasRecoverableSubscriptions()) return;
      const attempt = openTransport();
      const attemptGeneration = generation;
      void attempt.then(
        () => {
          if (recovery === currentRecovery && connected && generation === attemptGeneration) {
            finishRecovery();
          }
        },
        () => {
          if (recovery === currentRecovery) scheduleRecovery();
        },
      );
    }, delay);
  };

  beginRecovery = (error: TRConnectionError): void => {
    failSubscriptions(error, (subscription) => subscription.recovery === "fail");
    prepareSubscriptionsForRecovery();
    if (!hasRecoverableSubscriptions()) return;
    if (!recovery) {
      recovery = createDeferred();
      void recovery.promise.catch(() => undefined);
    }
    scheduleRecovery();
  };

  const connect = (): Promise<void> => {
    if (connected) return Promise.resolve();
    return recovery?.promise ?? openTransport();
  };

  const disconnect = (): void => {
    const error = new TRConnectionError("The WebSocket connection was closed by the client");
    cancelRecovery(error);
    rejectConnection?.(error);
    reconnectPromise = undefined;
    abandonTransport();
    failSubscriptions(error, () => true);
  };

  const reconnect = (): Promise<void> => {
    if (recovery) return recovery.promise;
    if (reconnectPromise) return reconnectPromise;
    if (connectionPromise) return connectionPromise;

    abandonTransport();
    prepareSubscriptionsForRecovery();

    const update = openTransport().catch((cause: unknown) => {
      const error = toConnectionError("Could not reconnect the WebSocket", cause);
      failSubscriptions(error, () => true);
      throw error;
    });
    const result = update.finally(() => {
      if (reconnectPromise === result) reconnectPromise = undefined;
    });
    reconnectPromise = result;
    return result;
  };

  const reconnectAfterLogin = (): Promise<void> | undefined => {
    if (!socket && !connectionPromise && !recovery) return undefined;
    return reconnect();
  };

  const subscribe = <Value, Payload>(
    payload: Payload,
    decode: (payload: string) => Value | undefined,
    sink: SubscriptionSink<Value>,
    recoveryPolicy: SubscriptionRecovery,
  ): SubscriptionControl => {
    if (!connected) throw new TRConnectionError("The WebSocket is not connected");

    const requestId = nextRequestId++;
    const serializedPayload = JSON.stringify(payload);
    if (serializedPayload === undefined) {
      throw new TRConnectionError("Could not serialize the Topic request");
    }
    let active = true;
    const subscription: ActiveSubscription = {
      serializedPayload,
      recovery: recoveryPolicy,
      needsResubscribe: false,
      accept: (rawPayload) => {
        try {
          const value = decode(rawPayload);
          if (value === undefined) return false;
          sink.next(value);
          return true;
        } catch (cause) {
          sink.error(
            cause instanceof Error
              ? cause
              : new TRConnectionError("Could not decode the Topic response", { cause }),
          );
          return false;
        }
      },
      fail: (error) => {
        if (!active) return;
        active = false;
        sink.error(error);
      },
      reset: () => sink.reset?.(),
    };
    subscriptions.set(requestId, subscription);

    try {
      send(`sub ${requestId} ${serializedPayload}`);
    } catch (cause) {
      active = false;
      subscriptions.delete(requestId);
      sink.error(toConnectionError("Could not subscribe to the Topic", cause));
    }

    return {
      unsubscribe: () => {
        if (!active) return;
        active = false;
        subscriptions.delete(requestId);
        if (recovery && !hasRecoverableSubscriptions()) {
          const error = new TRConnectionError("Connection recovery was cancelled");
          cancelRecovery(error);
          rejectConnection?.(error);
          abandonTransport();
        }
        if (!connected) return;
        try {
          send(`unsub ${requestId}`);
        } catch {
          // The caller has stopped. A failed acknowledgement changes nothing.
        }
      },
    };
  };

  return {
    get isAlive() {
      return alive;
    },
    connect,
    reconnect,
    reconnectAfterLogin,
    disconnect,
    subscribe,
  };
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
