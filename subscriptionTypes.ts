// subscriptionTypes.ts

// --------------- GENERIC HELPER TYPES ---------------

export interface NeonSearchFilter {
  key: string;
  value: string | string[];
}

export interface NeonSearchData {
  q: string;
  page: number;
  pageSize: number;
  filter: NeonSearchFilter[];
}

export interface ImageDetails {
  width: number;
  height: number;
  scale: number;
  url: string;
  url_next_gen: string;
}

// --------------- RESPONSE DATA TYPES (Partially Explored) ---------------

export interface AccountPair {
  securitiesAccountNumber: string;
  cashAccountNumber: string;
  productType: string;
}
export type AccountPairsResponse = AccountPair[];

export interface Aggregate {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: number;
  adjValue: string | null;
}
export interface AggregateHistoryLightResponse {
  resolution: number;
  lastAggregateEndTime: number;
  aggregates: Aggregate[];
}

export interface CashInfo {
  currencyId: string;
  amount: number;
  accountNumber?: string; // Optional as it appears in `CashResponse` but not `AvailableCashResponse` from snippets
}
export type AvailableCashResponse = CashInfo; // Assuming similar to CashInfo but simpler
export type CashResponse = CashInfo; // Specifically `CashInfo` with `accountNumber`

export interface AvailableSizeResponse {
  size: string; // or number, TBD
  // ... other fields if any
}

export interface CollectionCarouselItem {
  // Structure to be defined based on actual data
  id: string;
  title: string;
  imageUrl?: string;
  [key: string]: any;
}
export interface CollectionResponse {
  carouselItems?: CollectionCarouselItem[]; // If view is carousel
  // ... other collection structures
  [key: string]: any;
}

export interface CompactPortfolioInstrument {
  isin: string;
  averageBuyIn: string | null;
  netSize: string;
  virtualSize: string;
  status: string;
  instrumentType: string;
  name: string;
  derivativeInfo: unknown | null;
  bondInfo: unknown | null;
  imageId: string;
}
export interface CompactPortfolioByTypeResponse {
  // Grouped structure, e.g.:
  stocks?: CompactPortfolioInstrument[];
  etfs?: CompactPortfolioInstrument[];
  // ... other types
  [key: string]: CompactPortfolioInstrument[] | undefined;
}

export interface CustomerPermissionsResponse {
  permissions: string[]; // or object[], TBD
}

export interface DerivativeInstrument {
  // To be defined based on actual data, similar to NeonSearchResultItem but for derivatives
  isin: string;
  name: string;
  [key: string]: any;
}
export type DerivativesResponse = DerivativeInstrument[];

export interface FincrimeBannerResponse {
  // To be defined
  message?: string;
  level?: string;
  [key: string]: any;
}

export interface FrontendExperimentResponse {
  // To be defined based on specific experiment
  assignment?: unknown;
  exposureData?: unknown;
  [key: string]: any;
}

export interface HomeInstrumentExchangeResponse {
  id: string; // currency/exchange ID
  name: string;
  open: boolean;
  orderModes: string[];
  orderExpiries: string[];
  priceSteps: any[];
  openTimeOffsetMillis: number;
  closeTimeOffsetMillis: number;
  maintenanceWindow: unknown | null;
}

export interface InstrumentCharacteristics {
  legalForm: string | null;
  characteristicsOfLegalForm: unknown | null;
  originCountry: string | null;
}
export interface InstrumentPriceStats {
  high_1d?: string;
  low_1d?: string;
  price_5d?: string;
  price_1m?: string;
  price_3m?: string;
  price_6m?: string;
  price_1y?: string;
  price_3y?: string;
  price_5y?: string;
  high_52w?: string;
  low_52w?: string;
}
export interface InstrumentResponse
  extends InstrumentCharacteristics,
    InstrumentPriceStats {
  id: string; // ISIN
  name: string;
  // ... many other instrument details
  [key: string]: any;
}

export interface WatchlistInstrument {
  instrument_id: string;
  created_at: string; // Could be number (timestamp) - check actual data
  holding_percent: number | null;
  // ... fields from snippet like following, investable_isin etc.
  following: boolean;
  following_allowed: boolean;
  editing_allowed: boolean;
  investable_isin: string | null;
  sharing_allowed: boolean;
  jurisdiction_mismatch: boolean;
  share_text: string | null;
}
export interface NamedWatchlistResponse {
  id: string;
  title: string;
  description?: string | null;
  description_short?: string | null;
  created_at: string | null; // Could be number
  updated_at: string | null; // Could be number
  size: number;
  instruments: WatchlistInstrument[] | null;
  following: boolean;
  following_allowed: boolean;
  editing_allowed: boolean;
  investable_isin: string | null;
  sharing_allowed: boolean;
  jurisdiction_mismatch: boolean;
  share_text: string | null;
  images?: ImageDetails[];
}

export interface NewsItem {
  id: string;
  createdAt: number;
  provider: string;
  headline: string;
  summary: string;
  url: string;
}
export type NeonNewsResponse = NewsItem[];

export interface NeonSearchResultTag {
  type: "attribute" | string; // e.g. "attribute"
  id: string; // e.g. "savable"
  name: string; // e.g. "Savings Plan" or "Sparplan"
}
export interface NeonSearchResultItem {
  type: string; // e.g., "instrument", "underlying"
  isin?: string;
  name?: string;
  subtitle?: string;
  imageId?: string;
  derivativeProductCategories?: string[];
  mappedEtfIndexName?: string;
  etfDescription?: string;
  bondIssuerName?: string;
  hasCfd?: boolean;
  tags?: NeonSearchResultTag[];
  // ... other fields depending on the item type
  [key: string]: any;
}
export interface NeonSearchResponse {
  results: NeonSearchResultItem[];
  resultCount: number;
  correlationId: string;
}

