import { describe, expect, test } from "vite-plus/test";
import { timelineEventKind, timelineIconUrl, timelineMerchantCategory } from "../src/index.ts";

describe("timeline event kinds", () => {
  test("names card, transfer, and investment events", () => {
    expect(timelineEventKind("CARD_TRANSACTION")).toBe("cardPayment");
    expect(timelineEventKind("CARD_VERIFICATION")).toBe("cardNotice");
    expect(timelineEventKind("BANK_TRANSACTION_OUTGOING_DIRECT_DEBIT")).toBe("directDebit");
    expect(timelineEventKind("BANK_TRANSACTION_INCOMING")).toBe("transferIn");
    expect(timelineEventKind("PAYMENT_OUTBOUND")).toBe("transferOut");
    expect(timelineEventKind("SPARE_CHANGE_AGGREGATE")).toBe("investment");
    expect(timelineEventKind("TAX_REFUND")).toBe("tax");
  });

  test("reports an event it has not met as unknown", () => {
    expect(timelineEventKind("SOMETHING_NEW")).toBe("unknown");
  });
});

describe("timeline icons", () => {
  test("reads the card-network category from a fallback icon only", () => {
    expect(timelineMerchantCategory("logos/merchant-fallback-restaurants/v2")).toBe("restaurants");
    expect(timelineMerchantCategory("logos/merchant-0fb109c2-d31b-4abf-bc03-0ef63f1fde2b/v2")).toBe(
      null,
    );
  });

  test("builds the public asset URL for both icon forms", () => {
    expect(timelineIconUrl("logos/timeline_interest_new/v2")).toBe(
      "https://assets.traderepublic.com/img/logos/timeline_interest_new/v2/light.min.svg",
    );
    expect(timelineIconUrl("merchant-logos/376d6b56-8c2d-4811-976a-f1cc54dfe829", "dark")).toBe(
      "https://assets.traderepublic.com/img/merchant-logos/376d6b56-8c2d-4811-976a-f1cc54dfe829/dark.png",
    );
  });
});
