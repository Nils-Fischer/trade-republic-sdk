import { type } from "arktype";
import { TRValidationError } from "./errors.ts";
import { validateResponse, type ResponseValidation } from "./validation.ts";

export type { ValidationMode } from "./validation.ts";

const quoteSchema = type({
  time: "number",
  price: "string",
  size: "number",
});

export const TickerRequestSchema = type({
  id: type("string").matching(/^[A-Z0-9.]+\.[A-Z]{2,6}$/),
});

export type TickerRequest = typeof TickerRequestSchema.infer;

export const TickerResponseSchema = type({
  bid: quoteSchema,
  ask: quoteSchema,
  last: quoteSchema,
  pre: quoteSchema,
  "open?": quoteSchema,
  qualityId: "string",
  leverage: "null",
  delta: "null",
}).onDeepUndeclaredKey("reject");

export type TickerResponse = typeof TickerResponseSchema.infer;

export const CashRequestSchema = type({ "[string]": "never" });
export type CashRequest = typeof CashRequestSchema.infer;

export const CashResponseSchema = type({
  accountNumber: "string",
  currencyId: "string",
  amount: "number",
})
  .array()
  .onDeepUndeclaredKey("reject");
export type CashResponse = typeof CashResponseSchema.infer;

const EmptyRequestSchema = CashRequestSchema;
const UUIDSchema = type("string").matching(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
);

export const AccountPairsResponseSchema = type({
  authAccountId: UUIDSchema,
  accounts: type({
    securitiesAccountNumber: "string",
    cashAccountNumber: "string",
    productType: "string",
    "currency?": "string",
    "accountAccessType?": "string",
  }).array(),
}).onDeepUndeclaredKey("reject");
export type AccountPairsResponse = typeof AccountPairsResponseSchema.infer;

export const AvailableCashResponseSchema = CashResponseSchema.onDeepUndeclaredKey("reject");
export type AvailableCashResponse = typeof AvailableCashResponseSchema.infer;

export const CompactPortfolioByTypeRequestSchema = type({
  secAccNo: "string",
  "+": "reject",
});
export type CompactPortfolioByTypeRequest = typeof CompactPortfolioByTypeRequestSchema.infer;

export const CompactPortfolioByTypeResponseSchema = type({
  categories: type({
    categoryType: "string",
    positions: type({
      isin: "string",
      averageBuyIn: "string",
      netSize: "string",
      virtualSize: "string",
      status: "string",
      instrumentType: "string",
      name: "string",
      derivativeInfo: "unknown | null",
      bondInfo: "unknown | null",
      imageId: "string",
    }).array(),
  }).array(),
  "products?": "unknown[]",
}).onDeepUndeclaredKey("reject");
export type CompactPortfolioByTypeResponse = typeof CompactPortfolioByTypeResponseSchema.infer;

export const CustomerPermissionsResponseSchema = type({
  permissions: "unknown[]",
}).onDeepUndeclaredKey("reject");
export type CustomerPermissionsResponse = typeof CustomerPermissionsResponseSchema.infer;

export const FincrimeBannerResponseSchema = type({
  carouselItems: "unknown[]",
}).onDeepUndeclaredKey("reject");
export type FincrimeBannerResponse = typeof FincrimeBannerResponseSchema.infer;

export const OrdersRequestSchema = type({ terminated: "boolean", "+": "reject" });
export type OrdersRequest = typeof OrdersRequestSchema.infer;
export const OrdersResponseSchema = type({
  orders: "unknown[]",
  unsupportedOrderCount: "number",
}).onDeepUndeclaredKey("reject");
export type OrdersResponse = typeof OrdersResponseSchema.infer;

export const PortfolioStatusResponseSchema = type({
  status: "string",
  hasInvested: "boolean",
  firstCashReceived: "boolean",
  firstPortfolioUsage: "boolean",
  bitgoTermsRequired: "boolean",
  proprietaryTradingTermsRequired: "boolean",
  "dmaTermsRequired?": "boolean",
  reKycRequired: "unknown[]",
  sourceOfFundsRequired: "boolean",
  tradingBlockedOnIdentification: "boolean | null",
  bondsTermsRequired: "boolean",
  privateFundTermsRequired: "boolean",
}).onDeepUndeclaredKey("reject");
export type PortfolioStatusResponse = typeof PortfolioStatusResponseSchema.infer;

export const SavingsPlansRequestSchema = type({ secAccNo: "string", "+": "reject" });
export type SavingsPlansRequest = typeof SavingsPlansRequestSchema.infer;
export const SavingsPlansResponseSchema = type({
  savingsPlans: type({
    id: UUIDSchema,
    createdAt: "number",
    instrumentId: "string",
    amount: "number",
    interval: "string",
    startDate: {
      type: "string",
      value: "number",
      nextExecutionDate: "string",
    },
    firstExecutionDate: "unknown | null",
    nextExecutionDate: "string",
    previousExecutionDate: "string",
    virtualPreviousExecutionDate: "string",
    finalExecutionDate: "unknown | null",
    paymentMethodId: "unknown | null",
    paymentMethodCode: "unknown | null",
    lastPaymentExecutionDate: "unknown | null",
    paused: "boolean",
    fundingCashAccNo: "string",
    secAccNo: "string",
  }).array(),
}).onDeepUndeclaredKey("reject");
export type SavingsPlansResponse = typeof SavingsPlansResponseSchema.infer;

