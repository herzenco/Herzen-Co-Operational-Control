import type { JsonModel } from "./types";

function jsonFromText(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  return JSON.parse(fenced || value);
}

export class OpenAIJsonModel implements JsonModel {
  async generate<T>(system: string, prompt: string): Promise<T> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is required for content generation.");
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
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required when Manus auditing is unavailable.");
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
