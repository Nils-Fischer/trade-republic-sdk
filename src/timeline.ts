/**
 * What a timeline row's `eventType` says about it. The names follow pytr's
 * mapping (pytr/event.py), which spans the old and new timeline formats.
 * `unknown` means a type this list has not met; callers must handle it.
 */
export type TimelineEventKind =
  | "cardPayment"
  | "cardRefund"
  /** Money a merchant pushed to the card (an original credit transaction). */
  | "cardCredit"
  /** A card verification or a declined payment: no money moved. */
  | "cardNotice"
  | "atmWithdrawal"
  /** Trade Republic's own charge for a card. */
  | "cardFee"
  | "directDebit"
  /** The customer's own money paid in by card, wallet, or direct debit. Not income. */
  | "topUp"
  | "transferIn"
  | "transferOut"
  | "interest"
  /** Trades, savings plans, round-ups, Saveback, dividends, and corporate actions. */
  | "investment"
  | "tax"
  /** An order, document, or account event that moves no money. */
  | "notice"
  | "unknown";

const eventKinds = new Map<string, TimelineEventKind>([
  ["CARD_TRANSACTION", "cardPayment"],
  ["CARD_SUCCESSFUL_TRANSACTION", "cardPayment"],
  ["CARD_REFUND", "cardRefund"],
  ["CARD_TR_REFUND", "cardRefund"],
  ["CARD_SUCCESSFUL_OCT", "cardCredit"],
  ["CARD_VERIFICATION", "cardNotice"],
  ["CARD_SUCCESSFUL_VERIFICATION", "cardNotice"],
  ["CARD_FAILED_VERIFICATION", "cardNotice"],
  ["CARD_FAILED_TRANSACTION", "cardNotice"],
  ["CARD_SUCCESSFUL_ATM_WITHDRAWAL", "atmWithdrawal"],
  ["CARD_ORDER_BILLED", "cardFee"],
  ["BANK_TRANSACTION_OUTGOING_DIRECT_DEBIT", "directDebit"],
  ["PAYMENT_INBOUND", "topUp"],
  ["PAYMENT_INBOUND_APPLE_PAY", "topUp"],
  ["PAYMENT_INBOUND_CREDIT_CARD", "topUp"],
  ["PAYMENT_INBOUND_GOOGLE_PAY", "topUp"],
  ["PAYMENT_INBOUND_SEPA_DIRECT_DEBIT", "topUp"],
  ["PAYMENT-SERVICE-IN-PAYMENT-DIRECT-DEBIT", "topUp"],
  ["VERIFICATION_TRANSFER_ACCEPTED", "topUp"],
  ["ACCOUNT_TRANSFER_INCOMING", "transferIn"],
  ["BANK_TRANSACTION_INCOMING", "transferIn"],
  ["INCOMING_TRANSFER", "transferIn"],
  ["INCOMING_TRANSFER_DELEGATION", "transferIn"],
  ["BANK_TRANSACTION_OUTGOING", "transferOut"],
  ["JUNIOR_P2P_TRANSFER", "transferOut"],
  ["OUTGOING_TRANSFER", "transferOut"],
  ["OUTGOING_TRANSFER_DELEGATION", "transferOut"],
  ["PAYMENT_OUTBOUND", "transferOut"],
  ["INTEREST_PAYOUT", "interest"],
  ["INTEREST_PAYOUT_CREATED", "interest"],
  ["ACQUISITION_TRADE_PERK", "investment"],
  ["BENEFITS_SAVEBACK_EXECUTION", "investment"],
  ["BENEFITS_SPARE_CHANGE_EXECUTION", "investment"],
  ["CREDIT", "investment"],
  ["CREDIT_CANCELED", "investment"],
  ["GESH_CORPORATE_ACTION", "investment"],
  ["INSTRUCTION_CORPORATE_ACTION", "investment"],
  ["IPO_TRADE_EXECUTED", "investment"],
  ["ORDER_EXECUTED", "investment"],
  ["PRIVATE_MARKET_FUND_TRADE_EXECUTED", "investment"],
  ["PRIVATE_MARKETS_ORDER_CREATED", "investment"],
  ["PRIVATE_MARKETS_TRADE_EXECUTED", "investment"],
  ["SAVEBACK_AGGREGATE", "investment"],
  ["SAVINGS_PLAN_EXECUTED", "investment"],
  ["SAVINGS_PLAN_INVOICE_CREATED", "investment"],
  ["SHAREBOOKING", "investment"],
  ["SHAREBOOKING_TRANSACTIONAL", "investment"],
  ["SPARE_CHANGE_AGGREGATE", "investment"],
  ["SSP_CORPORATE_ACTION_ACTIVITY", "investment"],
  ["SSP_CORPORATE_ACTION_CASH", "investment"],
  ["SSP_CORPORATE_ACTION_CASH_AND_STOCK", "investment"],
  ["SSP_CORPORATE_ACTION_CASH_NON_DIVIDEND", "investment"],
  ["SSP_CORPORATE_ACTION_INVOICE_CASH", "investment"],
  ["SSP_CORPORATE_ACTION_INVOICE_SHARES", "investment"],
  ["SSP_CORPORATE_ACTION_NO_CASH", "investment"],
  ["SSP_SECURITIES_TRANSFER_INCOMING", "investment"],
  ["STOCK_PERK_REFUNDED", "investment"],
  ["TRADE_CORRECTED", "investment"],
  ["TRADE_INVOICE", "investment"],
  ["TRADING_SAVINGSPLAN_EXECUTED", "investment"],
  ["TRADING_TRADE_EXECUTED", "investment"],
  ["PRE_DETERMINED_TAX_BASE_EARNING", "tax"],
  ["SSP_TAX_CORRECTION", "tax"],
  ["SSP_TAX_CORRECTION_INVOICE", "tax"],
  ["TAX_CORRECTION", "tax"],
  ["TAX_REFUND", "tax"],
  ["EXEMPTION_ORDER_CHANGED", "notice"],
  ["EXEMPTION_ORDER_CHANGE_REQUESTED", "notice"],
  ["EXEMPTION_ORDER_CHANGE_REQUESTED_AUTOMATICALLY", "notice"],
  ["ORDER_CANCELED", "notice"],
  ["ORDER_CREATED", "notice"],
  ["ORDER_EXPIRED", "notice"],
  ["ORDER_REJECTED", "notice"],
  ["PRIVATE_MARKET_FUND_ORDER_RECEIVED", "notice"],
  ["SSP_CAPITAL_INCREASE_CUSTOMER_INSTRUCTION", "notice"],
  ["SSP_CORPORATE_ACTION_INFORMATIVE", "notice"],
  ["SSP_CORPORATE_ACTION_INFORMATIVE_NOTIFICATION", "notice"],
  ["SSP_CORPORATE_ACTION_INSTRUCTION", "notice"],
  ["SSP_CORPORATE_ACTION_UPCOMING", "notice"],
  ["SSP_DIVIDEND_OPTION_CUSTOMER_INSTRUCTION", "notice"],
  ["SSP_GENERAL_MEETING_CUSTOMER_INSTRUCTION", "notice"],
  ["SSP_TENDER_OFFER_CUSTOMER_INSTRUCTION", "notice"],
  ["TAX_YEAR_END_REPORT", "notice"],
  ["TAX_YEAR_END_REPORT_CREATED", "notice"],
  ["TRADING_ORDER_CANCELLED", "notice"],
  ["TRADING_ORDER_CREATED", "notice"],
  ["TRADING_ORDER_EXPIRED", "notice"],
  ["TRADING_ORDER_REJECTED", "notice"],
  ["TRADING_SAVINGSPLAN_EXECUTION_FAILED", "notice"],
  ["TRADING_SAVINGSPLAN_EXECUTION_PENDING", "notice"],
]);