export const TimelineActionsV2ResponseSchema = type({
  "items?": "unknown[]",
}).onDeepUndeclaredKey("reject");
export type TimelineActionsV2Response = typeof TimelineActionsV2ResponseSchema.infer;

export const TimelineDetailV2RequestSchema = type({ id: UUIDSchema, "+": "reject" });
export type TimelineDetailV2Request = typeof TimelineDetailV2RequestSchema.infer;
const TimelineDetailSectionSchema = type
  .or(
    type({
      title: "string",
      data: { "icon?": "string", timestamp: "string", status: "string" },
      type: "'header'",
    }),
    type({ title: "string", description: "string", type: "'banner'" }),
    type({
      title: "string",
      data: type({ title: "string", detail: "unknown", style: "string" }).array(),
      type: "'table'",
    }),
    type({
      title: "string",
      steps: type({
        leading: {
          avatar: { status: "string", type: "string" },
          connection: { order: "string" },
        },
        content: {
          title: "string",
          subtitle: "string | null",
          timestamp: "string",
          cta: "unknown | null",
        },
      }).array(),
      type: "'steps'",
    }),
    type({
      title: "string",
      data: type({
        title: "string",
        action: { payload: "string", type: "'browserModal'" },
        id: "string",
        postboxType: "string",
      }).array(),
      type: "'documents'",
    }),
  )
  .onDeepUndeclaredKey("reject");
export const TimelineDetailV2ResponseSchema = type({
  id: "string",
  sections: TimelineDetailSectionSchema.array(),
}).onDeepUndeclaredKey("reject");
export type TimelineDetailV2Response = typeof TimelineDetailV2ResponseSchema.infer;

export const TimelineTransactionsRequestSchema = type({
  "after?": "string",
  "+": "reject",
});
export type TimelineTransactionsRequest = typeof TimelineTransactionsRequestSchema.infer;
const TimelineTransactionAmountSchema = type({
  currency: "string",
  value: "number",
  fractionDigits: "number",
});
const TimelineTransactionAvatarBadgeSchema = type({
  asset: "string",
  type: "string",
}).or("string | null");
const TimelineTransactionAvatarSchema = type({
  asset: "string",
  "badge?": TimelineTransactionAvatarBadgeSchema,
});
export const TimelineTransactionSchema = type({
  id: "string",
  timestamp: "string",
  title: "string",
  icon: "string",
  badge: "string | null",
  "subtitle?": "string | null",
  amount: TimelineTransactionAmountSchema,
  subAmount: TimelineTransactionAmountSchema.or("null"),
  status: "string",
  action: { type: "string", payload: "string" },
  eventType: "string",
  cashAccountNumber: "string | null",
  hidden: "boolean",
  deleted: "boolean",
  "avatar?": TimelineTransactionAvatarSchema,
}).onDeepUndeclaredKey("reject");
export type TimelineTransaction = typeof TimelineTransactionSchema.infer;
export const TimelineTransactionsResponseSchema = type({
  items: TimelineTransactionSchema.array(),
  cursors: { "after?": "string | null", "before?": "string | null" },
  "startingTransactionId?": "string | null",
}).onDeepUndeclaredKey("reject");
export type TimelineTransactionsResponse = typeof TimelineTransactionsResponseSchema.infer;

export const TradingPerkConditionStatusResponseSchema = type({
  tradingPerkConditionStatus: "unknown | null",
}).onDeepUndeclaredKey("reject");
export type TradingPerkConditionStatusResponse =
  typeof TradingPerkConditionStatusResponseSchema.infer;

const ImageDetailSchema = type({
  width: "number",
  height: "number",
  scale: "number",
  url: "string",
  url_next_gen: "string",
});
const ImageDetailWithOptionalIconSchema = ImageDetailSchema.merge({
  "url_next_gen_icon?": "string",
});
const ImageDetailWithIconSchema = ImageDetailSchema.merge({ url_next_gen_icon: "string" });
const NamedWatchlistCoverSchema = type({
  small: ImageDetailWithOptionalIconSchema.array(),
  medium: ImageDetailSchema.array(),
  large: ImageDetailSchema.array(),
});
const WatchlistsCoverSchema = type({
  small: ImageDetailWithIconSchema.array(),
  medium: ImageDetailSchema.array(),
  large: ImageDetailSchema.array(),
});
const WatchlistSchema = type({
  id: "string",
  cover: WatchlistsCoverSchema,
  size: "number",
  title: "string",
  description: "unknown | null",
  description_short: "unknown | null",
  created_at: "unknown | null",
  updated_at: "unknown | null",
  instruments: "unknown | null",
  following: "boolean",
  following_allowed: "boolean",
  editing_allowed: "boolean",
  investable_isin: "unknown | null",
  sharing_allowed: "boolean",
  jurisdiction_mismatch: "boolean",
  share_text: "unknown | null",
});
export const WatchlistsResponseSchema = type({
  watchlists: WatchlistSchema.array(),
}).onDeepUndeclaredKey("reject");
export type WatchlistsResponse = typeof WatchlistsResponseSchema.infer;

