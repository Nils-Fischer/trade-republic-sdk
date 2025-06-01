import { z } from "zod";
export const AccountPairsRequestSchema = z.object({ type: z.literal("accountPairs") });

export type AccountPairsRequest = z.infer<typeof AccountPairsRequestSchema>;

export const AccountPairsResponseSchema = z.object({
  authAccountId: z.string().uuid(),
  accounts: z.array(
    z.object({
      securitiesAccountNumber: z.string(),
      cashAccountNumber: z.string(),
      productType: z.string(),
    }),
  ),
});

export type AccountPairsResponse = z.infer<typeof AccountPairsResponseSchema>;

export const AggregateHistoryLightRequestSchema = z.object({
  type: z.literal("aggregateHistoryLight"),
  range: z.literal("1d"),
  id: z.string().regex(/^[A-Z0-9]+\\.[A-Z]{2,3}$/),
  resolution: z.number().optional(),
});

export type AggregateHistoryLightRequest = z.infer<
  typeof AggregateHistoryLightRequestSchema
>;

export const AggregateHistoryLightResponseSchema = z.object({
  expectedClosingTime: z.number(),
  aggregates: z.array(
    z.object({
      time: z.number(),
      open: z.string(),
      high: z.string(),
      low: z.string(),
      close: z.string(),
      volume: z.number(),
      adjValue: z.string().nullable(),
    }),
  ),
  resolution: z.number().optional(),
  lastAggregateEndTime: z.number().optional(),
});

export type AggregateHistoryLightResponse = z.infer<
  typeof AggregateHistoryLightResponseSchema
>;

export const AvailableCashRequestSchema = z.object({ type: z.literal("availableCash") });

export type AvailableCashRequest = z.infer<typeof AvailableCashRequestSchema>;

export const AvailableCashResponseSchema = z.array(
  z.object({ accountNumber: z.string(), currencyId: z.string(), amount: z.number() }),
);

export type AvailableCashResponse = z.infer<typeof AvailableCashResponseSchema>;

export const AvailableCashForPayoutRequestSchema = z.object({
  type: z.literal("availableCashForPayout"),
});

export type AvailableCashForPayoutRequest = z.infer<
  typeof AvailableCashForPayoutRequestSchema
>;

export const AvailableCashForPayoutResponseSchema = z.array(
  z.object({ accountNumber: z.string(), currencyId: z.string(), amount: z.number() }),
);

export type AvailableCashForPayoutResponse = z.infer<
  typeof AvailableCashForPayoutResponseSchema
>;

export const AvailableSizeRequestSchema = z.object({
  type: z.literal("availableSize"),
  parameters: z.object({
    exchangeId: z.enum(["LSX", "SGL", "UBS"]),
    instrumentId: z.string().regex(/^[A-Z0-9]+\\.[A-Z]{2,3}$/),
  }),
});

export type AvailableSizeRequest = z.infer<typeof AvailableSizeRequestSchema>;

export const AvailableSizeResponseSchema = z.object({ size: z.string() });

export type AvailableSizeResponse = z.infer<typeof AvailableSizeResponseSchema>;

export const CashRequestSchema = z.object({ type: z.literal("cash") });

export type CashRequest = z.infer<typeof CashRequestSchema>;

export const CashResponseSchema = z.array(
  z.object({ accountNumber: z.string(), currencyId: z.string(), amount: z.number() }),
);

export type CashResponse = z.infer<typeof CashResponseSchema>;

export const CollectionRequestSchema = z.object({
  type: z.literal("collection"),
  view: z.literal("carousel"),
});

export type CollectionRequest = z.infer<typeof CollectionRequestSchema>;

const ImageDetailSchema = z.object({
  width: z.number(),
  height: z.number(),
  scale: z.number(),
  url: z.string(),
  url_next_gen: z.string(),
  url_next_gen_icon: z.string().optional(),
});

const CoverSchema = z.object({
  small: z.array(ImageDetailSchema),
  medium: z.array(ImageDetailSchema.omit({ url_next_gen_icon: true })),
  large: z.array(ImageDetailSchema.omit({ url_next_gen_icon: true })),
});