export function timelineEventKind(eventType: string): TimelineEventKind {
  return eventKinds.get(eventType) ?? "unknown";
}

/**
 * The card-network categories seen in fallback icons. Trade Republic may add
 * more, so any other lowercase name is passed through unchanged.
 */
export type TimelineMerchantCategory =
  | "restaurants"
  | "shopping"
  | "groceries"
  | "transport"
  | "health"
  | "entertainment"
  | "other"
  | (string & {});

const fallbackIcon = /^logos\/merchant-fallback-([a-z-]+)\//;
const merchantIcon = /^(?:logos\/merchant-|merchant-logos\/)/;

/**
 * The card-network category Trade Republic names in a merchant's fallback
 * icon, such as `restaurants` or `shopping`, or `null`. A merchant with its
 * own logo gets no category.
 */
export function timelineMerchantCategory(icon: string): TimelineMerchantCategory | null {
  return fallbackIcon.exec(icon)?.[1] ?? null;
}

/**
 * Whether `icon` is a merchant's own logo, as opposed to a category fallback,
 * a contact's initials, or one of Trade Republic's system icons.
 */
export function isTimelineMerchantLogo(icon: string): boolean {
  return merchantIcon.test(icon) && !fallbackIcon.test(icon);
}

const ASSET_ORIGIN = "https://assets.traderepublic.com/img";

/**
 * The public image for a timeline row's `icon` or `avatar.asset`. `logos/…`
 * assets are SVG; `merchant-logos/…` assets are PNG. Neither needs a Session.
 */
export function timelineIconUrl(icon: string, theme: "light" | "dark" = "light"): string {
  const file = icon.startsWith("merchant-logos/") ? `${theme}.png` : `${theme}.min.svg`;
  return `${ASSET_ORIGIN}/${icon}/${file}`;
}
