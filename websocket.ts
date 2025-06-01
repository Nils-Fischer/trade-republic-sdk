import EventEmitter from "eventemitter3";
import {
  AccountPairsResponse,
  AggregateHistoryLightResponse,
  AvailableCashResponse,
  AvailableSizeResponse,
  CashResponse,
  CollectionResponse,
  CompactPortfolioByTypeResponse,
  CustomerPermissionsResponse,
  DerivativesResponse,
  FincrimeBannerResponse,
  FrontendExperimentResponse,
  HomeInstrumentExchangeResponse,
  InstrumentResponse,
  NamedWatchlistResponse,
  NeonNewsResponse,
  NeonSearchData,
  NeonSearchResponse,
  NeonSearchSuggestedTagsResponse,
  OrdersResponse,
  PerformanceResponse,
  PortfolioStatusResponse,
  PriceForOrderResponse,
  SavingsPlansResponse,
  StockDetailsResponse,
  TickerResponse,
  TimelineActionsV2Response,
  TimelineActivityLogResponse,
  TimelineDetailV2Response,
  TimelineSavingsPlanOverviewResponse,
  TimelineTransactionsResponse,
  TradingPerkConditionStatusResponse,
  WatchlistsResponse,
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
    console.log("Subscribed to", requestId, payload);
  }

  public subscribeToAccountPairs(callback?: (data: AccountPairsResponse) => void): void {
    this.subscribeTo({ type: "accountPairs" }, callback);
  }

  public subscribeToAggregateHistoryLight(
    range: "1d" | "1w" | "1m" | "3m" | "1y" | "max",
    id: string,
    callback?: (data: AggregateHistoryLightResponse) => void,
  ): void {
    this.subscribeTo({ type: "aggregateHistoryLight", range, id }, callback);
  }

  public subscribeToAvailableCash(
    callback?: (data: AvailableCashResponse) => void,
  ): void {
    this.subscribeTo({ type: "availableCash" }, callback);
  }

  public subscribeToAvailableSize(
    exchangeId: string,
    instrumentId: string,
    callback?: (data: AvailableSizeResponse) => void,
  ): void {
    this.subscribeTo(
      {
        type: "availableSize",
        parameters: { exchangeId, instrumentId },
      },
      callback,
    );
  }

  public subscribeToCash(callback?: (data: CashResponse) => void): void {
    this.subscribeTo({ type: "cash" }, callback);
  }

  public subscribeToCollection(
    view: "carousel" = "carousel",
    collectionId?: string,
    callback?: (data: CollectionResponse) => void,
  ): void {
    const payload: any = { type: "collection", view };
    if (collectionId) payload.collectionId = collectionId;
    this.subscribeTo(payload, callback);
  }

  public subscribeToCompactPortfolioByType(
    secAccNo: string,
    callback?: (data: CompactPortfolioByTypeResponse) => void,
  ): void {
    this.subscribeTo({ type: "compactPortfolioByType", secAccNo }, callback);
  }

  public subscribeToCustomerPermissions(
    callback?: (data: CustomerPermissionsResponse) => void,
  ): void {
    this.subscribeTo({ type: "customerPermissions" }, callback);
  }

  public subscribeToDerivatives(
    jurisdiction: string,
    underlying: string,
    productCategory: "factorCertificate" | "knockOutProduct" | "vanillaWarrant",
    options?: {
      lang?: string;
      factor?: number;
      leverage?: number;
      strike?: number;
      sortBy?: string;
      sortDirection?: "asc" | "desc";
      optionType?: "long" | "short" | "call" | "put";
      pageSize?: number;
      after?: string;
    },
    callback?: (data: DerivativesResponse) => void,
  ): void {
    this.subscribeTo(
      {
        type: "derivatives",
        jurisdiction,
        underlying,
        productCategory,
        ...options,
      },
      callback,
    );
  }

  public subscribeToFincrimeBanner(
    callback?: (data: FincrimeBannerResponse) => void,
  ): void {
    this.subscribeTo({ type: "fincrimeBanner" }, callback);
  }

  public subscribeToFrontendExperiment(
    operation: "assignment" | "exposure",
    experimentId: string,
    identifier: string,
    callback?: (data: FrontendExperimentResponse) => void,
  ): void {
    this.subscribeTo(
      {
        type: "frontendExperiment",
        operation,
        experimentId,
        identifier,
      },
      callback,
    );
  }

  public subscribeToHomeInstrumentExchange(
    id: string,
    callback?: (data: HomeInstrumentExchangeResponse) => void,
  ): void {
    this.subscribeTo({ type: "homeInstrumentExchange", id }, callback);
  }

  public subscribeToInstrument(
    id: string,
    callback?: (data: InstrumentResponse) => void,
  ): void {
    this.subscribeTo({ type: "instrument", id }, callback);
  }

  public subscribeToNamedWatchlist(
    watchlistId: string,
    callback?: (data: NamedWatchlistResponse) => void,
  ): void {
    this.subscribeTo({ type: "namedWatchlist", watchlistId }, callback);
  }

  public subscribeToNeonNews(
    isin: string,
    callback?: (data: NeonNewsResponse) => void,
  ): void {
    this.subscribeTo({ type: "neonNews", isin }, callback);
  }

  public subscribeToNeonSearch(
    searchData: NeonSearchData,
    callback?: (data: NeonSearchResponse) => void,
  ): void {
    this.subscribeTo({ type: "neonSearch", data: searchData }, callback);
  }

  public subscribeToNeonSearchSuggestedTags(
    query: string,
    callback?: (data: NeonSearchSuggestedTagsResponse) => void,
  ): void {
    this.subscribeTo({ type: "neonSearchSuggestedTags", data: { q: query } }, callback);
  }

  public subscribeToOrders(
    terminated: boolean,
    callback?: (data: OrdersResponse) => void,
  ): void {
    this.subscribeTo({ type: "orders", terminated }, callback);
  }

  public subscribeToPerformance(
    id: string,
    callback?: (data: PerformanceResponse) => void,
  ): void {
    this.subscribeTo({ type: "performance", id }, callback);
  }

  public subscribeToPortfolioStatus(
    callback?: (data: PortfolioStatusResponse) => void,
  ): void {
    this.subscribeTo({ type: "portfolioStatus" }, callback);
  }

  public subscribeToPriceForOrder(
    exchangeId: string,
    instrumentId: string,
    callback?: (data: PriceForOrderResponse) => void,
  ): void {
    this.subscribeTo(
      {
        type: "priceForOrder",
        parameters: { exchangeId, instrumentId },
      },
      callback,
    );
  }

  public subscribeToSavingsPlans(
    secAccNo: string,
    callback?: (data: SavingsPlansResponse) => void,
  ): void {
    this.subscribeTo({ type: "savingsPlans", secAccNo }, callback);
  }

  public subscribeToStockDetails(
    id: string,
    callback?: (data: StockDetailsResponse) => void,
  ): void {
    this.subscribeTo({ type: "stockDetails", id }, callback);
  }

  public subscribeToTicker(id: string, callback?: (data: TickerResponse) => void): void {
    this.subscribeTo({ type: "ticker", id }, callback);
  }

  public subscribeToTimelineActionsV2(
    callback?: (data: TimelineActionsV2Response) => void,
  ): void {
    this.subscribeTo({ type: "timelineActionsV2" }, callback);
  }

  public subscribeToTimelineActivityLog(
    callback?: (data: TimelineActivityLogResponse) => void,
  ): void {
    this.subscribeTo({ type: "timelineActivityLog" }, callback);
  }

  public subscribeToTimelineDetailV2(
    id: string,
    callback?: (data: TimelineDetailV2Response) => void,
  ): void {
    this.subscribeTo({ type: "timelineDetailV2", id }, callback);
  }

  public subscribeToTimelineSavingsPlanOverview(
    savingsPlanId: string,
    callback?: (data: TimelineSavingsPlanOverviewResponse) => void,
  ): void {
    this.subscribeTo({ type: "timelineSavingsPlanOverview", savingsPlanId }, callback);
  }

  public subscribeToTimelineTransactions(
    callback?: (data: TimelineTransactionsResponse) => void,
  ): void {
    this.subscribeTo({ type: "timelineTransactions" }, callback);
  }

  public subscribeToTradingPerkConditionStatus(
    callback?: (data: TradingPerkConditionStatusResponse) => void,
  ): void {
    this.subscribeTo({ type: "tradingPerkConditionStatus" }, callback);
  }

  public subscribeToWatchlists(callback?: (data: WatchlistsResponse) => void): void {
    this.subscribeTo({ type: "watchlists" }, callback);
  }

  public subscribeToYieldToMaturity(
    id: string,
    callback?: (data: YieldToMaturityResponse) => void,
  ): void {
    this.subscribeTo({ type: "yieldToMaturity", id }, callback);
  }
}
