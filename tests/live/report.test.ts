import { type } from "arktype";
import { describe, expect, test } from "vite-plus/test";
import { TRHttpError, TRValidationError } from "../../src/index.ts";
import { createLiveReport } from "./report.ts";

describe("live account audit report", () => {
  test("reports distinct schema paths without response values", () => {
    const lines: string[] = [];
    const report = createLiveReport((line) => lines.push(line));
    const privateValue = "private-account-value";
    const result = type({
      items: type({ avatar: { badge: "string | null" } }).array(),
    })({
      items: [
        { avatar: { badge: { asset: privateValue } } },
        { avatar: { badge: { asset: privateValue } } },
      ],
    });
    expect(result).toBeInstanceOf(type.errors);

    report.capture(
      "timelineTransactions",
      new TRValidationError("Invalid response", {
        cause: result,
      }),
    );
    report.accessor("timelineTransactions", { pages: 2, items: 60 });
    report.finish();

    expect(lines).toEqual([
      "timelineTransactions: schema-drift (2 pages, 60 items)",
      '{"accessor":"timelineTransactions","path":"items.*.avatar.badge","code":"predicate","expected":"a string or null","actualType":"object","actualFields":[{"path":"asset","type":"string"}]}',
      "liveAudit: schema-drift (1 issue: timelineTransactions)",
    ]);
    expect(lines.join("\n")).not.toContain(privateValue);
  });

  test("keeps auditing after a read failure and reports only its safe code", () => {
    const lines: string[] = [];
    const report = createLiveReport((line) => lines.push(line));

    report.failure("accountInfo", new TRHttpError(503, "private response body"));
    report.accessor("cash", { items: 1 });
    report.finish();

    expect(lines).toEqual([
      "accountInfo: fail",
      '{"accessor":"accountInfo","code":"TRHttpError","status":503}',
      "cash: pass (1 item)",
      "liveAudit: fail (1 read)",
    ]);
    expect(lines.join("\n")).not.toContain("private response body");
  });

  test("keeps schema drift when a later page fails", () => {
    const lines: string[] = [];
    const report = createLiveReport((line) => lines.push(line));
    const result = type({ items: "string[]" })({ items: [1] });
    expect(result).toBeInstanceOf(type.errors);

    report.capture(
      "timelineTransactions",
      new TRValidationError("Invalid response", { cause: result }),
    );
    report.failure("timelineTransactions", new TRHttpError(503, "private response body"));
    report.finish();

    expect(lines).toEqual([
      "timelineTransactions: fail",
      '{"accessor":"timelineTransactions","code":"TRHttpError","status":503}',
      '{"accessor":"timelineTransactions","path":"items.*","code":"domain","expected":"a string","actualType":"number"}',
      "liveAudit: fail (1 read, 1 issue: timelineTransactions)",
    ]);
  });

  test("reports nested types and safe discriminator literals without values", () => {
    const lines: string[] = [];
    const report = createLiveReport((line) => lines.push(line));
    const privateValue = "private-account-value";
    const result = type({
      section: {
        action: { payload: "string", type: "'browserModal'" },
      },
    })({
      section: {
        action: {
          payload: { id: privateValue, meta: { enabled: true } },
          type: "timelineDetailModal",
        },
      },
    });
    expect(result).toBeInstanceOf(type.errors);

    report.capture(
      "timelineDetailV2",
      new TRValidationError("Invalid response", { cause: result }),
    );
    report.accessor("timelineDetailV2");

    expect(lines).toEqual([
      "timelineDetailV2: schema-drift",
      '{"accessor":"timelineDetailV2","path":"section.action.payload","code":"domain","expected":"a string","actualType":"object","actualFields":[{"path":"id","type":"string"},{"path":"meta","type":"object"},{"path":"meta.enabled","type":"boolean"}]}',
      '{"accessor":"timelineDetailV2","path":"section.action.type","code":"unit","expected":"\\"browserModal\\"","actualType":"string","actualLiteral":"timelineDetailModal"}',
    ]);
    expect(lines.join("\n")).not.toContain(privateValue);
  });
});
