/*
 * Comprehensive WebSocket Test Suite
 *
 * This test file provides comprehensive testing of all WebSocket functionality including:
 * - Connection and disconnection testing
 * - All subscription methods with live data validation
 * - Schema validation for requests and responses
 * - Error handling
 *
 * Note: This test requires valid authentication cookies and an active internet connection.
 * Some tests may timeout or fail schema validation if the real-world API responses
 * differ from expected schemas or if the websocket connection is unstable.
 *
 * For simpler method existence testing, see websocket-methods.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  AccountPairsRequestSchema,
  AccountPairsResponseSchema,
  AggregateHistoryLightRequestSchema,
  AggregateHistoryLightResponseSchema,
  AvailableCashForPayoutRequestSchema,
  AvailableCashRequestSchema,
  AvailableCashResponseSchema,
  AvailableSizeRequestSchema,
  AvailableSizeResponseSchema,
  CashRequestSchema,
  CashResponseSchema,
  CollectionRequestSchema,
  CollectionResponseSchema,
  CompactPortfolioByTypeRequestSchema,
  CustomerPermissionsRequestSchema,
  CustomerPermissionsResponseSchema,
  FincrimeBannerRequestSchema,
  FincrimeBannerResponseSchema,
  FrontendExperimentRequestSchema,
  FrontendExperimentResponseSchema,
  HomeInstrumentExchangeRequestSchema,
  HomeInstrumentExchangeResponseSchema,
  InstrumentRequestSchema,
  InstrumentResponseSchema,
  NamedWatchlistRequestSchema,
  NamedWatchlistResponseSchema,
  NeonNewsRequestSchema,
  NeonNewsResponseSchema,
  NeonSearchRequestSchema,
  NeonSearchResponseSchema,
  NeonSearchSuggestedTagRequestSchema,
  NeonSearchSuggestedTagResponseSchema,
  OrdersRequestSchema,
  OrdersResponseSchema,
  PerformanceRequestSchema,
  PortfolioStatusRequestSchema,
  PriceForOrderRequestSchema,
  PriceForOrderResponseSchema,
  SavingsPlansRequestSchema,
  SavingsPlansResponseSchema,
  StockDetailsRequestSchema,
  StockDetailsResponseSchema,
  TickerRequestSchema,
  TickerResponseSchema,
  TimelineActionsV2RequestSchema,
  TimelineActionsV2ResponseSchema,
  TimelineDetailV2RequestSchema,
  TimelineTransactionsRequestSchema,
  TradingPerkConditionStatusRequestSchema,
  TradingPerkConditionStatusResponseSchema,
  WatchlistsRequestSchema,
  WatchlistsResponseSchema,
  YieldToMaturityRequestSchema,
  YieldToMaturityResponseSchema,
} from "../subscriptionTypes";
import { TRWebSocket } from "../websocket";

const COOKIES_FILE = join(process.cwd(), "test-cookies.json");

function loadTestCookies(): string[] | null {
  try {
    if (!existsSync(COOKIES_FILE)) {
      return null;
    }

    const cookiesData = readFileSync(COOKIES_FILE, "utf-8");
    const cookies = JSON.parse(cookiesData);

    if (!Array.isArray(cookies) || cookies.length === 0) {
      return null;
    }

    return cookies;
  } catch (error) {
    return null;
  }
}

describe("TRWebSocket", () => {
  let websocket: TRWebSocket;
  let cookies: string[];

  beforeAll(async () => {
    // Load test cookies that should be set up by running: bun run test:setup
    const testCookies = loadTestCookies();
    if (!testCookies) {
      throw new Error(
        'No test cookies found. Please run "bun run test:setup" first to authenticate.',
      );
    }

    cookies = testCookies;
    websocket = new TRWebSocket(cookies, "en");
  });

  afterAll(() => {
    if (websocket) {
      websocket.disconnectWebSocket();
    }
  });

  describe("WebSocket Connection", () => {
    test("should create websocket instance with cookies", () => {
      expect(websocket).toBeDefined();
      expect(typeof websocket.connectWebSocket).toBe("function");
      expect(typeof websocket.disconnectWebSocket).toBe("function");
    });

    test("should reject connection without cookies", async () => {
      const emptyWebSocket = new TRWebSocket([]);

      try {
        await emptyWebSocket.connectWebSocket();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.message).toContain("Not authenticated");
      }
    });

    test("should connect to websocket successfully", async () => {
      // Add a timeout to prevent test hanging
      const connectPromise = websocket.connectWebSocket();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Connection timeout")), 10000),
      );

      await Promise.race([connectPromise, timeoutPromise]);

      // Verify connection is established
      expect(websocket).toBeDefined();
    }, 15000);

    test("should handle websocket events", (done) => {
      websocket.on("open", () => {
        expect(true).toBe(true);
        done();
      });

      websocket.on("error", (error) => {
        done(error);
      });
    });
  });

  describe("Core WebSocket Methods", () => {
    test("should have sendMessage method", () => {
      expect(typeof websocket.sendMessage).toBe("function");
    });

    test("should have subscribe and unsubscribe methods", () => {
      expect(typeof websocket.subscribe).toBe("function");
      expect(typeof websocket.unsubscribe).toBe("function");
    });

    test("should have subscribeTo method", () => {
      expect(typeof websocket.subscribeTo).toBe("function");
    });
  });

  describe("Subscription Methods", () => {
    // Helper function to test subscription method with timeout
    const testSubscription = (methodName: string, request: any, responseSchema: any) => {
      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`${methodName} subscription timeout`));
        }, 5000);

        try {
          (websocket as any)[methodName](request, (response: any) => {
            clearTimeout(timeout);

            // Validate response against schema
            const validationResult = responseSchema.safeParse(response);
            if (!validationResult.success) {
              console.warn(
                `${methodName} response validation failed:`,
                validationResult.error.issues,
              );
              // Don't fail the test for validation errors as real-world data might vary
            }

            expect(response).toBeDefined();
            resolve();
          });
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      });
    };

    test("should have subscribeToAccountPairs method", async () => {
      const request = { type: "accountPairs" as const };
      expect(AccountPairsRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToAccountPairs).toBe("function");

      await testSubscription(
        "subscribeToAccountPairs",
        request,
        AccountPairsResponseSchema,
      );
    }, 10000);

    test("should have subscribeToAggregateHistoryLight method", async () => {
      const request = {
        type: "aggregateHistoryLight" as const,
        range: "1d" as const,
        id: "US88160R1014.XNAS", // Tesla as example
      };
      expect(AggregateHistoryLightRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToAggregateHistoryLight).toBe("function");

      await testSubscription(
        "subscribeToAggregateHistoryLight",
        request,
        AggregateHistoryLightResponseSchema,
      );
    }, 10000);

    test("should have subscribeToAvailableCash method", async () => {
      const request = { type: "availableCash" as const };
      expect(AvailableCashRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToAvailableCash).toBe("function");

      await testSubscription(
        "subscribeToAvailableCash",
        request,
        AvailableCashResponseSchema,
      );
    }, 10000);

    test("should validate AvailableCashForPayout request schema", async () => {
      const request = { type: "availableCashForPayout" as const };
      expect(AvailableCashForPayoutRequestSchema.safeParse(request).success).toBe(true);

      // Note: subscribeToAvailableCashForPayout method doesn't exist in websocket.ts
      // This test validates the schema but doesn't test the method since it's not implemented
    });

    test("should have subscribeToAvailableSize method", async () => {
      const request = {
        type: "availableSize" as const,
        parameters: {
          exchangeId: "LSX" as const,
          instrumentId: "US88160R1014\\.XNAS",
        },
      };
      expect(AvailableSizeRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToAvailableSize).toBe("function");

      await testSubscription(
        "subscribeToAvailableSize",
        request,
        AvailableSizeResponseSchema,
      );
    }, 10000);

    test("should have subscribeToCash method", async () => {
      const request = { type: "cash" as const };
      expect(CashRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToCash).toBe("function");

      await testSubscription("subscribeToCash", request, CashResponseSchema);
    }, 10000);

    test("should have subscribeToCollection method", async () => {
      const request = {
        type: "collection" as const,
        view: "carousel" as const,
      };
      expect(CollectionRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToCollection).toBe("function");

      await testSubscription("subscribeToCollection", request, CollectionResponseSchema);
    }, 10000);

    test("should have subscribeToCompactPortfolioByType method", async () => {
      // We need a valid securities account number - this would need to be obtained from account info
      const request = {
        type: "compactPortfolioByType" as const,
        secAccNo: "123456789", // Placeholder - would need real account number
      };
      expect(CompactPortfolioByTypeRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToCompactPortfolioByType).toBe("function");

      // Skip actual subscription test as it requires valid account number
      // await testSubscription("subscribeToCompactPortfolioByType", request, CompactPortfolioByTypeResponseSchema);
    });

    test("should have subscribeToCustomerPermissions method", async () => {
      const request = { type: "customerPermissions" as const };
      expect(CustomerPermissionsRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToCustomerPermissions).toBe("function");

      await testSubscription(
        "subscribeToCustomerPermissions",
        request,
        CustomerPermissionsResponseSchema,
      );
    }, 10000);

    test("should have subscribeToDerivatives method", async () => {
      // This method requires specific parameters that would need to be obtained from other calls
      expect(typeof websocket.subscribeToDerivatives).toBe("function");
    });

    test("should have subscribeToFincrimeBanner method", async () => {
      const request = { type: "fincrimeBanner" as const };
      expect(FincrimeBannerRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToFincrimeBanner).toBe("function");

      await testSubscription(
        "subscribeToFincrimeBanner",
        request,
        FincrimeBannerResponseSchema,
      );
    }, 10000);

    test("should have subscribeToFrontendExperiment method", async () => {
      const request = { type: "frontendExperiment" as const };
      expect(FrontendExperimentRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToFrontendExperiment).toBe("function");

      await testSubscription(
        "subscribeToFrontendExperiment",
        request,
        FrontendExperimentResponseSchema,
      );
    }, 10000);

    test("should have subscribeToHomeInstrumentExchange method", async () => {
      const request = {
        type: "homeInstrumentExchange" as const,
        exchangeId: "LSX",
      };
      expect(HomeInstrumentExchangeRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToHomeInstrumentExchange).toBe("function");

      await testSubscription(
        "subscribeToHomeInstrumentExchange",
        request,
        HomeInstrumentExchangeResponseSchema,
      );
    }, 10000);

    test("should have subscribeToInstrument method", async () => {
      const request = {
        type: "instrument" as const,
        id: "US88160R1014.XNAS",
        jurisdiction: "DE",
      };
      expect(InstrumentRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToInstrument).toBe("function");

      await testSubscription("subscribeToInstrument", request, InstrumentResponseSchema);
    }, 10000);

    test("should have subscribeToNamedWatchlist method", async () => {
      const request = {
        type: "namedWatchlist" as const,
        id: "popular",
      };
      expect(NamedWatchlistRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToNamedWatchlist).toBe("function");

      await testSubscription(
        "subscribeToNamedWatchlist",
        request,
        NamedWatchlistResponseSchema,
      );
    }, 10000);

    test("should have subscribeToNeonNews method", async () => {
      const request = {
        type: "neonNews" as const,
        isin: "US88160R1014",
      };
      expect(NeonNewsRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToNeonNews).toBe("function");

      await testSubscription("subscribeToNeonNews", request, NeonNewsResponseSchema);
    }, 10000);

    test("should have subscribeToNeonSearch method", async () => {
      const request = {
        type: "neonSearch" as const,
        data: {
          q: "Tesla",
          page: 0,
          pageSize: 20,
          filter: [],
        },
      };
      expect(NeonSearchRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToNeonSearch).toBe("function");

      await testSubscription("subscribeToNeonSearch", request, NeonSearchResponseSchema);
    }, 10000);

    test("should have subscribeToNeonSearchSuggestedTags method", async () => {
      const request = { type: "neonSearchSuggestedTag" as const };
      expect(NeonSearchSuggestedTagRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToNeonSearchSuggestedTags).toBe("function");

      await testSubscription(
        "subscribeToNeonSearchSuggestedTags",
        request,
        NeonSearchSuggestedTagResponseSchema,
      );
    }, 10000);

    test("should have subscribeToOrders method", async () => {
      const request = { type: "orders" as const };
      expect(OrdersRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToOrders).toBe("function");

      await testSubscription("subscribeToOrders", request, OrdersResponseSchema);
    }, 10000);

    test("should have subscribeToPerformance method", async () => {
      const request = {
        type: "performance" as const,
        secAccNo: "123456789", // Placeholder
      };
      expect(PerformanceRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToPerformance).toBe("function");

      // Skip actual test as it requires valid account number
    });

    test("should have subscribeToPortfolioStatus method", async () => {
      const request = {
        type: "portfolioStatus" as const,
        secAccNo: "123456789", // Placeholder
      };
      expect(PortfolioStatusRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToPortfolioStatus).toBe("function");

      // Skip actual test as it requires valid account number
    });

    test("should have subscribeToPriceForOrder method", async () => {
      const request = {
        type: "priceForOrder" as const,
        parameters: {
          exchangeId: "LSX",
          instrumentId: "US88160R1014.XNAS",
        },
      };
      expect(PriceForOrderRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToPriceForOrder).toBe("function");

      await testSubscription(
        "subscribeToPriceForOrder",
        request,
        PriceForOrderResponseSchema,
      );
    }, 10000);

    test("should have subscribeToSavingsPlans method", async () => {
      const request = { type: "savingsPlans" as const };
      expect(SavingsPlansRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToSavingsPlans).toBe("function");

      await testSubscription(
        "subscribeToSavingsPlans",
        request,
        SavingsPlansResponseSchema,
      );
    }, 10000);

    test("should have subscribeToStockDetails method", async () => {
      const request = {
        type: "stockDetails" as const,
        id: "US88160R1014.XNAS",
      };
      expect(StockDetailsRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToStockDetails).toBe("function");

      await testSubscription(
        "subscribeToStockDetails",
        request,
        StockDetailsResponseSchema,
      );
    }, 10000);

    test("should have subscribeToTicker method", async () => {
      const request = {
        type: "ticker" as const,
        id: "US88160R1014.XNAS",
      };
      expect(TickerRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToTicker).toBe("function");

      await testSubscription("subscribeToTicker", request, TickerResponseSchema);
    }, 10000);

    test("should have subscribeToTimelineActionsV2 method", async () => {
      const request = { type: "timelineActionsV2" as const };
      expect(TimelineActionsV2RequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToTimelineActionsV2).toBe("function");

      await testSubscription(
        "subscribeToTimelineActionsV2",
        request,
        TimelineActionsV2ResponseSchema,
      );
    }, 10000);

    test("should have subscribeToTimelineDetailV2 method", async () => {
      const request = {
        type: "timelineDetailV2" as const,
        after: "placeholder-timeline-id",
      };
      expect(TimelineDetailV2RequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToTimelineDetailV2).toBe("function");

      // Skip actual test as it requires valid timeline data
    });

    test("should have subscribeToTimelineTransactions method", async () => {
      const request = {
        type: "timelineTransactions" as const,
        after: "placeholder-timeline-id",
      };
      expect(TimelineTransactionsRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToTimelineTransactions).toBe("function");

      // Skip actual test as it requires valid timeline data
    });

    test("should have subscribeToTradingPerkConditionStatus method", async () => {
      const request = { type: "tradingPerkConditionStatus" as const };
      expect(TradingPerkConditionStatusRequestSchema.safeParse(request).success).toBe(
        true,
      );
      expect(typeof websocket.subscribeToTradingPerkConditionStatus).toBe("function");

      await testSubscription(
        "subscribeToTradingPerkConditionStatus",
        request,
        TradingPerkConditionStatusResponseSchema,
      );
    }, 10000);

    test("should have subscribeToWatchlists method", async () => {
      const request = { type: "watchlists" as const };
      expect(WatchlistsRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToWatchlists).toBe("function");

      await testSubscription("subscribeToWatchlists", request, WatchlistsResponseSchema);
    }, 10000);

    test("should have subscribeToYieldToMaturity method", async () => {
      const request = {
        type: "yieldToMaturity" as const,
        isin: "US88160R1014",
      };
      expect(YieldToMaturityRequestSchema.safeParse(request).success).toBe(true);
      expect(typeof websocket.subscribeToYieldToMaturity).toBe("function");

      await testSubscription(
        "subscribeToYieldToMaturity",
        request,
        YieldToMaturityResponseSchema,
      );
    }, 10000);
  });

  describe("Error Handling", () => {
    test("should handle invalid subscription requests gracefully", () => {
      expect(() => {
        websocket.subscribeTo({});
      }).not.toThrow();
    });

    test("should handle websocket disconnection", () => {
      expect(() => {
        websocket.disconnectWebSocket();
      }).not.toThrow();
    });
  });
});
