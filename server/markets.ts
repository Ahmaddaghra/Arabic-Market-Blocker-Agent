import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const marketSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(2),
  shortLabel: z.string().min(2),
  locale: z.string().regex(/^ar-[A-Z]{2}$/),
  direction: z.literal("rtl"),
  currency: z.string().length(3),
  persona: z.object({
    fullName: z.string().min(2),
    mixedName: z.string().min(2),
    email: z.string().email(),
    phoneLocal: z.string().min(8),
    phoneInternational: z.string().startsWith("+"),
    city: z.string().min(2),
    password: z.string().min(8),
    arabicIndicDigits: z.string().min(8),
    currency: z.string().length(3),
  }),
  checks: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        severity: z.enum(["blocker", "warning", "info"]),
      }),
    )
    .min(1)
    .max(10),
});
export type Market = z.infer<typeof marketSchema>;
const marketsDirectory = path.resolve("data/markets");
export async function loadMarkets(): Promise<Market[]> {
  const files = (await fs.readdir(marketsDirectory))
    .filter((file) => file.endsWith(".json"))
    .sort();
  const markets = await Promise.all(
    files.map(async (file) =>
      marketSchema.parse(
        JSON.parse(
          await fs.readFile(path.join(marketsDirectory, file), "utf8"),
        ),
      ),
    ),
  );
  const ids = new Set<string>();
  for (const market of markets) {
    if (ids.has(market.id))
      throw new Error(`Duplicate market id: ${market.id}`);
    ids.add(market.id);
    if (market.persona.currency !== market.currency)
      throw new Error(`Persona currency mismatch for ${market.id}`);
  }
  return markets;
}
export async function loadMarket(id = "saudi-arabia"): Promise<Market> {
  const market = (await loadMarkets()).find((candidate) => candidate.id === id);
  if (!market) throw new Error(`Unsupported market rule pack: ${id}`);
  return market;
}
export async function listMarkets() {
  return (await loadMarkets()).map(
    ({ id, label, shortLabel, locale, currency }) => ({
      id,
      label,
      shortLabel,
      locale,
      currency,
    }),
  );
}
