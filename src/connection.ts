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
const CONNECT_FRAME = `connect 31 ${JSON.stringify({
  locale: "en",
  platformId: "webtrading",
  clientId: "app.traderepublic.com",
  clientVersion: "3.181.1",
})}`;

export interface SubscriptionSink<Value> {
  next(value: Value): void;
  error(error: Error): void;
}

export interface SubscriptionControl {
  unsubscribe(): void;
}

interface ActiveSubscription {
  previousPayload?: string;
  accept(payload: string): boolean;
  fail(error: Error): void;
}

export interface Connection {
  readonly isAlive: boolean;
  connect(): Promise<void>;
  subscribe<Value>(
    payload: object,
    decode: (payload: string) => Value | undefined,
    sink: SubscriptionSink<Value>,
  ): SubscriptionControl;
}

export function createConnection(environment: ResolvedEnvironment): Connection {
  const subscriptions = new Map<number, ActiveSubscription>();
  let socket: Socket | undefined;
  let connectionPromise: Promise<void> | undefined;
  let resolveConnection: (() => void) | undefined;
  let rejectConnection: ((error: Error) => void) | undefined;
  let echoTimer: TimerHandle | undefined;
  let lastEcho: string | undefined;
  let nextRequestId = 1;
  let connected = false;
  let closed = false;
  let alive = false;

  const send = (line: string): void => {
    if (!socket) throw new TRConnectionError("The WebSocket does not exist");
    socket.send(line);
  };

  const failHandshake = (error: Error): void => {
    rejectConnection?.(error);
    resolveConnection = undefined;
    rejectConnection = undefined;
  };

  const handleFrame = (raw: string): void => {
    const frame = parseFrame(raw);
    if (!frame) return;

    const subscription = subscriptions.get(frame.requestId);
    if (!subscription) return;

    switch (frame.kind) {
      case "snapshot":
        if (subscription.accept(frame.payload)) {
          subscription.previousPayload = frame.payload;
        }
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

  const sendEcho = (): void => {
    const echo = `echo ${environment.clock.now()}`;
    lastEcho = echo;
    alive = false;
    try {
      send(echo);
    } catch {
      // A close event reports the connection failure to active operations.
    }
  };

  const onOpen = (): void => {
    try {
      send(CONNECT_FRAME);
      echoTimer = environment.clock.setInterval(sendEcho, ECHO_INTERVAL_MS);
    } catch (cause) {
      failHandshake(toConnectionError("Could not send the WebSocket handshake", cause));
    }
  };

  const onMessage = ({ data }: SocketMessageEvent): void => {
    if (data === "connected") {
      if (!connected) {
        connected = true;
        resolveConnection?.();
        resolveConnection = undefined;
        rejectConnection = undefined;
      }
      return;
    }

    if (data.startsWith("echo ")) {
      if (data === lastEcho) alive = true;
      return;
    }

    handleFrame(data);
  };

  const onError = (event: SocketErrorEvent): void => {
    alive = false;
    if (!connected) {
      failHandshake(
        toConnectionError(
          "The WebSocket failed before Trade Republic accepted it",
          event.error ?? event,
        ),
      );
    }
  };

  const onClose = (event: SocketCloseEvent): void => {
    closed = true;
    connected = false;
    alive = false;
    if (echoTimer !== undefined) {
      environment.clock.clearInterval(echoTimer);
      echoTimer = undefined;
    }

    const error = new TRConnectionError("The WebSocket connection closed", { cause: event });
    failHandshake(error);
    const activeSubscriptions = [...subscriptions.values()];
    subscriptions.clear();
    activeSubscriptions.forEach((subscription) => subscription.fail(error));
  };

  const connect = (): Promise<void> => {
    if (connected) return Promise.resolve();
    if (connectionPromise) return connectionPromise;
    if (closed) {
      return Promise.reject(new TRConnectionError("The WebSocket connection is closed"));
    }

    try {
      socket = environment.socket(SOCKET_URL);
    } catch (cause) {
      return Promise.reject(toConnectionError("Could not create the WebSocket", cause));
    }

    connectionPromise = new Promise<void>((resolve, reject) => {
      resolveConnection = resolve;
      rejectConnection = reject;
    });
    socket.onopen = onOpen;
    socket.onmessage = onMessage;
    socket.onerror = onError;
    socket.onclose = onClose;

    return connectionPromise;
  };

  const subscribe = <Value>(
    payload: object,
    decode: (payload: string) => Value | undefined,
    sink: SubscriptionSink<Value>,
  ): SubscriptionControl => {
    if (!connected) throw new TRConnectionError("The WebSocket is not connected");

    const requestId = nextRequestId++;
    let active = true;
    const subscription: ActiveSubscription = {
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
        active = false;
        sink.error(error);
      },
    };
    subscriptions.set(requestId, subscription);

    try {
      send(`sub ${requestId} ${JSON.stringify(payload)}`);
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
    subscribe,
  };
}
