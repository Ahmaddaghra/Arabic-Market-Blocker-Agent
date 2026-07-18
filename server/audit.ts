import { chromium, type Page } from "playwright";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createPlan, createDeterministicPlan } from "./planner.js";
import { loadMarket, type Market } from "./markets.js";
import type { PlanResult } from "./planner.js";
import type {
  AuditResult,
  Field,
  Locator,
  Finding,
  PassedCheck,
  FieldComparison,
  FieldEvidence,
  ActionObservation,
  AuditProgress,
} from "./types.js";

const artifacts = path.resolve("artifacts");
const navigationTimeout = Number(process.env.NAVIGATION_TIMEOUT_MS || 20000);
function cssEscape(value: string) {
  return value.replace(
    /[^a-zA-Z0-9_-]/g,
    (char) => `\\${char.codePointAt(0)!.toString(16)} `,
  );
}
function roleName(value: string) {
  return value.replace(/^button\s*:\s*/i, "").trim();
}
function locatorCode(l: Locator) {
  return l.strategy === "label"
    ? `page.getByLabel(${JSON.stringify(l.value)})`
    : l.strategy === "role"
      ? `page.getByRole('button', { name: ${JSON.stringify(roleName(l.value))} })`
      : l.strategy === "name"
        ? `page.locator('[name=${JSON.stringify(l.value)}]')`
        : l.strategy === "id"
          ? `page.locator('#${cssEscape(l.value)}')`
          : `page.locator(${JSON.stringify(l.value)})`;
}
function testFor(
  url: string,
  title: string,
  locator: Locator,
  value: string,
  errorText: string,
) {
  return `import { test, expect } from '@playwright/test';\n\ntest(${JSON.stringify(title)}, async ({ page }) => {\n  await page.goto(${JSON.stringify(url)});\n  const field = ${locatorCode(locator)};\n  await field.fill(${JSON.stringify(value)});\n  await field.blur();\n  await expect(field).toHaveValue(${JSON.stringify(value)});\n  await expect(page.getByText(${JSON.stringify(errorText)}, { exact: false })).not.toBeVisible();\n});\n`;
}
async function inspect(
  page: Page,
): Promise<{ fields: Field[]; buttons: string[] }> {
  return page.evaluate(
    `(() => { const visible=el=>{const style=getComputedStyle(el);return style.display!=='none'&&style.visibility!=='hidden'&&el.getClientRects().length>0};const fields=[...document.querySelectorAll('input,textarea')].filter(el=>el instanceof HTMLInputElement&&el.type!=='hidden'&&visible(el)).map((el,index)=>{let label='';if(el.id){const direct=document.querySelector('label[for="'+CSS.escape(el.id)+'"]');if(direct&&direct.textContent)label=direct.textContent.trim()}if(!label)label=(el.closest('label')&&el.closest('label').textContent||el.getAttribute('aria-label')||'').trim();const locator=label?{strategy:'label',value:label}:el.name?{strategy:'name',value:el.name}:el.id?{strategy:'id',value:el.id}:{strategy:'css',value:'input:nth-of-type('+(index+1)+')'};return {tag:el.tagName.toLowerCase(),type:el.type||'text',label,name:el.name,placeholder:el.placeholder,required:el.required,locator}});const buttons=[...document.querySelectorAll('button,input[type=submit]')].filter(visible).map(el=>(el.textContent||el.value||'').trim()).filter(Boolean);return {fields,buttons}; })()`,
  ) as Promise<{ fields: Field[]; buttons: string[] }>;
}
function targetByLocator(page: Page, l: Locator) {
  return l.strategy === "role"
    ? page.getByRole("button", { name: roleName(l.value) }).first()
    : l.strategy === "label"
      ? page.getByLabel(l.value).first()
      : l.strategy === "name"
        ? page.locator(`[name=${JSON.stringify(l.value)}]`).first()
        : l.strategy === "id"
          ? page.locator(`#${cssEscape(l.value)}`).first()
          : page.locator(l.value).first();
}
async function fillByLocator(page: Page, l: Locator, value: string) {
  const target = targetByLocator(page, l);
  await target.fill(value);
  await target.blur();
  return target;
}
export async function executeClick(
  page: Page,
  l: Locator,
  allowSubmission: boolean,
) {
  const target = targetByLocator(page, l);
  if ((await target.count()) === 0)
    return {
      executed: false,
      submissionControl: false,
      reason: "locator_not_found",
    };
  const submissionControl = await target.evaluate((el) => {
    const type = (el.getAttribute("type") || "").toLowerCase();
    const text = (el.textContent || el.getAttribute("value") || "").trim();
    return (
      type === "submit" ||
      /create account|sign up|signup|register|submit/i.test(text)
    );
  });
  if (submissionControl && !allowSubmission)
    return {
      executed: false,
      submissionControl,
      reason: "submission_not_allowed",
    };
  await target.click();
  return { executed: true, submissionControl, reason: null };
}
export async function executeObserve(
  page: Page,
  l: Locator,
  screenshotPath: string,
): Promise<Omit<ActionObservation, "actionIndex" | "locale">> {
  const target = targetByLocator(page, l);
  const targetVisible =
    (await target.count()) > 0 && (await target.isVisible());
  const validationErrors = await page
    .locator("input,textarea,select")
    .evaluateAll((elements) =>
      elements.flatMap((element, index) => {
        const input = element as HTMLInputElement;
        const described = input.getAttribute("aria-describedby");
        const describedNode = described
          ? document.getElementById(described)
          : null;
        const message =
          describedNode?.textContent?.trim() || input.validationMessage || "";
        return message
          ? [
              {
                locator:
                  input.name ||
                  input.id ||
                  `${input.tagName.toLowerCase()}:${index}`,
                message,
              },
            ]
          : [];
      }),
    );
  await page.screenshot({ path: screenshotPath, fullPage: false });
  return {
    locator: l,
    url: page.url(),
    title: await page.title(),
    targetVisible,
    validationErrors,
    screenshot: `/artifacts/${path.basename(screenshotPath)}`,
  };
}
function caseDefinition(valueKey: string, market: Market) {
  if (valueKey === "fullName")
    return {
      rootCauseId: "name-ascii-only",
      checkId: "arabic-name",
      title: "Arabic and mixed-script names are rejected",
    };
  if (valueKey === "mixedName")
    return {
      rootCauseId: "name-ascii-only",
      checkId: "mixed-bidi",
      title: "Arabic and mixed-script names are rejected",
    };
  if (valueKey === "phoneLocal")
    return {
      rootCauseId: "phone-us-only",
      checkId: "phone-local",
      title: `${market.shortLabel} phone formats are rejected`,
    };
  if (valueKey === "phoneInternational")
    return {
      rootCauseId: "phone-us-only",
      checkId: "phone-international",
      title: `${market.shortLabel} phone formats are rejected`,
    };
  if (valueKey === "arabicIndicDigits")
    return {
      rootCauseId: "phone-us-only",
      checkId: "arabic-indic-digits",
      title: `${market.shortLabel} phone formats are rejected`,
    };
  return null;
}
const englishPersona: Record<string, string> = {
  fullName: "John Smith",
  mixedName: "John Smith",
  email: "john.smith@example.com",
  phoneLocal: "+14155552671",
  phoneInternational: "+14155552671",
  city: "New York",
  password: "SafeDemo!2026",
  arabicIndicDigits: "+14155552671",
};
async function measureFill(
  page: Page,
  locator: Locator,
  value: string,
): Promise<FieldEvidence> {
  const target = await fillByLocator(page, locator, value);
  const actual = await target.inputValue();
  const validationMessage = await target.evaluate((el) => {
    const described = el.getAttribute("aria-describedby");
    const node = described ? document.getElementById(described) : null;
    return (
      node?.textContent?.trim() ||
      (el as HTMLInputElement).validationMessage ||
      ""
    );
  });
  return {
    value,
    actual,
    accepted: actual === value && !validationMessage,
    validationMessage,
    locator,
  };
}
export function classifyComparison(
  english: FieldEvidence,
  arabic: FieldEvidence,
): FieldComparison["classification"] {
  if (arabic.accepted) return "pass";
  return english.accepted ? "market-specific" : "general-form-issue";
}

