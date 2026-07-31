"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "../utils/supabase/client";
import { WorkflowDesigner } from "./workflows/workflow-designer";

type View = "command" | "kanban" | "list" | "worklogs" | "content" | "leads" | "approvals" | "workflows";
type RecordValue = Record<string, unknown>;

type Viewer = {
  display_name: string;
  role: string;
};

type Overview = {
  viewer: Viewer;
  agents: RecordValue[];
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
  owner_agent_id: string;
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

const EMPTY_FORM: TaskForm = {
  title: "",
  description: "",
  owner_agent_id: "",
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

export function CommandCenter() {
  const supabase = useMemo(() => createClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [approvals, setApprovals] = useState<RecordValue[]>([]);
  const [updates, setUpdates] = useState<RecordValue[]>([]);
  const [workLogs, setWorkLogs] = useState<RecordValue[]>([]);
  const [contentItems, setContentItems] = useState<RecordValue[]>([]);
  const [contentProperties, setContentProperties] = useState<RecordValue[]>([]);
  const [contentChannels, setContentChannels] = useState<RecordValue[]>([]);
  const [contentTypes, setContentTypes] = useState<RecordValue[]>([]);
  const [contentHistory, setContentHistory] = useState<RecordValue[]>([]);
  const [view, setView] = useState<View>("command");
  const [lane, setLane] = useState("all");
  const [query, setQuery] = useState("");
  const [contentPlatform, setContentPlatform] = useState("all");
  const [contentAccount, setContentAccount] = useState("all");
  const [contentType, setContentType] = useState("all");
  const [todayLabel, setTodayLabel] = useState("Today");
  const [drawer, setDrawer] = useState<"task" | "brief" | "agent" | "agentForm" | "workLog" | "dailyUpdate" | "lead" | "content" | null>(null);
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
        leadsResponse,
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
        fetch("/api/v1/leads?limit=500&offset=0", { headers }),
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
        leadsPayload,
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
        leadsResponse.json(),
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
      setLeads(leadsResponse.ok ? leadsPayload.data.items : []);
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
      if (form.owner_agent_id) payload.owner_agent_id = form.owner_agent_id;
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
  const agentMap = useMemo(
    () => new Map(agents.map((agent) => [String(agent.id), text(agent.name || agent.code)])),
    [agents],
  );
  const projectMap = useMemo(
    () => new Map(projects.map((project) => [String(project.id), text(project.name || project.slug)])),
    [projects],
  );
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
      const laneMatch = lane === "all" || String(task.owner_agent_id) === lane;
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

  function openContent(item?: RecordValue) {
    const nextItem = item || null;
    setSelectedContent(nextItem);
    setEvidenceFile(null);
    setContentForm(nextItem ? {
      title: text(nextItem.title, ""),
      brief: text(nextItem.brief, ""),
      body: text(nextItem.body, ""),
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

    try {
      setError("");
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
                return <div key={column.id}><header><span>{column.label}</span><b>{String(items.length).padStart(2, "0")}</b></header>{items.slice(0, 2).map((task) => <button key={String(task.id)} onClick={() => setView("kanban")}><b>{text(task.title)}</b><small>{agentMap.get(String(task.owner_agent_id)) || "Unassigned"}</small></button>)}{!items.length && <p>Clear</p>}</div>;
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
                <div className="dueRow" key={String(task.id)}><i /><span><b>{text(task.title)}</b><small>{agentMap.get(String(task.owner_agent_id)) || "Unassigned"}</small></span></div>
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
            <button className="ownerLink" onClick={() => { const agent = agents.find((item) => String(item.id) === String(task.owner_agent_id)); if (agent) openAgent(agent); }}>{agentMap.get(String(task.owner_agent_id)) || "Unassigned"}</button>
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
                    <footer><span><span className="agentMark">{initials(agentMap.get(String(task.owner_agent_id)))}</span>{agentMap.get(String(task.owner_agent_id)) || "Unassigned"}</span>
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
    return (
      <div className="contentWorkspace">
        <section className="metricDeck contentMetrics">
          <div><span>Scheduled</span><strong>{String(scheduled.length).padStart(2, "0")}</strong><small>Approved content moving toward publication</small></div>
          <div><span>With Tito</span><strong>{String(inReview.length).padStart(2, "0")}</strong><small>Lupe-managed review and revision packages</small></div>
          <div><span>Published</span><strong>{String(published.length).padStart(2, "0")}</strong><small>Final URL and required evidence documented</small></div>
          <div><span>Properties</span><strong>{contentProperties.filter((property) => text(property.status) === "active").length}</strong><small>{contentProperties.filter((property) => text(property.status) === "paused").length} property paused</small></div>
        </section>

        <section className="deckPanel contentSchedule">
          <header className="panelHead"><div><span>Publishing desk</span><h2>Content operations</h2></div><button className="liveBtn" onClick={() => openContent()}>New content</button></header>
          <div className="contentFilters">
            <label>Platform<select value={contentPlatform} onChange={(event) => setContentPlatform(event.target.value)}><option value="all">All platforms</option>{platforms.map((platform) => <option key={platform} value={platform}>{platform}</option>)}</select></label>
            <label>Account<select value={contentAccount} onChange={(event) => setContentAccount(event.target.value)}><option value="all">All accounts</option>{accounts.map((account) => <option key={account} value={account}>{account}</option>)}</select></label>
            <label>Content type<select value={contentType} onChange={(event) => setContentType(event.target.value)}><option value="all">All content types</option>{types.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
            {(contentPlatform !== "all" || contentAccount !== "all" || contentType !== "all") && <button className="ghostBtn" onClick={() => { setContentPlatform("all"); setContentAccount("all"); setContentType("all"); }}>Clear filters</button>}
          </div>
          <div className="contentHead"><span>Date</span><span>Content</span><span>Platform</span><span>Account</span><span>Owner</span><span>Stage</span><span /></div>
          {filteredContent.map((item) => (
            <article key={String(item.id)}>
              <time>{item.publish_at ? <><b>{dateLabel(item.publish_at)}</b><small>{new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(String(item.publish_at)))}</small></> : <><b>Unscheduled</b><small>Awaiting approval</small></>}</time>
              <button className="contentTitle contentTitleButton" onClick={() => openContent(item)}><b>{text(item.title)}</b><small>{contentPropertyName(item)} · {contentTypeName(item)} · {text(item.distribution_mode)}</small></button>
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
            </article>
          ))}
          {!filteredContent.length && <div className="opsEmpty">{contentItems.length ? "No content matches the selected filters." : "No content records yet. Create the first item and move it through research, production, Tito approval, and publishing."}</div>}
        </section>

        <section className="deckPanel propertyPanel">
          <header className="panelHead"><div><span>Properties</span><h2>Publishing destinations</h2></div><small>Configured operating map</small></header>
          <div className="propertyGrid">
            {contentProperties.map((property) => (
              <article key={String(property.id)} className={text(property.status) === "paused" ? "paused" : ""}>
                <header><b>{text(property.name)}</b><span>{text(property.status)}</span></header>
                {contentChannels.filter((channel) => String(channel.property_id) === String(property.id)).map((channel) => (
                  <div key={String(channel.id)}><span>{text(channel.platform)}</span><small>{text(channel.publishing_mode).replaceAll("_", " ")}</small></div>
                ))}
                <p>{text(property.notes, "No operating note.")}</p>
              </article>
            ))}
          </div>
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
          {view !== "workflows" && <div className="laneFilters"><span>Lane</span><button className={lane === "all" ? "active" : ""} onClick={() => setLane("all")}>All lanes</button>{agents.map((agent) => <button key={String(agent.id)} className={lane === String(agent.id) ? "active" : ""} onClick={() => setLane(String(agent.id))}>{text(agent.name || agent.code)}</button>)}</div>}
        </header>

        <section className={`deckContent ${view === "workflows" ? "workflowDeckContent" : ""}`}>
          {error && <div className="opsError">{error}</div>}
          {view === "command" && renderCommand()}
          {view === "list" && renderList()}
          {view === "kanban" && renderKanban()}
          {view === "worklogs" && renderWorkLogs()}
          {view === "content" && renderContent()}
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
                <div className="formPair"><label>Agent<select value={form.owner_agent_id} onChange={(event) => setForm({ ...form, owner_agent_id: event.target.value })}><option value="">Unassigned</option>{agents.map((agent) => <option key={String(agent.id)} value={String(agent.id)}>{text(agent.name || agent.code)}</option>)}</select></label>
                  <label>Project<select value={form.project_id} onChange={(event) => setForm({ ...form, project_id: event.target.value })}><option value="">General</option>{projects.map((project) => <option key={String(project.id)} value={String(project.id)}>{text(project.name || project.slug)}</option>)}</select></label></div>
                <div className="formPair"><label>Priority<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><label>Due<input type="datetime-local" value={form.due_at} onChange={(event) => setForm({ ...form, due_at: event.target.value })} /></label></div>
                <label>Definition of done<textarea value={form.definition_of_done} onChange={(event) => setForm({ ...form, definition_of_done: event.target.value })} /></label>
                <button className="liveBtn full" type="submit">Issue instruction</button>
              </form>
            )}
            {drawer === "content" && (
              <form onSubmit={(event) => { event.preventDefault(); void saveContent(); }}>
                <span className="liveLabel"><i />Content operations</span>
                <h2>{selectedContent ? "Document the work and its outcome." : "Create a content instruction."}</h2>
                <p>Every item uses K2 research, passes through Lupe, and requires Tito approval before it can be scheduled or published.</p>
                <label>Title<input value={contentForm.title} onChange={(event) => setContentForm({ ...contentForm, title: event.target.value })} placeholder="What are we publishing?" /></label>
                <label>Brief<textarea value={contentForm.brief} onChange={(event) => setContentForm({ ...contentForm, brief: event.target.value })} placeholder="Audience, objective, offer, and required context." /></label>
                <label>Draft / final copy<textarea className="contentBodyField" value={contentForm.body} onChange={(event) => setContentForm({ ...contentForm, body: event.target.value })} placeholder="Document the working or final content here." /></label>
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
                <label>Publication screenshot
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setEvidenceFile(event.target.files?.[0] || null)} />
                  <small>{selectedContent?.screenshot_path ? "Screenshot evidence is already stored. Select a new file only to replace the recorded path." : "Required when an Instagram item is marked published. Stored privately in Supabase."}</small>
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
    </div>
  );
}
