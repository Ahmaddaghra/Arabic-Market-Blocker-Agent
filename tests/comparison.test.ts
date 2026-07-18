import { describe, it, expect } from "vitest";
import { classifyComparison, summarizeFindings } from "../server/audit.js";
import type { FieldEvidence, Finding } from "../server/types.js";

const locator = { strategy: "label" as const, value: "Full name" };
const evidence = (accepted: boolean): FieldEvidence => ({
  value: accepted ? "John Smith" : "عبد الرحمن",
  actual: accepted ? "John Smith" : "عبد الرحمن",
  accepted,
  validationMessage: accepted ? "" : "Rejected",
  locator,
});

describe("English vs Arabic control classification", () => {
  it("calls a failure market-specific only when English passed and Arabic failed", () => {
    expect(classifyComparison(evidence(true), evidence(false))).toBe(
      "market-specific",
    );
  });

  it("labels a shared failure as a general form issue", () => {
    expect(classifyComparison(evidence(false), evidence(false))).toBe(
      "general-form-issue",
    );
  });

  it("records an accepted Arabic value as a pass", () => {
    expect(classifyComparison(evidence(true), evidence(true))).toBe("pass");
  });
});

describe("verdict wording", () => {
  const finding = (rootCauseId: string) => ({ rootCauseId }) as Finding;
  it("separates market blockers from general issues", () => {
    expect(
      summarizeFindings([
        finding("phone-us-only"),
        finding("general-label-Telephone"),
      ]),
    ).toEqual({
      counts: { marketSpecificBlockers: 1, generalFormIssues: 1 },
      verdict:
        "Market-specific blockers: 1 · General form issues: 1 (affect all users)",
    });
  });
  it("does not claim a market blocker for a shared control failure", () => {
    expect(
      summarizeFindings([finding("general-label-Telephone")]).verdict,
    ).toBe(
      "Market-specific blockers: 0 · General form issues: 1 (affect all users)",
    );
  });
});
