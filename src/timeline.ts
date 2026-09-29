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
  /** A verification or declined payment: no money moved. */
  | "cardNotice"
  | "atmWithdrawal"
  /** Trade Republic's own charge for a card. */
  | "cardFee"
  | "directDebit"
  | "transferIn"
  | "transferOut"
  | "interest"
  /** Trades, savings plans, round-ups, Saveback, dividends, and securities transfers. */
  | "investment"
  | "tax"
  | "unknown";

const eventKinds = new Map<string, TimelineEventKind>([
  ["CARD_TRANSACTION", "cardPayment"],
  ["CARD_SUCCESSFUL_TRANSACTION", "cardPayment"],
  ["CARD_REFUND", "cardRefund"],
  ["CARD_TR_REFUND", "cardRefund"],
  ["CARD_SUCCESSFUL_OCT", "cardCredit"],
  ["CARD_VERIFICATION", "cardNotice"],
  ["CARD_FAILED_TRANSACTION", "cardNotice"],
  ["CARD_SUCCESSFUL_ATM_WITHDRAWAL", "atmWithdrawal"],
  ["CARD_ORDER_BILLED", "cardFee"],
  ["BANK_TRANSACTION_OUTGOING_DIRECT_DEBIT", "directDebit"],
  ["ACCOUNT_TRANSFER_INCOMING", "transferIn"],
  ["BANK_TRANSACTION_INCOMING", "transferIn"],
  ["INCOMING_TRANSFER", "transferIn"],
  ["INCOMING_TRANSFER_DELEGATION", "transferIn"],
  ["PAYMENT_INBOUND", "transferIn"],
  ["PAYMENT_INBOUND_APPLE_PAY", "transferIn"],
  ["PAYMENT_INBOUND_CREDIT_CARD", "transferIn"],
  ["PAYMENT_INBOUND_GOOGLE_PAY", "transferIn"],
  ["PAYMENT_INBOUND_SEPA_DIRECT_DEBIT", "transferIn"],
  ["PAYMENT-SERVICE-IN-PAYMENT-DIRECT-DEBIT", "transferIn"],
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
  ["IPO_TRADE_EXECUTED", "investment"],
  ["ORDER_EXECUTED", "investment"],
  ["PRIVATE_MARKET_FUND_TRADE_EXECUTED", "investment"],
  ["PRIVATE_MARKETS_ORDER_CREATED", "investment"],
  ["PRIVATE_MARKETS_TRADE_EXECUTED", "investment"],
  ["SAVEBACK_AGGREGATE", "investment"],
  ["SAVINGS_PLAN_EXECUTED", "investment"],
  ["SAVINGS_PLAN_INVOICE_CREATED", "investment"],
  ["SPARE_CHANGE_AGGREGATE", "investment"],
  ["SSP_SECURITIES_TRANSFER_INCOMING", "investment"],
  ["TRADE_CORRECTED", "investment"],
  ["TRADE_INVOICE", "investment"],
  ["TRADING_SAVINGSPLAN_EXECUTED", "investment"],
  ["TRADING_TRADE_EXECUTED", "investment"],
  ["SSP_TAX_CORRECTION", "tax"],
  ["SSP_TAX_CORRECTION_INVOICE", "tax"],
  ["TAX_CORRECTION", "tax"],
  ["TAX_REFUND", "tax"],
]);

export function timelineEventKind(eventType: string): TimelineEventKind {
  return eventKinds.get(eventType) ?? "unknown";
}

const fallbackIcon = /^logos\/merchant-fallback-([a-z-]+)\//;

/**
 * The card-network category Trade Republic names in a merchant's fallback
 * icon, such as `restaurants` or `shopping`, or `null`. A merchant with its
 * own logo gets no category.
 */
export function timelineMerchantCategory(icon: string): string | null {
  return fallbackIcon.exec(icon)?.[1] ?? null;
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
