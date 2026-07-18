import { describe, it, expect } from "vitest";
import { adaptivePlannerLabel, createPlan } from "../server/planner.js";
describe("planner fallback", () => {
  it("grounds actions in supplied DOM locators and explains fallback", async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await createPlan(
      [
        {
          tag: "input",
          type: "text",
          label: "Full name",
          name: "fullName",
          placeholder: "",
          required: true,
          locator: { strategy: "label", value: "Full name" },
        },
        {
          tag: "input",
          type: "email",
          label: "Email",
          name: "email",
          placeholder: "",
          required: true,
          locator: { strategy: "label", value: "Email" },
        },
      ],
      ["Create account"],
    );
    expect(result.supported).toBe(true);
    expect(result.actions[0].locator).toEqual({
      strategy: "label",
      value: "Full name",
    });
    expect(result.source).toBe("deterministic-fallback");
    expect(result.fallbackReason).toBe(
      "missing_key: OPENAI_API_KEY is not configured.",
    );
    expect(result.log.join("\n")).toContain("Fallback activated: missing_key");
  });
});
describe("planner display label", () => {
  it("uses one canonical adaptive name", () => {
    expect(adaptivePlannerLabel("gpt-5.6")).toBe("gpt-5.6-sol (adaptive)");
    expect(adaptivePlannerLabel("gpt-5.6-sol")).toBe("gpt-5.6-sol (adaptive)");
  });
});
