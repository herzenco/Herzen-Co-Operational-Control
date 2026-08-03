export type AutomationJobType = "monthly_generation" | "weekly_review_pack" | "publish_day_notice" | "weekly_k2_refresh" | "audit_retry";

export type AuditResult = {
  provider: "manus" | "anthropic";
  seo_score: number;
  aeo_score: number;
  passed: boolean;
  summary: string;
  blockers: string[];
  rewrite_guidance: string;
  raw_response?: Record<string, unknown>;
};

export type PlannedTopic = {
  topic_key: string;
  title: string;
  rationale: string;
  timely: boolean;
  target_audience: string;
  conversion_goal: string;
  cta: string;
  publish_at: string;
  source_links: string[];
};

export type GeneratedAsset = {
  title: string;
  body: string;
  caption?: string;
  slug: string;
  seo_title: string;
  meta_description: string;
  reasoning_summary: string;
};

export type GenerationPair = { blog: GeneratedAsset; linkedin: GeneratedAsset };

export interface JsonModel {
  generate<T>(system: string, prompt: string): Promise<T>;
}

export interface Auditor {
  name: "manus" | "anthropic";
  audit(asset: GeneratedAsset, context: Record<string, unknown>): Promise<AuditResult>;
}

export type DeliveryItem = { title: string; review_url: string };