const WatchlistSchema = z.object({
  id: z.string(),
  cover: CoverSchema,
  size: z.number(),
  title: z.string(),
  description: z.string(),
  description_short: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  instruments: z.any().nullable(),
  following: z.boolean(),
  following_allowed: z.boolean(),
  editing_allowed: z.boolean(),
  investable_isin: z.string().nullable(),
  sharing_allowed: z.boolean(),
  jurisdiction_mismatch: z.boolean(),
  share_text: z.string(),
});

export const CollectionResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  watchlists: z.array(WatchlistSchema),
});

export type CollectionResponse = z.infer<typeof CollectionResponseSchema>;

export const CompactPortfolioByTypeRequestSchema = z.object({
  type: z.literal("compactPortfolioByType"),
  secAccNo: z.string(),
});

export type CompactPortfolioByTypeRequest = z.infer<
  typeof CompactPortfolioByTypeRequestSchema
>;

export const CompactPortfolioByTypeResponseSchema = z.object({
  categories: z.array(
    z.object({
      categoryType: z.string(),
      positions: z.array(
        z.object({
          isin: z.string(),
          averageBuyIn: z.string(),
          netSize: z.string(),
          virtualSize: z.string(),
          status: z.string(),
          instrumentType: z.string(),
          name: z.string(),
          derivativeInfo: z.any().nullable(),
          bondInfo: z.any().nullable(),
          imageId: z.string(),
        }),
      ),
    }),
  ),
  products: z.array(z.any()),
});

export type CompactPortfolioByTypeResponse = z.infer<
  typeof CompactPortfolioByTypeResponseSchema
>;

export const CustomerPermissionsRequestSchema = z.object({
  type: z.literal("customerPermissions"),
});

export type CustomerPermissionsRequest = z.infer<typeof CustomerPermissionsRequestSchema>;

export const CustomerPermissionsResponseSchema = z.object({
  permissions: z.array(z.any()),
});

export type CustomerPermissionsResponse = z.infer<
  typeof CustomerPermissionsResponseSchema
>;

export const DerivativesRequestSchema = z.object({
  type: z.literal("derivatives"),
  jurisdiction: z.literal("DE"),
  lang: z.literal("en"),
  underlying: z.string().regex(/^[A-Z0-9]+$/),
  productCategory: z.enum(["vanillaWarrant", "knockOutProduct", "factorCertificate"]),
  strike: z.number().optional(),
  leverage: z.number().optional(),
  factor: z.number().optional(),
  sortBy: z.enum(["strike", "leverage", "factor"]),
  sortDirection: z.literal("asc"),
  optionType: z.enum(["call", "put", "long", "short"]),
  pageSize: z.literal(50),
  after: z.literal("0"),
});

export type DerivativesRequest = z.infer<typeof DerivativesRequestSchema>;

export const DerivativesResponseSchema = z.object({
  results: z.array(
    z.object({
      isin: z.string(),
      optionType: z.enum(["long", "short", "call", "put"]),
      productCategoryName: z.string(),
      nextGenProductCategoryName: z.string(),
      barrier: z.number().nullable(),
      leverage: z.number(),
      strike: z.number().nullable(),
      size: z.number(),
      factor: z.number().nullable(),
      delta: z.number().nullable(),
      currency: z.string(),
      expiry: z.string().nullable(),
      issuerDisplayName: z.string(),
      issuer: z.string(),
      issuerImageId: z.string(),
      imageId: z.string(),
    }),
  ),
});

export type DerivativesResponse = z.infer<typeof DerivativesResponseSchema>;

export const FincrimeBannerRequestSchema = z.object({
  type: z.literal("fincrimeBanner"),
});

export type FincrimeBannerRequest = z.infer<typeof FincrimeBannerRequestSchema>;

export const FincrimeBannerResponseSchema = z.object({ carouselItems: z.array(z.any()) });

export type FincrimeBannerResponse = z.infer<typeof FincrimeBannerResponseSchema>;

export const FrontendExperimentRequestSchema = z.object({
  type: z.literal("frontendExperiment"),
  operation: z.enum(["assignment", "exposure"]),
  experimentId: z.enum(["web-portfolio-analytics", "web-show-discover-section"]),
  identifier: z.string().uuid(),
});

export type FrontendExperimentRequest = z.infer<typeof FrontendExperimentRequestSchema>;

export const FrontendExperimentResponseSchema = z.object({ group: z.number() });

export type FrontendExperimentResponse = z.infer<typeof FrontendExperimentResponseSchema>;

