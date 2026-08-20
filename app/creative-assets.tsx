"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../utils/supabase/client";

type Row = Record<string, unknown>;
type PreviewFile = { name: string; mimeType: string; url: string };
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
  const [selectedAsset, setSelectedAsset] = useState<Row | null>(null);
  const [previewFiles, setPreviewFiles] = useState<PreviewFile[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [filters, setFilters] = useState({ campaign_id: "", platform: "", ad_group_name: "", asset_type: "", workflow_state: "" });

  async function api(path: string, init?: RequestInit) {
    const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, ...(init?.headers || {}) } });
    const payload = await response.json(); if (!response.ok) throw new Error(payload?.error?.message || "Creative request failed."); return payload.data;
  }
  async function refresh() {
    try {
      const params = new URLSearchParams(Object.entries(filters).filter(([key, value]) => key !== "platform" && value));
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
  async function uploadFile(item: Row, file: File) {
    const path = `${item.campaign_id}/${item.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    const { error } = await supabase.storage.from("paid-media-creative-assets").upload(path, file, { upsert: false, contentType: file.type }); if (error) throw error;
    await api(`/api/v1/paid-media-creatives/${item.id}/files`, { method: "POST", body: JSON.stringify({ original_filename: file.name, storage_path: path, mime_type: file.type, byte_size: file.size }) });
  }
  async function upload(item: Row, file: File) {
    try { await uploadFile(item, file); await refresh(); }
    catch (error) { onError(error instanceof Error ? error.message : "Upload failed."); }
  }
  async function ingestFiles(files: FileList | File[]) {
    const selectedCampaign = campaigns.find((campaign) => String(campaign.id) === form.campaign_id);
    const acceptedFiles = Array.from(files).filter((file) => ["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(file.type));
    if (!selectedCampaign) { onError("Choose a campaign before uploading assets."); return; }
    if (!acceptedFiles.length) { onError("Upload PNG, JPEG, WebP, or SVG creative assets."); return; }
    setIsUploading(true);
    try {
      for (const [index, file] of acceptedFiles.entries()) {
        setUploadStatus(`Uploading ${index + 1} of ${acceptedFiles.length} · ${file.name}`);
        const creative = await api("/api/v1/paid-media-creatives", {
          method: "POST",
          body: JSON.stringify({
            campaign_id: String(selectedCampaign.id),
            work_item_id: String(selectedCampaign.work_item_id),
            asset_type: file.name.toLowerCase().includes("logo") ? "logo" : "image",
            notes: `Uploaded to the campaign asset bucket for Lupe to organize. Original file: ${file.name}`,
            variants: [],
          }),
        });
        await uploadFile(creative, file);
      }
      setUploadStatus(`${acceptedFiles.length} ${acceptedFiles.length === 1 ? "asset" : "assets"} received · Lupe can organize them now`);
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Asset upload failed.";
      setUploadStatus("Upload interrupted");
      onError(message);
    } finally { setIsUploading(false); }
  }
  async function openAsset(item: Row) {
    setSelectedAsset(item); setPreviewFiles([]); setPreviewLoading(true);
    const files = item.files as Row[] || [];
    const signedFiles = await Promise.all(files.map(async (file) => {
      const bucket = String(file.storage_bucket || "paid-media-creative-assets");
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(String(file.storage_path), 3600);
      if (error || !data?.signedUrl) return null;
      return { name: String(file.original_filename || "Asset file"), mimeType: String(file.mime_type || ""), url: data.signedUrl };
    }));
    setPreviewFiles(signedFiles.filter((file): file is PreviewFile => file !== null)); setPreviewLoading(false);
  }
  async function bundle() {
    try { const campaign = filters.campaign_id || String(campaigns[0]?.id || ""); const data = await api(`/api/v1/paid-media-asset-bundle?campaign_id=${encodeURIComponent(campaign)}`); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = "occ-approved-paid-media-assets.json"; link.click(); URL.revokeObjectURL(url); }
    catch (error) { onError(error instanceof Error ? error.message : "Bundle could not be retrieved."); }
  }
  const adGroups = [...new Set(items.map((item) => String(item.ad_group_name || "")).filter(Boolean))];
  const platforms = [...new Set(campaigns.map((campaign) => String(campaign.platform || "")).filter(Boolean))];
  const visibleItems = filters.platform
    ? items.filter((item) => String((item.campaign as Row)?.platform || "") === filters.platform)
    : items;
  return <div className="creativeDeck">
    <section className="deckPanel creativeHero"><div><span className="eyebrow">Creative bucket</span><h2>Drop campaign assets here</h2><p>Upload the raw creative. Lupe will organize it by campaign and prepare it for review.</p></div><div className="creativeActions"><button className="outlineBtn" onClick={() => void bundle()}>Download approved assets</button><button className="ghostBtn" onClick={() => setShowForm(!showForm)}>{showForm ? "Close advanced form" : "Draft copy manually"}</button></div></section>
    <section className="deckPanel creativeIngest">
      <div className="creativeIngestContext">
        <label>Campaign<select aria-label="Campaign for uploaded assets" value={form.campaign_id} onChange={(event) => { const campaign = campaigns.find((item) => String(item.id) === event.target.value); setForm((current) => ({ ...current, campaign_id: event.target.value, work_item_id: String(campaign?.work_item_id || "") })); }}><option value="">Choose a campaign</option>{campaigns.map((campaign) => <option key={String(campaign.id)} value={String(campaign.id)}>{String(campaign.name)}</option>)}</select></label>
        <div><span className="eyebrow">Lupe handoff</span><p>Files land as draft campaign assets. Lupe can classify, rename, group, and route them from there.</p></div>
      </div>
      <label className={`creativeDropzone${isDraggingFiles ? " isDragging" : ""}${isUploading ? " isUploading" : ""}`} onDragEnter={(event) => { event.preventDefault(); setIsDraggingFiles(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDraggingFiles(false); }} onDrop={(event) => { event.preventDefault(); setIsDraggingFiles(false); void ingestFiles(event.dataTransfer.files); }}>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" multiple hidden disabled={isUploading} onChange={(event) => { if (event.target.files) void ingestFiles(event.target.files); event.target.value = ""; }} />
        <span className="creativeDropIcon" aria-hidden="true">＋</span><strong>{isUploading ? "Receiving assets…" : "Drag & drop campaign assets"}</strong><small>or click to choose multiple files · PNG, JPEG, WebP, SVG</small>
      </label>
      {uploadStatus && <p className="creativeUploadStatus" role="status">{uploadStatus}</p>}
    </section>
    <section className="deckPanel creativeFilters">
      <select aria-label="Campaign filter" value={filters.campaign_id} onChange={(e) => setFilters({ ...filters, campaign_id: e.target.value })}><option value="">All campaigns</option>{campaigns.map((c) => <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}</select>
      <select aria-label="Platform filter" value={filters.platform} onChange={(e) => setFilters({ ...filters, platform: e.target.value })}><option value="">All platforms</option>{platforms.map((platform) => <option key={platform}>{platform}</option>)}</select>
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
    <div className="creativeList">{visibleItems.map((item) => { const state = String(item.workflow_state); const campaign = item.campaign as Row; const variants = item.variants as Row[] || []; const changed = variants.filter((variant) => variant.original_value); return <article className={`deckPanel creativeCard clickable state-${state}`} key={String(item.id)} onClick={() => void openAsset(item)}><header><div><span className="eyebrow">{String(campaign?.platform || "Platform not set")} · {String(item.asset_type)} · v{String(item.version)}</span><h3>{String(item.ad_group_name || item.sitelink_text || item.callout_text || item.snippet_header || "Campaign asset")}</h3><p>{String(campaign?.name || "")}</p></div><span className="creativeState">{state.replaceAll("_", " ")}</span></header><dl><div><dt>Work item</dt><dd>{String(item.work_item_id)}</dd></div><div><dt>Destination</dt><dd>{String(item.destination_url || "Not required")}</dd></div><div><dt>Variants</dt><dd>{variants.length}</dd></div><div><dt>Updated</dt><dd>{new Date(String(item.updated_at)).toLocaleString()}</dd></div></dl>{changed.length > 0 && <section className="creativeRevisionLines"><h4>Compliance-only corrections</h4>{changed.map((variant) => <div className="creativeRevisionLine" key={`${String(variant.variant_type)}-${String(variant.position)}`}><span>{String(variant.variant_type)} {String(variant.position)}</span><p><del>{String(variant.original_value)}</del> <small>{String(variant.original_character_count)} characters</small></p><p><ins>{String(variant.value)}</ins> <small>{String(variant.corrected_character_count)} characters</small></p><em>{String(variant.meaning_change_label)}</em></div>)}</section>}<footer onClick={(event) => event.stopPropagation()}>
      <button className="liveBtn" onClick={() => void openAsset(item)}>View asset</button>{state === "approved" && <button className="outlineBtn" onClick={() => createRevision(item)}>Create revision</button>}{state !== "superseded" && <button className="ghostBtn" title="Mark this version as replaced by a newer asset" onClick={() => void transition(item, "superseded")}>Mark as replaced</button>}
      {["logo","image"].includes(String(item.asset_type)) && state !== "superseded" && <label className="outlineBtn uploadLabel">Upload file<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(item, file); }} /></label>}
    </footer></article>; })}{!visibleItems.length && <section className="deckPanel opsEmpty">No assets match these filters.</section>}</div>
    {selectedAsset && <div className="drawerShade" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedAsset(null); }}><aside className="deckDrawer creativePreviewDrawer" aria-label="Asset preview"><button className="drawerClose" onClick={() => setSelectedAsset(null)}>Close</button>{(() => { const campaign = selectedAsset.campaign as Row; const variants = selectedAsset.variants as Row[] || []; const files = selectedAsset.files as Row[] || []; const state = String(selectedAsset.workflow_state); const visualAsset = ["logo","image"].includes(String(selectedAsset.asset_type)); const canApprove = state === "ready_for_review" && (!visualAsset || files.length > 0); return <>
      <span className="eyebrow">{String(campaign?.platform || "Platform not set")} · {String(selectedAsset.asset_type)} · v{String(selectedAsset.version)}</span><h2>{String(selectedAsset.ad_group_name || selectedAsset.sitelink_text || selectedAsset.callout_text || selectedAsset.snippet_header || "Campaign asset")}</h2><p>{String(campaign?.name || "")}</p>
      <div className="creativePreviewStage">{previewLoading ? <p>Loading asset…</p> : previewFiles.length > 0 ? previewFiles.map((file) => file.mimeType.startsWith("image/") ? <figure key={file.url}><img src={file.url} alt={file.name} /><figcaption>{file.name}</figcaption></figure> : <a key={file.url} className="outlineBtn" href={file.url} target="_blank" rel="noreferrer">Open {file.name}</a>) : visualAsset ? <div className="creativeMissingAsset"><b>No asset file uploaded</b><p>Upload the creative before requesting approval.</p></div> : <div className="creativeTextAsset">{variants.length > 0 ? variants.map((variant) => <section key={String(variant.id)}><span>{String(variant.variant_type)} {String(variant.position)}</span><p>{String(variant.value)}</p></section>) : <section><span>Asset copy</span><p>{String(selectedAsset.primary_text || selectedAsset.callout_text || selectedAsset.sitelink_text || selectedAsset.notes || "No copy supplied.")}</p></section>}</div>}</div>
      <dl className="creativePreviewFacts"><div><dt>Status</dt><dd>{state.replaceAll("_", " ")}</dd></div><div><dt>Destination</dt><dd>{String(selectedAsset.destination_url || "Not required")}</dd></div><div><dt>Files</dt><dd>{files.length}</dd></div><div><dt>Updated</dt><dd>{new Date(String(selectedAsset.updated_at)).toLocaleString()}</dd></div></dl>
      <div className="creativePreviewActions">{state === "draft" && <button className="liveBtn" disabled={visualAsset && files.length === 0} onClick={() => void transition(selectedAsset, "ready_for_review").then(() => setSelectedAsset(null))}>Request review</button>}{state === "ready_for_review" && <><button className="liveBtn" disabled={!canApprove} title={!canApprove ? "Upload the asset before approving it" : undefined} onClick={() => void transition(selectedAsset, "approved").then(() => setSelectedAsset(null))}>Approve asset</button><button className="outlineBtn" onClick={() => void transition(selectedAsset, "rejected").then(() => setSelectedAsset(null))}>Reject asset</button></>}{!canApprove && state === "ready_for_review" && <small>Upload the asset file before approval.</small>}</div>
    </>; })()}</aside></div>}
  </div>;
}
