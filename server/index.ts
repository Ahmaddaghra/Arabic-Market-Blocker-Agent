import express from "express";
import rateLimit from "express-rate-limit";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { assertSafeUrl } from "./security.js";
import { runAudit } from "./audit.js";
import { listMarkets } from "./markets.js";
import type { AuditProgress, AuditResult } from "./types.js";
const app = express();
const port = Number(process.env.PORT || 3000);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
app.disable("x-powered-by");
// Render terminates TLS and forwards the original client IP through one proxy.
// Trusting exactly one hop lets express-rate-limit identify clients without
// accepting an arbitrary X-Forwarded-For chain outside Render.
if (process.env.RENDER === "true") app.set("trust proxy", 1);
app.use(express.json({ limit: "8kb" }));
app.use(
  "/artifacts",
  express.static(path.resolve("artifacts"), {
    fallthrough: false,
    maxAge: "1h",
  }),
);
const auditLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Rate limit reached. Try again in one minute." },
});
app.use("/api/audits", auditLimiter);
app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    playwright: true,
    model: process.env.OPENAI_MODEL || "gpt-5.6",
  }),
);
app.get("/api/markets", async (_req, res) => {
  try {
    const markets = await listMarkets();
    res.json(
      markets.map(({ id, label, shortLabel, locale, currency }) => ({
        id,
        label,
        shortLabel,
        locale,
        currency,
      })),
    );
  } catch (error) {
    res
      .status(500)
      .json({
        error:
          error instanceof Error
            ? error.message
            : "Market packs could not be loaded.",
      });
  }
});
app.post("/api/audits", async (req, res) => {
  try {
    if (typeof req.body?.url !== "string")
      return res.status(400).json({ error: "A URL is required." });
    const url = await assertSafeUrl(req.body.url);
    const ownHost = req.get("host")?.split(":")[0];
    const controlledBenchmark =
      (url.hostname === ownHost ||
        process.env.ALLOW_PRIVATE_TARGETS === "true") &&
      url.pathname.startsWith("/demo");
    const allowSubmission =
      req.body?.allowSubmission === true && controlledBenchmark;
    const auditTimeout = Math.max(
      Number(process.env.AUDIT_TIMEOUT_MS || 120000),
      120000,
    );
    const result = await Promise.race([
      runAudit(url, {
        allowSubmission,
        controlledBenchmark,
        marketId: req.body?.marketId,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(`Audit timed out safely after ${auditTimeout}ms.`),
            ),
          auditTimeout,
        ),
      ),
    ]);
    res.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Audit failed safely.";
    res
      .status(
        message.includes("blocked") || message.includes("valid") ? 400 : 422,
      )
      .json({ error: message });
  }
});
type AuditJob = {
  id: string;
  status: "queued" | "running" | "completed" | "unsupported" | "failed";
  events: AuditProgress[];
  result?: AuditResult;
  error?: string;
  createdAt: number;
};
const jobs = new Map<string, AuditJob>();
const jobTtlMs = 30 * 60_000;
const cleanupJobs = () => {
  const cutoff = Date.now() - jobTtlMs;
  for (const [id, job] of jobs) if (job.createdAt < cutoff) jobs.delete(id);
};
app.post("/api/audit-jobs", auditLimiter, (req, res) => {
  cleanupJobs();
  if (typeof req.body?.url !== "string")
    return res.status(400).json({ error: "A URL is required." });
  const id = crypto.randomUUID();
  const job: AuditJob = {
    id,
    status: "queued",
    events: [],
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  const requestedUrl = req.body.url;
  const requestedSubmission = req.body?.allowSubmission === true;
  const requestedMarket =
    typeof req.body?.marketId === "string" ? req.body.marketId : undefined;
  const ownHost = req.get("host")?.split(":")[0];
  res
    .status(202)
    .json({ jobId: id, status: job.status, pollUrl: `/api/audit-jobs/${id}` });
  void (async () => {
    job.status = "running";
    try {
      const url = await assertSafeUrl(requestedUrl);
      const controlledBenchmark =
        (url.hostname === ownHost ||
          process.env.ALLOW_PRIVATE_TARGETS === "true") &&
        url.pathname.startsWith("/demo");
      const allowSubmission = requestedSubmission && controlledBenchmark;
      const auditTimeout = Math.max(
        Number(process.env.AUDIT_TIMEOUT_MS || 120000),
        120000,
      );
      const result = await Promise.race([
        runAudit(url, {
          allowSubmission,
          controlledBenchmark,
          marketId: requestedMarket,
          onProgress: (event) => job.events.push(event),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(`Audit timed out safely after ${auditTimeout}ms.`),
              ),
            auditTimeout,
          ),
        ),
      ]);
      job.result = result;
      job.status =
        result.status === "unsupported" ? "unsupported" : "completed";
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Audit failed safely.";
      job.error = message;
      job.status = "failed";
      const last = job.events.at(-1);
      job.events.push({
        sequence: (last?.sequence || 0) + 1,
        step: (last?.step || 0) + 1,
        totalSteps: last?.totalSteps || null,
        type: "graceful-exit",
        message,
        planner: last?.planner || "not-invoked",
        timestamp: new Date().toISOString(),
      });
    }
  })();
});
app.get("/api/audit-jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job)
    return res.status(404).json({ error: "Audit job not found or expired." });
  res.json(job);
});
app.use("/demo", express.static(path.join(root, "demo-target")));
app.use(express.static(path.join(root, "dist")));
app.use((_req, res) => res.sendFile(path.join(root, "dist", "index.html")));
app.listen(port, () =>
  console.log(
    `Arabic Market Blocker Agent listening on http://localhost:${port}`,
  ),
);
