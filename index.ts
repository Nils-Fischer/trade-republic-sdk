import { EventEmitter } from "eventemitter3";
import { LoginResponseDataSchema } from "./types";
import { extractCookiesFromResponse, makeSignedRequest } from "./utils";
import { createWebSocket } from "./websocketFactory";

export class TradeRepublicClient extends EventEmitter {
  private processId: string | null = null;
  private initialCookies: string[] = [];
  private sessionCookies: string[] = [];
  private language: string;
  private ws: WebSocket | null = null;

  constructor(language: string = "en") {
    super();
    this.language = language;
  }

  /**
   * Initiates the login process by sending phone number and PIN.
   * After this call succeeds, an OTP will be sent to the user's device.
   * Call completeLogin() with the OTP to finish authentication.
   */
  public async initiateLogin(phoneNumber: string, pin: string): Promise<void> {
    const response: Response = await makeSignedRequest(
      "/api/v1/auth/web/login",
      {
        phoneNumber,
        pin,
      },
      "POST",
      undefined,
      this.language,
    );

    const data = LoginResponseDataSchema.parse(await response.json());
    this.processId = data.processId;
    this.initialCookies = extractCookiesFromResponse(response);
  }

  /**
   * Completes the login process using the OTP received on the user's device.
   * Must be called after initiateLogin().
   */
  public async completeLogin(otpCode: string): Promise<void> {
    if (!this.processId) {
      return Promise.reject(
        new Error("Login not initiated. Call initiateLogin() first."),
      );
    }

    if (this.initialCookies.length === 0) {
      return Promise.reject(
        new Error("No initial cookies found. Call initiateLogin() first."),
      );
    }

    const response = await makeSignedRequest(
      `/api/v1/auth/web/login/${this.processId}/${otpCode}`,
      {},
      "POST",
      this.initialCookies,
      this.language,
    );

    this.sessionCookies = extractCookiesFromResponse(response);
  }

  /**
   * Retrieves account information. Requires successful authentication.
   */
  public async getAccountInfo(): Promise<unknown> {
    if (this.sessionCookies.length === 0) {
      return Promise.reject(
        new Error("Not authenticated. Call initiateLogin() and completeLogin() first."),
      );
    }

    const result = await makeSignedRequest(
      "/api/v2/auth/account",
      {},
      "GET",
      this.sessionCookies,
      this.language,
    );
    return result.json();
  }

  /**
   * Retrieves trending stocks. Requires successful authentication.
   */
  public async getTrendingStocks(): Promise<unknown> {
    if (this.sessionCookies.length === 0) {
      return Promise.reject(
        new Error("Not authenticated. Call initiateLogin() and completeLogin() first."),
      );
    }

    const result = await makeSignedRequest(
      "/api/v1/ranking/trendingStocks",
      {},
      "GET",
      this.sessionCookies,
      this.language,
    );
    return result.json();
  }

  /**
   * Retrieves tax exemption orders. Requires successful authentication.
   */
  public async getTaxExemptionOrders(): Promise<unknown> {
    if (this.sessionCookies.length === 0) {
      return Promise.reject(
        new Error("Not authenticated. Call initiateLogin() and completeLogin() first."),
      );
    }

    const result = await makeSignedRequest(
      "/api/v1/taxes/exemptionorders",
      {},
      "GET",
      this.sessionCookies,
      this.language,
    );
    return result.json();
  }

  /**
   * Retrieves customer personal details. Requires successful authentication.
   */
  public async getPersonalDetails(): Promise<unknown> {
    if (this.sessionCookies.length === 0) {
      return Promise.reject(
        new Error("Not authenticated. Call initiateLogin() and completeLogin() first."),
      );
    }

    const result = await makeSignedRequest(
      "/api/v1/customer/personal-details",
      {},
      "GET",
      this.sessionCookies,
      this.language,
    );
    return result.json();
  }

  /**
   * Retrieves payment methods. Requires successful authentication.
   */
  public async getPaymentMethods(): Promise<unknown> {
    if (this.sessionCookies.length === 0) {
      return Promise.reject(
        new Error("Not authenticated. Call initiateLogin() and completeLogin() first."),
      );
    }

    const result = await makeSignedRequest(
      "/api/v2/payment/methods",
      {},
      "GET",
      this.sessionCookies,
      this.language,
    );
    return result.json();
  }

  /**
   * Retrieves tax residency information. Requires successful authentication.
   */
  public async getTaxResidency(): Promise<unknown> {
    if (this.sessionCookies.length === 0) {
      return Promise.reject(
        new Error("Not authenticated. Call initiateLogin() and completeLogin() first."),
      );
    }

    const result = await makeSignedRequest(
      "/api/v1/country/taxresidency",
      {},
      "GET",
      this.sessionCookies,
      this.language,
    );
    return result.json();
  }

  /**
   * Retrieves tax information. Requires successful authentication.
   */
  public async getTaxInformation(): Promise<unknown> {
    if (this.sessionCookies.length === 0) {
      return Promise.reject(
        new Error("Not authenticated. Call initiateLogin() and completeLogin() first."),
      );
    }

    const result = await makeSignedRequest(
      "/api/v1/taxes/information",
      {},
      "GET",
      this.sessionCookies,
      this.language,
    );
    return result.json();
  }

  /**
   * Retrieves all documents. Requires successful authentication.
   */
  public async getAllDocuments(): Promise<unknown> {
    if (this.sessionCookies.length === 0) {
      return Promise.reject(
        new Error("Not authenticated. Call initiateLogin() and completeLogin() first."),
      );
    }

    const result = await makeSignedRequest(
      "/api/v1/documents/all",
      {},
      "GET",
      this.sessionCookies,
      this.language,
    );
    return result.json();
  }

  /**
   * Checks if the client is currently authenticated.
   */
  public isAuthenticated(): boolean {
    return this.sessionCookies.length > 0;
  }

  /**
   * Clears the current session, requiring re-authentication.
   */
  public logout(): void {
    this.processId = null;
    this.initialCookies = [];
    this.sessionCookies = [];
  }

  /**
   * Checks if WebSocket is connected and ready.
   */
  public isWebSocketConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Sends a raw message to the WebSocket.
   */
  public sendMessage(message: string): void {
    if (!this.isWebSocketConnected()) {
      throw new Error("WebSocket is not connected.");
    }
    this.ws!.send(message);
  }

  /**
   * Subscribes to a data feed.
   */
  public subscribe(requestId: string, payload: object): void {
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

  /**
   * Closes the WebSocket connection.
   */
  public disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Establishes a WebSocket connection with authentication cookies.
   * Requires successful authentication.
   */
  public async connectWebSocket(
    url: string = "wss://api.traderepublic.com",
  ): Promise<void> {
    if (this.sessionCookies.length === 0) {
      throw new Error(
        "Not authenticated. Call initiateLogin() and completeLogin() first.",
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

      this.ws = wsClient as any; // Store reference if needed
    } catch (error) {
      this.emit("error", error);
      throw error;
    }
  }
}