export const HomeInstrumentExchangeRequestSchema = z.object({
  type: z.literal("homeInstrumentExchange"),
  id: z.string().regex(/^[A-Z0-9]+\\.[A-Z]{2,3}$/),
});

export type HomeInstrumentExchangeRequest = z.infer<
  typeof HomeInstrumentExchangeRequestSchema
>;

export const HomeInstrumentExchangeResponseSchema = z.object({
  exchangeId: z.string(),
  exchange: z.object({ id: z.string(), name: z.string(), timeZoneId: z.string() }),
  currency: z.object({ id: z.string(), name: z.string() }),
  open: z.boolean(),
  orderModes: z.array(z.string()),
  orderExpiries: z.array(z.string()),
  priceSteps: z.array(z.any()),
  maintenanceWindow: z.any().nullable(),
  openTimeOffsetMillis: z.number(),
  closeTimeOffsetMillis: z.number(),
});

export type HomeInstrumentExchangeResponse = z.infer<
  typeof HomeInstrumentExchangeResponseSchema
>;

export const InstrumentRequestSchema = z.object({
  type: z.literal("instrument"),
  id: z.string().regex(/^[A-Z0-9]+\\.[A-Z]{2,3}$/),
  jurisdiction: z.literal("DE"),
});

export type InstrumentRequest = z.infer<typeof InstrumentRequestSchema>;

export const InstrumentResponseSchema = z.object({
  active: z.boolean(),
  exchangeIds: z.array(z.string()),
  exchanges: z.array(
    z.object({
      slug: z.string(),
      active: z.boolean(),
      nameAtExchange: z.string(),
      symbolAtExchange: z.string(),
      band: z.number().nullable(),
      firstSeen: z.number(),
      lastSeen: z.number(),
      firstTradingDay: z.number().nullable(),
      lastTradingDay: z.number().nullable(),
      tradingTimes: z.any().nullable(),
      fractionalTrading: z
        .object({
          minOrderSize: z.string(),
          maxOrderSize: z.string().nullable(),
          stepSize: z.string(),
          minOrderAmount: z.string().nullable(),
          maxOrderAmount: z.string().nullable(),
        })
        .nullable(),
      settlementRoute: z.string(),
      weight: z.number().nullable(),
    }),
  ),
  jurisdictions: z.record(
    z.object({
      active: z.boolean(),
      kidLink: z.string().nullable(),
      kidRequired: z.boolean(),
      savable: z.boolean(),
      fractionalTradingAllowed: z.boolean(),
      proprietaryTradable: z.boolean(),
      usesWeightsForExchanges: z.boolean(),
      weights: z.any().nullable(),
    }),
  ),
  dividends: z.array(z.any()),
  splits: z.array(z.any()),
  cfi: z.string(),
  name: z.string(),
  typeId: z.string(),
  legalTypeId: z.string().nullable(),
  wkn: z.string(),
  legacyTypeChar: z.string(),
  isin: z.string(),
  priceFactor: z.number(),
  shortName: z.string(),
  nextGenName: z.string(),
  alarmsName: z.string(),
  homeSymbol: z.string(),
  intlSymbol: z.string().nullable(),
  homeNsin: z.string(),
  tags: z.array(
    z.object({
      type: z.string(),
      id: z.string(),
      name: z.string(),
      icon: z.string().optional(),
    }),
  ),
  derivativeProductCount: z.record(z.number()).optional(),
  derivativeProductCategories: z.array(z.string()).optional(),
  company: z
    .object({
      name: z.string(),
      description: z.string().optional(),
      marketCap: z.number().optional(),
      employeeCount: z.number().optional(),
      foundedYear: z.number().optional(),
      ceo: z.string().optional(),
      country: z.string().optional(),
      ipo: z.number().optional(),
    })
    .optional(),
});

export type InstrumentResponse = z.infer<typeof InstrumentResponseSchema>;

export const NamedWatchlistRequestSchema = z.object({
  type: z.literal("namedWatchlist"),
  watchlistId: z.union([z.literal("favorites"), z.string().uuid()]),
});

export type NamedWatchlistRequest = z.infer<typeof NamedWatchlistRequestSchema>;

