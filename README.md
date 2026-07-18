# Arabic Market Blocker Agent

A bounded developer tool that tests one standard, public signup form with a selected Arab-market persona, compares the English baseline with the Arabic input path, records screenshot and DOM-locator evidence, and turns confirmed blockers into grounded Playwright regression tests.

The verdict language is deliberately narrow: **Found N blockers** or **No blockers found in tested flows**. The project does not certify a product or claim broad market readiness.

**Live demo:** https://arabic-market-blocker-agent.onrender.com

## OpenAI Build Week

This project was built for OpenAI Build Week as a bounded developer tool, not a general-purpose crawler.

- **GPT-5.6:** reads the currently visible, extracted DOM; maps unfamiliar labels to Saudi rule-pack values; chooses grounded `fill`, `click`, and `observe` actions; and replans when a safe navigation click reveals a new form step.
- **Codex:** helped design the bounded architecture, implement the Playwright executor and React evidence UI, diagnose deployment failures, write tests, review false-positive risk, and verify deployed runs.

### Judge test in under two minutes

1. Open the [live demo](https://arabic-market-blocker-agent.onrender.com).
2. Paste `https://arabic-market-blocker-agent.onrender.com/demo/adaptive/`.
3. Click **Run Saudi signup audit**.
4. Confirm the result says `planner: gpt-5.6-sol (adaptive)`, then inspect **Why GPT-5.6 mattered**, the EN/AR field comparison, and the generated test.

The centerpiece target uses unconventional labels and a second step revealed only after **Continue**. The deterministic fallback maps `0/2` initial fields; GPT-5.6 maps them, navigates, replans against the newly visible DOM, and completes the bounded audit. Recorded proof: [fallback run](evaluation/runs/adaptive-multistep-fallback.json) and [adaptive run](evaluation/runs/adaptive-multistep-gpt.json).

## Supported scope

- Public, standard signup forms
- No CAPTCHA, authentication wall, payment, or destructive submission
- One selected market rule pack per audit
- At most ten documented checks
- Hard navigation timeout and bounded plan size

## Markets

- **Saudi Arabia** — `data/markets/saudi-arabia.json` (`ar-SA`, SAR)
- **United Arab Emirates** — `data/markets/united-arab-emirates.json` (`ar-AE`, AED)

Market packs are discovered and schema-validated dynamically from `data/markets`. **Adding a market is one JSON file**: adding a third valid pack requires zero application-code changes. The MVP does not introduce a persona engine or market-specific application architecture.

Unsupported pages stop with a clear explanation. The runner never attempts CAPTCHA bypass or credentialed flows.

## Why not existing tools?

These are strong tools that solve related but different problems:

| Existing tool | What it covers | What it doesn't do for Arab-market readiness |
|---|---|---|
| Playwright MCP | Browser automation, form filling, and test generation | No Arab-market knowledge: which values must be accepted or what counts as a market blocker |
| Virtuoso QA / AI testing platforms | General AI-driven web testing and locale data | General-purpose platforms, not a focused verdict on whether Arabic users can complete a flow |
| Applitools | Visual localization comparison and layout/overflow detection | Visual focus; it does not prove Arabic names and phones are accepted or that signup completes |
| BrowserStack | Real devices, geolocations, and locales | Provides the environment, not the Arab-market expertise or the finding/evidence/test output |
| Lokalise / translation QA | String and translation quality | Does not execute the user journey inside the product |
| Raqeeb (open source) | Static HTML/CSS RTL checks and a 0–100 score | Static analysis; no real browser journey, EN/AR control comparison, or generated regression tests |

This project's contribution is packaging market knowledge (versioned rule packs) + a bounded adaptive planner + evidence-grounded regression tests into a single decision-focused tool.

## Why this is not an ad-hoc Codex prompt

An ad-hoc prompt has no stable inputs, rubric, evidence contract, or repeatability guarantee. This project makes the workflow reproducible through:

1. A versioned Saudi rule pack containing test values and at most ten named checks.
2. A fixed bounded planner contract with DOM-grounded locators only.
3. An English control run and Saudi Arabic run against the same page.
4. Screenshot evidence and the exact locator/value/error behind every finding.
5. A deterministic fallback so the same supported form remains testable without model access.
6. A regression test generated from the locator actually discovered in the target DOM.

GPT-5.6 is the adaptive planner: it receives the extracted accessible form structure, identifies whether a standard signup flow is supported, maps fields to Saudi persona values, and returns the next bounded DOM-grounded actions. Playwright executes those actions and records the observed state. Codex was used to design, implement, test, and review the repository.

## Run locally

```bash
npm install
npx playwright install chromium
cp .env.example .env
npm run build
ALLOW_PRIVATE_TARGETS=true npm start
```

Open `http://localhost:3000`, and audit `http://127.0.0.1:3000/demo/`. `ALLOW_PRIVATE_TARGETS=true` exists only for this local benchmark. Never enable it in production.

Set `OPENAI_API_KEY` to enable the GPT-5.6 adaptive planner. Without it, the visible planner label changes to `deterministic-fallback`; the controlled benchmark and safety checks still run truthfully.

## Known limitations

- Only visible fields in public, standard signup forms are inspected; CAPTCHA, authentication walls, iframes with inaccessible content, payment, and highly custom controls are unsupported.
- Adaptive planning is bounded to the supplied DOM locators, at most 12 actions per planning round, and at most two DOM-change replans.
- External targets are never submitted. Only same-origin `/demo` targets can receive `allowSubmission: true`, and the server revalidates that gate.
- Browser validation and error text can vary by target and locale. A market-specific finding requires the English control to pass where the Saudi value fails; shared failures are labeled general form issues.
- Generated regression tests are grounded in observed locators but may still need selector review on unstable third-party DOMs.
- Render cold starts and model latency can make a correct audit take up to roughly 90 seconds.

## Verify

```bash
npm test
npm run build
npm run test:e2e
```

## Deployment-first skeleton

The included `Dockerfile` uses the official Playwright image and `render.yaml` declares a web service with a health check. Production keeps private targets blocked and requires an `OPENAI_API_KEY` secret. After connecting the repository to Render, the first deployment checkpoint is:

1. `/api/health` returns `{ ok: true, playwright: true }`.
2. A public URL opens in server-side Chromium.
3. A screenshot is returned within the hard timeout.
4. Private IPs, unsafe protocols, and credential-bearing URLs are rejected before launch.

## Security boundaries

- HTTP(S) only; credentials in URLs are rejected.
- DNS is resolved before launch and private, loopback, link-local, and carrier-grade NAT ranges are blocked.
- Five audit starts per minute per client.
- 8 KB JSON request limit, hard navigation timeout, fresh isolated browser context.
- No CAPTCHA bypass, no login, no payment, no real account submission.

DNS rebinding defenses should be strengthened further before production use by pinning resolved IPs at the network layer. This MVP documents that limitation instead of overclaiming SSRF safety.

## Architecture

`React UI → rate-limited Express API → URL safety gate → isolated Playwright → DOM extractor → GPT-5.6 planner → evidence verifier → grounded test generator`

The UI starts a bounded job with `POST /api/audit-jobs` and polls its scoped status URL. Progress events come from the real browser/planner/executor path—not a timer—and include the current step, estimated total, active planner, DOM field count, action outcomes, blockers, replans, and exact graceful-exit reasons. The original synchronous `POST /api/audits` remains available for reproducible evaluation scripts.

The controlled `/demo/` target is a transparent benchmark with two documented failures: Arabic Unicode names and Saudi phone numbers. It is not presented as real-world validation.

## Controlled benchmark ground truth

The benchmark has exactly two seeded root causes:

| Root cause | Seeded behavior | Ground-truth blocker |
|---|---|---|
| `name-ascii-only` | Arabic or mixed-script `Full name` shows `Only English letters are allowed` | 1 |
| `phone-us-only` | Saudi local, international, and Arabic-Indic phone values show `Enter a valid US phone number` | 1 |

Repeated failing values are test cases, not new blockers. The audit deduplicates by `rootCauseId` and reports `benchmarkEvaluation` with precision, recall, false positives, false negatives, and whether the controlled submission completed.

The API accepts `allowSubmission: true` only when the URL is the same-origin `/demo` benchmark. For every other URL the server forces it to `false`, and the planner is instructed not to click submit. The controlled benchmark may submit because it is owned, disposable, and marks success with `data-audit-success="true"`.

For reproducibility, run the same deployed `/demo/` URL twice and compare `planner`, `plan`, `findings`, `benchmarkEvaluation`, and the planner decision log. Wording or action ordering may vary; the unique root-cause count and benchmark metrics must remain stable.

Observed deployed repeatability check (2026-07-18):

| Run | Planner | Response ID | Unique blockers | Failing cases | Precision | Recall | Submission attempted | Flow completed |
|---|---|---|---:|---:|---:|---:|---|---|
| 1 | `gpt-5.6-sol (adaptive)` | `resp_014a94196f8f4663006a5ad5e646ec819abf65a53a30fe2825` | 2 | 5 | 1.0 | 1.0 | true | false |
| 2 | `gpt-5.6-sol (adaptive)` | `resp_0f031908e2a2357f006a5ad6303b88819a9fae9454bb9ab608` | 2 | 3 | 1.0 | 1.0 | true | false |

These repeatability runs used the real isolated `en-US` control and `ar-SA` persona contexts. The adaptive planner varied the order and number of repeated test cases, but it kept the unique blocker count and benchmark metrics stable. `flowCompleted: false` is the expected result for this seeded benchmark: the final submission click executed, then the seeded Arabic-name and Saudi-phone validation blockers prevented success.

## Evaluation

**Evaluation summary (re-run with the real isolated English control):** 2 controlled benchmarks + 3 external demo applications; 4 controlled findings across the two benchmark scenarios; all 4 confirmed against each scenario's documented ground truth; 6 external named Saudi-market pass cases; 2 unsupported runs handled gracefully, including one rejected candidate. External targets have no ground truth, so no external precision or recall is claimed.

All external targets are public demo, sandbox, or automation-practice applications. External runs use `allowSubmission: false`; they fill and inspect fields but do not create accounts.

| Target | Preflight | Adaptive result | Findings | Passes | Notes | Replayable log |
|---|---|---|---:|---:|---|---|
| Controlled `/demo/` | Owned benchmark; no CAPTCHA | Completed | 2 | — | Both seeded root causes confirmed; submission attempted and correctly blocked | [run log](evaluation/runs/controlled-benchmark.json) |
| Controlled `/demo/adaptive/` | Owned multi-step benchmark; unconventional labels; no CAPTCHA | Completed | 2 | 2 | Fallback mapped 0/2; GPT mapped step 1, clicked Continue, replanned, and completed step 2 | [adaptive log](evaluation/runs/adaptive-multistep-gpt.json) · [fallback log](evaluation/runs/adaptive-multistep-fallback.json) |
| [ParaBank](https://parabank.parasoft.com/parabank/register.htm) | Public Parasoft demo; signup form; no CAPTCHA observed | Completed | 0 | 5 | Real EN control and Saudi values both passed Arabic name, mixed BiDi name, Saudi local/international phone, and Arabic-Indic digit checks; city also compared but is not counted as a named pass | [run log](evaluation/runs/external-parabank.json) |
| [Automation Exercise](https://automationexercise.com/login) | Public automation-practice site; signup form; no CAPTCHA observed | Completed | 0 | 1 | Real EN control and Saudi full name both passed; phone and completion checks unavailable | [run log](evaluation/runs/external-automation-exercise.json) |
| [nopCommerce demo](https://demo.nopcommerce.com/register) | Official resettable demo; form visible during browser preflight | Unsupported | 0 | 0 | Render-side browser received no auditable fields; stopped instead of reporting a false pass | [run log](evaluation/runs/unsupported-nopcommerce.json) |

Rejected candidate: the Magento Software Testing Board URL returned an SSL/reveal interstitial rather than signup fields. The deployed audit classified it as unsupported with zero findings and zero passes. It is not counted among the three external evaluation applications. [Rejected-candidate run log](evaluation/runs/unsupported-magento-candidate.json)

These external findings and passes are observations from bounded, non-submitting runs. They do not certify the applications or prove the absence of other blockers.
