import {
  AccountInfo,
  AllDocuments,
  LoginResponseDataSchema,
  PaymentMethods,
  PersonalDetails,
  TaxExemptionOrders,
  TaxInformation,
  TaxResidency,
  TrendingStocks,
} from "./types";
import { extractCookiesFromResponse, makeSignedRequest } from "./utils";
import { TRWebSocket } from "./websocket";

export class TradeRepublicClient {
  private processId: string | null = null;
  private initialCookies: string[] = [];
  private sessionCookies: string[] = [];
  private language: string;

  // WebSocket subscriptions namespace
  public ws: TRWebSocket = new TRWebSocket([]);

  constructor(language: string = "en") {
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
  public async completeLogin(otpCode: string): Promise<string[]> {
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
    this.ws = new TRWebSocket(this.sessionCookies, this.language);
    return this.sessionCookies;
  }

  /**
   * Authenticates using existing session cookies.
   * This bypasses the normal login flow - ensure cookies are valid and secure.
   * @param cookies Array of session cookies from a previous authenticated session
   */
  public async loginWithCookies(cookies: string[]): Promise<string[]> {
    if (!cookies || cookies.length === 0) {
      return Promise.reject(new Error("Invalid cookies provided"));
    }

    this.processId = null;
    this.initialCookies = [];

    this.sessionCookies = cookies;
    this.ws = new TRWebSocket(this.sessionCookies, this.language);
    return this.sessionCookies;
  }

  /**
   * Retrieves account information. Requires successful authentication.
   */
  public async getAccountInfo(): Promise<AccountInfo> {
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
  public async getTrendingStocks(): Promise<TrendingStocks> {
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
  public async getTaxExemptionOrders(): Promise<TaxExemptionOrders> {
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
  public async getPersonalDetails(): Promise<PersonalDetails> {
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
  public async getPaymentMethods(): Promise<PaymentMethods> {
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
  public async getTaxResidency(): Promise<TaxResidency> {
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
  public async getTaxInformation(): Promise<TaxInformation> {
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
  public async getAllDocuments(): Promise<AllDocuments> {
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
}

// Export types for users
export type {
  AccountInfo,
  AllDocuments,
  PaymentMethods,
  PersonalDetails,
  TaxExemptionOrders,
  TaxInformation,
  TaxResidency,
  TrendingStocks,
} from "./types";

// Export WebSocket related exports
export type {
  CompactPortfolioByTypeRequest,
  CompactPortfolioByTypeResponse,
  NamedWatchlistRequest,
  NamedWatchlistResponse,
  PortfolioStatusResponse,
  WatchlistsResponse,
} from "./subscriptionTypes";
export { TRWebSocket } from "./websocket";