export const NamedWatchlistResponseSchema = z.object({
  id: z.string(),
  cover: z.object({
    small: z.array(
      z.object({
        width: z.number(),
        height: z.number(),
        scale: z.number(),
        url: z.string(),
        url_next_gen: z.string(),
        url_next_gen_icon: z.string().optional(),
      }),
    ),
    medium: z.array(
      z.object({
        width: z.number(),
        height: z.number(),
        scale: z.number(),
        url: z.string(),
        url_next_gen: z.string(),
      }),
    ),
    large: z.array(
      z.object({
        width: z.number(),
        height: z.number(),
        scale: z.number(),
        url: z.string(),
        url_next_gen: z.string(),
      }),
    ),
  }),
  size: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  description_short: z.string().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
  instruments: z
    .array(
      z.object({
        instrument_id: z.string(),
        created_at: z.string().nullable(),
        holding_percent: z.number().nullable(),
      }),
    )
    .nullable(),
  following: z.boolean(),
  following_allowed: z.boolean(),
  editing_allowed: z.boolean(),
  investable_isin: z.string().nullable(),
  sharing_allowed: z.boolean(),
  jurisdiction_mismatch: z.boolean(),
  share_text: z.string().nullable(),
});

export type NamedWatchlistResponse = z.infer<typeof NamedWatchlistResponseSchema>;

export const NeonNewsRequestSchema = z.object({
  type: z.literal("neonNews"),
  isin: z.string().regex(/^[A-Z0-9]+$/),
});

export type NeonNewsRequest = z.infer<typeof NeonNewsRequestSchema>;

export const NeonNewsResponseSchema = z.array(
  z.object({
    id: z.string(),
    createdAt: z.number(),
    provider: z.string(),
    headline: z.string(),
    summary: z.string(),
    url: z.string(),
  }),
);

export type NeonNewsResponse = z.infer<typeof NeonNewsResponseSchema>;

export const NeonSearchRequestSchema = z.object({
  type: z.literal("neonSearch"),
  data: z.object({
    q: z.string(),
    page: z.number(),
    pageSize: z.number(),
    filter: z.array(
      z.object({
        key: z.enum(["type", "jurisdiction", "relativePerformance"]),
        value: z.enum([
          "stock",
          "fund",
          "crypto",
          "bond",
          "derivative",
          "DE",
          "dailyBest",
          "dailyWorst",
        ]),
      }),
    ),
  }),
});

export type NeonSearchRequest = z.infer<typeof NeonSearchRequestSchema>;

export const NeonSearchResponseSchema = z.object({
  results: z.array(
    z.object({
      isin: z.string(),
      name: z.string(),
      tags: z.array(z.object({ type: z.string(), id: z.string(), name: z.string() })),
      type: z.string(),
      derivativeProductCategories: z.array(z.string()),
      imageId: z.string(),
      hasCfd: z.boolean(),
      subtitle: z.string().optional(),
      mappedEtfIndexName: z.string().optional(),
      etfDescription: z.string().optional(),
      bondIssuerName: z.string().optional(),
    }),
  ),
  resultCount: z.number(),
  correlationId: z.string(),
});

export type NeonSearchResponse = z.infer<typeof NeonSearchResponseSchema>;

export const NeonSearchSuggestedTagRequestSchema = z.object({
  type: z.literal("neonSearchSuggestedTags"),
  data: z.object({ q: z.string() }),
});

export type NeonSearchSuggestedTagRequest = z.infer<
  typeof NeonSearchSuggestedTagRequestSchema
>;

export const NeonSearchSuggestedTagResponseSchema = z.object({
  results: z.array(z.any()),
});

export type NeonSearchSuggestedTagResponse = z.infer<
  typeof NeonSearchSuggestedTagResponseSchema
>;

export const OrdersRequestSchema = z.object({
  type: z.literal("orders"),
  terminated: z.boolean(),
});

export type OrdersRequest = z.infer<typeof OrdersRequestSchema>;

export const OrdersResponseSchema = z.object({
  orders: z.array(z.any()),
  unsupportedOrderCount: z.number(),
});

export type OrdersResponse = z.infer<typeof OrdersResponseSchema>;

export const PerformanceRequestSchema = z.object({
  type: z.literal("performance"),
  id: z.string().regex(/^[A-Z0-9]+\\.[A-Z]{2,3}$/),
});

export type PerformanceRequest = z.infer<typeof PerformanceRequestSchema>;

