import type { GenerationPair, JsonModel, PlannedTopic } from "./types";

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

export async function generatePair(model: JsonModel, topic: PlannedTopic, context: Record<string, unknown>, rewriteGuidance = "") {
  const pair = await model.generate<GenerationPair>(
    `Write a publication-ready website blog and LinkedIn companion as separate assets. ${VOICE} Blog length is 400-1500 words. The LinkedIn post must include the supplied website URL. No image generation. Return JSON with blog and linkedin objects containing title, body, caption, slug, seo_title, meta_description, reasoning_summary.`,
    JSON.stringify({ topic, context, website_url: `${process.env.HERZEN_WEBSITE_URL || "https://herzen.co"}/${topic.topic_key}`, rewrite_guidance: rewriteGuidance }),
  );
  return enforcePair(pair);
}

export { blogWordCount, enforcePair };
