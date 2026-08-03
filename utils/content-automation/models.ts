import type { JsonModel } from "./types";
import { getVercelOidcToken } from "@vercel/oidc";

function jsonFromText(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  return JSON.parse(fenced || value);
}

type JsonSchema = Record<string, unknown>;

async function gatewayJson<T>(model: string, system: string, prompt: string, schema: JsonSchema = { type: "object", additionalProperties: true }): Promise<T> {
  const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || await getVercelOidcToken();
  if (!token) throw new Error("Vercel AI Gateway requires VERCEL_OIDC_TOKEN or AI_GATEWAY_API_KEY.");
  const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      response_format: {
        type: "json",
        name: "occ_structured_output",
        description: "Structured JSON for the OCC content automation pipeline.",
        schema,
      },
    }),
  });
  if (!response.ok) throw new Error(`AI Gateway request failed (${response.status}): ${await response.text()}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return jsonFromText(payload.choices?.[0]?.message?.content || "") as T;
}

export class OpenAIJsonModel implements JsonModel {
  async generate<T>(system: string, prompt: string): Promise<T> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return gatewayJson<T>(process.env.OPENAI_CONTENT_MODEL || "openai/gpt-5.6-terra", system, prompt);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_CONTENT_MODEL || "gpt-5-mini",
        input: [{ role: "system", content: system }, { role: "user", content: prompt }],
        text: { format: { type: "json_object" } },
      }),
    });
    if (!response.ok) throw new Error(`OpenAI generation failed (${response.status}): ${await response.text()}`);
    const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
    const output = payload.output_text || payload.output?.flatMap((item) => item.content || []).map((item) => item.text || "").join("") || "";
    return jsonFromText(output) as T;
  }
}

export class AnthropicJsonModel implements JsonModel {
  async generate<T>(system: string, prompt: string): Promise<T> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return gatewayJson<T>(process.env.ANTHROPIC_AUDIT_MODEL || "anthropic/claude-sonnet-4.6", system, prompt, {
      type: "object",
      additionalProperties: false,
      required: ["seo_score", "aeo_score", "summary", "blockers", "rewrite_guidance"],
      properties: {
        seo_score: { type: "integer", minimum: 0, maximum: 100 },
        aeo_score: { type: "integer", minimum: 0, maximum: 100 },
        summary: { type: "string" },
        blockers: { type: "array", items: { type: "string" } },
        rewrite_guidance: { type: "string" },
      },
    });
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_AUDIT_MODEL || "claude-sonnet-4-5", max_tokens: 2000, system, messages: [{ role: "user", content: prompt }] }),
    });
    if (!response.ok) throw new Error(`Anthropic audit failed (${response.status}): ${await response.text()}`);
    const payload = await response.json() as { content?: Array<{ type: string; text?: string }> };
    return jsonFromText(payload.content?.filter((part) => part.type === "text").map((part) => part.text || "").join("") || "") as T;
  }
}