export const PerformanceResponseSchema = z.object({
  high_1d: z.string(),
  low_1d: z.string(),
  price_5d: z.string(),
  price_1m: z.string(),
  price_3m: z.string(),
  price_6m: z.string(),
  price_1y: z.string(),
  price_3y: z.string(),
  price_5y: z.string(),
  high_52w: z.string(),
  low_52w: z.string(),
});

export type PerformanceResponse = z.infer<typeof PerformanceResponseSchema>;

export const PortfolioStatusRequestSchema = z.object({
  type: z.literal("portfolioStatus"),
});

export type PortfolioStatusRequest = z.infer<typeof PortfolioStatusRequestSchema>;

export const PortfolioStatusResponseSchema = z.object({
  status: z.string(),
  hasInvested: z.boolean(),
  firstCashReceived: z.boolean(),
  firstPortfolioUsage: z.boolean(),
  bitgoTermsRequired: z.boolean(),
  proprietaryTradingTermsRequired: z.boolean(),
  reKycRequired: z.array(z.any()),
  sourceOfFundsRequired: z.boolean(),
  tradingBlockedOnIdentification: z.boolean(),
  bondsTermsRequired: z.boolean(),
  privateFundTermsRequired: z.boolean(),
});

export type PortfolioStatusResponse = z.infer<typeof PortfolioStatusResponseSchema>;

export const PriceForOrderResponseSchema = z.object({
  currencyId: z.string(),
  price: z.number(),
  priceFactor: z.number(),
  priceAsk: z.number(),
  priceBid: z.number(),
  time: z.number(),
});

export type PriceForOrderResponse = z.infer<typeof PriceForOrderResponseSchema>;

export const PriceForOrderRequestSchema = z.object({
  type: z.literal("priceForOrder"),
  parameters: z.object({
    exchangeId: z.enum(["LSX", "SGL", "UBS"]),
    instrumentId: z.string().regex(/^[A-Z0-9]+\\.[A-Z]{2,3}$/),
    type: z.enum(["buy", "sell"]),
  }),
});

export type PriceForOrderRequest = z.infer<typeof PriceForOrderRequestSchema>;

export const SavingsPlansRequestSchema = z.object({
  type: z.literal("savingsPlans"),
  secAccNo: z.string(),
});

export type SavingsPlansRequest = z.infer<typeof SavingsPlansRequestSchema>;

export const SavingsPlansResponseSchema = z.object({
  savingsPlans: z.array(
    z.object({
      id: z.string().uuid(),
      createdAt: z.number(),
      instrumentId: z.string(),
      amount: z.number(),
      interval: z.string(),
      startDate: z.object({
        type: z.string(),
        value: z.number(),
        nextExecutionDate: z.string(),
      }),
      firstExecutionDate: z.any().nullable(),
      nextExecutionDate: z.string(),
      previousExecutionDate: z.string(),
      virtualPreviousExecutionDate: z.string(),
      finalExecutionDate: z.any().nullable(),
      paymentMethodId: z.any().nullable(),
      paymentMethodCode: z.any().nullable(),
      lastPaymentExecutionDate: z.any().nullable(),
      paused: z.boolean(),
      fundingCashAccNo: z.string(),
      secAccNo: z.string(),
    }),
  ),
});

export type SavingsPlansResponse = z.infer<typeof SavingsPlansResponseSchema>;

export const SavingsPlanParametersRequestSchema = z.object({
  type: z.literal("savingsPlanParameters"),
  instrumentId: z.string(),
});

export type SavingsPlanParametersRequest = z.infer<
  typeof SavingsPlanParametersRequestSchema
>;

export const SavingsPlanParametersResponseSchema = z.object({
  intervals: z.array(
    z.object({
      interval: z.string(),
      startDates: z.array(
        z.object({
          type: z.string(),
          value: z.number(),
          nextExecutionDate: z.string(),
          availablePaymentMethods: z.array(z.string()),
        }),
      ),
    }),
  ),
  amount: z.object({ min: z.number(), max: z.number(), unit: z.number() }),
  exchangeInfo: z.object({ id: z.string(), name: z.string() }),
});

export type SavingsPlanParametersResponse = z.infer<
  typeof SavingsPlanParametersResponseSchema
>;

export const StockDetailsRequestSchema = z.object({
  type: z.literal("stockDetails"),
  id: z.string().regex(/^[A-Z0-9]+$/),
  jurisdiction: z.literal("DE"),
});

