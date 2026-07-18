import { describe, expect, it } from "vitest";
import { loadMarkets, marketSchema } from "../server/markets.js";

describe("market rule packs", () => {
  it("dynamically loads and validates Saudi Arabia and UAE packs", async () => {
    const markets = await loadMarkets();
    expect(markets.map((market) => market.id)).toEqual([
      "saudi-arabia",
      "united-arab-emirates",
    ]);
    for (const market of markets)
      expect(marketSchema.safeParse(market).success).toBe(true);
    expect(
      markets.find((market) => market.id === "saudi-arabia"),
    ).toMatchObject({ locale: "ar-SA", currency: "SAR" });
    expect(
      markets.find((market) => market.id === "united-arab-emirates"),
    ).toMatchObject({ locale: "ar-AE", currency: "AED" });
  });
});
