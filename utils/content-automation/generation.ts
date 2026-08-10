import type { GenerationPair, JsonModel, PlannedTopic, TracedGeneration } from "./types";

export const MONTHLY_SHADOW_PROMPT_VERSION = "monthly-shadow-generation-v1";

const VOICE = "Founder-led, direct, sharp, useful, and energetic. No political stances. No giveaways or discounts unless the supplied context explicitly approves them.";

function blogWordCount(body: string) { return body.trim().split(/\s+/).filter(Boolean).length; }

function enforcePair(pair: GenerationPair) {
  const count = blogWordCount(pair.blog.body);
  if (count < 400 || count > 1500) throw new Error(`Blog must contain 400-1500 words; received ${count}.`);
  if (!/https?:\/\//i.test(pair.linkedin.body)) throw new Error("LinkedIn companion content must link to the website.");
  return pair;
}

export async function planMonthlySlate(model: JsonModel, context: Record<string, unknown>, monthStart: string) {
  return model.generate<{ topics: PlannedTopic[]; evergreen_fallbacks: Array<{ title: string; rationale: string }> }>(
    `You are K2, Herzen Co.'s research strategist. ${VOICE} Prefer strong timely topics. If evidence is insufficient, return evergreen fallback ideas only; do not draft them.`,
    JSON.stringify({ month_start: monthStart, context, required_topic_fields: ["topic_key","title","rationale","timely","target_audience","conversion_goal","cta","publish_at","source_links"] }),
  );
}

export async function promoteEvergreenFallback(model: JsonModel, fallback: { title: string; rationale: string }, context: Record<string, unknown>, monthStart: string) {
  return model.generate<PlannedTopic>(
    `You are K2, Herzen Co.'s research strategist. ${VOICE} Turn the approved evergreen fallback into one complete pilot topic. Return only the required structured fields and set timely to false.`,
    JSON.stringify({ fallback, month_start: monthStart, context, required_topic_fields: ["topic_key","title","rationale","timely","target_audience","conversion_goal","cta","publish_at","source_links"] }),
  );
}

export async function generatePair(model: JsonModel, topic: PlannedTopic, context: Record<string, unknown>, rewriteGuidance = "") {
  const pair = await model.generate<GenerationPair>(
    `Write a publication-ready website blog and LinkedIn companion as separate assets. ${VOICE} Blog length is 400-1500 words. The LinkedIn post must include the supplied website URL. No image generation. Return JSON with blog and linkedin objects containing title, body, caption, slug, seo_title, meta_description, reasoning_summary.`,
    JSON.stringify({ topic, context, website_url: `${process.env.HERZEN_WEBSITE_URL || "https://herzen.co"}/${topic.topic_key}`, rewrite_guidance: rewriteGuidance }),
  );
  return enforcePair(pair);
}

export async function generateShadowPair(model: JsonModel, topic: PlannedTopic, context: Record<string, unknown>, editorialBrief: string, rewriteGuidance = ""): Promise<TracedGeneration<GenerationPair>> {
  const system = `You are C-3PO, Herzen Co.'s editorial and packaging specialist. Write one website blog and one related but independently approvable LinkedIn post as separate unpublished shadow assets. ${VOICE} Blog length is 400-1500 words. The LinkedIn post must include the supplied planned website URL. Use the approved K2 research and the editorial brief. Do not include publishing instructions or claim that anything is approved, scheduled, or live. Return JSON with blog and linkedin objects containing title, body, caption, slug, seo_title, meta_description, reasoning_summary.`;
  const prompt = JSON.stringify({ topic, approved_k2_research: context, editorial_brief: editorialBrief, website_url: `${process.env.HERZEN_WEBSITE_URL || "https://herzen.co"}/${topic.topic_key}`, rewrite_guidance: rewriteGuidance });
  const generated = model.generateTraced
    ? await model.generateTraced<GenerationPair>(system, prompt, MONTHLY_SHADOW_PROMPT_VERSION)
    : { value: await model.generate<GenerationPair>(system, prompt), trace: { provider: "openai" as const, model: "unknown", prompt_version: MONTHLY_SHADOW_PROMPT_VERSION, trace_id: crypto.randomUUID(), provider_request_id: null, completed_at: new Date().toISOString() } };
  return { ...generated, value: enforcePair(generated.value) };
}

export { blogWordCount, enforcePair };