export interface NeonSearchSuggestedTag {
  // To be defined
  tag: string;
  type?: string;
  [key: string]: any;
}
export interface NeonSearchSuggestedTagsResponse {
  results: NeonSearchSuggestedTag[];
}

export interface OrderItem {
  // To be defined based on actual order data
  id: string;
  isin: string;
  status: string;
  price?: number;
  quantity?: number;
  type?: string; // e.g. limit, market
  side?: "buy" | "sell";
  createdAt: number;
  [key: string]: any;
}
export interface OrdersResponse {
  orders: OrderItem[];
  unsupportedOrderCount: number;
}

export type PerformanceResponse = InstrumentPriceStats; // From snippet, seems to be just price stats

export interface PortfolioStatusResponse {
  status: string;
  hasInvested: boolean;
  firstCashReceived: boolean;
  firstPortfolioUsage: boolean;
  bitgoTermsRequired: boolean;
  proprietaryTradingTermsRequired: boolean;
  reKycRequired: any[]; // string[] or object[] TBD
  sourceOfFundsRequired: boolean;
  tradingBlockedOnIdentification: boolean;
  bondsTermsRequired: boolean;
  privateFundTermsRequired: boolean;
}

export interface PriceForOrderResponse {
  // Likely similar to TickerResponse
  currencyId: string;
  price: number;
  priceFactor?: number;
  priceAsk?: number;
  priceBid?: number;
  time: number;
  qualityId?: string;
  [key: string]: any;
}

export interface SavingsPlanExecutionRule {
  type: "dayOfMonth" | string; // other types?
  value: number;
  nextExecutionDate?: string; // Appears in one snippet part, might be top level
}
export interface SavingsPlan {
  id: string;
  isin: string;
  name: string;
  amount: number; // amount for each execution
  status: string; // e.g. ACTIVE, PAUSED
  firstExecutionDate: string | null;
  nextExecutionDate: string;
  previousExecutionDate: string | null;
  virtualPreviousExecutionDate?: string | null;
  finalExecutionDate: string | null;
  paymentMethodId: string | null;
  paymentMethodCode: string | null;
  lastPaymentExecutionDate: string | null;
  paused: boolean;
  fundingCashAccNo: string;
  secAccNo: string;
  executionRule?: SavingsPlanExecutionRule; // From one snippet
  // ... other fields
  [key: string]: any;
}
export type SavingsPlansResponse = SavingsPlan[];

export interface StockDividendInfo {
  periodStartDate: string;
  projected: boolean | null;
  yieldValue: number | null;
  amount: number | null;
  count: number | null;
  projectedCount: number | null;
  price: number | null;
  dividendFrequency: string | null;
}
export interface StockDetailsResponse extends InstrumentResponse {
  dividends?: StockDividendInfo[];
  // ... other stock specific details
}

export interface TickerResponse {
  currencyId?: string;
  price: number | string; // String in some snippets, number in others
  priceFactor?: number;
  priceAsk?: number;
  priceBid?: number;
  time: number;
  size?: number; // Appears in detailed ticker
  qualityId?: string; // Appears in detailed ticker
  leverage?: number | null;
  delta?: number | null;
  open?: string; // From aggregate-like ticker snippet
  high?: string;
  low?: string;
  close?: string;
  volume?: number;
  adjValue?: string | null;
  [key: string]: any;
}

export interface TimelineAction {
  // To be defined
  id: string;
  type: string;
  title: string;
  timestamp: number;
  [key: string]: any;
}
export type TimelineActionsV2Response = TimelineAction[];

export interface TimelineActivityLogItem {
  // To be defined
  id: string;
  message: string;
  timestamp: number;
  [key: string]: any;
}
export type TimelineActivityLogResponse = TimelineActivityLogItem[];

export interface TimelineDetailV2Response {
  // To be defined based on the specific detail being fetched
  id: string;
  details: unknown;
  [key: string]: any;
}

export interface TimelineSavingsPlanOverviewResponse {
  // Structure based on snippet: {"type":"dayOfMonth","value":2},"paymentMethodId":null,"secAccNo":"0192228801","fundingCashAccNo":"0192228811"}}},"type":"actionButtons"}
  // This implies a complex nested structure for UI, needs more exploration
  executionRule?: { type: string; value: number };
  paymentMethodId?: string | null;
  secAccNo?: string;
  fundingCashAccNo?: string;
  actionButtonType?: string; // e.g. "actionButtons"
  [key: string]: any;
}

export interface TimelineTransaction {
  // To be defined
  id: string;
  type: "buy" | "sell" | "dividend" | "deposit" | "withdrawal";
  isin?: string;
  name?: string;
  amount: number;
  currency: string;
  timestamp: number;
  [key: string]: any;
}
export type TimelineTransactionsResponse = TimelineTransaction[];

export interface TradingPerkConditionStatusResponse {
  tradingPerkConditionStatus: unknown | null;
}

export interface WatchlistOverviewItem extends NamedWatchlistResponse {
  // Watchlists response is an array of full watchlist details (like NamedWatchlistResponse)
}
export type WatchlistsResponse = WatchlistOverviewItem[];

export interface YieldToMaturityResponse {
  // To be defined, likely financial figures for a bond
  ytm: number;
  currency: string;
  calculationDate: number;
  [key: string]: any;
}

// It might be useful to have a generic WebSocket message type from TR if a pattern emerges
export interface TradeRepublicWebSocketMessage<T = any> {
  type: string; // This could be the subscription type, or 'data', 'error', 'ack' etc.
  requestId?: string; // The original request ID for sub/unsub
  payload: T;
  error?: any;
  // ... any other common wrapper fields
}