export type StockDetailsRequest = z.infer<typeof StockDetailsRequestSchema>;

export const StockDetailsResponseSchema = z.object({
  isin: z.string(),
  company: z
    .object({
      name: z.string(),
      description: z.string(),
      yearFounded: z.number(),
      tickerSymbol: z.string(),
      peRatioSnapshot: z.number().optional(),
      marketCapSnapshot: z.number().optional(),
      employees: z.number().optional(),
      website: z.string().optional(),
      contactInfo: z
        .object({
          address: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  exchangeInformation: z.object({ id: z.string(), name: z.string() }).optional(),
  events: z
    .array(
      z.object({
        date: z.string(),
        title: z.string(),
        description: z.string().optional(),
      }),
    )
    .optional(),
  derivativeProductCategories: z.array(z.string()).optional(),
  imageId: z.string().optional(),
  availableExchanges: z.array(z.string()).optional(),
});

export type StockDetailsResponse = z.infer<typeof StockDetailsResponseSchema>;

export const TickerRequestSchema = z.object({
  type: z.literal("ticker"),
  id: z.string().regex(/^[A-Z0-9]{2}[A-Z0-9]{9}\\.[A-Z]{2,3}$/),
});

export type TickerRequest = z.infer<typeof TickerRequestSchema>;

export const TickerResponseSchema = z.object({
  bid: z.object({ time: z.number(), price: z.string(), size: z.number() }),
  ask: z.object({ time: z.number(), price: z.string(), size: z.number() }),
  last: z.object({ time: z.number(), price: z.string(), size: z.number() }),
  pre: z.object({ time: z.number(), price: z.string(), size: z.number() }),
  open: z.object({ time: z.number(), price: z.string(), size: z.number() }).optional(),
  qualityId: z.string(),
  leverage: z.null(),
  delta: z.null(),
});

export type TickerResponse = z.infer<typeof TickerResponseSchema>;

export const TimelineActionsV2RequestSchema = z.object({
  type: z.literal("timelineActionsV2"),
});

export type TimelineActionsV2Request = z.infer<typeof TimelineActionsV2RequestSchema>;

export const TimelineActionsV2ResponseSchema = z.object({ items: z.array(z.any()) });

export type TimelineActionsV2Response = z.infer<typeof TimelineActionsV2ResponseSchema>;

export const TimelineDetailV2RequestSchema = z.object({
  type: z.literal("timelineDetailV2"),
  id: z.string().uuid(),
});

export type TimelineDetailV2Request = z.infer<typeof TimelineDetailV2RequestSchema>;

export const TimelineDetailV2ResponseSchema = z.object({
  id: z.string(),
  sections: z.array(
    z.union([
      z.object({
        title: z.string(),
        data: z.object({
          icon: z.string().optional(),
          timestamp: z.string(),
          status: z.string(),
        }),
        type: z.literal("header"),
      }),
      z.object({ title: z.string(), description: z.string(), type: z.literal("banner") }),
      z.object({
        title: z.string().nullable(),
        data: z.array(
          z.object({
            title: z.string(),
            detail: z.union([
              z.object({
                text: z.string(),
                functionalStyle: z.string(),
                type: z.literal("status"),
              }),
              z.object({
                text: z.string(),
                icon: z.string(),
                type: z.literal("iconWithText"),
              }),
              z.object({ text: z.string(), type: z.literal("text") }),
              z.object({
                title: z.string(),
                timestamp: z.string(),
                amount: z.string(),
                icon: z.string(),
                status: z.string(),
                action: z.object({ type: z.string() }).passthrough(),
                subtitle: z.string(),
                type: z.literal("embeddedTimelineItem"),
              }),
              z
                .object({
                  content: z
                    .object({
                      type: z.string(),
                      title: z.string(),
                      truncate: z.boolean(),
                    })
                    .optional(),
                  trailing: z.object({ type: z.string() }).optional(),
                  action: z.object({ payload: z.any(), type: z.string() }).passthrough(),
                  icon: z.string().optional(),
                  style: z.string().optional(),
                  text: z.string().optional(),
                  type: z.string().optional(),
                })
                .passthrough(),
            ]),
            style: z.string(),
          }),
        ),
        type: z.literal("table"),
      }),
      z.object({
        title: z.string(),
        steps: z.array(
          z.object({
            leading: z.object({
              avatar: z.object({ status: z.string(), type: z.string() }),
              connection: z.object({ order: z.string() }),
            }),
            content: z.object({
              title: z.string(),
              subtitle: z.string().nullable(),
              timestamp: z.string(),
              cta: z.any().nullable(),
            }),
          }),
        ),
        type: z.literal("steps"),
      }),
      z.object({
        title: z.string(),
        data: z.array(
          z.object({
            title: z.string(),
            action: z.object({ payload: z.string(), type: z.literal("browserModal") }),
            id: z.string(),
            postboxType: z.string(),
          }),
        ),
        type: z.literal("documents"),
      }),
      z.object({}).passthrough(),
    ]),
  ),
});

export type TimelineDetailV2Response = z.infer<typeof TimelineDetailV2ResponseSchema>;

export const TimelineTransactionsRequestSchema = z.object({
  type: z.literal("timelineTransactions"),
});

export type TimelineTransactionsRequest = z.infer<
  typeof TimelineTransactionsRequestSchema
>;

export const TimelineTransactionsResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      timestamp: z.string(),
      title: z.string(),
      icon: z.string(),
      badge: z.null().or(z.string()),
      subtitle: z.string().optional().nullable(),
      amount: z.object({
        currency: z.string(),
        value: z.number(),
        fractionDigits: z.number(),
      }),
      subAmount: z.null().or(
        z.object({
          currency: z.string(),
          value: z.number(),
          fractionDigits: z.number(),
        }),
      ),
      status: z.string(),
      action: z.object({ type: z.string(), payload: z.string() }),
      eventType: z.string(),
      cashAccountNumber: z.string().nullable(),
      hidden: z.boolean(),
      deleted: z.boolean(),
    }),
  ),
});

