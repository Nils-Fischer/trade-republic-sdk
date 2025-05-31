import EventEmitter from "eventemitter3";
import { createWebSocket, IWebSocketClient } from "./websocketFactory";

export class TRWebSocket extends EventEmitter {
  private sessionCookies: string[];
  private language: string;
  private webSocket: IWebSocketClient | null = null;

  constructor(sessionCookies: string[], language: string = "en") {
    super();
    this.sessionCookies = sessionCookies;
    this.language = language;
  }

  /**
   * Establishes a WebSocket connection with authentication cookies.
   * Requires successful authentication.
   */
  public async connectWebSocket(
    url: string = "wss://api.traderepublic.com",
  ): Promise<void> {
    if (this.sessionCookies.length) {
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
        this.emit("message", event.data);
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
}
