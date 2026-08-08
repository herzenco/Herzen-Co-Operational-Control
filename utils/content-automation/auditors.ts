import type { AuditResult, Auditor, GeneratedAsset, JsonModel } from "./types";

export const ANTHROPIC_QA_RUBRIC_VERSION = "monthly-shadow-qa-v1";

export function normalizeAudit(provider: "manus" | "anthropic", value: Omit<AuditResult, "provider" | "passed">): AuditResult {
  const rawSeo = Number(value.seo_score);
  const rawAeo = Number(value.aeo_score);
  if (!Number.isFinite(rawSeo) || !Number.isFinite(rawAeo)) throw new Error(`${provider} audit returned invalid SEO/AEO scores.`);
  const seo = Math.max(0, Math.min(100, Math.floor(rawSeo)));
  const aeo = Math.max(0, Math.min(100, Math.floor(rawAeo)));
  if (!String(value.seo_explanation || "").trim() || !String(value.aeo_explanation || "").trim()) throw new Error(`${provider} audit omitted separate SEO/AEO explanations.`);
  return { ...value, provider, seo_score: seo, aeo_score: aeo, passed: seo >= 80 && aeo >= 80 };
}

export class ManusAuditor implements Auditor {
  name = "manus" as const;
  constructor(private endpoint: string, private apiKey: string) {}
  async audit(asset: GeneratedAsset, context: Record<string, unknown>) {
    const response = await fetch(this.endpoint, { method: "POST", headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ asset, context, rubric: { seo_minimum: 80, aeo_minimum: 80 } }) });
    if (!response.ok) throw new Error(`Manus audit failed (${response.status}).`);
    const now = new Date().toISOString();
    const payload = await response.json() as Omit<AuditResult, "provider" | "passed" | "model" | "rubric_version" | "trace_id" | "evaluated_at">;
    return normalizeAudit(this.name, { ...payload, model: "manus", rubric_version: ANTHROPIC_QA_RUBRIC_VERSION, trace_id: response.headers.get("x-request-id") || crypto.randomUUID(), evaluated_at: now });
  }
}

export class AnthropicAuditor implements Auditor {
  name = "anthropic" as const;
  constructor(private model: JsonModel) {}
  async audit(asset: GeneratedAsset, context: Record<string, unknown>) {
    const system = "You audit founder-led B2B content. Return JSON with seo_score, aeo_score, seo_explanation, aeo_explanation, summary, blockers, rewrite_guidance. Score SEO and AEO separately and rigorously within the asset's intended platform. Never round a failing score upward. For LinkedIn, score platform discoverability, semantic relevance, and answer extractability; do not require website-only schema markup or long-form page structure.";
    const prompt = JSON.stringify({ asset, context, rubric_version: ANTHROPIC_QA_RUBRIC_VERSION, hard_rules: { min_scores: 80, politics: false, unapproved_promotions: false } });
    if (this.model.generateTraced) {
      const generated = await this.model.generateTraced<Omit<AuditResult, "provider" | "passed" | "model" | "rubric_version" | "trace_id" | "evaluated_at">>(
        system,
        prompt,
        ANTHROPIC_QA_RUBRIC_VERSION,
      );
      return normalizeAudit(this.name, { ...generated.value, model: generated.trace.model, rubric_version: ANTHROPIC_QA_RUBRIC_VERSION, trace_id: generated.trace.trace_id, evaluated_at: generated.trace.completed_at });
    }
    const result = await this.model.generate<Omit<AuditResult, "provider" | "passed" | "model" | "rubric_version" | "trace_id" | "evaluated_at">>(
      system,
      prompt,
    );
    return normalizeAudit(this.name, { ...result, model: "unknown", rubric_version: ANTHROPIC_QA_RUBRIC_VERSION, trace_id: crypto.randomUUID(), evaluated_at: new Date().toISOString() });
  }
}

export function createAuditor(anthropicModel: JsonModel): Auditor {
  if (process.env.MANUS_AUDIT_URL && process.env.MANUS_API_KEY) return new ManusAuditor(process.env.MANUS_AUDIT_URL, process.env.MANUS_API_KEY);
  return new AnthropicAuditor(anthropicModel);
}