export type TimelineTransactionsResponse = z.infer<
  typeof TimelineTransactionsResponseSchema
>;

export const TradingPerkConditionStatusRequestSchema = z.object({
  type: z.literal("tradingPerkConditionStatus"),
});

export type TradingPerkConditionStatusRequest = z.infer<
  typeof TradingPerkConditionStatusRequestSchema
>;

export const TradingPerkConditionStatusResponseSchema = z.object({
  tradingPerkConditionStatus: z.any().nullable(),
});

export type TradingPerkConditionStatusResponse = z.infer<
  typeof TradingPerkConditionStatusResponseSchema
>;

export const WatchlistsRequestSchema = z.object({ type: z.literal("watchlists") });

export type WatchlistsRequest = z.infer<typeof WatchlistsRequestSchema>;

export const WatchlistsResponseSchema = z.object({
  watchlists: z.array(
    z.object({
      id: z.string(),
      cover: z.object({
        small: z.array(
          z.object({
            width: z.number(),
            height: z.number(),
            scale: z.number(),
            url: z.string(),
            url_next_gen: z.string(),
            url_next_gen_icon: z.string(),
          }),
        ),
        medium: z.array(
          z.object({
            width: z.number(),
            height: z.number(),
            scale: z.number(),
            url: z.string(),
            url_next_gen: z.string(),
          }),
        ),
        large: z.array(
          z.object({
            width: z.number(),
            height: z.number(),
            scale: z.number(),
            url: z.string(),
            url_next_gen: z.string(),
          }),
        ),
      }),
      size: z.number(),
      title: z.string(),
      description: z.any().nullable(),
      description_short: z.any().nullable(),
      created_at: z.any().nullable(),
      updated_at: z.any().nullable(),
      instruments: z.any().nullable(),
      following: z.boolean(),
      following_allowed: z.boolean(),
      editing_allowed: z.boolean(),
      investable_isin: z.any().nullable(),
      sharing_allowed: z.boolean(),
      jurisdiction_mismatch: z.boolean(),
      share_text: z.any().nullable(),
    }),
  ),
});

export type WatchlistsResponse = z.infer<typeof WatchlistsResponseSchema>;

export const YieldToMaturityRequestSchema = z.object({
  type: z.literal("yieldToMaturity"),
  id: z.string().regex(/^[A-Z0-9]+$/),
});

export type YieldToMaturityRequest = z.infer<typeof YieldToMaturityRequestSchema>;

export const YieldToMaturityResponseSchema = z.any();

export type YieldToMaturityResponse = z.infer<typeof YieldToMaturityResponseSchema>;
