"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "../utils/supabase/client";
import { WorkflowDesigner } from "./workflows/workflow-designer";
import { CONTENT_CREATIVE_BUCKET, contentCreativeDownloadName, contentCreativeExternalUrl, contentCreativePath } from "../utils/content-assets";
import { isContentReviewable, rejectionHistoryFromActivity } from "../utils/content-review";

type View = "command" | "kanban" | "list" | "worklogs" | "content" | "agentops" | "leads" | "approvals" | "workflows";
type RecordValue = Record<string, unknown>;

type Viewer = {
  display_name: string;
  role: string;
};

type Overview = {
  viewer: Viewer;
  agents: RecordValue[];
  profiles: RecordValue[];
  projects: RecordValue[];
  tasks: RecordValue[];
  counts: {
    agents: number;
    projects: number;
    tasks: number;
    open_tasks: number;
    pending_approvals: number;
  };
};

type TaskForm = {
  title: string;
  description: string;
  assignee: string;
  project_id: string;
  priority: string;
  due_at: string;
  definition_of_done: string;
  status: string;
};

type ContentForm = {
  title: string;
  brief: string;
  body: string;
  caption: string;
  creative_asset_path: string;
  property_id: string;
  channel_id: string;
  content_type_id: string;
  owner_agent_id: string;
  distribution_mode: "organic" | "paid";
  status: string;
  publish_at: string;
  final_url: string;
  failure_message: string;
};

type AgentForm = { code: string; name: string; role: string; lane: string; status: string; charter: string; instructions: string; capabilities: string };
type WorkLogForm = { agent_id: string; task_id: string; entry_type: string; title: string; body: string; artifacts: string };
type DailyUpdateForm = { agent_id: string; update_date: string; summary: string; completed: string; blockers: string; next_steps: string; asks: string; health: string };
type LeadForm = { property_id: string; assigned_agent_id: string; contact_name: string; company: string; email: string; phone: string; source: string; subject: string; inquiry: string; status: string; priority: string; next_follow_up_at: string; notes: string };
type ContentUtilityStatus = { contentId: string; message: string; kind: "success" | "error" };

const EMPTY_FORM: TaskForm = {
  title: "",
  description: "",
  assignee: "",
  project_id: "",
  priority: "medium",
  due_at: "",
  definition_of_done: "",
  status: "inbox",
};

const EMPTY_CONTENT_FORM: ContentForm = {
  title: "",
  brief: "",
  body: "",
  caption: "",
  creative_asset_path: "",
  property_id: "",
  channel_id: "",
  content_type_id: "",
  owner_agent_id: "",
  distribution_mode: "organic",
  status: "idea",
  publish_at: "",
  final_url: "",
  failure_message: "",
};

const EMPTY_AGENT_FORM: AgentForm = { code: "", name: "", role: "", lane: "", status: "active", charter: "", instructions: "", capabilities: "" };
const EMPTY_WORK_LOG_FORM: WorkLogForm = { agent_id: "", task_id: "", entry_type: "progress", title: "", body: "", artifacts: "" };
const EMPTY_DAILY_UPDATE_FORM: DailyUpdateForm = { agent_id: "", update_date: "", summary: "", completed: "", blockers: "", next_steps: "", asks: "", health: "on_track" };
const EMPTY_LEAD_FORM: LeadForm = { property_id: "", assigned_agent_id: "", contact_name: "", company: "", email: "", phone: "", source: "website", subject: "", inquiry: "", status: "new", priority: "medium", next_follow_up_at: "", notes: "" };

const CONTENT_STATUS_LABELS: Record<string, string> = {
  idea: "Idea",
  research_ready: "Research ready",
  drafting: "Drafting",
  ready_for_lupe: "Ready for Lupe",
  awaiting_tito: "Awaiting Tito",
  revision_requested: "Revision requested",
  approved: "Approved",
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  blocked: "Blocked",
  failed: "Failed",
  cancelled: "Cancelled",
};

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "command", label: "Command" },
  { id: "kanban", label: "Kanban" },
  { id: "list", label: "List" },
  { id: "worklogs", label: "Work Logs" },
  { id: "content", label: "Content" },
  { id: "agentops", label: "Agent Ops" },
  { id: "leads", label: "Leads" },
  { id: "approvals", label: "Approvals" },
  { id: "workflows", label: "Workflows" },
];

const STATUS_COLUMNS = [
  { id: "inbox", label: "Inbox", note: "Instructions waiting to start" },
  { id: "in_progress", label: "In progress", note: "Active work across the roster" },
  { id: "review", label: "Review", note: "Awaiting K2 or owner review" },
  { id: "done", label: "Done", note: "Closed and documented" },
];

