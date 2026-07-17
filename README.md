# Arabic Market Blocker Agent

A bounded developer tool that tests one standard, public signup form with a Saudi market persona, compares the English baseline with the Arabic input path, records screenshot and DOM-locator evidence, and turns confirmed blockers into grounded Playwright regression tests.

The verdict language is deliberately narrow: **Found N blockers** or **No blockers found in tested flows**. The project does not certify a product or claim broad market readiness.

## Supported scope

- Public, standard signup forms
- No CAPTCHA, authentication wall, payment, or destructive submission
- One Saudi Arabia rule pack in `data/markets/saudi-arabia.json`
- At most ten documented checks
- Hard navigation timeout and bounded plan size

Unsupported pages stop with a clear explanation. The runner never attempts CAPTCHA bypass or credentialed flows.

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

The controlled `/demo/` target is a transparent benchmark with two documented failures: Arabic Unicode names and Saudi phone numbers. It is not presented as real-world validation.
