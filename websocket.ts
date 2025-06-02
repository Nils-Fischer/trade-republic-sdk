import EventEmitter from "eventemitter3";
import {
  AccountPairsResponse,
  AggregateHistoryLightRequest,
  AggregateHistoryLightResponse,
  AvailableCashResponse,
  AvailableSizeRequest,
  AvailableSizeResponse,
  CashResponse,
  CollectionRequest,
  CollectionResponse,
  CompactPortfolioByTypeRequest,
  CompactPortfolioByTypeResponse,
  CustomerPermissionsResponse,
  DerivativesRequest,
  DerivativesResponse,
  FincrimeBannerResponse,
  FrontendExperimentRequest,
  FrontendExperimentResponse,
  HomeInstrumentExchangeRequest,
  HomeInstrumentExchangeResponse,
  InstrumentRequest,
  InstrumentResponse,
  NamedWatchlistRequest,
  NamedWatchlistResponse,
  NeonNewsRequest,
  NeonNewsResponse,
  NeonSearchRequest,
  NeonSearchResponse,
  NeonSearchSuggestedTagRequest,
  NeonSearchSuggestedTagResponse,
  OrdersRequest,
  OrdersResponse,
  PerformanceRequest,
  PerformanceResponse,
  PortfolioStatusResponse,
  PriceForOrderRequest,
  PriceForOrderResponse,
  SavingsPlansRequest,
  SavingsPlansResponse,
  StockDetailsRequest,
  StockDetailsResponse,
  TickerRequest,
  TickerResponse,
  TimelineActionsV2Response,
  TimelineDetailV2Request,
  TimelineDetailV2Response,
  TimelineTransactionsResponse,
  TradingPerkConditionStatusResponse,
  WatchlistsResponse,
  YieldToMaturityRequest,
  YieldToMaturityResponse,
} from "./subscriptionTypes";
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
   * @param url The WebSocket URL to connect to. Defaults to "wss://api.traderepublic.com".
   * @returns A Promise that resolves when the connection is established, or rejects on error.
   */
  public async connectWebSocket(
    url: string = "wss://api.traderepublic.com",
  ): Promise<void> {
    if (this.sessionCookies.length === 0) {
      return Promise.reject(
        new Error("Not authenticated. Call initiateLogin() and completeLogin() first."),
      );
    }

    return new Promise((resolve, reject) => {
      const connectWebSocket = async () => {
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
            resolve();
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
            reject(error);
          };

          wsClient.onclose = (event) => {
            this.emit("close", event);
          };

          this.webSocket = wsClient;
        } catch (error) {
          this.emit("error", error);
          reject(error);
        }
      };

      connectWebSocket();
    });
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
   * @param message The message string to send.
   * @throws Error if the WebSocket is not connected.
   */
  public sendMessage(message: string): void {
    if (!this.webSocket) throw new Error("WebSocket is not connected.");
    this.webSocket.send(message);
  }

  /**
   * Subscribes to a data feed with a specific request ID and payload.
   * @param requestId The unique identifier for this subscription request.
   * @param payload The subscription payload object.
   * @throws Error if the WebSocket is not connected.
   */
  public subscribe(requestId: string, payload: object): void {
    if (!this.webSocket) throw new Error("WebSocket is not connected.");
    const message = `sub ${requestId} ${JSON.stringify(payload)}`;
    this.sendMessage(message);
  }

  /**
   * Unsubscribes from a data feed.
   * @param requestId The request ID used for the original subscription.
   * @param payload The payload object, typically the same as used for subscription.
   */
  public unsubscribe(requestId: string, payload: object): void {
    const message = `unsub ${requestId} ${JSON.stringify(payload)}`;
    this.sendMessage(message);
  }

  /**
   * A generic method to subscribe to a data feed. It assigns an auto-incrementing request ID.
   * @template T The expected type of the data in the callback.
   * @param payload The subscription payload object, including the 'type' of subscription.
   * @param callback An optional callback function to handle incoming data of type T.
   */
  public subscribeTo<T>(payload: object, callback?: (data: T) => void): void {
    const requestId = this.requestIdCounter.toString();
    this.requestIdCounter += 1;
    this.subscriptions.set(requestId, callback);
    this.subscribe(requestId, payload);
    console.log("Subscribed to", requestId, payload);
  }

  /**
   * Subscribes to account pairs information.
   * This provides details about associated securities and cash accounts.
   * @param callback Optional callback to handle `AccountPairsResponse` data.
   */
  public subscribeToAccountPairs(callback?: (data: AccountPairsResponse) => void): void {
    this.subscribeTo({ type: "accountPairs" }, callback);
  }

  /**
   * Subscribes to light aggregate history for an instrument.
   * This can be used to fetch historical price data (OHLCV) for a given instrument ID and range.
   * @param request The `AggregateHistoryLightRequest` object, specifying instrument ID, range, and optional resolution.
   * @param callback Optional callback to handle `AggregateHistoryLightResponse` data.
   */
  public subscribeToAggregateHistoryLight(
    request: AggregateHistoryLightRequest,
    callback?: (data: AggregateHistoryLightResponse) => void,
  ): void {
    const payload = { type: "aggregateHistoryLight", ...request };
    this.subscribeTo(payload, callback);
  }

  /**
   * Subscribes to available cash information for the account.
   * Provides a list of accounts with their respective available cash amounts and currency.
   * @param callback Optional callback to handle `AvailableCashResponse` data.
   */
  public subscribeToAvailableCash(
    callback?: (data: AvailableCashResponse) => void,
  ): void {
    this.subscribeTo({ type: "availableCash" }, callback);
  }

  /**
   * Subscribes to the available size for an instrument on a specific exchange.
   * This is used to determine the tradable quantity for an instrument.
   * @param request The `AvailableSizeRequest` object, specifying instrument and exchange IDs.
   * @param callback Optional callback to handle `AvailableSizeResponse` data.
   */
  public subscribeToAvailableSize(
    request: AvailableSizeRequest,
    callback?: (data: AvailableSizeResponse) => void,
  ): void {
    this.subscribeTo(request, callback);
  }

  /**
   * Subscribes to cash information for the account.
   * Provides a list of accounts with their respective cash amounts and currency. Similar to availableCash but might represent total cash.
   * @param callback Optional callback to handle `CashResponse` data.
   */
  public subscribeToCash(callback?: (data: CashResponse) => void): void {
    this.subscribeTo({ type: "cash" }, callback);
  }

  /**
   * Subscribes to a collection of watchlists, often presented in a carousel view.
   * @param request The `CollectionRequest` object, typically specifying the view type (e.g., "carousel").
   * @param callback Optional callback to handle `CollectionResponse` data, which includes collection details and an array of watchlists.
   */
  public subscribeToCollection(
    request: CollectionRequest,
    callback?: (data: CollectionResponse) => void,
  ): void {
    const payload = { type: "collection", ...request };
    this.subscribeTo(payload, callback);
  }

  /**
   * Subscribes to a compact view of the portfolio, categorized by type.
   * @param request The `CompactPortfolioByTypeRequest` object, specifying the securities account number.
   * @param callback Optional callback to handle `CompactPortfolioByTypeResponse` data, showing categorized positions.
   */
  public subscribeToCompactPortfolioByType(
    request: CompactPortfolioByTypeRequest,
    callback?: (data: CompactPortfolioByTypeResponse) => void,
  ): void {
    const payload = { type: "compactPortfolioByType", ...request };
    this.subscribeTo(payload, callback);
  }

  /**
   * Subscribes to customer permissions.
   * This can be used to fetch the list of permissions applicable to the current user.
   * @param callback Optional callback to handle `CustomerPermissionsResponse` data.
   */
  public subscribeToCustomerPermissions(
    callback?: (data: CustomerPermissionsResponse) => void,
  ): void {
    this.subscribeTo({ type: "customerPermissions" }, callback);
  }

  /**
   * Subscribes to a list of derivatives for a given underlying instrument.
   * Allows filtering by product category, strike, leverage, factor, and sorting.
   * @param request The `DerivativesRequest` object specifying the underlying, product category, and other filter/sort criteria.
   * @param callback Optional callback to handle `DerivativesResponse` data.
   */
  public subscribeToDerivatives(
    request: DerivativesRequest,
    callback?: (data: DerivativesResponse) => void,
  ): void {
    const payload = { type: "derivatives", ...request };
    this.subscribeTo(payload, callback);
  }

  /**
   * Subscribes to financial crime (fincrime) banner information.
   * This might be used to display relevant compliance or informational banners.
   * @param callback Optional callback to handle `FincrimeBannerResponse` data.
   */
  public subscribeToFincrimeBanner(
    callback?: (data: FincrimeBannerResponse) => void,
  ): void {
    this.subscribeTo({ type: "fincrimeBanner" }, callback);
  }

  /**
   * Subscribes to a frontend experiment.
   * Used for A/B testing or feature flagging, reporting assignment or exposure to an experiment.
   * @param request The `FrontendExperimentRequest` object, specifying operation, experiment ID, and identifier.
   * @param callback Optional callback to handle `FrontendExperimentResponse` data, which may include the experiment group.
   */
  public subscribeToFrontendExperiment(
    request: FrontendExperimentRequest,
    callback?: (data: FrontendExperimentResponse) => void,
  ): void {
    const payload = { type: "frontendExperiment", ...request };
    this.subscribeTo(payload, callback);
  }

  /**
   * Subscribes to the home instrument exchange information for a given instrument ID.
   * Provides details about the instrument's primary exchange, currency, trading status, and order parameters.
   * @param request The `HomeInstrumentExchangeRequest` object, specifying the instrument ID.
   * @param callback Optional callback to handle `HomeInstrumentExchangeResponse` data.
   */
  public subscribeToHomeInstrumentExchange(
    request: HomeInstrumentExchangeRequest,
    callback?: (data: HomeInstrumentExchangeResponse) => void,
  ): void {
    const payload = { type: "homeInstrumentExchange", ...request };
    this.subscribeTo(payload, callback);
  }

  /**
   * Subscribes to detailed information about a specific instrument.
   * Includes data on exchanges, jurisdictions, company details, tags, and derivative product info.
   * @param request The `InstrumentRequest` object, specifying instrument ID and jurisdiction.
   * @param callback Optional callback to handle `InstrumentResponse` data.
   */
  public subscribeToInstrument(
    request: InstrumentRequest,
    callback?: (data: InstrumentResponse) => void,
  ): void {
    const payload = { type: "instrument", ...request };
    this.subscribeTo(payload, callback);
  }

  /**
   * Subscribes to a specific named watchlist (e.g., "favorites" or a custom watchlist by ID).
   * Provides details of the watchlist including its instruments.
   * @param request The `NamedWatchlistRequest` object, specifying the watchlist ID.
   * @param callback Optional callback to handle `NamedWatchlistResponse` data.
   */
  public subscribeToNamedWatchlist(
    request: NamedWatchlistRequest,
    callback?: (data: NamedWatchlistResponse) => void,
  ): void {
    const payload = { type: "namedWatchlist", ...request };
    this.subscribeTo(payload, callback);
  }

  /**
   * Subscribes to news articles related to a specific ISIN (instrument).
   * @param request The `NeonNewsRequest` object, specifying the ISIN.
   * @param callback Optional callback to handle `NeonNewsResponse` data, an array of news items.
   */
  public subscribeToNeonNews(
    request: NeonNewsRequest,
    callback?: (data: NeonNewsResponse) => void,
  ): void {
    const payload = { type: "neonNews", ...request };
    this.subscribeTo(payload, callback);
  }

  /**
   * Subscribes to search results from the "Neon" search engine.
   * Allows searching for instruments with various filters.
   * @param request The `NeonSearchRequest` object, containing the search query, pagination, and filters.
   * @param callback Optional callback to handle `NeonSearchResponse` data, including search results and count.
   */
  public subscribeToNeonSearch(
    request: NeonSearchRequest,
    callback?: (data: NeonSearchResponse) => void,
  ): void {
    const payload = { type: "neonSearch", ...request };
    this.subscribeTo(payload, callback);
  }

  /**
   * Subscribes to suggested search tags from the "Neon" search engine.
   * Useful for providing search query autocompletion or suggestions.
   * @param request The `NeonSearchSuggestedTagRequest` object, containing the partial search query.
   * @param callback Optional callback to handle `NeonSearchSuggestedTagResponse` data.
   */
  public subscribeToNeonSearchSuggestedTags(
    request: NeonSearchSuggestedTagRequest,
    callback?: (data: NeonSearchSuggestedTagResponse) => void,
  ): void {
    const payload = { type: "neonSearchSuggestedTags", ...request };
    this.subscribeTo(payload, callback);
  }

  /**
   * Subscribes to the list of orders for the account.
   * Can specify whether to include terminated (e.g., executed, cancelled) orders.
   * @param request The `OrdersRequest` object, indicating if terminated orders should be included.
   * @param callback Optional callback to handle `OrdersResponse` data.
   */
  public subscribeToOrders(
    request: OrdersRequest,
    callback?: (data: OrdersResponse) => void,
  ): void {
    const payload = { type: "orders", ...request };
    this.subscribeTo(payload, callback);
  }

  /**
   * Subscribes to performance data for a specific instrument.
   * Provides historical price points (e.g., 1d, 5d, 1m, 1y, 52w high/low).
   * @param request The `PerformanceRequest` object, specifying the instrument ID.
   * @param callback Optional callback to handle `PerformanceResponse` data.
   */
  public subscribeToPerformance(
    request: PerformanceRequest,
    callback?: (data: PerformanceResponse) => void,
  ): void {
    const payload = { type: "performance", ...request };
    this.subscribeTo(payload, callback);
  }

  /**
   * Subscribes to the portfolio status.
   * Provides information about the account's state, such as whether the user has invested, KYC requirements, etc.
   * @param callback Optional callback to handle `PortfolioStatusResponse` data.
   */
  public subscribeToPortfolioStatus(
    callback?: (data: PortfolioStatusResponse) => void,
  ): void {
    this.subscribeTo({ type: "portfolioStatus" }, callback);
  }

  /**
   * Subscribes to the current price for placing an order for a specific instrument.
   * Provides bid, ask, and last prices, along with currency and time.
   * @param request The `PriceForOrderRequest` object, specifying instrument, exchange, and order type (buy/sell).
   * @param callback Optional callback to handle `PriceForOrderResponse` data.
   */
  public subscribeToPriceForOrder(
    request: PriceForOrderRequest,
    callback?: (data: PriceForOrderResponse) => void,
  ): void {
    const payload = { type: "priceForOrder", ...request };
    this.subscribeTo(payload, callback);
  }

  /**
   * Subscribes to savings plans associated with a securities account.
   * @param request The `SavingsPlansRequest` object, specifying the securities account number.
   * @param callback Optional callback to handle `SavingsPlansResponse` data, an array of savings plans.
   */
  public subscribeToSavingsPlans(
    request: SavingsPlansRequest,
    callback?: (data: SavingsPlansResponse) => void,
  ): void {
    const payload = { type: "savingsPlans", ...request };
    this.subscribeTo(payload, callback);
  }

  /**
   * Subscribes to detailed stock information for a specific instrument.
   * This includes company details, exchange information, events, and more.
   * @param request The `StockDetailsRequest` object, specifying the instrument ID and jurisdiction.
   * @param callback Optional callback to handle `StockDetailsResponse` data.
   */
  public subscribeToStockDetails(
    request: StockDetailsRequest,
    callback?: (data: StockDetailsResponse) => void,
  ): void {
    const payload = { type: "stockDetails", ...request };
    this.subscribeTo(payload, callback);
  }

  /**
   * Subscribes to real-time ticker data for an instrument.
   * Provides bid, ask, last, and pre-market prices and sizes.
   * @param request The `TickerRequest` object, specifying the instrument ID.
   * @param callback Optional callback to handle `TickerResponse` data.
   */
  public subscribeToTicker(
    request: TickerRequest,
    callback?: (data: TickerResponse) => void,
  ): void {
    const payload = { type: "ticker", ...request };
    this.subscribeTo(payload, callback);
  }

  /**
   * Subscribes to timeline actions (version 2).
   * This typically provides a list of actionable items or notifications for the user's timeline.
   * @param callback Optional callback to handle `TimelineActionsV2Response` data.
   */
  public subscribeToTimelineActionsV2(
    callback?: (data: TimelineActionsV2Response) => void,
  ): void {
    const payload = { type: "timelineActionsV2" };
    this.subscribeTo(payload, callback);
  }

  /**
   * Subscribes to the details of a specific timeline event (version 2).
   * Provides structured information about a timeline item, broken down into sections.
   * @param request The `TimelineDetailV2Request` object, specifying the timeline event ID.
   * @param callback Optional callback to handle `TimelineDetailV2Response` data.
   */
  public subscribeToTimelineDetailV2(
    request: TimelineDetailV2Request,
    callback?: (data: TimelineDetailV2Response) => void,
  ): void {
    const payload = { type: "timelineDetailV2", ...request };
    this.subscribeTo(payload, callback);
  }

  /**
   * Subscribes to timeline transaction items.
   * Provides a list of financial transactions (e.g., buys, sells, dividends) for the user's timeline.
   * @param callback Optional callback to handle `TimelineTransactionsResponse` data.
   */
  public subscribeToTimelineTransactions(
    callback?: (data: TimelineTransactionsResponse) => void,
  ): void {
    const payload = { type: "timelineTransactions" };
    this.subscribeTo(payload, callback);
  }

  /**
   * Subscribes to the status of trading perk conditions.
   * This could relate to benefits or features unlocked by meeting certain trading criteria.
   * @param callback Optional callback to handle `TradingPerkConditionStatusResponse` data.
   */
  public subscribeToTradingPerkConditionStatus(
    callback?: (data: TradingPerkConditionStatusResponse) => void,
  ): void {
    const payload = { type: "tradingPerkConditionStatus" };
    this.subscribeTo(payload, callback);
  }

  /**
   * Subscribes to the user's watchlists.
   * Provides a list of all watchlists, including their details and instrument counts.
   * @param callback Optional callback to handle `WatchlistsResponse` data.
   */
  public subscribeToWatchlists(callback?: (data: WatchlistsResponse) => void): void {
    const payload = { type: "watchlists" };
    this.subscribeTo(payload, callback);
  }

  /**
   * Subscribes to the yield to maturity for a bond.
   * @param request The `YieldToMaturityRequest` object, specifying the bond's instrument ID.
   * @param callback Optional callback to handle `YieldToMaturityResponse` data. The schema is `z.any()`, so the exact structure may vary.
   */
  public subscribeToYieldToMaturity(
    request: YieldToMaturityRequest,
    callback?: (data: YieldToMaturityResponse) => void,
  ): void {
    const payload = { type: "yieldToMaturity", ...request };
    this.subscribeTo(payload, callback);
  }
}