export const NamedWatchlistRequestSchema = type({
  watchlistId: type("'favorites'").or(UUIDSchema),
  "+": "reject",
});
export type NamedWatchlistRequest = typeof NamedWatchlistRequestSchema.infer;
const NamedWatchlistInstrumentCreatedAtSchema = type("string | null").or("number[]");
export const NamedWatchlistResponseSchema = WatchlistSchema.merge({
  cover: NamedWatchlistCoverSchema,
  description: "string | null",
  description_short: "string | null",
  created_at: "string | null",
  updated_at: "string | null",
  instruments: type({
    instrument_id: "string",
    "created_at?": NamedWatchlistInstrumentCreatedAtSchema,
    holding_percent: "number | null",
  })
    .array()
    .or("null"),
  investable_isin: "string | null",
  share_text: "string | null",
}).onDeepUndeclaredKey("reject");
export type NamedWatchlistResponse = typeof NamedWatchlistResponseSchema.infer;

/** The single source of truth for Trade Republic WebSocket Topics. */
export const topicRegistry = {
  ticker: {
    request: TickerRequestSchema,
    response: TickerResponseSchema,
    secured: false,
  },
  cash: {
    request: CashRequestSchema,
    response: CashResponseSchema,
    secured: true,
  },
  accountPairs: {
    request: EmptyRequestSchema,
    response: AccountPairsResponseSchema,
    secured: true,
  },
  availableCash: {
    request: EmptyRequestSchema,
    response: AvailableCashResponseSchema,
    secured: true,
  },
  compactPortfolioByType: {
    request: CompactPortfolioByTypeRequestSchema,
    response: CompactPortfolioByTypeResponseSchema,
    secured: true,
  },
  customerPermissions: {
    request: EmptyRequestSchema,
    response: CustomerPermissionsResponseSchema,
    secured: true,
  },
  fincrimeBanner: {
    request: EmptyRequestSchema,
    response: FincrimeBannerResponseSchema,
    secured: true,
  },
  orders: { request: OrdersRequestSchema, response: OrdersResponseSchema, secured: true },
  portfolioStatus: {
    request: EmptyRequestSchema,
    response: PortfolioStatusResponseSchema,
    secured: true,
  },
  savingsPlans: {
    request: SavingsPlansRequestSchema,
    response: SavingsPlansResponseSchema,
    secured: true,
  },
  timelineActionsV2: {
    request: EmptyRequestSchema,
    response: TimelineActionsV2ResponseSchema,
    secured: true,
  },
  timelineDetailV2: {
    request: TimelineDetailV2RequestSchema,
    response: TimelineDetailV2ResponseSchema,
    secured: true,
  },
  timelineTransactions: {
    request: TimelineTransactionsRequestSchema,
    response: TimelineTransactionsResponseSchema,
    secured: true,
  },
  tradingPerkConditionStatus: {
    request: EmptyRequestSchema,
    response: TradingPerkConditionStatusResponseSchema,
    secured: true,
  },
  watchlists: {
    request: EmptyRequestSchema,
    response: WatchlistsResponseSchema,
    secured: true,
  },
  namedWatchlist: {
    request: NamedWatchlistRequestSchema,
    response: NamedWatchlistResponseSchema,
    secured: true,
  },
} as const;

export function isSecuredTopic(name: TopicName): boolean {
  return topicRegistry[name].secured;
}

export type TopicName = keyof typeof topicRegistry;
export type TopicRequest<Name extends TopicName> = (typeof topicRegistry)[Name]["request"]["infer"];
export type TopicResponse<Name extends TopicName> =
  (typeof topicRegistry)[Name]["response"]["infer"];

export const topicNames = Object.keys(topicRegistry).filter(isTopicName);

function isTopicName(name: string): name is TopicName {
  return Object.hasOwn(topicRegistry, name);
}

function assertTopicRequest<Name extends TopicName>(
  name: Name,
  request: TopicRequest<Name>,
): TopicRequest<Name> {
  try {
    return topicRegistry[name].request.assert(request) as TopicRequest<Name>;
  } catch (cause) {
    throw new TRValidationError(`Invalid request for Topic "${name}"`, { cause });
  }
}

export function encodeTopicRequest<Name extends TopicName>(
  name: Name,
  request: TopicRequest<Name>,
) {
  return {
    type: name,
    ...assertTopicRequest(name, request),
  };
}

export function decodeTopicResponse<Name extends TopicName>(
  name: Name,
  payload: string,
  validation: ResponseValidation,
): TopicResponse<Name> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    // A malformed Frame is ignored in every validation mode.
    return undefined;
  }

  return validateResponse<TopicResponse<Name>>(
    topicRegistry[name].response,
    value,
    `Topic "${name}"`,
    validation,
  );
}
