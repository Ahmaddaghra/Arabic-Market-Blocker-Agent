export type Locator = {
  strategy: "label" | "role" | "name" | "id" | "css";
  value: string;
};
export type Field = {
  tag: string;
  type: string;
  label: string;
  name: string;
  placeholder: string;
  required: boolean;
  locator: Locator;
};
export type PlanAction = {
  action: "fill" | "click" | "observe";
  fieldPurpose: string | null;
  locator: Locator;
  valueKey: string | null;
  reason: string;
};
export type FindingCase = {
  checkId: string;
  valueKey: string;
  value: string;
  actual: string;
};
export type Finding = {
  id: string;
  rootCauseId: string;
  title: string;
  severity: "blocker" | "warning";
  checkId: string;
  summary: string;
  impact: string;
  actual: string;
  expected: string;
  locator: Locator;
  evidenceScreenshot: string;
  generatedTest: string;
  testCases: FindingCase[];
};
export type PassedCheck = {
  checkId: string;
  valueKey: string;
  locator: Locator;
  actual: string;
};
export type FieldEvidence = {
  value: string;
  actual: string;
  accepted: boolean;
  validationMessage: string;
  locator: Locator;
};
export type FieldComparison = {
  checkId: string;
  fieldPurpose: string;
  valueKey: string;
  classification: "market-specific" | "general-form-issue" | "pass";
  english: FieldEvidence;
  arabic: FieldEvidence;
  evidence: { englishScreenshot: string; arabicScreenshot: string };
};
export type ActionObservation = {
  actionIndex: number;
  locale: string;
  locator: Locator;
  url: string;
  title: string;
  targetVisible: boolean;
  validationErrors: Array<{ locator: string; message: string }>;
  screenshot: string;
};
export type BenchmarkEvaluation = {
  groundTruthBlockers: number;
  detectedBlockers: number;
  failingTestCases: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  submissionAttempted: boolean;
  flowCompleted: boolean;
};
export type AuditProgress = {
  sequence: number;
  step: number;
  totalSteps: number | null;
  type:
    "status" | "planner" | "action" | "finding" | "graceful-exit" | "complete";
  message: string;
  planner: string;
  timestamp: string;
};
export type MarketSummary = {
  id: string;
  label: string;
  shortLabel: string;
  locale: string;
  currency: string;
};
export type AuditResult = {
  status: "completed" | "unsupported";
  verdict: string;
  verdictCounts?: { marketSpecificBlockers: number; generalFormIssues: number };
  url: string;
  market: MarketSummary;
  planner: string;
  fallbackReason: string | null;
  plannerLog: string[];
  allowSubmission: boolean;
  benchmarkEvaluation: null | BenchmarkEvaluation;
  supportMessage?: string;
  fields: Field[];
  plan: PlanAction[];
  deterministicPlan: PlanAction[];
  findings: Finding[];
  passes: PassedCheck[];
  fieldComparisons: FieldComparison[];
  actionObservations: ActionObservation[];
  screenshots: { baseline: string; arabic: string };
  comparison: { english: string; arabic: string };
  runId?: string;
  reportUrl?: string;
  durableReport?: boolean;
};
