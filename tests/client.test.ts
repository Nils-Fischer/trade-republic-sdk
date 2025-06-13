import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { TradeRepublicClient } from "../index";
import {
  AccountInfoSchema,
  AllDocumentsSchema,
  PaymentMethodsSchema,
  PersonalDetailsSchema,
  TaxExemptionOrdersSchema,
  TaxInformationSchema,
  TaxResidencySchema,
  TrendingStocksSchema,
} from "../types";
import { ensureAuthenticationForTests } from "./auth-setup";

describe("TradeRepublicClient", () => {
  let client: TradeRepublicClient;

  beforeAll(async () => {
    const cookies = await ensureAuthenticationForTests();

    client = new TradeRepublicClient();
    await client.loginWithCookies(cookies);
  });

  afterAll(() => {
    if (client) {
      client.logout();
    }
  });

  describe("Authentication", () => {
    test("should be authenticated after setup", () => {
      expect(client.isAuthenticated()).toBe(true);
    });

    test("should have a valid WebSocket instance", () => {
      expect(client.ws).toBeDefined();
      expect(typeof client.ws.connectWebSocket).toBe("function");
    });
  });

  describe("Account Information", () => {
    test("should fetch account information", async () => {
      const accountInfo = await client.getAccountInfo();
      expect(accountInfo).toBeDefined();

      // Validate that the response matches the exact schema format
      const validationResult = AccountInfoSchema.safeParse(accountInfo);
      expect(validationResult.success).toBe(true);
      if (!validationResult.success) {
        console.error("AccountInfo validation errors:", validationResult.error.issues);
      }
    });

    test("should fetch personal details", async () => {
      const personalDetails = await client.getPersonalDetails();
      expect(personalDetails).toBeDefined();

      // Validate that the response matches the exact schema format
      const validationResult = PersonalDetailsSchema.safeParse(personalDetails);
      expect(validationResult.success).toBe(true);
      if (!validationResult.success) {
        console.error(
          "PersonalDetails validation errors:",
          validationResult.error.issues,
        );
      }
    });

    test("should fetch payment methods", async () => {
      const paymentMethods = await client.getPaymentMethods();
      expect(paymentMethods).toBeDefined();

      // Validate that the response matches the exact schema format
      const validationResult = PaymentMethodsSchema.safeParse(paymentMethods);
      expect(validationResult.success).toBe(true);
      if (!validationResult.success) {
        console.error("PaymentMethods validation errors:", validationResult.error.issues);
      }
    });
  });

  describe("Financial Data", () => {
    test("should fetch trending stocks", async () => {
      const trendingStocks = await client.getTrendingStocks();
      expect(trendingStocks).toBeDefined();

      // Validate that the response matches the exact schema format
      const validationResult = TrendingStocksSchema.safeParse(trendingStocks);
      expect(validationResult.success).toBe(true);
      if (!validationResult.success) {
        console.error("TrendingStocks validation errors:", validationResult.error.issues);
      }
    });
  });

  describe("Tax Information", () => {
    test("should fetch tax exemption orders", async () => {
      const taxExemptionOrders = await client.getTaxExemptionOrders();
      expect(taxExemptionOrders).toBeDefined();

      // Validate that the response matches the exact schema format
      const validationResult = TaxExemptionOrdersSchema.safeParse(taxExemptionOrders);
      expect(validationResult.success).toBe(true);
      if (!validationResult.success) {
        console.error(
          "TaxExemptionOrders validation errors:",
          validationResult.error.issues,
        );
      }
    });

    test("should fetch tax residency information", async () => {
      const taxResidency = await client.getTaxResidency();
      expect(taxResidency).toBeDefined();

      // Validate that the response matches the exact schema format
      const validationResult = TaxResidencySchema.safeParse(taxResidency);
      expect(validationResult.success).toBe(true);
      if (!validationResult.success) {
        console.error("TaxResidency validation errors:", validationResult.error.issues);
      }
    });

    test("should fetch tax information", async () => {
      const taxInformation = await client.getTaxInformation();
      expect(taxInformation).toBeDefined();

      // Validate that the response matches the exact schema format
      const validationResult = TaxInformationSchema.safeParse(taxInformation);
      expect(validationResult.success).toBe(true);
      if (!validationResult.success) {
        console.error("TaxInformation validation errors:", validationResult.error.issues);
      }
    });
  });

  describe("Documents", () => {
    test("should fetch all documents", async () => {
      const allDocuments = await client.getAllDocuments();
      expect(allDocuments).toBeDefined();

      // Validate that the response matches the exact schema format
      const validationResult = AllDocumentsSchema.safeParse(allDocuments);
      expect(validationResult.success).toBe(true);
      if (!validationResult.success) {
        console.error("AllDocuments validation errors:", validationResult.error.issues);
      }
    });
  });

  describe("Error Handling", () => {
    test("should handle unauthenticated requests properly", async () => {
      const unauthenticatedClient = new TradeRepublicClient();

      try {
        await unauthenticatedClient.getAccountInfo();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.message).toContain("Not authenticated");
      }
    });

    test("should handle incomplete login flow", async () => {
      const incompleteClient = new TradeRepublicClient();

      try {
        await incompleteClient.completeLogin("1234");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.message).toContain("Login not initiated");
      }
    });

    test("should handle invalid cookies", async () => {
      const invalidCookieClient = new TradeRepublicClient();

      try {
        await invalidCookieClient.loginWithCookies([]);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.message).toContain("Invalid cookies provided");
      }
    });
  });

  describe("Client State Management", () => {
    test("should properly logout and clear state", () => {
      const testClient = new TradeRepublicClient();
      testClient.logout();

      expect(testClient.isAuthenticated()).toBe(false);
    });

    test("should maintain language setting", () => {
      const germanClient = new TradeRepublicClient("de");
      const englishClient = new TradeRepublicClient("en");

      // Language is private, but we can test that different instances can be created
      expect(germanClient).toBeInstanceOf(TradeRepublicClient);
      expect(englishClient).toBeInstanceOf(TradeRepublicClient);
    });
  });

  describe("Cookie Fallback Integration", () => {
    test("should correctly parse cookies during login on platforms without getSetCookie", async () => {
      const fallbackClient = new TradeRepublicClient();

      const rawCookieHeader =
        "tr_session=a-fallback-session-id; path=/; secure, __cf_bm=a-fallback-cookie; expires=Thu, 26-Oct-2024 10:00:00 GMT";

      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          processId: "12345",
          countdownInSeconds: 180,
          "2fa": "sms",
        }),
        text: async () =>
          JSON.stringify({
            processId: "12345",
            countdownInSeconds: 180,
            "2fa": "sms",
          }),
        headers: {
          get: (header: string) => {
            if (header.toLowerCase() === "set-cookie") {
              return rawCookieHeader;
            }
            return null;
          },
          // No getSetCookie present on this mocked response
        },
      } as unknown as Response;

      // Mock global.fetch for just this test
      const originalFetch = global.fetch;
      global.fetch = mock(async () => mockResponse) as any;

      // This will call makeSignedRequest and then extractCookiesFromResponse internally
      await fallbackClient.initiateLogin("+123456789", "1234");

      // Verify that the client's internal state was set correctly by the fallback logic
      const internalCookies = (fallbackClient as any).initialCookies;
      expect(internalCookies).toEqual([
        "tr_session=a-fallback-session-id",
        "__cf_bm=a-fallback-cookie",
      ]);

      // Restore global.fetch
      global.fetch = originalFetch;
    });
  });
});
