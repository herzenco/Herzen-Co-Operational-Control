"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../utils/supabase/client";

type Row = Record<string, unknown>;
type Props = { accessToken: string; onError: (message: string) => void };
const TYPES = ["RSA", "sitelink", "callout", "structured_snippet", "logo", "image"];
const STATES = ["draft", "ready_for_review", "approved", "rejected", "superseded"];

const emptyForm = { campaign_id: "", work_item_id: "", request_id: "", ad_group_name: "", asset_type: "RSA", destination_url: "https://www.herzenco.co/product-leadership/", utm_source: "google", utm_medium: "cpc", utm_campaign: "hc_search_product_leadership_month_1", primary_text: "", cta: "Book a meeting", sitelink_text: "", sitelink_description_1: "", sitelink_description_2: "", callout_text: "", snippet_header: "", notes: "", headlines: "", descriptions: "", snippet_values: "", supersedes_id: "" };

export function CreativeAssets({ accessToken, onError }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [filters, setFilters] = useState({ campaign_id: "", ad_group_name: "", asset_type: "", workflow_state: "" });

  async function api(path: string, init?: RequestInit) {
    const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, ...(init?.headers || {}) } });
    const payload = await response.json(); if (!response.ok) throw new Error(payload?.error?.message || "Creative request failed."); return payload.data;
  }
  async function refresh() {
    try {
      const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
      const [campaignData, creativeData] = await Promise.all([api("/api/v1/paid-media-campaigns"), api(`/api/v1/paid-media-creatives?${params}`)]);
      setCampaigns(campaignData.items); setItems(creativeData.items);
      if (!form.campaign_id && campaignData.items[0]) setForm((current) => ({ ...current, campaign_id: String(campaignData.items[0].id), work_item_id: String(campaignData.items[0].work_item_id), destination_url: String(campaignData.items[0].destination_url), utm_source: String(campaignData.items[0].utm_source || "google"), utm_medium: String(campaignData.items[0].utm_medium || "cpc"), utm_campaign: String(campaignData.items[0].utm_campaign || "") }));
    } catch (error) { onError(error instanceof Error ? error.message : "Creative assets could not load."); }
  }
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [accessToken, filters.campaign_id, filters.ad_group_name, filters.asset_type, filters.workflow_state]); // eslint-disable-line react-hooks/exhaustive-deps

  function variants() {
    const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);
    return [
      ...lines(form.headlines).map((value, index) => ({ variant_type: "headline", position: index + 1, value })),
      ...lines(form.descriptions).map((value, index) => ({ variant_type: "description", position: index + 1, value })),
      ...lines(form.snippet_values).map((value, index) => ({ variant_type: "snippet_value", position: index + 1, value })),
    ];
  }
  async function createCreative(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api("/api/v1/paid-media-creatives", { method: "POST", body: JSON.stringify({ ...form, variants: variants() }) });
      setShowForm(false); setForm((current) => ({ ...emptyForm, campaign_id: current.campaign_id, work_item_id: current.work_item_id, destination_url: current.destination_url, utm_source: current.utm_source, utm_medium: current.utm_medium, utm_campaign: current.utm_campaign })); await refresh();
    } catch (error) { onError(error instanceof Error ? error.message : "Creative could not be created."); }
  }
  async function transition(item: Row, workflow_state: string) {
    try { await api(`/api/v1/paid-media-creatives/${item.id}`, { method: "PATCH", body: JSON.stringify({ workflow_state }) }); await refresh(); }
    catch (error) { onError(error instanceof Error ? error.message : "State could not be changed."); }
  }
  function createRevision(item: Row) {
    const itemVariants = (item.variants as Row[] || []);
    const values = (kind: string) => itemVariants.filter((variant) => variant.variant_type === kind).map((variant) => String(variant.value)).join("\n");
    setForm({ ...emptyForm, campaign_id: String(item.campaign_id), work_item_id: String(item.work_item_id), request_id: String(item.request_id || ""), ad_group_name: String(item.ad_group_name || ""), asset_type: String(item.asset_type), destination_url: String(item.destination_url || ""), utm_source: String(item.utm_source || ""), utm_medium: String(item.utm_medium || ""), utm_campaign: String(item.utm_campaign || ""), primary_text: String(item.primary_text || ""), cta: String(item.cta || "Book a meeting"), sitelink_text: String(item.sitelink_text || ""), sitelink_description_1: String(item.sitelink_description_1 || ""), sitelink_description_2: String(item.sitelink_description_2 || ""), callout_text: String(item.callout_text || ""), snippet_header: String(item.snippet_header || ""), notes: String(item.notes || ""), headlines: values("headline"), descriptions: values("description"), snippet_values: values("snippet_value"), supersedes_id: String(item.id) });
    setShowForm(true); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function upload(item: Row, file: File) {
    try {
      const path = `${item.campaign_id}/${item.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
      const { error } = await supabase.storage.from("paid-media-creative-assets").upload(path, file, { upsert: false, contentType: file.type }); if (error) throw error;
      await api(`/api/v1/paid-media-creatives/${item.id}/files`, { method: "POST", body: JSON.stringify({ original_filename: file.name, storage_path: path, mime_type: file.type, byte_size: file.size }) }); await refresh();
    } catch (error) { onError(error instanceof Error ? error.message : "Upload failed."); }
  }
  async function bundle() {
    try { const campaign = filters.campaign_id || String(campaigns[0]?.id || ""); const data = await api(`/api/v1/paid-media-asset-bundle?campaign_id=${encodeURIComponent(campaign)}`); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = "occ-approved-paid-media-assets.json"; link.click(); URL.revokeObjectURL(url); }
    catch (error) { onError(error instanceof Error ? error.message : "Bundle could not be retrieved."); }
  }
  const adGroups = [...new Set(items.map((item) => String(item.ad_group_name || "")).filter(Boolean))];
  return <div className="creativeDeck">
    <section className="deckPanel creativeHero"><div><span className="eyebrow">Paid media · Google Search</span><h2>Creative Intake</h2><p>Structured assets, explicit review, immutable approvals, and one canonical build bundle.</p></div><div className="creativeActions"><button className="outlineBtn" onClick={() => void bundle()}>Download approved bundle</button><button className="liveBtn" onClick={() => setShowForm(!showForm)}>New creative</button></div></section>
    <section className="deckPanel creativeFilters">
      <select aria-label="Campaign filter" value={filters.campaign_id} onChange={(e) => setFilters({ ...filters, campaign_id: e.target.value })}><option value="">All campaigns</option>{campaigns.map((c) => <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}</select>
      <select aria-label="Ad group filter" value={filters.ad_group_name} onChange={(e) => setFilters({ ...filters, ad_group_name: e.target.value })}><option value="">All ad groups</option>{adGroups.map((name) => <option key={name}>{name}</option>)}</select>
      <select aria-label="Asset type filter" value={filters.asset_type} onChange={(e) => setFilters({ ...filters, asset_type: e.target.value })}><option value="">All types</option>{TYPES.map((value) => <option key={value}>{value}</option>)}</select>
      <select aria-label="State filter" value={filters.workflow_state} onChange={(e) => setFilters({ ...filters, workflow_state: e.target.value })}><option value="">All states</option>{STATES.map((value) => <option key={value}>{value.replaceAll("_", " ")}</option>)}</select>
    </section>
    {showForm && <form className="deckPanel creativeForm" onSubmit={createCreative}><h3>{form.supersedes_id ? "New revision draft" : "New draft creative"}</h3>{form.supersedes_id && <p>This draft preserves and will replace approved asset <code>{form.supersedes_id}</code> only when the revision is approved.</p>}<div className="creativeFormGrid">
      <label>Campaign<select value={form.campaign_id} onChange={(e) => { const campaign = campaigns.find((c) => c.id === e.target.value); setForm({ ...form, campaign_id: e.target.value, work_item_id: String(campaign?.work_item_id || "") }); }}>{campaigns.map((c) => <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}</select></label>
      <label>Asset type<select value={form.asset_type} onChange={(e) => setForm({ ...form, asset_type: e.target.value })}>{TYPES.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>OCC work item<input value={form.work_item_id} readOnly /></label><label>Request ID<input value={form.request_id} onChange={(e) => setForm({ ...form, request_id: e.target.value })} /></label>
      {form.asset_type === "RSA" && <label>Ad group<input required value={form.ad_group_name} onChange={(e) => setForm({ ...form, ad_group_name: e.target.value })} /></label>}
      {["RSA","sitelink"].includes(form.asset_type) && <label>Destination URL<input required type="url" value={form.destination_url} onChange={(e) => setForm({ ...form, destination_url: e.target.value })} /></label>}
      {form.asset_type === "sitelink" && <><label>Link text<input required value={form.sitelink_text} onChange={(e) => setForm({ ...form, sitelink_text: e.target.value })} /></label><label>Description 1<input value={form.sitelink_description_1} onChange={(e) => setForm({ ...form, sitelink_description_1: e.target.value })} /></label><label>Description 2<input value={form.sitelink_description_2} onChange={(e) => setForm({ ...form, sitelink_description_2: e.target.value })} /></label></>}
      {form.asset_type === "callout" && <label>Callout text<input required value={form.callout_text} onChange={(e) => setForm({ ...form, callout_text: e.target.value })} /></label>}
      {form.asset_type === "structured_snippet" && <label>Snippet header<input required value={form.snippet_header} onChange={(e) => setForm({ ...form, snippet_header: e.target.value })} /></label>}
    </div>
    {form.asset_type === "RSA" && <><label>Headlines · one per line<textarea required rows={8} value={form.headlines} onChange={(e) => setForm({ ...form, headlines: e.target.value })} /></label><label>Descriptions · one per line<textarea rows={5} value={form.descriptions} onChange={(e) => setForm({ ...form, descriptions: e.target.value })} /></label></>}
    {form.asset_type === "structured_snippet" && <label>Values · one per line<textarea required rows={5} value={form.snippet_values} onChange={(e) => setForm({ ...form, snippet_values: e.target.value })} /></label>}
    <label>Notes / usage constraints<textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label><footer><button className="liveBtn" type="submit">Create draft</button></footer></form>}
    <div className="creativeList">{items.map((item) => { const state = String(item.workflow_state); const campaign = item.campaign as Row; const variants = item.variants as Row[] || []; return <article className={`deckPanel creativeCard state-${state}`} key={String(item.id)}><header><div><span className="eyebrow">{String(item.asset_type)} · v{String(item.version)}</span><h3>{String(item.ad_group_name || item.sitelink_text || item.callout_text || item.snippet_header || "Campaign asset")}</h3><p>{String(campaign?.name || "")}</p></div><span className="creativeState">{state.replaceAll("_", " ")}</span></header><dl><div><dt>Work item</dt><dd>{String(item.work_item_id)}</dd></div><div><dt>Destination</dt><dd>{String(item.destination_url || "Not required")}</dd></div><div><dt>Variants</dt><dd>{variants.length}</dd></div><div><dt>Updated</dt><dd>{new Date(String(item.updated_at)).toLocaleString()}</dd></div></dl><footer>
      {state === "draft" && <button className="outlineBtn" onClick={() => void transition(item, "ready_for_review")}>Request review</button>}{state === "ready_for_review" && <><button className="liveBtn" onClick={() => void transition(item, "approved")}>Approve</button><button className="outlineBtn" onClick={() => void transition(item, "rejected")}>Reject</button></>}{state === "approved" && <button className="outlineBtn" onClick={() => createRevision(item)}>Create revision</button>}{state !== "superseded" && <button className="ghostBtn" onClick={() => void transition(item, "superseded")}>Supersede</button>}
      {["logo","image"].includes(String(item.asset_type)) && state !== "superseded" && <label className="outlineBtn uploadLabel">Upload file<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(item, file); }} /></label>}
    </footer></article>; })}{!items.length && <section className="deckPanel opsEmpty">No creative assets match these filters.</section>}</div>
  </div>;
}
