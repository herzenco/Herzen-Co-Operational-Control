"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type RecordValue = Record<string, unknown>;
type TimelineEntry = RecordValue & { _kind: "activity" | "work_log" };

type TaskDetailDialogProps = {
  taskId: string;
  accessToken: string;
  agents: RecordValue[];
  profiles: RecordValue[];
  projects: RecordValue[];
  onClose: () => void;
};

const SENSITIVE_KEY = /(secret|password|private[_-]?key|access[_-]?token|refresh[_-]?token|api[_-]?key|credential(?!_id))/i;

function text(value: unknown, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function dateTime(value: unknown) {
  if (!value) return "Not set";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(date);
}

function safeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as RecordValue).map(([key, child]) => [key, SENSITIVE_KEY.test(key) ? "[redacted]" : safeValue(child)]));
  }
  return value;
}

function StructuredValue({ value, empty = "None documented" }: { value: unknown; empty?: string }) {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return <p className="taskDetailEmpty">{empty}</p>;
  if (typeof value === "string") return <p className="taskDetailProse">{value}</p>;
  return <pre className="taskDetailStructured">{JSON.stringify(safeValue(value), null, 2)}</pre>;
}

export function TaskDetailDialog({ taskId, accessToken, agents, profiles, projects, onClose }: TaskDetailDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [task, setTask] = useState<RecordValue | null>(null);
  const [activity, setActivity] = useState<RecordValue[]>([]);
  const [workLogs, setWorkLogs] = useState<RecordValue[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "not-found" | "unauthorized" | "error">("loading");
  const [message, setMessage] = useState("");
  const [copyState, setCopyState] = useState("");

  const agentMap = useMemo(() => new Map(agents.map((agent) => [String(agent.id), text(agent.name || agent.code)])), [agents]);
  const profileMap = useMemo(() => new Map(profiles.map((profile) => [String(profile.user_id), text(profile.display_name)])), [profiles]);
  const projectMap = useMemo(() => new Map(projects.map((project) => [String(project.id), text(project.name || project.slug)])), [projects]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const headers = { Authorization: `Bearer ${accessToken}` };
    void Promise.all([
      fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}`, { headers, cache: "no-store" }),
      fetch(`/api/v1/activity?entity_type=tasks&entity_id=${encodeURIComponent(taskId)}&limit=200&offset=0`, { headers, cache: "no-store" }),
      fetch(`/api/v1/work-logs?task_id=${encodeURIComponent(taskId)}&limit=200&offset=0`, { headers, cache: "no-store" }),
    ]).then(async ([taskResponse, activityResponse, logsResponse]) => {
      const taskPayload = await taskResponse.json().catch(() => null);
      if (cancelled) return;
      if (taskResponse.status === 401 || taskResponse.status === 403) {
        setState("unauthorized");
        setMessage(taskPayload?.error?.message || "Your OCC session cannot access this ticket.");
        return;
      }
      if (taskResponse.status === 404) {
        setState("not-found");
        setMessage("No production OCC ticket exists with this exact ID.");
        return;
      }
      if (!taskResponse.ok) {
        setState("error");
        setMessage(taskPayload?.error?.message || `The ticket API returned ${taskResponse.status}.`);
        return;
      }
      const [activityPayload, logsPayload] = await Promise.all([
        activityResponse.json().catch(() => null),
        logsResponse.json().catch(() => null),
      ]);
      if (cancelled) return;
      setTask(taskPayload.data);
      setActivity(activityResponse.ok ? activityPayload?.data?.items || [] : []);
      setWorkLogs(logsResponse.ok ? logsPayload?.data?.items || [] : []);
      setState("ready");
    }).catch((loadError: unknown) => {
      if (cancelled) return;
      setState("error");
      setMessage(loadError instanceof Error ? loadError.message : "The ticket could not be loaded.");
    });
    return () => { cancelled = true; };
  }, [accessToken, taskId]);

  useEffect(() => {
    function trapFocus(event: KeyboardEvent) {
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", trapFocus);
    return () => document.removeEventListener("keydown", trapFocus);
  }, []);

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState(`${label} copied`);
    } catch {
      setCopyState(`Could not copy ${label.toLowerCase()}`);
    }
    window.setTimeout(() => setCopyState(""), 1800);
  }

  const ticketUrl = typeof window === "undefined" ? `/tasks/${taskId}` : `${window.location.origin}/tasks/${taskId}`;
  const assignee = task?.owner_agent_id ? agentMap.get(String(task.owner_agent_id)) : task?.assigned_user_id ? profileMap.get(String(task.assigned_user_id)) : null;
  const creator = task?.created_by ? profileMap.get(String(task.created_by)) || String(task.created_by) : "Machine/API or unavailable";

  return (
    <dialog ref={dialogRef} className="taskDetailDialog" aria-labelledby="task-detail-title" aria-describedby="task-detail-status" onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={onClose}>
      <div className="taskDetailShell">
        <header className="taskDetailHeader">
          <div><span>Production OCC ticket</span><h2 id="task-detail-title">{task ? text(task.title, "Untitled ticket") : "Ticket detail"}</h2><p id="task-detail-status" role="status" aria-live="polite">{state === "loading" ? `Loading exact record ${taskId}…` : state === "ready" ? `Exact production record ${taskId}` : message}</p></div>
          <button ref={closeButtonRef} className="drawerClose" onClick={onClose} aria-label="Close ticket detail">Close</button>
        </header>

        {state === "loading" && <div className="taskDetailState"><span className="taskDetailSpinner" aria-hidden="true" /><b>Loading ticket</b><p>Reading the exact ID from the authenticated OCC API.</p></div>}
        {state !== "loading" && state !== "ready" && <div className="taskDetailState error"><b>{state === "not-found" ? "Ticket not found" : state === "unauthorized" ? "Access required" : "Could not load ticket"}</b><p>{message}</p>{state === "unauthorized" && <a className="liveBtn" href={`/login?next=${encodeURIComponent(`/tasks/${taskId}`)}`}>Sign in again</a>}</div>}

        {state === "ready" && task && <div className="taskDetailBody">
          <section className="taskDetailActions" aria-label="Ticket actions">
            <button className="outlineBtn" onClick={() => void copy(taskId, "Ticket ID")}>Copy ID</button>
            <button className="outlineBtn" onClick={() => void copy(ticketUrl, "Ticket link")}>Copy link</button>
            <a className="liveBtn" href={ticketUrl} target="_blank" rel="noopener noreferrer">Open stable link</a>
            {copyState && <span role="status" aria-live="polite">{copyState}</span>}
          </section>

          <dl className="taskDetailFacts">
            <div><dt>ID</dt><dd className="taskDetailId">{taskId}</dd></div>
            <div><dt>Status</dt><dd>{text(task.status, "inbox").replaceAll("_", " ")}</dd></div>
            <div><dt>Priority</dt><dd>{text(task.priority, "medium")}</dd></div>
            <div><dt>Project</dt><dd>{task.project_id ? projectMap.get(String(task.project_id)) || String(task.project_id) : "General"}</dd></div>
            <div><dt>Assignee</dt><dd>{assignee || "Unassigned"}</dd></div>
            <div><dt>Creator / actor</dt><dd>{creator}</dd></div>
            <div><dt>Due</dt><dd>{dateTime(task.due_at)}</dd></div>
            <div><dt>Created</dt><dd>{dateTime(task.created_at)}</dd></div>
            <div><dt>Updated</dt><dd>{dateTime(task.updated_at)}</dd></div>
            <div><dt>Completed</dt><dd>{dateTime(task.completed_at)}</dd></div>
          </dl>

          <section className="taskDetailSection"><h3>Description</h3><StructuredValue value={task.description} empty="No description documented." /></section>
          <section className="taskDetailSection"><h3>Definition of done</h3><StructuredValue value={task.definition_of_done} empty="No completion criteria documented." /></section>
          <div className="taskDetailSplit">
            <section className="taskDetailSection"><h3>Dependencies</h3><StructuredValue value={task.dependencies} /></section>
            <section className="taskDetailSection"><h3>Tags</h3>{Array.isArray(task.tags) && task.tags.length ? <div className="taskDetailTags">{task.tags.map((tag) => <span key={String(tag)}>{String(tag)}</span>)}</div> : <p className="taskDetailEmpty">No tags</p>}</section>
          </div>
          <section className="taskDetailSection"><h3>Metadata</h3><StructuredValue value={task.metadata} empty="No metadata documented." /></section>

          <section className="taskDetailSection"><h3>Activity and work history</h3>
            <div className="taskActivityList">
              {([...activity.map((event): TimelineEntry => ({ ...event, _kind: "activity" })), ...workLogs.map((log): TimelineEntry => ({ ...log, _kind: "work_log" }))])
                .sort((a, b) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime())
                .map((entry) => {
                  const eventAgentId = (entry.after_data as RecordValue | undefined)?.agent_id;
                  const actor = entry._kind === "work_log" ? agentMap.get(String(entry.agent_id)) || "Unknown agent" : eventAgentId ? agentMap.get(String(eventAgentId)) || `Agent ${String(eventAgentId)}` : entry.actor_user_id ? profileMap.get(String(entry.actor_user_id)) || "OCC member" : "OCC system";
                  return <article key={`${entry._kind}-${String(entry.id)}`}><header><b>{entry._kind === "work_log" ? text(entry.title, text(entry.entry_type, "Work log")) : text(entry.action, "activity").replaceAll("_", " ")}</b><time>{dateTime(entry.created_at)}</time></header><p>{entry._kind === "work_log" ? text(entry.body, "No narrative documented.") : `${actor} recorded this ${text(entry.action, "event").replaceAll("_", " ")}.`}</p>{Boolean(eventAgentId) && <small>Machine attribution: {actor}{(entry.after_data as RecordValue | undefined)?.credential_id ? ` · credential ID ${String((entry.after_data as RecordValue).credential_id)}` : ""}</small>}</article>;
                })}
              {!activity.length && !workLogs.length && <p className="taskDetailEmpty">No related activity or work logs are available.</p>}
            </div>
          </section>
        </div>}
      </div>
    </dialog>
  );
}
