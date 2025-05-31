import EventEmitter from "eventemitter3";
import { CustomerPermissionsPayload } from "./subscriptionTypes";
import { createWebSocket, IWebSocketClient } from "./websocketFactory";

export class TRWebSocket extends EventEmitter {
  private sessionCookies: string[];
  private language: string;
  private webSocket: IWebSocketClient | null = null;
  private subscriptions: Map<string, ((data: any) => void) | undefined> = new Map();
  private lastSubscriptionPayload: Map<string, string> = new Map();
  private requestIdCounter = 1;

  constructor(sessionCookies: string[], language: string = "en") {
    super();
    this.sessionCookies = sessionCookies;
    this.language = language;
  }

  /**
   * Parses a delta string and applies it to the original text
   */
  private applyDelta(original: string, deltaString: string): string {
    const tokens = deltaString.trim().split(/\s+/);
    let result = "";
    let originalIndex = 0;

    for (const token of tokens) {
      if (token.startsWith("=")) {
        // Copy N characters from original
        const count = parseInt(token.slice(1));
        result += original.slice(originalIndex, originalIndex + count);
        originalIndex += count;
      } else if (token.startsWith("-")) {
        // Skip N characters from original
        const count = parseInt(token.slice(1));
        originalIndex += count;
      } else if (token.startsWith("+")) {
        // Insert literal text
        const text = token.slice(1);
        result += text;
      }
    }

    return result;
  }

  /**
   * Establishes a WebSocket connection with authentication cookies.
   * Requires successful authentication.
   */
  public async connectWebSocket(
    url: string = "wss://api.traderepublic.com",
  ): Promise<void> {
    if (this.sessionCookies.length === 0) {
      return Promise.reject(
        new Error("Not authenticated. Call initiateLogin() and completeLogin() first."),
      );
    }

    try {
      // Convert cookies array to cookie header string
      const cookieHeader = this.sessionCookies.join("; ");

      const wsClient = await createWebSocket(url, undefined, {
        Cookie: cookieHeader,
        Origin: "https://app.traderepublic.com",
      });

      wsClient.onopen = () => {
        const requestId = "31";
        const payload = {
          locale: this.language,
          platformId: "webtrading",
          clientId: "app.traderepublic.com",
          clientVersion: "3.181.1", // TODO: get this from the app
        };
        const connectMessage = `connect ${requestId} ${JSON.stringify(payload)}`;

        wsClient.send(connectMessage);
        this.emit("open");
      };

      wsClient.onmessage = (event) => {
        const raw = event.data as string;
        this.emit("message", raw);

        const [id, letter, ...parts] = raw.split(" ");
        const payload = parts.join(" ");

        if (!id || !this.subscriptions.has(id)) return;

        switch (letter) {
          case "A":
            // full snapshot
            try {
              const full = JSON.parse(payload);
              this.lastSubscriptionPayload.set(id, payload);
              this.subscriptions.get(id)?.(full);
            } catch (err) {
              console.error("Failed to parse full snapshot:", err);
            }
            break;

          case "D":
            // delta update
            const lastPayload = this.lastSubscriptionPayload.get(id);
            if (lastPayload) {
              const newPayloadString = this.applyDelta(lastPayload, payload);
              try {
                const updated = JSON.parse(newPayloadString);
                this.lastSubscriptionPayload.set(id, newPayloadString);
                this.subscriptions.get(id)?.(updated);
              } catch (error) {
                console.error("Failed to parse delta result:", error);
              }
            } else {
              // No previous payload to apply delta to
              console.warn("No previous payload to apply delta to");
            }
            break;

          case "C":
            // subscription closed – no payload
            this.subscriptions.get(id)?.({ messageType: "C" });
            this.subscriptions.delete(id);
            this.lastSubscriptionPayload.delete(id);
            break;
        }
      };

      wsClient.onerror = (error) => {
        this.emit("error", error);
      };

      wsClient.onclose = (event) => {
        this.emit("close", event);
      };

      this.webSocket = wsClient;
    } catch (error) {
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Closes the WebSocket connection.
   */
  public disconnectWebSocket(): void {
    if (this.webSocket) {
      this.webSocket.close();
      this.webSocket = null;
    }
  }

  /**
   * Sends a raw message to the WebSocket.
   */
  public sendMessage(message: string): void {
    if (!this.webSocket) throw new Error("WebSocket is not connected.");
    this.webSocket.send(message);
  }

  /**
   * Subscribes to a data feed.
   */
  public subscribe(requestId: string, payload: object): void {
    if (!this.webSocket) throw new Error("WebSocket is not connected.");
    const message = `sub ${requestId} ${JSON.stringify(payload)}`;
    this.sendMessage(message);
  }

  /**
   * Unsubscribes from a data feed.
   */
  public unsubscribe(requestId: string, payload: object): void {
    const message = `unsub ${requestId} ${JSON.stringify(payload)}`;
    this.sendMessage(message);
  }

  public subscribeTo<T>(payload: object, callback?: (data: T) => void): void {
    const requestId = this.requestIdCounter.toString();
    this.requestIdCounter += 1;
    this.subscriptions.set(requestId, callback);
    this.subscribe(requestId, payload);
  }

  public subscribeToCustomerPermissions(
    callback?: (data: CustomerPermissionsPayload) => void,
  ): void {
    this.subscribeTo({ type: "customerPermissions" }, callback);
  }
}
