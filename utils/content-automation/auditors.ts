import type { AuditResult, Auditor, GeneratedAsset, JsonModel } from "./types";

function normalize(provider: "manus" | "anthropic", value: Omit<AuditResult, "provider" | "passed">): AuditResult {
  const seo = Math.max(0, Math.min(100, Number(value.seo_score)));
  const aeo = Math.max(0, Math.min(100, Number(value.aeo_score)));
  return { ...value, provider, seo_score: seo, aeo_score: aeo, passed: seo >= 80 && aeo >= 80 };
}

export class ManusAuditor implements Auditor {
  name = "manus" as const;
  constructor(private endpoint: string, private apiKey: string) {}
  async audit(asset: GeneratedAsset, context: Record<string, unknown>) {
    const response = await fetch(this.endpoint, { method: "POST", headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ asset, context, rubric: { seo_minimum: 80, aeo_minimum: 80 } }) });
    if (!response.ok) throw new Error(`Manus audit failed (${response.status}).`);
    return normalize(this.name, await response.json());
  }
}

export class AnthropicAuditor implements Auditor {
  name = "anthropic" as const;
  constructor(private model: JsonModel) {}
  async audit(asset: GeneratedAsset, context: Record<string, unknown>) {
    const result = await this.model.generate<Omit<AuditResult, "provider" | "passed">>(
      "You audit founder-led B2B content. Return JSON with seo_score, aeo_score, summary, blockers, rewrite_guidance. Score SEO and AEO separately and rigorously.",
      JSON.stringify({ asset, context, hard_rules: { min_scores: 80, politics: false, unapproved_promotions: false } }),
    );
    return normalize(this.name, result);
  }
}

export function createAuditor(anthropicModel: JsonModel): Auditor {
  if (process.env.MANUS_AUDIT_URL && process.env.MANUS_API_KEY) return new ManusAuditor(process.env.MANUS_AUDIT_URL, process.env.MANUS_API_KEY);
  return new AnthropicAuditor(anthropicModel);
}