type Planner = (
  fields: Field[],
  buttons: string[],
  allowSubmission?: boolean,
  market?: Market,
) => Promise<PlanResult>;
export async function runAudit(
  url: URL,
  options: {
    allowSubmission: boolean;
    controlledBenchmark: boolean;
    marketId?: string;
    planner?: Planner;
    onProgress?: (event: AuditProgress) => void;
  },
): Promise<AuditResult> {
  const market = await loadMarket(options.marketId);
  const marketSummary = {
    id: market.id,
    label: market.label,
    shortLabel: market.shortLabel,
    locale: market.locale,
    currency: market.currency,
  };
  let progressSequence = 0;
  let progressStep = 0;
  let progressTotal: number | null = 5;
  let activePlanner = "pending";
  const emit = (
    type: AuditProgress["type"],
    message: string,
    advance = true,
  ) => {
    if (advance) {
      progressStep++;
      if (progressTotal !== null && progressStep > progressTotal)
        progressTotal = progressStep + 1;
    }
    options.onProgress?.({
      sequence: ++progressSequence,
      step: progressStep,
      totalSteps: progressTotal,
      type,
      message,
      planner: activePlanner,
      timestamp: new Date().toISOString(),
    });
  };
  await fs.mkdir(artifacts, { recursive: true });
  const id = crypto.randomUUID();
  emit("status", "Launching two isolated browser contexts…");
  const browser = await chromium.launch({ headless: true });
  try {
    const englishContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
    });
    const arabicContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: market.locale,
    });
    const englishPage = await englishContext.newPage();
    const page = await arabicContext.newPage();
    for (const candidate of [englishPage, page])
      candidate.setDefaultTimeout(5000);
    emit(
      "status",
      `Opening the target in en-US and ${market.locale} contexts…`,
    );
    await Promise.all([
      englishPage.goto(url.href, {
        waitUntil: "domcontentloaded",
        timeout: navigationTimeout,
      }),
      page.goto(url.href, {
        waitUntil: "domcontentloaded",
        timeout: navigationTimeout,
      }),
    ]);
    if (
      await page
        .locator(
          'iframe[src*="captcha"], [class*="captcha" i], [id*="captcha" i]',
        )
        .count()
    ) {
      const supportMessage =
        "CAPTCHA detected. This tool only supports public standard signup forms without CAPTCHA or authentication walls.";
      progressTotal = progressStep + 1;
      emit("graceful-exit", supportMessage);
      return {
        status: "unsupported",
        verdict: "Unsupported site",
        url: url.href,
        market: marketSummary,
        planner: "not-invoked",
        fallbackReason: null,
        plannerLog: [
          "Planner not invoked: CAPTCHA detected before DOM planning.",
        ],
        allowSubmission: options.allowSubmission,
        benchmarkEvaluation: null,
        supportMessage,
        fields: [],
        plan: [],
        deterministicPlan: [],
        findings: [],
        passes: [],
        fieldComparisons: [],
        actionObservations: [],
        screenshots: { baseline: "", arabic: "" },
        comparison: { english: "Not tested", arabic: "Not tested" },
      };
    }
    emit("status", "Analyzing the visible DOM…");
    const { fields, buttons } = await inspect(page);
    const deterministicPlan = createDeterministicPlan(
      fields,
      "comparison_only: deterministic mapping generated for the adaptive-plan diff.",
    ).actions;
    if (fields.length === 0) {
      const supportMessage =
        "No auditable signup fields were exposed to the deployed browser. The run was stopped instead of reporting a false pass.";
      progressTotal = progressStep + 1;
      emit("graceful-exit", supportMessage);
      return {
        status: "unsupported",
        verdict: "Unsupported site",
        url: url.href,
        market: marketSummary,
        planner: "not-invoked",
        fallbackReason: null,
        plannerLog: [`Graceful stop: ${supportMessage}`],
        allowSubmission: options.allowSubmission,
        benchmarkEvaluation: null,
        supportMessage,
        fields,
        plan: [],
        deterministicPlan,
        findings: [],
        passes: [],
        fieldComparisons: [],
        actionObservations: [],
        screenshots: { baseline: "", arabic: "" },
        comparison: {
          english: "No standard form detected",
          arabic: "Not tested",
        },
      };
    }
    const planner = options.planner || createPlan;
    activePlanner = options.planner
      ? "injected-planner"
      : process.env.OPENAI_API_KEY
        ? process.env.OPENAI_MODEL || "gpt-5.6"
        : "deterministic-fallback";
    emit(
      "planner",
      `Identified ${fields.length} visible field${fields.length === 1 ? "" : "s"}. ${activePlanner} is planning grounded actions…`,
    );
    const plan = await planner(
      fields,
      buttons,
      options.allowSubmission,
      market,
    );
    if (!plan.supported) {
      const supportMessage = plan.reason;
      progressTotal = progressStep + 1;
      emit("graceful-exit", supportMessage);
      return {
        status: "unsupported",
        verdict: "Unsupported site",
        url: url.href,
        market: marketSummary,
        planner: plan.source,
        fallbackReason: plan.fallbackReason,
        plannerLog: [...plan.log, `Graceful stop: ${supportMessage}`],
        allowSubmission: options.allowSubmission,
        benchmarkEvaluation: null,
        supportMessage,
        fields,
        plan: plan.actions,
        deterministicPlan,
        findings: [],
        passes: [],
        fieldComparisons: [],
        actionObservations: [],
        screenshots: { baseline: "", arabic: "" },
        comparison: {
          english: "No standard form detected",
          arabic: "Not tested",
        },
      };
    }
    activePlanner = plan.source;
    progressTotal = 5 + plan.actions.length;
    emit(
      "planner",
      `${activePlanner} planned ${plan.actions.length} grounded actions.`,
      false,
    );
    const allFields = [...fields];
    const baseline = `/artifacts/${id}-english.png`;
    const arabic = `/artifacts/${id}-arabic.png`;
    const executionLog = [...plan.log];
    const findingsByRoot = new Map<string, Finding>();
    const passes: PassedCheck[] = [];
    let submissionAttempted = false;
    let flowCompleted = false;
    const fieldComparisons: FieldComparison[] = [];
    const actionObservations: ActionObservation[] = [];
    let replanCount = 0;
    let visibleFieldSignature = fields
      .map((field) => `${field.locator.strategy}:${field.locator.value}`)
      .join("|");
    for (const [actionIndex, action] of plan.actions.entries()) {
      if (action.action === "click") {
        try {
          const [englishClick, arabicClick] = await Promise.all([
            executeClick(englishPage, action.locator, options.allowSubmission),
            executeClick(page, action.locator, options.allowSubmission),
          ]);
          submissionAttempted ||=
            arabicClick.executed && arabicClick.submissionControl;
          await page.waitForTimeout(150);
          flowCompleted = await page
            .locator('[data-audit-success="true"]')
            .isVisible();
          executionLog.push(
            `Execution click: locator=${action.locator.strategy}=${action.locator.value}, EN=${englishClick.executed ? "executed" : `blocked:${englishClick.reason}`}, AR=${arabicClick.executed ? "executed" : `blocked:${arabicClick.reason}`}, submissionControl=${arabicClick.submissionControl}, flowCompleted=${flowCompleted}`,
          );
          emit(
            "action",
            `${arabicClick.executed ? "Clicked" : "Skipped"} ${action.locator.value}${arabicClick.reason ? `: ${arabicClick.reason}` : ""}.`,
          );
          if (
            arabicClick.executed &&
            !arabicClick.submissionControl &&
            replanCount < 2
          ) {
            const nextDom = await inspect(page);
            const nextSignature = nextDom.fields
              .map(
                (field) => `${field.locator.strategy}:${field.locator.value}`,
              )
              .join("|");
            if (nextSignature && nextSignature !== visibleFieldSignature) {
              replanCount++;
              visibleFieldSignature = nextSignature;
              for (const field of nextDom.fields)
                if (
                  !allFields.some(
                    (existing) =>
                      existing.locator.strategy === field.locator.strategy &&
                      existing.locator.value === field.locator.value,
                  )
                )
                  allFields.push(field);
              emit(
                "planner",
                `New step revealed. Analyzing ${nextDom.fields.length} newly visible fields with ${activePlanner}…`,
                false,
              );
              const nextPlan = await planner(
                nextDom.fields,
                nextDom.buttons,
                options.allowSubmission,
                market,
              );
              activePlanner = nextPlan.source;
              if (nextPlan.supported) {
                progressTotal =
                  (progressTotal || progressStep) + nextPlan.actions.length;
                plan.actions.push(...nextPlan.actions);
              }
              executionLog.push(
                `Adaptive replan ${replanCount}: visible DOM changed after click; fields=${nextDom.fields.length}, buttons=${nextDom.buttons.length}, planner=${nextPlan.source}, supported=${nextPlan.supported}`,
                ...nextPlan.log.map(
                  (entry) => `Replan ${replanCount}: ${entry}`,
                ),
              );
              emit(
                "planner",
                `Replan ${replanCount} added ${nextPlan.actions.length} grounded actions.`,
                false,
              );
              if (!nextPlan.supported)
                executionLog.push(
                  `Adaptive replan ${replanCount} stopped: ${nextPlan.reason}`,
                );
            }
          }
        } catch (error) {
          executionLog.push(
            `Execution click failed: ${error instanceof Error ? error.message : "unknown click error"}`,
          );
          emit(
            "action",
            `Click failed safely: ${error instanceof Error ? error.message : "unknown click error"}.`,
          );
        }
        continue;
      }
      if (action.action === "observe") {
        try {
          const englishPath = path.join(
            artifacts,
            `${id}-observe-${actionIndex}-english.png`,
          );
          const arabicPath = path.join(
            artifacts,
            `${id}-observe-${actionIndex}-arabic.png`,
          );
          const [englishObservation, arabicObservation] = await Promise.all([
            executeObserve(englishPage, action.locator, englishPath),
            executeObserve(page, action.locator, arabicPath),
          ]);
          actionObservations.push(
            { actionIndex, locale: "en-US", ...englishObservation },
            { actionIndex, locale: market.locale, ...arabicObservation },
          );
          executionLog.push(
            `Execution observe: locator=${action.locator.strategy}=${action.locator.value}, EN visible=${englishObservation.targetVisible} validationErrors=${englishObservation.validationErrors.length}, AR visible=${arabicObservation.targetVisible} validationErrors=${arabicObservation.validationErrors.length}, screenshots=${englishObservation.screenshot},${arabicObservation.screenshot}`,
          );
          emit(
            "action",
            `Observed ${action.locator.value}: ${arabicObservation.validationErrors.length} Arabic validation message${arabicObservation.validationErrors.length === 1 ? "" : "s"}.`,
          );
        } catch (error) {
          executionLog.push(
            `Execution observe failed: ${error instanceof Error ? error.message : "unknown observe error"}`,
          );
          emit(
            "action",
            `Observation failed safely for ${action.locator.value}.`,
          );
        }
        continue;
      }
      if (action.action !== "fill" || !action.valueKey) continue;
      const value = (market.persona as Record<string, string>)[action.valueKey];
      const englishValue = englishPersona[action.valueKey];
      if (!value || !englishValue) {
        executionLog.push(
          `Execution skipped fill: unknown valueKey=${action.valueKey}`,
        );
        continue;
      }
      try {
        const [englishEvidence, arabicEvidence] = await Promise.all([
          measureFill(englishPage, action.locator, englishValue),
          measureFill(page, action.locator, value),
        ]);
        const definition = caseDefinition(action.valueKey, market);
        const classification = classifyComparison(
          englishEvidence,
          arabicEvidence,
        );
        const checkId = definition?.checkId || action.valueKey;
        const fieldPurpose =
          action.locator.value || action.fieldPurpose || action.valueKey;
        fieldComparisons.push({
          checkId,
          fieldPurpose,
          valueKey: action.valueKey,
          classification,
          english: englishEvidence,
          arabic: arabicEvidence,
          evidence: { englishScreenshot: baseline, arabicScreenshot: arabic },
        });
        executionLog.push(
          `Execution comparison: valueKey=${action.valueKey}, locator=${action.locator.strategy}=${action.locator.value}, EN value=${JSON.stringify(englishValue)} ${englishEvidence.accepted ? "accepted" : englishEvidence.validationMessage || "rejected"}, ${market.shortLabel} value=${JSON.stringify(value)} ${arabicEvidence.accepted ? "accepted" : arabicEvidence.validationMessage || "rejected"}, classification=${classification}`,
        );
        if (!arabicEvidence.accepted && definition) {
          const marketSpecific = classification === "market-specific";
          const rootCauseId = marketSpecific
            ? definition.rootCauseId
            : `general-${action.locator.strategy}-${action.locator.value}`;
          const existing = findingsByRoot.get(rootCauseId);
          const actual =
            arabicEvidence.validationMessage || arabicEvidence.actual;
          const testCase = {
            checkId: definition.checkId,
            valueKey: action.valueKey,
            value,
            actual,
          };
          if (existing) {
            existing.testCases.push(testCase);
            emit("finding", `Additional failing case: ${definition.title}.`);
          } else {
            findingsByRoot.set(rootCauseId, {
              id: crypto.randomUUID(),
              rootCauseId,
              title: marketSpecific
                ? definition.title
                : `General form issue in ${fieldPurpose}`,
              severity: "blocker",
              checkId: definition.checkId,
              summary: marketSpecific
                ? actual ||
                  "The Arabic value was rejected while the English control was accepted."
                : `Both English and Arabic control values failed; this is not classified as market-specific.`,
              impact: marketSpecific
                ? `A ${market.label} user may be unable to complete signup.`
                : `The tested field appears broken for more than the ${market.shortLabel} persona.`,
              actual,
              expected: marketSpecific
                ? `Accept the ${market.shortLabel} value when the English control is accepted`
                : "Accept a valid control value in at least one tested locale",
              locator: action.locator,
              evidenceScreenshot: arabic,
              generatedTest: testFor(
                url.href,
                definition.title,
                action.locator,
                value,
                actual || "invalid",
              ),
              testCases: [testCase],
            });
            emit(
              "finding",
              `Blocker found: ${marketSpecific ? definition.title : `general issue in ${fieldPurpose}`}.`,
            );
          }
        } else {
          emit(
            "action",
            `Tested ${fieldPurpose}: English ${englishEvidence.accepted ? "accepted" : "rejected"}, Arabic ${arabicEvidence.accepted ? "accepted" : "rejected"}.`,
          );
          if (definition)
            passes.push({
              checkId: definition.checkId,
              valueKey: action.valueKey,
              locator: action.locator,
              actual: arabicEvidence.actual,
            });
        }
      } catch (error) {
        executionLog.push(
          `Execution fill failed: valueKey=${action.valueKey}; ${error instanceof Error ? error.message : "unknown fill error"}`,
        );
      }
    }
    const findings = [...findingsByRoot.values()];
    await Promise.all([
      englishPage.screenshot({
        path: path.join(artifacts, `${id}-english.png`),
        fullPage: false,
      }),
      page.screenshot({
        path: path.join(artifacts, `${id}-arabic.png`),
        fullPage: false,
      }),
    ]);
    const failingTestCases = findings.reduce(
      (total, finding) => total + finding.testCases.length,
      0,
    );
    const expectedRoots = new Set(["name-ascii-only", "phone-us-only"]);
    const detectedRoots = new Set(
      findings.map((finding) => finding.rootCauseId),
    );
    const truePositives = [...detectedRoots].filter((root) =>
      expectedRoots.has(root),
    ).length;
    const falsePositives = [...detectedRoots].filter(
      (root) => !expectedRoots.has(root),
    ).length;
    const falseNegatives = [...expectedRoots].filter(
      (root) => !detectedRoots.has(root),
    ).length;
    const benchmarkEvaluation = options.controlledBenchmark
      ? {
          groundTruthBlockers: 2,
          detectedBlockers: findings.length,
          failingTestCases,
          truePositives,
          falsePositives,
          falseNegatives,
          precision: truePositives / (truePositives + falsePositives || 1),
          recall: truePositives / (truePositives + falseNegatives || 1),
          submissionAttempted,
          flowCompleted,
        }
      : null;
    const result = {
      status: "completed" as const,
      verdict: findings.length
        ? `Found ${findings.length} unique blocker${findings.length === 1 ? "" : "s"} across ${failingTestCases} failing test cases`
        : `No blockers found in tested flows; ${passes.length} ${market.shortLabel}-market checks passed`,
      url: url.href,
      market: marketSummary,
      planner: plan.source,
      fallbackReason: plan.fallbackReason,
      plannerLog: executionLog,
      allowSubmission: options.allowSubmission,
      benchmarkEvaluation,
      fields: allFields,
      plan: plan.actions,
      deterministicPlan,
      findings,
      passes,
      fieldComparisons,
      actionObservations,
      screenshots: { baseline, arabic },
      comparison: {
        english: `English persona executed in isolated en-US context across ${fieldComparisons.length} field checks`,
        arabic: findings.length
          ? `${market.shortLabel} persona produced evidence-backed failures`
          : `Tested ${market.shortLabel} persona inputs were preserved`,
      },
    };
    progressTotal = Math.max(progressTotal || progressStep, progressStep + 1);
    emit("complete", result.verdict);
    return result;
  } finally {
    await browser.close();
  }
}
