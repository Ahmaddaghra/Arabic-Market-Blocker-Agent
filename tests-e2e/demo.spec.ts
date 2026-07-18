import { test, expect } from "@playwright/test";

test("bundled report routes survive without runtime run storage", async ({
  page,
}) => {
  for (const slug of [
    "benchmark-saudi",
    "benchmark-uae",
    "multistep-gpt",
    "external-lambdatest",
  ]) {
    await page.goto(`/report/${slug}`);
    await expect(page.locator(".results")).toBeVisible();
    await expect(page.getByText("Permanent bundled report")).toBeVisible();
    await expect(page.locator(".comparison img")).toHaveCount(2);
    for (const image of await page.locator(".comparison img").all())
      expect(await image.getAttribute("src")).toMatch(
        /^data:image\/png;base64,/,
      );
  }
});

test("sample chips fill targets without starting an audit", async ({
  page,
}) => {
  await page.goto("/");
  const cases = [
    ["Controlled benchmark", "/demo/"],
    ["Multi-step (GPT-only)", "/demo/adaptive/"],
    [
      "ParaBank (external)",
      "https://parabank.parasoft.com/parabank/register.htm",
    ],
  ] as const;
  for (const [label, expected] of cases) {
    await page
      .getByRole("button", { name: new RegExp(label.replace(/[()]/g, "\\$&")) })
      .click();
    await expect(page.getByLabel("Public signup form URL")).toHaveValue(
      new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    await expect(page.getByLabel("Market")).toHaveValue("saudi-arabia");
    await expect(page.getByText("Live audit progress")).toHaveCount(0);
  }
});

test("controlled benchmark uses the adaptive planner when an API key is configured", async ({
  page,
}) => {
  test.skip(
    !process.env.OPENAI_API_KEY,
    "OPENAI_API_KEY is required for the adaptive integration path.",
  );
  await page.goto("/");
  await page
    .getByLabel("Public signup form URL")
    .fill("http://127.0.0.1:3000/demo/");
  await page.getByRole("button", { name: "Run Saudi signup audit" }).click();
  await expect(page.getByText("Live audit progress")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /Market-specific blockers: 2.*General form issues: 0/,
    }),
  ).toBeVisible({ timeout: 120000 });
  await expect(
    page.getByText("Planner: gpt-5.6-sol (adaptive)", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Adaptive planner completed without fallback."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Why GPT-5.6 mattered" }),
  ).toBeVisible();
  await expect(page.getByText("Per-field control comparison")).toBeVisible();
});

test("missing API key is exposed as an explicit fallback path", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.OPENAI_API_KEY),
    "Fallback integration path runs only when the server has no API key.",
  );
  await page.goto("/");
  await page
    .getByLabel("Public signup form URL")
    .fill("http://127.0.0.1:3000/demo/");
  await page.getByRole("button", { name: "Run Saudi signup audit" }).click();
  await expect(page.getByText("Live audit progress")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /Market-specific blockers: 2.*General form issues: 0/,
    }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByText("Planner: deterministic-fallback", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText(/Fallback reason:.*missing_key/)).toBeVisible();
  await expect(page.getByText("Planner run log")).toBeVisible();
  await expect(page.getByText(/Step \d+\/\d+/).first()).toBeVisible();
  await expect(
    page.getByText(/Planner: deterministic-fallback/).first(),
  ).toBeVisible();
});

test("unsupported adaptive demo streams its exact graceful-exit reason", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.OPENAI_API_KEY),
    "Missing-key graceful exit requires a server without an API key.",
  );
  await page.goto("/");
  await page
    .getByLabel("Public signup form URL")
    .fill("http://127.0.0.1:3000/demo/adaptive/");
  await page.getByRole("button", { name: "Run Saudi signup audit" }).click();
  await expect(page.getByText("Live audit progress")).toBeVisible();
  await expect(
    page
      .getByText(
        /Deterministic fallback could not safely map at least two visible fields/,
      )
      .first(),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Unsupported site")).toBeVisible();
});