function text(value: unknown, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function dateLabel(value: unknown) {
  if (!value) return "No due date";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "No due date";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function initials(value: unknown) {
  return text(value, "?")
    .split(/[\s-]+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function taskStatus(task: RecordValue) {
  return text(task.status, "inbox");
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function copyTextFallback(value: string) {
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  return copied;
}

function triggerFileDownload(url: string, filename: string, openInNewTab = false) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  if (openInNewTab) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function CommandCenter() {
  const supabase = useMemo(() => createClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [approvals, setApprovals] = useState<RecordValue[]>([]);
  const [approvalActivity, setApprovalActivity] = useState<RecordValue[]>([]);
  const [updates, setUpdates] = useState<RecordValue[]>([]);
  const [workLogs, setWorkLogs] = useState<RecordValue[]>([]);
  const [contentItems, setContentItems] = useState<RecordValue[]>([]);
  const [contentProperties, setContentProperties] = useState<RecordValue[]>([]);
  const [contentChannels, setContentChannels] = useState<RecordValue[]>([]);
  const [contentTypes, setContentTypes] = useState<RecordValue[]>([]);
  const [contentHistory, setContentHistory] = useState<RecordValue[]>([]);
  const [agentWorkItems, setAgentWorkItems] = useState<RecordValue[]>([]);
  const [workDependencies, setWorkDependencies] = useState<RecordValue[]>([]);
  const [contentFeedback, setContentFeedback] = useState<RecordValue[]>([]);
  const [socialQueue, setSocialQueue] = useState<RecordValue[]>([]);
  const [view, setView] = useState<View>("command");
  const [lane, setLane] = useState("all");
  const [query, setQuery] = useState("");
  const [contentPlatform, setContentPlatform] = useState("all");
  const [contentAccount, setContentAccount] = useState("all");
  const [contentType, setContentType] = useState("all");
  const [opsAgent, setOpsAgent] = useState("all");
  const [opsProperty, setOpsProperty] = useState("all");
  const [opsPlatform, setOpsPlatform] = useState("all");
  const [opsStatus, setOpsStatus] = useState("all");
  const [opsSignal, setOpsSignal] = useState("all");
  const [opsPublishDate, setOpsPublishDate] = useState("");
  const [todayLabel, setTodayLabel] = useState("Today");
  const [drawer, setDrawer] = useState<"task" | "brief" | "agent" | "agentForm" | "workLog" | "dailyUpdate" | "lead" | "content" | "contentPreview" | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<RecordValue | null>(null);
  const [selectedContent, setSelectedContent] = useState<RecordValue | null>(null);
  const [form, setForm] = useState<TaskForm>(EMPTY_FORM);
  const [contentForm, setContentForm] = useState<ContentForm>(EMPTY_CONTENT_FORM);
  const [agentForm, setAgentForm] = useState<AgentForm>(EMPTY_AGENT_FORM);
  const [workLogForm, setWorkLogForm] = useState<WorkLogForm>(EMPTY_WORK_LOG_FORM);
  const [dailyUpdateForm, setDailyUpdateForm] = useState<DailyUpdateForm>(EMPTY_DAILY_UPDATE_FORM);
  const [leads, setLeads] = useState<RecordValue[]>([]);
  const [selectedLead, setSelectedLead] = useState<RecordValue | null>(null);
  const [leadForm, setLeadForm] = useState<LeadForm>(EMPTY_LEAD_FORM);
  const [leadStatus, setLeadStatus] = useState("all");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [creativeFile, setCreativeFile] = useState<File | null>(null);
  const [contentMediaUrls, setContentMediaUrls] = useState<Record<string, string>>({});
  const [contentDownloadUrls, setContentDownloadUrls] = useState<Record<string, string>>({});
  const [contentMediaErrors, setContentMediaErrors] = useState<Record<string, string>>({});
  const [contentUtilityStatus, setContentUtilityStatus] = useState<ContentUtilityStatus | null>(null);
  const [downloadingContentId, setDownloadingContentId] = useState("");
  const [rejectingContent, setRejectingContent] = useState<RecordValue | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [reviewSaving, setReviewSaving] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState("");
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [selectedPropertyPlatform, setSelectedPropertyPlatform] = useState("");
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (!data.session) {
        window.location.href = "/login";
        return;
      }
      setSession(data.session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) window.location.href = "/login";
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCalendarMonth(new Date().toLocaleDateString("en-CA", { year: "numeric", month: "2-digit", timeZone: "America/New_York" }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const paths = contentItems
      .map((item) => {
        return { id: String(item.id), path: contentCreativePath(item), externalUrl: contentCreativeExternalUrl(item), downloadName: contentCreativeDownloadName(item) };
      })
      .filter((item) => item.path || item.externalUrl);
    if (!paths.length) {
      const timer = window.setTimeout(() => {
        setContentMediaUrls({});
        setContentDownloadUrls({});
        setContentMediaErrors({});
      }, 0);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    void Promise.all(paths.map(async ({ id, path, externalUrl, downloadName }) => {
      if (externalUrl) return { id, preview: externalUrl, download: externalUrl, error: "" };
      const [preview, download] = await Promise.all([
        supabase.storage.from(CONTENT_CREATIVE_BUCKET).createSignedUrl(path, 3600),
        supabase.storage.from(CONTENT_CREATIVE_BUCKET).createSignedUrl(path, 3600, { download: downloadName }),
      ]);
      return { id, preview: preview.data?.signedUrl || "", download: download.data?.signedUrl || "", error: preview.error?.message || download.error?.message || "" };
    })).then((urls) => {
      if (cancelled) return;
      setContentMediaUrls(Object.fromEntries(urls.map(({ id, preview }) => [id, preview])));
      setContentDownloadUrls(Object.fromEntries(urls.map(({ id, download }) => [id, download])));
      setContentMediaErrors(Object.fromEntries(urls.filter(({ error }) => error).map(({ id, error }) => [id, error])));
    });
    return () => { cancelled = true; };
  }, [contentItems, supabase]);

  useEffect(() => {
    if (!session) return;
    startTransition(() => void refreshAll(session.access_token));
  }, [session]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTodayLabel(new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: "America/New_York",
      }).format(new Date()));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function request(path: string, init?: RequestInit) {
    if (!session?.access_token) throw new Error("Your session expired. Sign in again.");
    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        ...(init?.headers || {}),
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message || `Request failed (${response.status}).`);
    return payload;
  }

  async function downloadDeliverable(item: RecordValue) {
    try {
      setError("");
      const payload = await request(`/api/v1/content-items/${item.id}/deliverable`);
      const blob = new Blob([JSON.stringify(payload.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      triggerFileDownload(url, `occ-${String(item.title || item.id).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "The package is blocked from delivery.");
    }
  }

  async function refreshAll(accessToken: string) {
    try {
      setError("");
      const headers = { Authorization: `Bearer ${accessToken}` };
      const [
        overviewResponse,
        approvalsResponse,
        updatesResponse,
        workLogsResponse,
        contentItemsResponse,
        propertiesResponse,
        channelsResponse,
        typesResponse,
        historyResponse,
        approvalActivityResponse,
        leadsResponse,
        agentWorkResponse,
        workDependencyResponse,
        feedbackResponse,
        socialQueueResponse,
      ] = await Promise.all([
        fetch("/api/v1/overview", { headers }),
        fetch("/api/v1/approvals?limit=200&offset=0", { headers }),
        fetch("/api/v1/daily-updates?limit=200&offset=0", { headers }),
        fetch("/api/v1/work-logs?limit=200&offset=0", { headers }),
        fetch("/api/v1/content-items?limit=500&offset=0", { headers }),
        fetch("/api/v1/content-properties?limit=100&offset=0", { headers }),
        fetch("/api/v1/content-channels?limit=100&offset=0", { headers }),
        fetch("/api/v1/content-types?limit=100&offset=0", { headers }),
        fetch("/api/v1/content-status-history?limit=500&offset=0", { headers }),
        fetch("/api/v1/activity?entity_type=approvals&limit=500&offset=0", { headers }),
        fetch("/api/v1/leads?limit=500&offset=0", { headers }),
        fetch("/api/v1/agent-work-items?limit=500&offset=0", { headers }),
        fetch("/api/v1/agent-work-dependencies?limit=500&offset=0", { headers }),
        fetch("/api/v1/content-feedback?limit=500&offset=0", { headers }),
        fetch("/api/v1/social-operations-queue?limit=500&offset=0", { headers }),
      ]);
      const [
        overviewPayload,
        approvalsPayload,
        updatesPayload,
        workLogsPayload,
        contentItemsPayload,
        propertiesPayload,
        channelsPayload,
        typesPayload,
        historyPayload,
        approvalActivityPayload,
        leadsPayload,
        agentWorkPayload,
        workDependencyPayload,
        feedbackPayload,
        socialQueuePayload,
      ] = await Promise.all([
        overviewResponse.json(),
        approvalsResponse.json(),
        updatesResponse.json(),
        workLogsResponse.json(),
        contentItemsResponse.json(),
        propertiesResponse.json(),
        channelsResponse.json(),
        typesResponse.json(),
        historyResponse.json(),
        approvalActivityResponse.json(),
        leadsResponse.json(),
        agentWorkResponse.json(),
        workDependencyResponse.json(),
        feedbackResponse.json(),
        socialQueueResponse.json(),
      ]);
      if (!overviewResponse.ok) throw new Error(overviewPayload?.error?.message || "Could not load operations.");
      const contentResponses = [
        contentItemsResponse,
        propertiesResponse,
        channelsResponse,
        typesResponse,
        historyResponse,
      ];
      const contentPayloads = [
        contentItemsPayload,
        propertiesPayload,
        channelsPayload,
        typesPayload,
        historyPayload,
      ];
      const failedContentIndex = contentResponses.findIndex((response) => !response.ok);
      if (failedContentIndex >= 0) {
        throw new Error(contentPayloads[failedContentIndex]?.error?.message || "Could not load content operations. Apply the content operations migration first.");
      }
      setOverview(overviewPayload.data);
      setApprovals(approvalsResponse.ok ? approvalsPayload.data.items : []);
      setUpdates(updatesResponse.ok ? updatesPayload.data.items : []);
      setWorkLogs(workLogsResponse.ok ? workLogsPayload.data.items : []);
      setContentItems(contentItemsPayload.data.items);
      setContentProperties(propertiesPayload.data.items);
      setContentChannels(channelsPayload.data.items);
      setContentTypes(typesPayload.data.items);
      setContentHistory(historyPayload.data.items);
      setApprovalActivity(approvalActivityResponse.ok ? approvalActivityPayload.data.items : []);
      setLeads(leadsResponse.ok ? leadsPayload.data.items : []);
      setAgentWorkItems(agentWorkResponse.ok ? agentWorkPayload.data.items : []);
      setWorkDependencies(workDependencyResponse.ok ? workDependencyPayload.data.items : []);
      setContentFeedback(feedbackResponse.ok ? feedbackPayload.data.items : []);
      setSocialQueue(socialQueueResponse.ok ? socialQueuePayload.data.items : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load operations.");
    }
  }

  async function createTask() {
    if (!form.title.trim()) {
      setError("Give the instruction a title before assigning it.");
      return;
    }
    try {
      setError("");
      const payload: RecordValue = {
        title: form.title.trim(),
        description: form.description.trim(),
        status: form.status,
        priority: form.priority,
        definition_of_done: form.definition_of_done.trim(),
      };
      if (form.assignee.startsWith("agent:")) payload.owner_agent_id = form.assignee.slice(6);
      if (form.assignee.startsWith("human:")) payload.assigned_user_id = form.assignee.slice(6);
      if (form.project_id) payload.project_id = form.project_id;
      if (form.due_at) payload.due_at = new Date(form.due_at).toISOString();
      await request("/api/v1/tasks", { method: "POST", body: JSON.stringify(payload) });
      setDrawer(null);
      setForm(EMPTY_FORM);
      if (session) await refreshAll(session.access_token);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not create the instruction.");
    }
  }

  async function moveTask(task: RecordValue, status: string) {
    try {
      await request(`/api/v1/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, completed_at: status === "done" ? new Date().toISOString() : null }),
      });
      if (session) await refreshAll(session.access_token);
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Could not update the task.");
    }
  }

  function lineList(value: string) {
    return value.split("\n").map((item) => item.trim()).filter(Boolean);
  }

  function businessDate() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }

  function openAgentForm(agent?: RecordValue) {
    setSelectedAgent(agent || null);
    setAgentForm(agent ? { code: text(agent.code, ""), name: text(agent.name, ""), role: text(agent.role, ""), lane: text(agent.lane, ""), status: text(agent.status, "active"), charter: text(agent.charter, ""), instructions: text(agent.instructions, ""), capabilities: Array.isArray(agent.capabilities) ? agent.capabilities.join("\n") : text(agent.capabilities, "") } : EMPTY_AGENT_FORM);
    setDrawer("agentForm");
  }

  async function saveAgent() {
    if (!agentForm.code.trim() || !agentForm.name.trim()) return setError("Agent code and display name are required.");
    try {
      setError("");
      const payload = { ...agentForm, code: agentForm.code.trim(), name: agentForm.name.trim(), capabilities: lineList(agentForm.capabilities) };
      await request(selectedAgent ? `/api/v1/agents/${selectedAgent.id}` : "/api/v1/agents", { method: selectedAgent ? "PATCH" : "POST", body: JSON.stringify(payload) });
      setDrawer(null); setSelectedAgent(null); setAgentForm(EMPTY_AGENT_FORM);
      if (session) await refreshAll(session.access_token);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save the agent."); }
  }

  function openWorkLog(agentId = "", taskId = "") {
    setWorkLogForm({ ...EMPTY_WORK_LOG_FORM, agent_id: agentId, task_id: taskId });
    setDrawer("workLog");
  }

  async function saveWorkLog() {
    if (!workLogForm.agent_id || !workLogForm.body.trim()) return setError("Choose an agent and document the work performed.");
    try {
      setError("");
      await request("/api/v1/work-logs", { method: "POST", body: JSON.stringify({ ...workLogForm, task_id: workLogForm.task_id || null, title: workLogForm.title.trim() || null, body: workLogForm.body.trim(), artifacts: lineList(workLogForm.artifacts) }) });
      setDrawer(null); setWorkLogForm(EMPTY_WORK_LOG_FORM);
      if (session) await refreshAll(session.access_token);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save the work log."); }
  }

  function openDailyUpdate(agentId = "") {
    setDailyUpdateForm({ ...EMPTY_DAILY_UPDATE_FORM, agent_id: agentId, update_date: businessDate() });
    setDrawer("dailyUpdate");
  }

  async function saveDailyUpdate() {
    if (!dailyUpdateForm.agent_id || !dailyUpdateForm.summary.trim()) return setError("Choose an agent and provide the daily summary.");
    try {
      setError("");
      const existing = updates.find((update) => String(update.agent_id) === dailyUpdateForm.agent_id && text(update.update_date).slice(0, 10) === dailyUpdateForm.update_date);
      const payload = { ...dailyUpdateForm, summary: dailyUpdateForm.summary.trim(), completed: lineList(dailyUpdateForm.completed), blockers: lineList(dailyUpdateForm.blockers), next_steps: lineList(dailyUpdateForm.next_steps), asks: lineList(dailyUpdateForm.asks) };
      await request(existing ? `/api/v1/daily-updates/${existing.id}` : "/api/v1/daily-updates", { method: existing ? "PATCH" : "POST", body: JSON.stringify(payload) });
      setDrawer(null); setDailyUpdateForm(EMPTY_DAILY_UPDATE_FORM);
      if (session) await refreshAll(session.access_token);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save the daily update."); }
  }

  function openLead(lead?: RecordValue) {
    setSelectedLead(lead || null);
    setLeadForm(lead ? {
      property_id: text(lead.property_id, ""), assigned_agent_id: text(lead.assigned_agent_id, ""), contact_name: text(lead.contact_name, ""), company: text(lead.company, ""), email: text(lead.email, ""), phone: text(lead.phone, ""), source: text(lead.source, "website"), subject: text(lead.subject, ""), inquiry: text(lead.inquiry, ""), status: text(lead.status, "new"), priority: text(lead.priority, "medium"), next_follow_up_at: lead.next_follow_up_at ? new Date(String(lead.next_follow_up_at)).toISOString().slice(0, 16) : "", notes: text(lead.notes, ""),
    } : EMPTY_LEAD_FORM);
    setDrawer("lead");
  }

  async function saveLead() {
    if (!leadForm.contact_name.trim() || !leadForm.inquiry.trim() || (!leadForm.email.trim() && !leadForm.phone.trim())) return setError("A lead requires a contact name, inquiry, and either email or phone.");
    try {
      setError("");
      const payload = { ...leadForm, property_id: leadForm.property_id || null, assigned_agent_id: leadForm.assigned_agent_id || null, email: leadForm.email.trim() || null, phone: leadForm.phone.trim() || null, company: leadForm.company.trim() || null, subject: leadForm.subject.trim() || null, notes: leadForm.notes.trim() || null, next_follow_up_at: leadForm.next_follow_up_at ? new Date(leadForm.next_follow_up_at).toISOString() : null };
      await request(selectedLead ? `/api/v1/leads/${selectedLead.id}` : "/api/v1/leads", { method: selectedLead ? "PATCH" : "POST", body: JSON.stringify(payload) });
      setDrawer(null); setSelectedLead(null); setLeadForm(EMPTY_LEAD_FORM);
      if (session) await refreshAll(session.access_token);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save the lead."); }
  }

  async function decide(approval: RecordValue, status: "approved" | "changes_requested" | "declined") {
    try {
      await request(`/api/v1/approvals/${approval.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, decided_at: new Date().toISOString() }),
      });
      if (session) await refreshAll(session.access_token);
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "Could not record the decision.");
    }
  }

  const agents = useMemo(() => [...(overview?.agents || [])].sort((left, right) => {
    const leftIsLupe = text(left.name || left.code).toLowerCase() === "lupe";
    const rightIsLupe = text(right.name || right.code).toLowerCase() === "lupe";
    if (leftIsLupe === rightIsLupe) return 0;
    return leftIsLupe ? -1 : 1;
  }), [overview]);
  const projects = useMemo(() => overview?.projects || [], [overview]);
  const tasks = useMemo(() => overview?.tasks || [], [overview]);
  const profiles = useMemo(() => overview?.profiles || [], [overview]);
  const agentMap = useMemo(
    () => new Map(agents.map((agent) => [String(agent.id), text(agent.name || agent.code)])),
    [agents],
  );
  const projectMap = useMemo(
    () => new Map(projects.map((project) => [String(project.id), text(project.name || project.slug)])),
    [projects],
  );
  const profileMap = useMemo(
    () => new Map(profiles.map((profile) => [String(profile.user_id), text(profile.display_name)])),
    [profiles],
  );
  const taskAssigneeName = (task: RecordValue) =>
    profileMap.get(String(task.assigned_user_id)) || agentMap.get(String(task.owner_agent_id)) || "Unassigned";
  const latestUpdate = useMemo(() => {
    const map = new Map<string, RecordValue>();
    [...updates]
      .sort((a, b) => text(b.update_date || b.created_at).localeCompare(text(a.update_date || a.created_at)))
      .forEach((update) => {
        const id = String(update.agent_id || "");
        if (id && !map.has(id)) map.set(id, update);
      });
    return map;
  }, [updates]);

  const visibleTasks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks.filter((task) => {
      const laneMatch = lane === "all"
        || String(task.owner_agent_id) === lane
        || `human:${String(task.assigned_user_id)}` === lane;
      const searchMatch = !needle || JSON.stringify(task).toLowerCase().includes(needle);
      return laneMatch && searchMatch;
    });
  }, [lane, query, tasks]);

  const pendingApprovals = approvals.filter((approval) => text(approval.status, "pending") === "pending");
  const dueToday = tasks.filter((task) => {
    if (!task.due_at || taskStatus(task) === "done") return false;
    return new Date(String(task.due_at)).toDateString() === new Date().toDateString();
  });
  const contentDueToday = contentItems
    .filter((item) => {
      if (!item.publish_at || ["published", "cancelled"].includes(text(item.status))) return false;
      return new Date(String(item.publish_at)).toDateString() === new Date().toDateString();
    })
    .sort((left, right) => new Date(String(left.publish_at)).getTime() - new Date(String(right.publish_at)).getTime());
  const reporting = agents.filter((agent) => latestUpdate.has(String(agent.id))).length;
  const activeTasks = tasks.filter((task) => !["done", "cancelled"].includes(taskStatus(task)));
  const blockedTasks = activeTasks.filter((task) => taskStatus(task) === "blocked");
  const overdueTasks = activeTasks.filter((task) => task.due_at && new Date(String(task.due_at)) < new Date());
  const contentPropertyMap = useMemo(
    () => new Map(contentProperties.map((property) => [String(property.id), property])),
    [contentProperties],
  );
  const contentChannelMap = useMemo(
    () => new Map(contentChannels.map((channel) => [String(channel.id), channel])),
    [contentChannels],
  );
  const contentTypeMap = useMemo(
    () => new Map(contentTypes.map((contentTypeRecord) => [String(contentTypeRecord.id), contentTypeRecord])),
    [contentTypes],
  );
  const lupe = useMemo(
    () => agents.find((agent) => text(agent.code || agent.name).toLowerCase() === "lupe"),
    [agents],
  );
  const k2 = useMemo(
    () => agents.find((agent) => text(agent.code || agent.name).toLowerCase() === "k2"),
    [agents],
  );

  function contentProperty(item: RecordValue) {
    return contentPropertyMap.get(String(item.property_id));
  }

  function contentChannel(item: RecordValue) {
    return contentChannelMap.get(String(item.channel_id));
  }

  function contentPlatformForItem(item: RecordValue) {
    return text(contentChannel(item)?.platform, "Unassigned");
  }

  function contentAccountName(item: RecordValue) {
    return text(contentChannel(item)?.account_name, "Unassigned");
  }

  function contentPropertyName(item: RecordValue) {
    return text(contentProperty(item)?.name, "Unknown property");
  }

  function contentTypeName(item: RecordValue) {
    return text(contentTypeMap.get(String(item.content_type_id))?.name, "K2 to decide");
  }

  function contentPictureUrl(item: RecordValue) {
    return contentMediaUrls[String(item.id)] || "";
  }

  function contentPictureDownloadUrl(item: RecordValue) {
    return contentDownloadUrls[String(item.id)] || contentPictureUrl(item);
  }

  async function copyContentCaption(item: RecordValue) {
    const contentId = String(item.id);
    const caption = text(item.caption, "").trim();
    if (!caption) {
      setContentUtilityStatus({ contentId, message: "No caption is available to copy.", kind: "error" });
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(caption);
      } else if (!copyTextFallback(caption)) {
        throw new Error("Clipboard access is unavailable.");
      }
      setContentUtilityStatus({ contentId, message: "Caption copied.", kind: "success" });
    } catch {
      setContentUtilityStatus({ contentId, message: "Could not copy the caption. Check browser clipboard access.", kind: "error" });
    }
  }

  async function downloadContentPicture(item: RecordValue) {
    const contentId = String(item.id);
    const downloadUrl = contentPictureDownloadUrl(item);
    if (!downloadUrl) {
      setContentUtilityStatus({ contentId, message: "No downloadable image is attached.", kind: "error" });
      return;
    }
    const filename = contentCreativeDownloadName(item);
    setDownloadingContentId(contentId);
    try {
      if (contentCreativePath(item)) {
        triggerFileDownload(downloadUrl, filename);
      } else {
        const response = await fetch(downloadUrl, { credentials: "omit" });
        if (!response.ok) throw new Error(`Image request failed (${response.status}).`);
        const objectUrl = URL.createObjectURL(await response.blob());
        triggerFileDownload(objectUrl, filename);
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      }
      setContentUtilityStatus({ contentId, message: "Image download started.", kind: "success" });
    } catch {
      triggerFileDownload(downloadUrl, filename, true);
      setContentUtilityStatus({ contentId, message: "The image opened in a new tab. Save it from there if the download did not begin.", kind: "error" });
    } finally {
      setDownloadingContentId("");
    }
  }

  function openContent(item?: RecordValue) {
    const nextItem = item || null;
    setSelectedContent(nextItem);
    setEvidenceFile(null);
    setCreativeFile(null);
    setContentForm(nextItem ? {
      title: text(nextItem.title, ""),
      brief: text(nextItem.brief, ""),
      body: text(nextItem.body, ""),
      caption: text(nextItem.caption, ""),
      creative_asset_path: contentCreativePath(nextItem),
      property_id: text(nextItem.property_id, ""),
      channel_id: text(nextItem.channel_id, ""),
      content_type_id: text(nextItem.content_type_id, ""),
      owner_agent_id: text(nextItem.owner_agent_id, ""),
      distribution_mode: text(nextItem.distribution_mode, "organic") as "organic" | "paid",
      status: text(nextItem.status, "idea"),
      publish_at: nextItem.publish_at ? new Date(String(nextItem.publish_at)).toISOString().slice(0, 16) : "",
      final_url: text(nextItem.final_url, ""),
      failure_message: text(nextItem.failure_message, ""),
    } : EMPTY_CONTENT_FORM);
    setDrawer("content");
  }

  function previewContent(item: RecordValue) {
    setSelectedContent(item);
    setDrawer("contentPreview");
  }

  function openContentRejection(item: RecordValue) {
    setError("");
    setRejectingContent(item);
    setRejectionReason("");
  }

  async function ensureContentApproval(item: RecordValue) {
    const existing = approvals.find((approval) => String(approval.id) === String(item.approval_id));
    if (existing) return existing;
    if (!lupe) throw new Error("Lupe must exist in the agent roster before content can be reviewed.");
    const approvalPayload = await request("/api/v1/approvals", {
      method: "POST",
      body: JSON.stringify({
        content_item_id: item.id,
        requested_by_agent_id: lupe.id,
        reviewer_agent_id: lupe.id,
        title: `Content approval: ${text(item.title)}`,
        summary: text(item.brief || item.body || item.caption, "Content submitted for review."),
        evidence: [`Property: ${contentPropertyName(item)}`, `Channel: ${contentAccountName(item)}`, `Format: ${contentTypeName(item)}`],
        recommendation: "Approve for the documented publish date or return specific feedback to Lupe.",
        status: "pending",
        due_at: item.publish_at || null,
      }),
    });
    await request(`/api/v1/content-items/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ approval_id: approvalPayload.data.id, status: "awaiting_tito" }),
    });
    return approvalPayload.data as RecordValue;
  }

  async function reviewContent(item: RecordValue, decision: "approved" | "changes_requested", note = "") {
    const decisionNote = note.trim();
    if (decision === "changes_requested" && !decisionNote) {
      setError("A rejection reason is required for Lupe and C-3PO.");
      return;
    }
    try {
      setError("");
      setReviewSaving(true);
      const approval = await ensureContentApproval(item);
      await request(`/api/v1/approvals/${approval.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: decision,
          decision_note: decisionNote || null,
          decided_at: new Date().toISOString(),
          schedule_content: decision === "approved" && Boolean(item.publish_at),
        }),
      });
      setDrawer(null);
      setSelectedContent(null);
      setRejectingContent(null);
      setRejectionReason("");
      if (session) await refreshAll(session.access_token);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Could not record the content decision.");
    } finally {
      setReviewSaving(false);
    }
  }

  function channelsForProperty(propertyId: string) {
    return contentChannels.filter((channel) =>
      String(channel.property_id) === propertyId && text(channel.status, "active") !== "archived"
    );
  }

  async function saveContent() {
    if (!contentForm.title.trim() || !contentForm.property_id || !contentForm.channel_id) {
      setError("Content requires a title, property, and publishing channel.");
      return;
    }
    const chosenProperty = contentProperties.find((property) => String(property.id) === contentForm.property_id);
    const chosenOwner = agents.find((agent) => String(agent.id) === contentForm.owner_agent_id);
    const requiresBubblesCreative = text(chosenProperty?.slug, "").toLowerCase() === "bubbles-n-salt"
      && text(chosenOwner?.code, "").toLowerCase() === "c-3po";
    if (requiresBubblesCreative && !contentForm.caption.trim()) {
      setError("Bubbles n Salt posts owned by C-3PO require the final caption.");
      return;
    }
    if (requiresBubblesCreative && !creativeFile && !contentForm.creative_asset_path) {
      setError("Bubbles n Salt posts owned by C-3PO require an uploaded post image.");
      return;
    }

    try {
      setError("");
      let creativeAssetPath = contentForm.creative_asset_path;
      if (creativeFile) {
        if (!session?.user.id) throw new Error("Your session expired.");
        const extension = creativeFile.name.split(".").pop()?.toLowerCase() || "png";
        const objectPath = `${session.user.id}/${selectedContent?.id || crypto.randomUUID()}/${crypto.randomUUID()}.${extension}`;
        const { error: creativeUploadError } = await supabase.storage
          .from(CONTENT_CREATIVE_BUCKET)
          .upload(objectPath, creativeFile, {
            cacheControl: "3600",
            contentType: creativeFile.type,
            upsert: false,
          });
        if (creativeUploadError) throw creativeUploadError;
        creativeAssetPath = objectPath;
      }
      let screenshotPath = text(selectedContent?.screenshot_path, "");
      if (evidenceFile) {
        if (!session?.user.id) throw new Error("Your session expired.");
        const extension = evidenceFile.name.split(".").pop()?.toLowerCase() || "png";
        const objectPath = `${session.user.id}/${selectedContent?.id || crypto.randomUUID()}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from("content-publication-evidence")
          .upload(objectPath, evidenceFile, {
            cacheControl: "3600",
            contentType: evidenceFile.type,
            upsert: false,
          });
        if (uploadError) throw uploadError;
        screenshotPath = objectPath;
      }

      const payload: RecordValue = {
        title: contentForm.title.trim(),
        brief: contentForm.brief.trim() || null,
        body: contentForm.body.trim() || null,
        caption: contentForm.caption.trim() || null,
        creative_asset_path: creativeAssetPath || null,
        property_id: contentForm.property_id,
        channel_id: contentForm.channel_id,
        content_type_id: contentForm.content_type_id || null,
        owner_agent_id: contentForm.owner_agent_id || null,
        research_owner_agent_id: k2?.id || null,
        distribution_mode: contentForm.distribution_mode,
        status: contentForm.status,
        publish_at: contentForm.publish_at ? new Date(contentForm.publish_at).toISOString() : null,
        final_url: contentForm.final_url.trim() || null,
        screenshot_path: screenshotPath || null,
        failure_message: contentForm.failure_message.trim() || null,
      };

      if (selectedContent) {
        await request(`/api/v1/content-items/${selectedContent.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await request("/api/v1/content-items", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      setDrawer(null);
      setSelectedContent(null);
      setContentForm(EMPTY_CONTENT_FORM);
      setEvidenceFile(null);
      setCreativeFile(null);
      if (session) await refreshAll(session.access_token);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the content item.");
    }
  }

  async function advanceContent(item: RecordValue, nextStatus: string) {
    try {
      setError("");
      await request(`/api/v1/content-items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      if (session) await refreshAll(session.access_token);
    } catch (advanceError) {
      setError(advanceError instanceof Error ? advanceError.message : "Could not advance the content item.");
    }
  }

  async function sendContentToTito(item: RecordValue) {
    if (!lupe) {
      setError("Lupe must exist in the agent roster before an approval package can be sent.");
      return;
    }
    try {
      setError("");
      const approvalPayload = await request("/api/v1/approvals", {
        method: "POST",
        body: JSON.stringify({
          content_item_id: item.id,
          requested_by_agent_id: lupe.id,
          reviewer_agent_id: lupe.id,
          title: `Content approval: ${text(item.title)}`,
          summary: text(item.brief || item.body, "Lupe has assembled this content item for Tito's review."),
          evidence: [
            `Property: ${contentPropertyName(item)}`,
            `Channel: ${contentAccountName(item)}`,
            `Format: ${contentTypeName(item)}`,
            "K2 research should be referenced in the content record.",
          ],
          recommendation: "Review the final content and approve it for scheduling or request revisions.",
          status: "pending",
          due_at: item.publish_at || null,
        }),
      });
      await request(`/api/v1/content-items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "awaiting_tito",
          approval_id: approvalPayload.data.id,
        }),
      });
      if (session) await refreshAll(session.access_token);
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : "Could not send the content package to Tito.");
    }
  }

  function openAgent(agent: RecordValue) {
    setSelectedAgent(agent);
    setDrawer("agent");
  }

  function renderCommand() {
    return (
      <div className="commandView">
        <section className="metricDeck">
          <div><span>Open instructions</span><strong>{String(activeTasks.length).padStart(2, "0")}</strong><small>Across {agents.length} operating lanes</small></div>
          <div><span>Due today</span><strong>{String(dueToday.length).padStart(2, "0")}</strong><small>Requires attention before close</small></div>
          <div><span>Approval queue</span><strong>{String(pendingApprovals.length).padStart(2, "0")}</strong><small>Decision packages awaiting you</small></div>
          <div><span>Daily reports</span><strong>{reporting}/{agents.length}</strong><small>{agents.length - reporting} lanes still silent</small></div>
        </section>

        <section className="deckPanel commandBrief">
          <header className="panelHead"><div><span>Daily brief</span><h2>{todayLabel}</h2></div><small>Live operational readout</small></header>
          <div className="briefSnapshot">
            <div><span>Today’s focus</span><p>{dueToday.length || contentDueToday.length ? `${dueToday.length} instructions and ${contentDueToday.length} publications are due today. ${[...contentDueToday, ...dueToday].slice(0, 3).map((item) => text(item.title)).join(" · ")}` : "No instructions or publications are due today; use the window to clear review-stage work."}</p></div>
            <div className={pendingApprovals.length ? "attention" : ""}><span>Your attention</span><p>{pendingApprovals.length ? `${pendingApprovals.length} approval package${pendingApprovals.length === 1 ? "" : "s"} need your decision.` : "No approval decisions are waiting."}</p></div>
            <div className={blockedTasks.length || overdueTasks.length ? "attention" : ""}><span>Watch list</span><p>{blockedTasks.length || overdueTasks.length ? `${blockedTasks.length} blocked · ${overdueTasks.length} overdue. Lupe should resolve these before new work begins.` : "Nothing is blocked or overdue."}</p></div>
            <div className={reporting < agents.length ? "attention" : ""}><span>Reporting</span><p>{reporting} of {agents.length} lanes have reported. {agents.length - reporting ? `${agents.length - reporting} updates are still missing.` : "The full roster is accounted for."}</p></div>
          </div>
        </section>

        <div className="commandSnapshots">
          <section className="deckPanel miniKanban">
            <header className="panelHead"><div><span>Kanban snapshot</span><h2>Work in motion</h2></div><button className="textLink compactLink" onClick={() => setView("kanban")}>Open board →</button></header>
            <div className="miniKanbanGrid">
              {STATUS_COLUMNS.map((column) => {
                const items = tasks.filter((task) => taskStatus(task) === column.id || (column.id === "in_progress" && taskStatus(task) === "blocked"));
                return <div key={column.id}><header><span>{column.label}</span><b>{String(items.length).padStart(2, "0")}</b></header>{items.slice(0, 2).map((task) => <button key={String(task.id)} onClick={() => setView("kanban")}><b>{text(task.title)}</b><small>{taskAssigneeName(task)}</small></button>)}{!items.length && <p>Clear</p>}</div>;
              })}
            </div>
          </section>

          <section className="deckPanel todayCalendar">
            <header className="panelHead"><div><span>Today’s calendar</span><h2>Content going live</h2></div><small>{contentDueToday.length} scheduled</small></header>
            <div className="todaySchedule">
              {contentDueToday.map((item) => (
                <article key={String(item.id)}>
                  <time>{new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(String(item.publish_at)))}</time>
                  <div><b>{text(item.title)}</b><small>{contentAccountName(item)} · {contentTypeName(item)}</small></div>
                  <span>{contentPlatformForItem(item)}</span>
                </article>
              ))}
              {!contentDueToday.length && <div className="emptySchedule"><b>No content scheduled today.</b><span>Approved content appears here after Lupe records its publishing time.</span></div>}
            </div>
          </section>
        </div>

        <div className="commandGrid">
          <section className="deckPanel teamPanel">
            <header className="panelHead"><div><span>Roster state</span><h2>Agent operating lanes</h2></div><small>Click a lane to inspect</small></header>
            {agents.map((agent) => {
              const owned = activeTasks.filter((task) => String(task.owner_agent_id) === String(agent.id));
              const update = latestUpdate.get(String(agent.id));
              return (
                <button className="teamRow" key={String(agent.id)} onClick={() => openAgent(agent)}>
                  <span className="agentMark large">{initials(agent.code || agent.name)}</span>
                  <span className="agentIdentity"><b>{text(agent.name || agent.code)}</b><small>{text(agent.role, "Agent")}</small></span>
                  <span className="agentFocus">{text(agent.lane || agent.charter, "Operating lane")}</span>
                  <strong>{String(owned.length).padStart(2, "0")}</strong>
                  <span className="reportState"><b className={update ? "" : "missing"}>{update ? "Reported" : "Missing"}</b><small>{update ? dateLabel(update.update_date) : "No update"}</small></span>
                </button>
              );
            })}
          </section>

          <div className="sideStack">
            <section className="deckPanel">
              <header className="panelHead"><div><span>Needs direction</span><h2>Approval queue</h2></div><small>{pendingApprovals.length} open</small></header>
              {pendingApprovals.slice(0, 4).map((approval) => (
                <button className="decisionRow" key={String(approval.id)} onClick={() => setView("approvals")}>
                  <b>{text(approval.title, "Untitled approval")}</b>
                  <small><i>Pending</i> · {dateLabel(approval.due_at)}</small>
                </button>
              ))}
              {!pendingApprovals.length && <p className="opsEmpty">No decisions waiting.</p>}
              <button className="textLink" onClick={() => setView("approvals")}>Open approval queue →</button>
            </section>

            <section className="deckPanel">
              <header className="panelHead"><div><span className="dim">Today</span><h2>Due before close</h2></div><small>{dueToday.length}</small></header>
              {dueToday.slice(0, 5).map((task) => (
                <div className="dueRow" key={String(task.id)}><i /><span><b>{text(task.title)}</b><small>{taskAssigneeName(task)}</small></span></div>
              ))}
              {!dueToday.length && <p className="opsEmpty">Nothing due today.</p>}
            </section>
          </div>
        </div>
      </div>
    );
  }

  function renderList() {
    return (
      <section className="deckPanel ledger">
        <header className="panelHead"><div><span>Instruction ledger</span><h2>{visibleTasks.length} visible instructions</h2></div><small>Live from Supabase</small></header>
        <div className="ledgerHead"><span /><span>Instruction</span><span>Owner</span><span>Priority</span><span>Status</span><span>Due</span><span>Project</span></div>
        {visibleTasks.map((task) => (
          <div className="ledgerRow" key={String(task.id)}>
            <button className={`squareCheck ${taskStatus(task) === "done" ? "done" : ""}`} onClick={() => void moveTask(task, taskStatus(task) === "done" ? "in_progress" : "done")} aria-label="Toggle completion"><i /></button>
            <span className="instruction"><b className={taskStatus(task) === "done" ? "struck" : ""}>{text(task.title)}</b><small>{text(task.description, "No context documented")}</small></span>
            <button className="ownerLink" onClick={() => { const agent = agents.find((item) => String(item.id) === String(task.owner_agent_id)); if (agent) openAgent(agent); }}>{taskAssigneeName(task)}</button>
            <span className={text(task.priority) === "urgent" ? "urgent" : ""}>{text(task.priority, "medium")}</span>
            <span className={`statusPill s${taskStatus(task).replace("_", "")}`}><i />{statusLabel(taskStatus(task))}</span>
            <span>{dateLabel(task.due_at)}</span>
            <span>{projectMap.get(String(task.project_id)) || "General"}</span>
          </div>
        ))}
        {!visibleTasks.length && <p className="opsEmpty">No instructions match this view.</p>}
        <footer>{busy ? "Synchronizing operations…" : "All changes write through the Lupe operations API."}</footer>
      </section>
    );
  }

  function renderKanban() {
    return (
      <div className="kanbanDeck">
        {STATUS_COLUMNS.map((column) => {
          const items = visibleTasks.filter((task) => taskStatus(task) === column.id || (column.id === "in_progress" && taskStatus(task) === "blocked"));
          return (
            <section className="kanbanColumn" key={column.id}>
              <header><span><i />{column.label}</span><b>{String(items.length).padStart(2, "0")}</b></header>
              <p>{column.note}</p>
              <div>
                {items.map((task) => (
                  <article key={String(task.id)}>
                    <header><span>{projectMap.get(String(task.project_id)) || "General"}</span><em>{text(task.priority, "medium")}</em></header>
                    <h3>{text(task.title)}</h3>
                    <p>{text(task.description, "No context documented.")}</p>
                    <footer><span><span className="agentMark">{initials(taskAssigneeName(task))}</span>{taskAssigneeName(task)}</span>
                      {column.id !== "done" && <button onClick={() => void moveTask(task, column.id === "inbox" ? "in_progress" : column.id === "in_progress" ? "review" : "done")}>Advance →</button>}
                    </footer>
                  </article>
                ))}
              </div>
              <button className="addInstruction" onClick={() => { setForm({ ...EMPTY_FORM, status: column.id }); setDrawer("task"); }}>+ Add instruction</button>
            </section>
          );
        })}
      </div>
    );
  }

  function renderWorkLogs() {
    return (
      <section className="deckPanel workLogPanel">
        <header className="panelHead"><div><span>Documented execution</span><h2>{workLogs.length} work log entries</h2></div><button className="outlineBtn" onClick={() => openWorkLog()}>New work log</button></header>
        <div className="workLogList">
          {workLogs.map((log) => (
            <article key={String(log.id)}>
              <span className="agentMark">{initials(agentMap.get(String(log.agent_id)))}</span>
              <div><header><b>{text(log.title, statusLabel(text(log.entry_type, "note")))}</b><span>{text(log.entry_type, "note")}</span></header><p>{text(log.body, "No narrative documented.")}</p><small>{agentMap.get(String(log.agent_id)) || "Unknown agent"} · {dateLabel(log.created_at)}{log.task_id ? ` · Task ${String(log.task_id).slice(0, 8)}` : ""}</small></div>
            </article>
          ))}
          {!workLogs.length && <p className="opsEmpty">No work has been documented yet.</p>}
        </div>
      </section>
    );
  }

  function renderAgentOps() {
    const agentById = new Map(agents.map((agent) => [String(agent.id), text(agent.name || agent.code)]));
    const propertyById = new Map(contentProperties.map((property) => [String(property.id), text(property.name)]));
    const queueById = new Map(socialQueue.map((item) => [String(item.id), item]));
    const workById = new Map(agentWorkItems.map((item) => [String(item.id), item]));
    const blockedWork = new Set(workDependencies.filter((dependency) => {
      if (dependency.required !== true) return false;
      const upstream = workById.get(String(dependency.upstream_work_item_id));
      return upstream && !["final", "delivered"].includes(text(upstream.status));
    }).map((dependency) => String(dependency.downstream_work_item_id)));
    const filtered = contentItems.filter((item) => {
      const queue = queueById.get(String(item.id));
      return (opsAgent === "all" || String(item.owner_agent_id) === opsAgent)
        && (opsProperty === "all" || String(item.property_id) === opsProperty)
        && (opsPlatform === "all" || String(queue?.platform) === opsPlatform)
        && (opsStatus === "all" || String(item.status) === opsStatus)
        && (!opsPublishDate || String(item.publish_at || "").slice(0, 10) === opsPublishDate)
        && (opsSignal === "all"
          || (opsSignal === "blocked" && agentWorkItems.some((work) => String(work.content_item_id) === String(item.id) && blockedWork.has(String(work.id))))
          || (opsSignal === "feedback" && queue?.has_unresolved_feedback === true)
          || (opsSignal === "ready" && queue?.ready_to_deliver === true));
    }).sort((a, b) => String(a.publish_at || "9999").localeCompare(String(b.publish_at || "9999")));

    return <div className="agentOpsDeck">
      <section className="deckPanel opsControlPanel">
        <header className="panelHead"><div><span>Canonical social operations</span><h2>Agent handoffs and delivery queue</h2></div><small>{agentWorkItems.length} artifacts · {contentFeedback.filter((item) => item.required === true && ["received", "blocked"].includes(text(item.status))).length} unresolved feedback</small></header>
        <div className="opsViewFilters">
          <label>Agent<select value={opsAgent} onChange={(event) => setOpsAgent(event.target.value)}><option value="all">All agents</option>{agents.map((agent) => <option key={String(agent.id)} value={String(agent.id)}>{text(agent.name || agent.code)}</option>)}</select></label>
          <label>Brand<select value={opsProperty} onChange={(event) => setOpsProperty(event.target.value)}><option value="all">All brands</option>{contentProperties.map((property) => <option key={String(property.id)} value={String(property.id)}>{text(property.name)}</option>)}</select></label>
          <label>Platform<select value={opsPlatform} onChange={(event) => setOpsPlatform(event.target.value)}><option value="all">All platforms</option>{[...new Set(socialQueue.map((item) => text(item.platform)).filter((item) => item !== "—"))].map((platform) => <option key={platform}>{platform}</option>)}</select></label>
          <label>Status<select value={opsStatus} onChange={(event) => setOpsStatus(event.target.value)}><option value="all">All statuses</option>{Object.keys(CONTENT_STATUS_LABELS).map((status) => <option key={status} value={status}>{CONTENT_STATUS_LABELS[status]}</option>)}</select></label>
          <label>Signal<select value={opsSignal} onChange={(event) => setOpsSignal(event.target.value)}><option value="all">All records</option><option value="blocked">Dependency blocked</option><option value="feedback">Feedback unresolved</option><option value="ready">Ready to deliver</option></select></label>
          <label>Publish date<input type="date" value={opsPublishDate} onChange={(event) => setOpsPublishDate(event.target.value)} /></label>
        </div>
      </section>
      <section className="opsPackageGrid">
        {filtered.map((item) => {
          const queue = queueById.get(String(item.id));
          const work = agentWorkItems.filter((artifact) => String(artifact.content_item_id) === String(item.id) || String(artifact.campaign_id) === String(item.id));
          const feedback = contentFeedback.filter((entry) => String(entry.content_item_id) === String(item.id));
          const dependencyBlocked = work.some((artifact) => blockedWork.has(String(artifact.id)));
          return <article className="deckPanel opsPackageCard" key={String(item.id)}>
            <header><div><span>{propertyById.get(String(item.property_id)) || "Unknown brand"} · {text(queue?.platform)}</span><h3>{text(item.title)}</h3></div><b className={queue?.ready_to_deliver === true ? "readySignal" : "blockedSignal"}>{queue?.ready_to_deliver === true ? "Ready" : "Gated"}</b></header>
            <p>{dateLabel(item.publish_at)} · {CONTENT_STATUS_LABELS[text(item.status)] || statusLabel(text(item.status))} · {agentById.get(String(item.owner_agent_id)) || "Unassigned"}</p>
            <div className="handoffChain">{work.length ? work.map((artifact, index) => <span key={String(artifact.id)} className={blockedWork.has(String(artifact.id)) ? "blocked" : ""}>{index > 0 && <i>→</i>}<b>{agentById.get(String(artifact.agent_id)) || "Agent"}</b><small>{text(artifact.work_item_type)} · {text(artifact.status)}</small></span>) : <em>No agent artifacts linked</em>}</div>
            <footer><span>{dependencyBlocked ? "Dependency blocked" : feedback.some((entry) => entry.required === true && ["received", "blocked"].includes(text(entry.status))) ? "Required feedback unresolved" : `${work.length} linked artifacts`}</span><button className="outlineBtn" disabled={queue?.ready_to_deliver !== true} onClick={() => void downloadDeliverable(item)}>Download final package</button></footer>
          </article>;
        })}
        {!filtered.length && <p className="opsEmpty">No packages match this operations view.</p>}
      </section>
    </div>;
  }

  function renderContent() {
    const platforms = [...new Set(contentChannels.map((channel) => text(channel.platform)).filter(Boolean))].sort();
    const accounts = [...new Set(contentChannels.map((channel) => text(channel.account_name)).filter(Boolean))].sort();
    const types = [...new Set(contentTypes.map((contentTypeRecord) => text(contentTypeRecord.name)).filter(Boolean))].sort();
    const filteredContent = contentItems.filter((item) => {
      const platformMatch = contentPlatform === "all" || contentPlatform === contentPlatformForItem(item);
      const accountMatch = contentAccount === "all" || contentAccount === contentAccountName(item);
      const typeMatch = contentType === "all" || contentType === contentTypeName(item);
      const laneMatch = lane === "all" || String(item.owner_agent_id) === lane;
      const searchMatch = !query.trim() || JSON.stringify(item).toLowerCase().includes(query.trim().toLowerCase());
      return platformMatch && accountMatch && typeMatch && laneMatch && searchMatch;
    });
    const scheduled = filteredContent.filter((item) => ["scheduled", "publishing"].includes(text(item.status)));
    const inReview = filteredContent.filter((item) => ["ready_for_lupe", "awaiting_tito", "revision_requested"].includes(text(item.status)));
    const published = filteredContent.filter((item) => text(item.status) === "published");
    const monthDate = calendarMonth ? new Date(`${calendarMonth}-01T12:00:00`) : new Date();
    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const gridStart = new Date(monthStart);
    gridStart.setDate(monthStart.getDate() - monthStart.getDay());
    const calendarDays = Array.from({ length: 42 }, (_, index) => {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + index);
      return day;
    });
    const selectedProperty = contentProperties.find((property) => String(property.id) === selectedPropertyId) || contentProperties[0];
    const propertyChannels = selectedProperty ? contentChannels.filter((channel) => String(channel.property_id) === String(selectedProperty.id)) : [];
    const propertyPlatforms = [...new Set(propertyChannels.map((channel) => text(channel.platform)).filter(Boolean))];
    const activePropertyPlatform = propertyPlatforms.includes(selectedPropertyPlatform) ? selectedPropertyPlatform : (propertyPlatforms[0] || "");
    const previewItems = contentItems.filter((item) =>
      String(item.property_id) === String(selectedProperty?.id) && contentPlatformForItem(item) === activePropertyPlatform
    ).sort((left, right) => new Date(String(right.publish_at || right.created_at)).getTime() - new Date(String(left.publish_at || left.created_at)).getTime());
    const rejectedFeedback = rejectionHistoryFromActivity(approvalActivity);
    for (const approval of approvals) {
      const decision = text(approval.status, "");
      const reason = text(approval.decision_note, "").trim();
      const contentItemId = text(approval.content_item_id, "");
      const alreadyCaptured = rejectedFeedback.some((entry) => entry.approvalId === String(approval.id) && entry.reason === reason);
      if (["changes_requested", "declined"].includes(decision) && reason && contentItemId && !alreadyCaptured) {
        rejectedFeedback.push({
          id: `current-${String(approval.id)}`,
          approvalId: String(approval.id),
          contentItemId,
          decision: decision as "changes_requested" | "declined",
          reason,
          decidedAt: text(approval.decided_at || approval.updated_at, ""),
        });
      }
    }
    const changeMonth = (amount: number) => {
      const next = new Date(monthDate.getFullYear(), monthDate.getMonth() + amount, 1);
      setCalendarMonth(next.toLocaleDateString("en-CA", { year: "numeric", month: "2-digit" }));
    };
    return (
      <div className="contentWorkspace">
        <section className="deckPanel propertyPanel">
          <header className="panelHead"><div><span>Properties</span><h2>Channel preview</h2></div><small>See the feed before it publishes</small></header>
          <div className="propertyTabs" role="tablist" aria-label="Publishing properties">
            {contentProperties.map((property, index) => <button key={String(property.id)} role="tab" aria-selected={String(property.id) === String(selectedProperty?.id)} className={String(property.id) === String(selectedProperty?.id) ? "active" : ""} onClick={() => { setSelectedPropertyId(String(property.id)); const firstChannel = contentChannels.find((channel) => String(channel.property_id) === String(property.id)); setSelectedPropertyPlatform(text(firstChannel?.platform, "")); }}><i className={`propertyTone tone${index % 4}`} />{text(property.name)}<small>{text(property.status)}</small></button>)}
          </div>
          {selectedProperty && <div className="propertyPreview">
            <div className="platformTabs" role="tablist" aria-label={`${text(selectedProperty.name)} platforms`}>
              {propertyPlatforms.map((platform) => <button key={platform} role="tab" aria-selected={platform === activePropertyPlatform} className={platform === activePropertyPlatform ? "active" : ""} onClick={() => setSelectedPropertyPlatform(platform)}>{platform}</button>)}
            </div>
            <header className="feedIdentity"><span className="feedAvatar">{initials(selectedProperty.name)}</span><div><b>{text(selectedProperty.name)}</b><small>{activePropertyPlatform} · {text(selectedProperty.status)}</small></div></header>
            <div className={`feedPreview ${activePropertyPlatform.toLowerCase()}`}>
              {previewItems.map((item) => <button key={String(item.id)} onClick={() => previewContent(item)}>
                {contentPictureUrl(item) ? <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={contentPictureUrl(item)} alt={`Preview for ${text(item.title)}`} />
                </> : <span className="feedPlaceholder"><b>{initials(selectedProperty.name)}</b><small>Creative pending</small></span>}
                <span><b>{text(item.title)}</b><small>{item.publish_at ? dateLabel(item.publish_at) : CONTENT_STATUS_LABELS[text(item.status)]}</small></span>
              </button>)}
              {!previewItems.length && <p className="opsEmpty">No {activePropertyPlatform.toLowerCase()} content has been created for this property yet.</p>}
            </div>
          </div>}
        </section>

        <section className="metricDeck contentMetrics">
          <div><span>Scheduled</span><strong>{String(scheduled.length).padStart(2, "0")}</strong><small>Approved content moving toward publication</small></div>
          <div><span>With Tito</span><strong>{String(inReview.length).padStart(2, "0")}</strong><small>Lupe-managed review and revision packages</small></div>
          <div><span>Published</span><strong>{String(published.length).padStart(2, "0")}</strong><small>Final URL and required evidence documented</small></div>
          <div><span>Properties</span><strong>{contentProperties.filter((property) => text(property.status) === "active").length}</strong><small>{contentProperties.filter((property) => text(property.status) === "paused").length} property paused</small></div>
        </section>

        <section className="deckPanel publishingCalendar">
          <header className="panelHead calendarPanelHead"><div><span>Publishing calendar</span><h2>{new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(monthDate)}</h2></div><div className="calendarControls"><button onClick={() => changeMonth(-1)} aria-label="Previous month">←</button><button onClick={() => changeMonth(1)} aria-label="Next month">→</button><button className="liveBtn" onClick={() => openContent()}>New content</button></div></header>
          <div className="propertyLegend" aria-label="Property color key">
            {contentProperties.map((property, index) => <span key={String(property.id)}><i className={`propertyTone tone${index % 4}`} />{text(property.name)}</span>)}
          </div>
          <div className="publishingCalendarGrid">
            {calendarDays.map((day) => {
              const dayKey = day.toLocaleDateString("en-CA");
              const dayItems = filteredContent.filter((item) => item.publish_at && new Date(String(item.publish_at)).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) === dayKey);
              return <div key={dayKey} className={`publishingDay ${day.getMonth() !== monthDate.getMonth() ? "outside" : ""}`}>
                <time>{day.getDate()}</time>
                {dayItems.map((item) => {
                  const propertyIndex = Math.max(0, contentProperties.findIndex((property) => String(property.id) === String(item.property_id)));
                  return <button key={String(item.id)} className={`calendarContent tone${propertyIndex % 4}`} onClick={() => previewContent(item)}>
                    <b>{new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(String(item.publish_at)))}</b>
                    <span>{text(item.title)}</span><small>{contentPlatformForItem(item)}</small>
                  </button>;
                })}
              </div>;
            })}
          </div>
        </section>

        <section className="deckPanel contentSchedule">
          <header className="panelHead"><div><span>Posts</span><h2>Review every caption and creative</h2></div><small>Open a post to approve it or return feedback</small></header>
          <div className="contentFilters">
            <label>Platform<select value={contentPlatform} onChange={(event) => setContentPlatform(event.target.value)}><option value="all">All platforms</option>{platforms.map((platform) => <option key={platform} value={platform}>{platform}</option>)}</select></label>
            <label>Account<select value={contentAccount} onChange={(event) => setContentAccount(event.target.value)}><option value="all">All accounts</option>{accounts.map((account) => <option key={account} value={account}>{account}</option>)}</select></label>
            <label>Content type<select value={contentType} onChange={(event) => setContentType(event.target.value)}><option value="all">All content types</option>{types.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
            {(contentPlatform !== "all" || contentAccount !== "all" || contentType !== "all") && <button className="ghostBtn" onClick={() => { setContentPlatform("all"); setContentAccount("all"); setContentType("all"); }}>Clear filters</button>}
          </div>
          <div className="contentHead"><span>Date</span><span>Content</span><span>Platform</span><span>Account</span><span>Owner</span><span>Stage</span><span /></div>
          <div className="contentCards" aria-label="Content review queue">{filteredContent.map((item) => (
            <article key={String(item.id)} className={`${contentPlatformForItem(item).toLowerCase() === "instagram" ? "instagramReviewCard" : ""} ${isContentReviewable(item.status) ? "reviewable" : ""}`.trim()}>
              <time>{item.publish_at ? <><b>{dateLabel(item.publish_at)}</b><small>{new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(String(item.publish_at)))}</small></> : <><b>Unscheduled</b><small>Awaiting approval</small></>}</time>
              <button type="button" className="mobilePostCreative" onClick={() => previewContent(item)} aria-label={`Open ${text(item.title)} preview`}>
                {contentPictureUrl(item) ? <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={contentPictureUrl(item)} alt={`Creative for ${text(item.title)}`} />
                </> : <span><b>{initials(contentPropertyName(item))}</b><small>Creative unavailable</small></span>}
              </button>
              <button type="button" className="contentTitle contentTitleButton" onClick={() => previewContent(item)}><b>{text(item.title)}</b><small>{contentPropertyName(item)} · {contentTypeName(item)} · {text(item.distribution_mode)}</small><span className="mobileContentCaption">{text(item.caption, "No caption documented.")}</span>{Boolean(item.creative_asset_path) && <small className="creativePath">Post image · {String(item.creative_asset_path).split("/").at(-1)}</small>}</button>
              <span className="platformList">{contentPlatformForItem(item)}<small>{text(contentChannel(item)?.publishing_mode).replaceAll("_", " ")}</small></span>
              <span className="accountName">{contentAccountName(item)}</span>
              <button className="ownerLink" onClick={() => { const agent = agents.find((entry) => String(entry.id) === String(item.owner_agent_id)); if (agent) openAgent(agent); }}>{agentMap.get(String(item.owner_agent_id)) || "Unassigned"}</button>
              <span className={`statusPill s${text(item.status).replaceAll("_", "")}`}><i />{CONTENT_STATUS_LABELS[text(item.status)] || statusLabel(text(item.status))}</span>
              <span className="contentActions">
                {["idea", "revision_requested"].includes(text(item.status)) && <button onClick={() => void advanceContent(item, "research_ready")}>Research ready</button>}
                {text(item.status) === "research_ready" && <button onClick={() => void advanceContent(item, "drafting")}>Start draft</button>}
                {text(item.status) === "drafting" && <button onClick={() => void advanceContent(item, "ready_for_lupe")}>Send to Lupe</button>}
                {text(item.status) === "ready_for_lupe" && <button onClick={() => void sendContentToTito(item)}>Send to Tito</button>}
                {text(item.status) === "approved" && <button onClick={() => openContent(item)}>{item.publish_at ? "Schedule" : "Set schedule"}</button>}
                {text(item.status) === "scheduled" && <button onClick={() => void advanceContent(item, "publishing")}>Begin publishing</button>}
                {["publishing", "failed"].includes(text(item.status)) && <button onClick={() => openContent(item)}>Record result</button>}
                {text(item.status) === "published" && Boolean(item.final_url) && <a href={String(item.final_url)} target="_blank" rel="noreferrer">Open ↗</a>}
              </span>
              {contentPlatformForItem(item).toLowerCase() === "instagram" && <div className="mobilePostTools">
                <button className="outlineBtn" disabled={!text(item.caption, "").trim()} onClick={() => void copyContentCaption(item)}>Copy caption</button>
                <button className="outlineBtn" disabled={!contentPictureDownloadUrl(item) || downloadingContentId === String(item.id)} onClick={() => void downloadContentPicture(item)}>{downloadingContentId === String(item.id) ? "Preparing…" : "Download image"}</button>
                {contentUtilityStatus?.contentId === String(item.id) && <span className={`contentUtilityStatus ${contentUtilityStatus.kind}`} role="status" aria-live="polite">{contentUtilityStatus.message}</span>}
              </div>}
              {contentPlatformForItem(item).toLowerCase() === "instagram" && isContentReviewable(item.status) && <div className="mobileReviewActions">
                <button className="outlineBtn" disabled={reviewSaving} onClick={() => openContentRejection(item)}>Reject</button>
                <button className="liveBtn" disabled={reviewSaving} onClick={() => void reviewContent(item, "approved")}>Approve</button>
              </div>}
            </article>
          ))}
          {!filteredContent.length && <div className="opsEmpty">{contentItems.length ? "No content matches the selected filters." : "No content records yet. Create the first item and move it through research, production, Tito approval, and publishing."}</div>}
          </div>
        </section>

        <section className="deckPanel rejectedContent">
          <header className="panelHead"><div><span>Rejected</span><h2>Feedback Lupe must carry forward</h2></div><small>Permanent decision history</small></header>
          {rejectedFeedback.map((feedback) => {
            const item = contentItems.find((entry) => String(entry.id) === feedback.contentItemId);
            const owner = item ? agentMap.get(String(item.owner_agent_id)) : "Content owner";
            return <button key={feedback.id} className="rejectedContentRow" onClick={() => item && previewContent(item)}><span><b>{text(item?.title, "Archived content decision")}</b><small>{item ? contentPropertyName(item) : "Content"} · {dateLabel(feedback.decidedAt)} · For Lupe + {owner || "content owner"}</small></span><p>{feedback.reason}</p></button>;
          })}
          {!rejectedFeedback.length && <p className="opsEmpty">No rejected posts. Feedback will remain here for Lupe and the content owner after a post is returned.</p>}
        </section>
      </div>
    );
  }

  function renderLeads() {
    const visibleLeads = leads.filter((lead) => {
      const statusMatch = leadStatus === "all" || text(lead.status) === leadStatus;
      const laneMatch = lane === "all" || String(lead.assigned_agent_id) === lane;
      const searchMatch = !query.trim() || JSON.stringify(lead).toLowerCase().includes(query.trim().toLowerCase());
      return statusMatch && laneMatch && searchMatch;
    });
    const open = leads.filter((lead) => !["won", "lost", "spam"].includes(text(lead.status))).length;
    const followUps = leads.filter((lead) => lead.next_follow_up_at && new Date(String(lead.next_follow_up_at)) <= new Date() && !["won", "lost", "spam"].includes(text(lead.status))).length;
    return <div className="leadsWorkspace">
      <section className="metricDeck leadsMetrics"><div><span>Open inquiries</span><strong>{String(open).padStart(2, "0")}</strong><small>Active conversations</small></div><div><span>New</span><strong>{String(leads.filter((lead) => text(lead.status) === "new").length).padStart(2, "0")}</strong><small>Awaiting first response</small></div><div><span>Follow-ups due</span><strong>{String(followUps).padStart(2, "0")}</strong><small>Needs action now</small></div><div><span>Won</span><strong>{String(leads.filter((lead) => text(lead.status) === "won").length).padStart(2, "0")}</strong><small>Converted inquiries</small></div></section>
      <section className="deckPanel leadsLedger"><header className="panelHead"><div><span>Inquiry pipeline</span><h2>{visibleLeads.length} leads across your properties</h2></div><button className="liveBtn" onClick={() => openLead()}>New lead</button></header>
        <div className="leadFilters"><span>Status</span>{["all", "new", "contacted", "qualified", "proposal", "won", "lost"].map((status) => <button key={status} className={leadStatus === status ? "active" : ""} onClick={() => setLeadStatus(status)}>{statusLabel(status)}</button>)}</div>
        <div className="leadHead"><span>Contact</span><span>Property</span><span>Source</span><span>Inquiry</span><span>Owner</span><span>Status</span><span>Follow-up</span></div>
        {visibleLeads.map((lead) => <button className="leadRow" key={String(lead.id)} onClick={() => openLead(lead)}><span><b>{text(lead.contact_name)}</b><small>{text(lead.company, text(lead.email || lead.phone))}</small></span><span>{text(contentPropertyMap.get(String(lead.property_id))?.name, "Unassigned")}</span><span className="leadSource">{statusLabel(text(lead.source, "other"))}</span><span><b>{text(lead.subject, "General inquiry")}</b><small>{text(lead.inquiry)}</small></span><span>{agentMap.get(String(lead.assigned_agent_id)) || "Unassigned"}</span><span className={`statusPill s${text(lead.status).replace("_", "")}`}><i />{statusLabel(text(lead.status))}</span><span>{dateLabel(lead.next_follow_up_at)}</span></button>)}
        {!visibleLeads.length && <p className="opsEmpty">No inquiries match this view. Add a lead manually or connect a property intake source to the Leads API.</p>}
      </section>
    </div>;
  }

  function renderApprovals() {
    return (
      <div className="approvalDeck">
        {approvals.map((approval) => {
          const decided = text(approval.status, "pending") !== "pending";
          return (
            <article className={`deckPanel approvalCard ${decided ? "decided" : ""}`} key={String(approval.id)}>
              <header><div><span>{text(approval.status, "pending")}</span><h2>{text(approval.title, "Untitled decision")}</h2></div><b>{dateLabel(approval.due_at)}</b></header>
              <div className="approvalBody">
                <div><span>Summary</span><p>{text(approval.summary, "No summary documented.")}</p></div>
                <div><span>Recommendation</span><p>{text(approval.recommendation, "No recommendation documented.")}</p></div>
                <div><span>Risk</span><p>{text(approval.risk, "No risk documented.")}</p></div>
              </div>
              {!decided && <footer><button className="liveBtn" onClick={() => void decide(approval, "approved")}>Approve</button><button className="outlineBtn" onClick={() => void decide(approval, "changes_requested")}>Request changes</button><button className="ghostBtn" onClick={() => void decide(approval, "declined")}>Decline</button></footer>}
            </article>
          );
        })}
        {!approvals.length && <section className="deckPanel opsEmpty">No approval packages have been submitted.</section>}
      </div>
    );
  }

  return (
    <div className="deck">
      <header className="mobileCommandHeader">
        <div className="mobileStatus"><span>OCC · Secure</span><span className="mobileLink"><i />Link stable</span><span>100%</span></div>
        <div className="mobileTitleRow">
          {/* Vinext's dev runtime does not currently support next/image reliably. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <span className="mobileMark"><img src="/herzen-mark-white.png" alt="" /></span>
          <div><span className="liveLabel"><i />Live operation</span><h1>{VIEWS.find((item) => item.id === view)?.label}</h1></div>
          {view !== "workflows" && <button className="mobileNew" onClick={() => { setForm(EMPTY_FORM); setDrawer("task"); }}>New</button>}
        </div>
        <nav className="mobileViewStrip" aria-label="Operations views">
          {VIEWS.map((item) => (
            <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}>{item.label}</button>
          ))}
        </nav>
      </header>

      <aside className="rail">
        <div className="deckBrand">
          {/* Vinext's dev runtime does not currently support next/image reliably. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/herzen-logo-white.png" alt="Herzen Co." />
          <span>Operations Control Center</span>
        </div>
        <div className="rule" />
        <nav className="deckNav">
          {VIEWS.map((item) => (
            <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}>
              <i /><span>{item.label}</span><em>{item.id === "approvals" ? String(pendingApprovals.length).padStart(2, "0") : item.id === "list" ? String(tasks.length).padStart(2, "0") : item.id === "worklogs" ? String(workLogs.length).padStart(2, "0") : item.id === "content" ? String(contentItems.length).padStart(2, "0") : item.id === "leads" ? String(leads.filter((lead) => text(lead.status) === "new").length).padStart(2, "0") : ""}</em>
            </button>
          ))}
        </nav>
        <section className="roster">
          <span className="railLabel railLabelAction">Agent spaces <button onClick={() => openAgentForm()} aria-label="Create agent">+</button></span>
          {agents.map((agent) => (
            <button key={String(agent.id)} onClick={() => openAgent(agent)}>
              <span className="agentMark">{initials(agent.code || agent.name)}</span><span>{text(agent.name || agent.code)}</span><i className={text(agent.status, "active") === "active" ? "online" : ""} />
            </button>
          ))}
          <p><b>{overview?.viewer.display_name || "Lupe"}</b><br />{overview?.viewer.role || "operator"} access</p>
          <form action="/api/auth/logout" method="post"><button className="signOut" type="submit">Sign out</button></form>
        </section>
      </aside>

      <main className={`deckMain ${view === "workflows" ? "workflowDeckMain" : ""}`}>
        <header className={`deckHeader ${view === "workflows" ? "workflowDeckHeader" : ""}`}>
          <div className="titleBlock"><span className="liveLabel"><i />Live operation</span><h1>{VIEWS.find((item) => item.id === view)?.label}</h1><p>Direction enters here. Execution leaves documented.</p></div>
          {view !== "workflows" && <div className="headerActions">
            <label className="deckSearch"><span>/</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={view === "leads" ? "Search inquiries" : "Search instructions"} /></label>
            <button className="outlineBtn" onClick={() => setDrawer("brief")}>Daily brief</button>
            <button className="liveBtn" onClick={() => { setForm(EMPTY_FORM); setDrawer("task"); }}>New instruction</button>
          </div>}
          {view !== "workflows" && <div className="laneFilters"><span>Lane</span><button className={lane === "all" ? "active" : ""} onClick={() => setLane("all")}>All lanes</button>{agents.map((agent) => <button key={String(agent.id)} className={lane === String(agent.id) ? "active" : ""} onClick={() => setLane(String(agent.id))}>{text(agent.name || agent.code)}</button>)}{["command", "kanban", "list"].includes(view) && profiles.map((profile) => <button key={String(profile.user_id)} className={lane === `human:${String(profile.user_id)}` ? "active" : ""} onClick={() => setLane(`human:${String(profile.user_id)}`)}>{text(profile.display_name)}</button>)}</div>}
        </header>

        <section className={`deckContent ${view === "workflows" ? "workflowDeckContent" : ""}`}>
          {error && <div className="opsError">{error}</div>}
          {view === "command" && renderCommand()}
          {view === "list" && renderList()}
          {view === "kanban" && renderKanban()}
          {view === "worklogs" && renderWorkLogs()}
          {view === "content" && renderContent()}
          {view === "agentops" && renderAgentOps()}
          {view === "leads" && renderLeads()}
          {view === "approvals" && renderApprovals()}
          {view === "workflows" && session?.access_token && <WorkflowDesigner accessToken={session.access_token} />}
        </section>
      </main>

      <nav className="mobileBottomNav" aria-label="Primary mobile navigation">
        {([
          { id: "command" as View, label: "Today", badge: "" },
          { id: "list" as View, label: "Work", badge: String(tasks.length).padStart(2, "0") },
          { id: "content" as View, label: "Content", badge: String(contentItems.length).padStart(2, "0") },
          { id: "approvals" as View, label: "Queue", badge: String(pendingApprovals.length).padStart(2, "0") },
        ]).map((item) => (
          <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}>
            <i /><span>{item.label}</span>{item.badge && <em>{item.badge}</em>}
          </button>
        ))}
      </nav>

      {drawer && (
        <div className="drawerShade" onMouseDown={(event) => { if (event.target === event.currentTarget) setDrawer(null); }}>
          <aside className="deckDrawer">
            <button className="drawerClose" onClick={() => setDrawer(null)}>Close</button>
            {drawer === "task" && (
              <form onSubmit={(event) => { event.preventDefault(); void createTask(); }}>
                <span className="liveLabel"><i />New instruction</span><h2>Put direction into motion.</h2><p>Assign the lane, context, due date, and definition of done. Lupe and the agent roster will work from this record.</p>
                <label>Instruction<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="What needs to happen?" /></label>
                <label>Context<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
                <div className="formPair"><label>Assignee<select value={form.assignee} onChange={(event) => setForm({ ...form, assignee: event.target.value })}><option value="">Unassigned</option><optgroup label="People">{profiles.map((profile) => <option key={String(profile.user_id)} value={`human:${String(profile.user_id)}`}>{text(profile.display_name)}</option>)}</optgroup><optgroup label="Agents">{agents.map((agent) => <option key={String(agent.id)} value={`agent:${String(agent.id)}`}>{text(agent.name || agent.code)}</option>)}</optgroup></select></label>
                  <label>Project<select value={form.project_id} onChange={(event) => setForm({ ...form, project_id: event.target.value })}><option value="">General</option>{projects.map((project) => <option key={String(project.id)} value={String(project.id)}>{text(project.name || project.slug)}</option>)}</select></label></div>
                <div className="formPair"><label>Priority<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><label>Due<input type="datetime-local" value={form.due_at} onChange={(event) => setForm({ ...form, due_at: event.target.value })} /></label></div>
                <label>Definition of done<textarea value={form.definition_of_done} onChange={(event) => setForm({ ...form, definition_of_done: event.target.value })} /></label>
                <button className="liveBtn full" type="submit">Issue instruction</button>
              </form>
            )}
            {drawer === "contentPreview" && selectedContent && (
              <div className="contentPreviewDrawer">
                <span className="liveLabel"><i />Content preview</span>
                <h2>{text(selectedContent.title)}</h2>
                <div className="contentPreviewMeta">
                  <span>{contentPropertyName(selectedContent)}</span><span>{contentPlatformForItem(selectedContent)}</span><span>{contentTypeName(selectedContent)}</span><span>{CONTENT_STATUS_LABELS[text(selectedContent.status)] || statusLabel(text(selectedContent.status))}</span>
                </div>
                <article className={`contentPostMockup ${contentPlatformForItem(selectedContent).toLowerCase()}`}>
                  <header><span className="feedAvatar">{initials(contentPropertyName(selectedContent))}</span><div><b>{contentPropertyName(selectedContent)}</b><small>{contentAccountName(selectedContent)}</small></div><span>•••</span></header>
                  {contentPictureUrl(selectedContent) ? (
                    <figure className="contentCreative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={contentPictureUrl(selectedContent)} alt={`Creative for ${text(selectedContent.title)}`} />
                      <figcaption>Original stored creative · secure preview</figcaption>
                    </figure>
                  ) : (
                    <div className="contentCreativeEmpty"><span>{initials(contentPropertyName(selectedContent))}</span><b>{contentCreativePath(selectedContent) ? "Creative file unavailable" : "No creative attached yet"}</b><small>{contentCreativePath(selectedContent) ? `The record is attached to ${contentCreativePath(selectedContent)}, but Storage could not resolve it${contentMediaErrors[String(selectedContent.id)] ? `: ${contentMediaErrors[String(selectedContent.id)]}` : "."}` : "Add the final image in Edit content so it can be previewed and downloaded here."}</small></div>
                  )}
                  <div className="contentPostSignals" aria-hidden="true"><span>♡</span><span>○</span><span>⌁</span><span>▱</span></div>
                  <section className="contentPostCaption"><b>{contentAccountName(selectedContent)}</b><p>{text(selectedContent.caption, "No final publishing caption has been documented yet.")}</p></section>
                  {contentPlatformForItem(selectedContent).toLowerCase() === "instagram" && <div className="contentPostUtilityActions">
                    <button className="outlineBtn" disabled={!text(selectedContent.caption, "").trim()} onClick={() => void copyContentCaption(selectedContent)}>Copy caption</button>
                    <button className="liveBtn" disabled={!contentPictureDownloadUrl(selectedContent) || downloadingContentId === String(selectedContent.id)} onClick={() => void downloadContentPicture(selectedContent)}>{downloadingContentId === String(selectedContent.id) ? "Preparing download…" : "Download image"}</button>
                    {contentUtilityStatus?.contentId === String(selectedContent.id) && <span className={`contentUtilityStatus ${contentUtilityStatus.kind}`} role="status" aria-live="polite">{contentUtilityStatus.message}</span>}
                  </div>}
                </article>
                {Boolean(selectedContent.body) && <section className="previewCopy"><span>Draft / working copy</span><p>{text(selectedContent.body)}</p></section>}
                {Boolean(selectedContent.brief) && <section className="previewCopy"><span>Brief</span><p>{text(selectedContent.brief)}</p></section>}
                {contentPlatformForItem(selectedContent).toLowerCase() === "instagram" && isContentReviewable(selectedContent.status) && <section className="contentReviewDecision">
                  <span>Review decision</span>
                  <p>Approve this post for its documented date, or reject it and leave specific feedback for Lupe and {agentMap.get(String(selectedContent.owner_agent_id)) || "the content owner"}.</p>
                  <div><button className="outlineBtn" disabled={reviewSaving} onClick={() => openContentRejection(selectedContent)}>Reject</button><button className="liveBtn" disabled={reviewSaving} onClick={() => void reviewContent(selectedContent, "approved")}>{selectedContent.publish_at ? "Approve & schedule" : "Approve post"}</button></div>
                  {!selectedContent.publish_at && <small>Add a publish date before approval to place this post directly on the calendar.</small>}
                </section>}
                <dl className="contentPreviewFacts">
                  <div><dt>Publishes</dt><dd>{selectedContent.publish_at ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(String(selectedContent.publish_at))) : "Not scheduled"}</dd></div>
                  <div><dt>Account</dt><dd>{contentAccountName(selectedContent)}</dd></div>
                  <div><dt>Owner</dt><dd>{agentMap.get(String(selectedContent.owner_agent_id)) || "Unassigned"}</dd></div>
                  <div><dt>Distribution</dt><dd>{text(selectedContent.distribution_mode)}</dd></div>
                  <div><dt>Post image asset</dt><dd>{contentCreativePath(selectedContent) || "Not uploaded"}</dd></div>
                  <div><dt>Publication proof</dt><dd>{selectedContent.screenshot_path ? "Screenshot stored separately" : "Not recorded"}</dd></div>
                </dl>
                <div className="previewActions">
                  {Boolean(selectedContent.final_url) && <a className="outlineBtn" href={String(selectedContent.final_url)} target="_blank" rel="noreferrer">Open published post ↗</a>}
                  <button className="outlineBtn" onClick={() => openContent(selectedContent)}>Edit content</button>
                </div>
              </div>
            )}
            {drawer === "content" && (
              <form onSubmit={(event) => { event.preventDefault(); void saveContent(); }}>
                <span className="liveLabel"><i />Content operations</span>
                <h2>{selectedContent ? "Document the work and its outcome." : "Create a content instruction."}</h2>
                <p>Every item uses K2 research, passes through Lupe, and requires Tito approval before it can be scheduled or published.</p>
                <label>Title<input value={contentForm.title} onChange={(event) => setContentForm({ ...contentForm, title: event.target.value })} placeholder="What are we publishing?" /></label>
                <label>Brief<textarea value={contentForm.brief} onChange={(event) => setContentForm({ ...contentForm, brief: event.target.value })} placeholder="Audience, objective, offer, and required context." /></label>
                <label>Draft / final copy<textarea className="contentBodyField" value={contentForm.body} onChange={(event) => setContentForm({ ...contentForm, body: event.target.value })} placeholder="Document the working or final content here." /></label>
                <label>Caption<textarea className="contentCaptionField" value={contentForm.caption} onChange={(event) => setContentForm({ ...contentForm, caption: event.target.value })} placeholder="Exact final text that will publish with the post." /></label>
                <label>Post image
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setCreativeFile(event.target.files?.[0] || null)} />
                  <small>{creativeFile ? `${creativeFile.name} is ready to upload.` : contentForm.creative_asset_path ? `Stored asset: ${contentForm.creative_asset_path}` : "Upload the final pre-publication creative. Required for Bubbles n Salt posts owned by C-3PO."}</small>
                </label>
                <div className="formPair">
                  <label>Property
                    <select value={contentForm.property_id} onChange={(event) => {
                      const propertyId = event.target.value;
                      const availableChannels = channelsForProperty(propertyId);
                      setContentForm({
                        ...contentForm,
                        property_id: propertyId,
                        channel_id: availableChannels.some((channel) => String(channel.id) === contentForm.channel_id)
                          ? contentForm.channel_id
                          : String(availableChannels[0]?.id || ""),
                      });
                    }}>
                      <option value="">Choose property</option>
                      {contentProperties.map((property) => <option key={String(property.id)} value={String(property.id)} disabled={text(property.status) === "paused"}>{text(property.name)}{text(property.status) === "paused" ? " — paused" : ""}</option>)}
                    </select>
                  </label>
                  <label>Channel
                    <select value={contentForm.channel_id} onChange={(event) => setContentForm({ ...contentForm, channel_id: event.target.value })}>
                      <option value="">Choose channel</option>
                      {channelsForProperty(contentForm.property_id).map((channel) => <option key={String(channel.id)} value={String(channel.id)} disabled={text(channel.status) === "paused"}>{text(channel.platform)} · {text(channel.account_name)}</option>)}
                    </select>
                  </label>
                </div>
                <div className="formPair">
                  <label>Content type
                    <select value={contentForm.content_type_id} onChange={(event) => setContentForm({ ...contentForm, content_type_id: event.target.value })}>
                      <option value="">K2 to decide</option>
                      {contentTypes.filter((entry) => ["active", "proposed"].includes(text(entry.status))).map((entry) => <option key={String(entry.id)} value={String(entry.id)}>{text(entry.name)} · {text(entry.status)}</option>)}
                    </select>
                  </label>
                  <label>Distribution
                    <select value={contentForm.distribution_mode} onChange={(event) => {
                      const distribution = event.target.value as "organic" | "paid";
                      const preferredCode = distribution === "paid" ? "rex" : "c-3po";
                      const preferredOwner = agents.find((agent) => text(agent.code).toLowerCase() === preferredCode);
                      setContentForm({ ...contentForm, distribution_mode: distribution, owner_agent_id: String(preferredOwner?.id || contentForm.owner_agent_id) });
                    }}>
                      <option value="organic">Organic</option>
                      <option value="paid">Paid</option>
                    </select>
                  </label>
                </div>
                <div className="formPair">
                  <label>Owner
                    <select value={contentForm.owner_agent_id} onChange={(event) => setContentForm({ ...contentForm, owner_agent_id: event.target.value })}>
                      <option value="">Unassigned</option>
                      {agents.map((agent) => <option key={String(agent.id)} value={String(agent.id)}>{text(agent.name || agent.code)}</option>)}
                    </select>
                  </label>
                  <label>Status
                    <select value={contentForm.status} onChange={(event) => setContentForm({ ...contentForm, status: event.target.value })}>
                      {Object.entries(CONTENT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                </div>
                <label>Publish date and time<input type="datetime-local" value={contentForm.publish_at} onChange={(event) => setContentForm({ ...contentForm, publish_at: event.target.value })} /></label>
                <label>Final published URL<input type="url" value={contentForm.final_url} onChange={(event) => setContentForm({ ...contentForm, final_url: event.target.value })} placeholder="https://…" /></label>
                <label>Creative / publication image
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setEvidenceFile(event.target.files?.[0] || null)} />
                  <small>{selectedContent?.screenshot_path ? "The original image is securely stored. Select a new file only to replace it." : "Upload the highest-quality final image. It stays private and becomes downloadable from the content preview."}</small>
                </label>
                <label>Failure or blocker detail<textarea value={contentForm.failure_message} onChange={(event) => setContentForm({ ...contentForm, failure_message: event.target.value })} placeholder="Required when status is Failed." /></label>
                {selectedContent && (
                  <div className="contentHistory">
                    <span>Status history</span>
                    {contentHistory.filter((event) => String(event.content_item_id) === String(selectedContent.id)).slice(0, 8).map((event) => (
                      <div key={String(event.id)}><b>{event.from_status ? `${CONTENT_STATUS_LABELS[text(event.from_status)] || text(event.from_status)} → ` : ""}{CONTENT_STATUS_LABELS[text(event.to_status)] || text(event.to_status)}</b><small>{dateLabel(event.created_at)}</small></div>
                    ))}
                  </div>
                )}
                <button className="liveBtn full" type="submit">{selectedContent ? "Save content record" : "Create content record"}</button>
              </form>
            )}
            {drawer === "lead" && (
              <form onSubmit={(event) => { event.preventDefault(); void saveLead(); }}>
                <span className="liveLabel"><i />Inquiry intake</span><h2>{selectedLead ? "Move the conversation forward." : "Capture a new lead."}</h2><p>Every inquiry is tied to a property, owned by a lane, and tracked through a clear commercial pipeline.</p>
                <div className="formPair"><label>Contact name<input value={leadForm.contact_name} onChange={(event) => setLeadForm({ ...leadForm, contact_name: event.target.value })} /></label><label>Company<input value={leadForm.company} onChange={(event) => setLeadForm({ ...leadForm, company: event.target.value })} /></label></div>
                <div className="formPair"><label>Email<input type="email" value={leadForm.email} onChange={(event) => setLeadForm({ ...leadForm, email: event.target.value })} /></label><label>Phone<input type="tel" value={leadForm.phone} onChange={(event) => setLeadForm({ ...leadForm, phone: event.target.value })} /></label></div>
                <div className="formPair"><label>Property<select value={leadForm.property_id} onChange={(event) => setLeadForm({ ...leadForm, property_id: event.target.value })}><option value="">Unassigned</option>{contentProperties.map((property) => <option key={String(property.id)} value={String(property.id)}>{text(property.name)}</option>)}</select></label><label>Source<select value={leadForm.source} onChange={(event) => setLeadForm({ ...leadForm, source: event.target.value })}><option value="website">Website</option><option value="instagram">Instagram</option><option value="linkedin">LinkedIn</option><option value="email">Email</option><option value="referral">Referral</option><option value="phone">Phone</option><option value="other">Other</option></select></label></div>
                <label>Subject<input value={leadForm.subject} onChange={(event) => setLeadForm({ ...leadForm, subject: event.target.value })} /></label><label>Inquiry<textarea value={leadForm.inquiry} onChange={(event) => setLeadForm({ ...leadForm, inquiry: event.target.value })} /></label>
                <div className="formPair"><label>Owner<select value={leadForm.assigned_agent_id} onChange={(event) => setLeadForm({ ...leadForm, assigned_agent_id: event.target.value })}><option value="">Unassigned</option>{agents.map((agent) => <option key={String(agent.id)} value={String(agent.id)}>{text(agent.name || agent.code)}</option>)}</select></label><label>Status<select value={leadForm.status} onChange={(event) => setLeadForm({ ...leadForm, status: event.target.value })}>{["new", "contacted", "qualified", "proposal", "won", "lost", "spam"].map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label></div>
                <div className="formPair"><label>Priority<select value={leadForm.priority} onChange={(event) => setLeadForm({ ...leadForm, priority: event.target.value })}><option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><label>Next follow-up<input type="datetime-local" value={leadForm.next_follow_up_at} onChange={(event) => setLeadForm({ ...leadForm, next_follow_up_at: event.target.value })} /></label></div>
                <label>Internal notes<textarea value={leadForm.notes} onChange={(event) => setLeadForm({ ...leadForm, notes: event.target.value })} /></label><button className="liveBtn full" type="submit">{selectedLead ? "Save lead" : "Add to pipeline"}</button>
              </form>
            )}
            {drawer === "agentForm" && (
              <form onSubmit={(event) => { event.preventDefault(); void saveAgent(); }}>
                <span className="liveLabel"><i />Agent management</span><h2>{selectedAgent ? "Edit the operating lane." : "Add an agent to the roster."}</h2><p>Define the identity, charter, standing instructions, and capabilities Lupe will coordinate.</p>
                <div className="formPair"><label>Code<input value={agentForm.code} onChange={(event) => setAgentForm({ ...agentForm, code: event.target.value })} placeholder="K2" /></label><label>Display name<input value={agentForm.name} onChange={(event) => setAgentForm({ ...agentForm, name: event.target.value })} /></label></div>
                <div className="formPair"><label>Role<input value={agentForm.role} onChange={(event) => setAgentForm({ ...agentForm, role: event.target.value })} /></label><label>Status<select value={agentForm.status} onChange={(event) => setAgentForm({ ...agentForm, status: event.target.value })}><option value="active">Active</option><option value="paused">Paused</option><option value="retired">Retired</option></select></label></div>
                <label>Operating lane<input value={agentForm.lane} onChange={(event) => setAgentForm({ ...agentForm, lane: event.target.value })} /></label><label>Charter<textarea value={agentForm.charter} onChange={(event) => setAgentForm({ ...agentForm, charter: event.target.value })} /></label><label>Standing instructions<textarea value={agentForm.instructions} onChange={(event) => setAgentForm({ ...agentForm, instructions: event.target.value })} /></label>
                <label>Capabilities <small>One per line</small><textarea value={agentForm.capabilities} onChange={(event) => setAgentForm({ ...agentForm, capabilities: event.target.value })} /></label><button className="liveBtn full" type="submit">{selectedAgent ? "Save agent" : "Create agent"}</button>
              </form>
            )}
            {drawer === "workLog" && (
              <form onSubmit={(event) => { event.preventDefault(); void saveWorkLog(); }}>
                <span className="liveLabel"><i />Execution evidence</span><h2>Document work while it is fresh.</h2><p>Connect the record to an agent and, when relevant, the instruction it advances.</p>
                <div className="formPair"><label>Agent<select value={workLogForm.agent_id} onChange={(event) => setWorkLogForm({ ...workLogForm, agent_id: event.target.value })}><option value="">Choose agent</option>{agents.map((agent) => <option key={String(agent.id)} value={String(agent.id)}>{text(agent.name || agent.code)}</option>)}</select></label><label>Type<select value={workLogForm.entry_type} onChange={(event) => setWorkLogForm({ ...workLogForm, entry_type: event.target.value })}>{["note", "progress", "decision", "blocker", "deliverable", "evidence"].map((entry) => <option key={entry}>{entry}</option>)}</select></label></div>
                <label>Instruction<select value={workLogForm.task_id} onChange={(event) => setWorkLogForm({ ...workLogForm, task_id: event.target.value })}><option value="">Agent lane / no instruction</option>{tasks.map((task) => <option key={String(task.id)} value={String(task.id)}>{text(task.title)}</option>)}</select></label><label>Title<input value={workLogForm.title} onChange={(event) => setWorkLogForm({ ...workLogForm, title: event.target.value })} /></label><label>Narrative<textarea value={workLogForm.body} onChange={(event) => setWorkLogForm({ ...workLogForm, body: event.target.value })} /></label>
                <label>Artifact references <small>One URL or path per line</small><textarea value={workLogForm.artifacts} onChange={(event) => setWorkLogForm({ ...workLogForm, artifacts: event.target.value })} /></label><button className="liveBtn full" type="submit">Record work</button>
              </form>
            )}
            {drawer === "dailyUpdate" && (
              <form onSubmit={(event) => { event.preventDefault(); void saveDailyUpdate(); }}>
                <span className="liveLabel"><i />Daily reporting</span><h2>Account for the operating lane.</h2><p>Submitting again for the same agent and business date updates the existing report.</p>
                <div className="formPair"><label>Agent<select value={dailyUpdateForm.agent_id} onChange={(event) => setDailyUpdateForm({ ...dailyUpdateForm, agent_id: event.target.value })}><option value="">Choose agent</option>{agents.map((agent) => <option key={String(agent.id)} value={String(agent.id)}>{text(agent.name || agent.code)}</option>)}</select></label><label>Business date<input type="date" value={dailyUpdateForm.update_date} onChange={(event) => setDailyUpdateForm({ ...dailyUpdateForm, update_date: event.target.value })} /></label></div>
                <label>Health<select value={dailyUpdateForm.health} onChange={(event) => setDailyUpdateForm({ ...dailyUpdateForm, health: event.target.value })}><option value="on_track">On track</option><option value="at_risk">At risk</option><option value="blocked">Blocked</option></select></label><label>Summary<textarea value={dailyUpdateForm.summary} onChange={(event) => setDailyUpdateForm({ ...dailyUpdateForm, summary: event.target.value })} /></label>
                {([['completed','Completed'],['blockers','Blockers'],['next_steps','Next steps'],['asks','Asks']] as const).map(([field, label]) => <label key={field}>{label} <small>One per line</small><textarea value={dailyUpdateForm[field]} onChange={(event) => setDailyUpdateForm({ ...dailyUpdateForm, [field]: event.target.value })} /></label>)}
                <button className="liveBtn full" type="submit">Save daily update</button>
              </form>
            )}
            {drawer === "agent" && selectedAgent && (() => {
              const mine = tasks.filter((task) => String(task.owner_agent_id) === String(selectedAgent.id));
              const update = latestUpdate.get(String(selectedAgent.id));
              return <div><div className="agentDrawerHead"><span className="agentMark large">{initials(selectedAgent.code || selectedAgent.name)}</span><div><span className="liveLabel"><i />Agent space</span><h2>{text(selectedAgent.name || selectedAgent.code)}</h2></div></div><p>{text(selectedAgent.charter || selectedAgent.lane, "No charter documented.")}</p><div className="drawerActionRow"><button className="outlineBtn" onClick={() => openAgentForm(selectedAgent)}>Edit agent</button><button className="outlineBtn" onClick={() => openWorkLog(String(selectedAgent.id))}>Add work log</button><button className="liveBtn" onClick={() => openDailyUpdate(String(selectedAgent.id))}>Daily update</button></div>
                <div className="agentStats"><div><b>{mine.filter((task) => !["done", "cancelled"].includes(taskStatus(task))).length}</b><span>Open</span></div><div><b>{mine.filter((task) => taskStatus(task) === "review").length}</b><span>Review</span></div><div><b>{mine.filter((task) => taskStatus(task) === "done").length}</b><span>Closed</span></div></div>
                <h3>Instructions</h3>{mine.map((task) => <button className="drawerTask" key={String(task.id)} onClick={() => { setLane(String(selectedAgent.id)); setView("list"); setDrawer(null); }}><span>{statusLabel(taskStatus(task))}</span><b>{text(task.title)}</b><small>{dateLabel(task.due_at)}</small></button>)}
                <h3>Latest daily update</h3>{update ? <><div className="briefLine"><span>Summary</span><p>{text(update.summary)}</p></div><div className="briefLine"><span>Blockers</span><p>{Array.isArray(update.blockers) ? update.blockers.join(" · ") : text(update.blockers, "None reported")}</p></div><div className="briefLine"><span>Next</span><p>{Array.isArray(update.next_steps) ? update.next_steps.join(" · ") : text(update.next_steps, "Not reported")}</p></div></> : <p>No daily update has been submitted.</p>}</div>;
            })()}
            {drawer === "brief" && (
              <div><span className="liveLabel"><i />Daily brief</span><h2>Operational state at a glance.</h2><p>Generated from the live instruction ledger, approval queue, and most recent agent reports.</p>
                <div className="briefLine"><span>Open</span><p>{activeTasks.length} instructions remain open across {agents.length} agent lanes.</p></div>
                <div className="briefLine"><span>Due today</span><p>{dueToday.length || contentDueToday.length ? [...contentDueToday, ...dueToday].map((item) => text(item.title)).join(" · ") : "Nothing is due before close."}</p></div>
                <div className="briefLine"><span>Decisions</span><p>{pendingApprovals.length ? `${pendingApprovals.length} approval packages await direction.` : "The approval queue is clear."}</p></div>
                <div className="briefLine"><span>Reporting</span><p>{reporting} of {agents.length} agents have a documented update.</p></div>
                <div className="briefRecommendation"><span>Lupe recommendation</span><p>{pendingApprovals.length ? "Clear the approval queue first, then close the oldest review-stage instructions." : "Focus the team on today’s due work and close review-stage instructions."}</p></div>
              </div>
            )}
          </aside>
        </div>
      )}
      {rejectingContent && (
        <div className="contentRejectionShade" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !reviewSaving) {
            setRejectingContent(null);
            setRejectionReason("");
            setError("");
          }
        }}>
          <section className="contentRejectionDialog" role="dialog" aria-modal="true" aria-labelledby="content-rejection-title" aria-describedby="content-rejection-help">
            <form onSubmit={(event) => { event.preventDefault(); void reviewContent(rejectingContent, "changes_requested", rejectionReason); }}>
              <span className="liveLabel"><i />Return for revision</span>
              <h2 id="content-rejection-title">Why are you rejecting this post?</h2>
              <p id="content-rejection-help">Be specific. This feedback becomes permanent review history for Lupe and {agentMap.get(String(rejectingContent.owner_agent_id)) || "the content owner"}, so they can revise the post without repeating the mistake.</p>
              <label>Rejection reason<textarea autoFocus required value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="What needs to change, and what should the agents remember next time?" /></label>
              {error && <p className="contentRejectionError" role="alert">{error}</p>}
              <footer><button type="button" className="ghostBtn" disabled={reviewSaving} onClick={() => { setRejectingContent(null); setRejectionReason(""); setError(""); }}>Cancel</button><button type="submit" className="liveBtn" disabled={reviewSaving || !rejectionReason.trim()}>{reviewSaving ? "Saving…" : "Reject post"}</button></footer>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
