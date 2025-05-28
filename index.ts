import { LoginResponseDataSchema } from "./types";
import { extractCookiesFromResponse, makeSignedRequest } from "./utils";

export class TradeRepublicClient {
  private processId: string | null = null;
  private initialCookies: string[] = [];
  private sessionCookies: string[] = [];
  private language: string;

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

    console.log("Login initiated. OTP has been sent to your device.");
  }

  /**
   * Completes the login process using the OTP received on the user's device.
   * Must be called after initiateLogin().
   */
  public async completeLogin(otpCode: string): Promise<void> {
    if (!this.processId) {
      throw new Error("Login not initiated. Call initiateLogin() first.");
    }

    if (this.initialCookies.length === 0) {
      throw new Error("No initial cookies found. Call initiateLogin() first.");
    }

    const response = await makeSignedRequest(
      `/api/v1/auth/web/login/${this.processId}/${otpCode}`,
      {},
      "POST",
      this.initialCookies,
      this.language,
    );

    this.sessionCookies = extractCookiesFromResponse(response);
    console.log("Login completed successfully.");
  }

  /**
   * Retrieves account information. Requires successful authentication.
   */
  public async getAccountInfo(): Promise<unknown> {
    if (this.sessionCookies.length === 0) {
      throw new Error(
        "Not authenticated. Call initiateLogin() and completeLogin() first.",
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
      throw new Error(
        "Not authenticated. Call initiateLogin() and completeLogin() first.",
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
      throw new Error(
        "Not authenticated. Call initiateLogin() and completeLogin() first.",
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
      throw new Error(
        "Not authenticated. Call initiateLogin() and completeLogin() first.",
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
      throw new Error(
        "Not authenticated. Call initiateLogin() and completeLogin() first.",
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
      throw new Error(
        "Not authenticated. Call initiateLogin() and completeLogin() first.",
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
      throw new Error(
        "Not authenticated. Call initiateLogin() and completeLogin() first.",
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
      throw new Error(
        "Not authenticated. Call initiateLogin() and completeLogin() first.",
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
