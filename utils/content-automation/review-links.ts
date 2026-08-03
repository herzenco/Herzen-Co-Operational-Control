import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export function hashReviewToken(token: string) { return createHash("sha256").update(token).digest("hex"); }

export async function createReviewLink(supabase: SupabaseClient, contentItemId: string) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashReviewToken(token);
  const { error } = await supabase.from("content_review_links").upsert({ content_item_id: contentItemId, token_hash: tokenHash, status: "active" }, { onConflict: "content_item_id" });
  if (error) throw error;
  const origin = process.env.OCC_PUBLIC_URL || "http://localhost:3000";
  return `${origin}/review/content/${token}`;
}

export async function resolveReviewLink(supabase: SupabaseClient, token: string) {
  const { data, error } = await supabase.from("content_review_links").select("id,content_item_id,status,expires_at").eq("token_hash", hashReviewToken(token)).eq("status", "active").maybeSingle();
  if (error) throw error;
  if (!data || (data.expires_at && new Date(data.expires_at) <= new Date())) return null;
  return data;
}

