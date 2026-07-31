"use client";

import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "../utils/supabase/client";

type ResourceName =
  | "agents"
  | "projects"
  | "tasks"
  | "work-logs"
  | "daily-updates"
  | "approvals"
  | "activity";

type FieldKind = "text" | "textarea" | "select" | "date" | "json" | "list";

type FieldConfig = {
  name: string;
  label: string;
  kind: FieldKind;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  helper?: string;
};

type ResourceConfig = {
  name: ResourceName;
  label: string;
  description: string;
  mutable: boolean;
  singular: string;
  fields: FieldConfig[];
};

type Viewer = {
  display_name: string;
  role: string;
};

type OverviewCounts = {
  agents: number;
  projects: number;
  tasks: number;
  open_tasks: number;
  pending_approvals: number;
};

type OverviewData = {
  viewer: Viewer;
  agents: Record<string, unknown>[];
  projects: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  counts: OverviewCounts;
};

type CollectionResponse = {
  data: {
    items: Record<string, unknown>[];
    count: number;
    limit: number;
    offset: number;
  };
};

type ApiError = {
  error?: {
    message?: string;
  };
};

type FormState = Record<string, string>;

const RESOURCE_CONFIGS: ResourceConfig[] = [
  {
    name: "agents",
    label: "Agents",
    singular: "agent",
    description: "Roster, permissions mapping, reporting lines, and operating scope.",
    mutable: true,
    fields: [
      { name: "code", label: "Code", kind: "text", placeholder: "c3po" },
      { name: "name", label: "Name", kind: "text", placeholder: "C-3PO" },
      { name: "role", label: "Role", kind: "text", placeholder: "Content operator" },
      { name: "lane", label: "Lane", kind: "text", placeholder: "Content" },
      {
        name: "status",
        label: "Status",
        kind: "select",
        options: [
          { value: "active", label: "Active" },
          { value: "paused", label: "Paused" },
          { value: "retired", label: "Retired" },
        ],
      },
      { name: "charter", label: "Charter", kind: "textarea" },
      { name: "instructions", label: "Instructions", kind: "textarea" },
      { name: "capabilities", label: "Capabilities", kind: "list", helper: "One item per line." },
      { name: "metadata", label: "Metadata", kind: "json", helper: "Valid JSON object or array." },
      { name: "auth_user_id", label: "Auth User ID", kind: "text" },
      { name: "reports_to", label: "Reports To", kind: "select" },
    ],
  },
  {
    name: "projects",
    label: "Projects",
    singular: "project",
    description: "Operating initiatives, ownership, objectives, and project status.",
    mutable: true,
    fields: [
      { name: "name", label: "Name", kind: "text" },
      { name: "slug", label: "Slug", kind: "text", placeholder: "operational-command-center" },
      { name: "description", label: "Description", kind: "textarea" },
      {
        name: "status",
        label: "Status",
        kind: "select",
        options: [
          { value: "planned", label: "Planned" },
          { value: "active", label: "Active" },
          { value: "paused", label: "Paused" },
          { value: "completed", label: "Completed" },
          { value: "archived", label: "Archived" },
        ],
      },
      { name: "owner_agent_id", label: "Owner Agent", kind: "select" },
      { name: "objectives", label: "Objectives", kind: "list", helper: "One objective per line." },
      { name: "metadata", label: "Metadata", kind: "json", helper: "Valid JSON object or array." },
    ],
  },
  {
    name: "tasks",
    label: "Tasks",
    singular: "task",
    description: "Instructions, ownership, due dates, dependencies, and definitions of done.",
    mutable: true,
    fields: [
      { name: "title", label: "Title", kind: "text" },
      { name: "description", label: "Description", kind: "textarea" },
      { name: "project_id", label: "Project", kind: "select" },
      { name: "owner_agent_id", label: "Owner Agent", kind: "select" },
      {
        name: "status",
        label: "Status",
        kind: "select",
        options: [
          { value: "inbox", label: "Inbox" },
          { value: "in_progress", label: "In Progress" },
          { value: "blocked", label: "Blocked" },
          { value: "review", label: "Review" },
          { value: "done", label: "Done" },
          { value: "cancelled", label: "Cancelled" },
        ],
      },
      {
        name: "priority",
        label: "Priority",
        kind: "select",
        options: [
          { value: "urgent", label: "Urgent" },
          { value: "high", label: "High" },
          { value: "medium", label: "Medium" },
          { value: "low", label: "Low" },
        ],
      },
      { name: "due_at", label: "Due At", kind: "date" },
      { name: "definition_of_done", label: "Definition Of Done", kind: "textarea" },
      { name: "dependencies", label: "Dependencies", kind: "list", helper: "One dependency per line." },
      { name: "tags", label: "Tags", kind: "list", helper: "One tag per line." },
      { name: "metadata", label: "Metadata", kind: "json", helper: "Valid JSON object or array." },
    ],
  },
  {
    name: "work-logs",
    label: "Work Logs",
    singular: "work log",
    description: "Progress notes, decisions, blockers, evidence, and deliverables.",
    mutable: true,
    fields: [
      { name: "task_id", label: "Task", kind: "select" },
      { name: "agent_id", label: "Agent", kind: "select" },
      {
        name: "entry_type",
        label: "Entry Type",
        kind: "select",
        options: [
          { value: "note", label: "Note" },
          { value: "progress", label: "Progress" },
          { value: "decision", label: "Decision" },
          { value: "blocker", label: "Blocker" },
          { value: "deliverable", label: "Deliverable" },
          { value: "evidence", label: "Evidence" },
        ],
      },
      { name: "title", label: "Title", kind: "text" },
      { name: "body", label: "Body", kind: "textarea" },
      { name: "artifacts", label: "Artifacts", kind: "json", helper: "Use JSON for structured links and attachments." },
      { name: "metadata", label: "Metadata", kind: "json", helper: "Valid JSON object or array." },
    ],
  },
  {
    name: "daily-updates",
    label: "Daily Updates",
    singular: "daily update",
    description: "Daily state by agent, including blockers, next steps, and health.",
    mutable: true,
    fields: [
      { name: "agent_id", label: "Agent", kind: "select" },
      { name: "update_date", label: "Update Date", kind: "date" },
      { name: "summary", label: "Summary", kind: "textarea" },
      { name: "completed", label: "Completed", kind: "list", helper: "One item per line." },
      { name: "blockers", label: "Blockers", kind: "list", helper: "One item per line." },
      { name: "next_steps", label: "Next Steps", kind: "list", helper: "One item per line." },
      { name: "asks", label: "Asks", kind: "list", helper: "One item per line." },
      {
        name: "health",
        label: "Health",
        kind: "select",
        options: [
          { value: "on_track", label: "On Track" },
          { value: "at_risk", label: "At Risk" },
          { value: "blocked", label: "Blocked" },
        ],
      },
    ],
  },
  {
    name: "approvals",
    label: "Approvals",
    singular: "approval",
    description: "Decision packages for Tito with evidence, risk, and recommendation.",
    mutable: true,
    fields: [
      { name: "task_id", label: "Task", kind: "select" },
      { name: "project_id", label: "Project", kind: "select" },
      { name: "requested_by_agent_id", label: "Requested By", kind: "select" },
      { name: "reviewer_agent_id", label: "Reviewer", kind: "select" },
      { name: "title", label: "Title", kind: "text" },
      { name: "summary", label: "Summary", kind: "textarea" },
      { name: "evidence", label: "Evidence", kind: "list", helper: "One proof point per line." },
      { name: "risk", label: "Risk", kind: "textarea" },
      { name: "recommendation", label: "Recommendation", kind: "textarea" },
      {
        name: "status",
        label: "Status",
        kind: "select",
        options: [
          { value: "pending", label: "Pending" },
          { value: "approved", label: "Approved" },
          { value: "changes_requested", label: "Changes Requested" },
          { value: "declined", label: "Declined" },
          { value: "withdrawn", label: "Withdrawn" },
        ],
      },
      { name: "decision_note", label: "Decision Note", kind: "textarea" },
      { name: "due_at", label: "Due At", kind: "date" },
    ],
  },
  {
    name: "activity",
    label: "Activity",
    singular: "activity event",
    description: "Immutable audit trail of inserts, updates, and deletes.",
    mutable: false,
    fields: [],
  },
];

const EMPTY_COUNTS: OverviewCounts = {
  agents: 0,
  projects: 0,
  tasks: 0,
  open_tasks: 0,
  pending_approvals: 0,
};

function formatLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stringifyValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

function defaultFormState(config: ResourceConfig, record?: Record<string, unknown>): FormState {
  return Object.fromEntries(
    config.fields.map((field) => {
      const value = record?.[field.name];
      if (value === null || value === undefined) return [field.name, ""];
      if (field.kind === "json") return [field.name, JSON.stringify(value, null, 2)];
      if (field.kind === "list") return [field.name, Array.isArray(value) ? value.join("\n") : String(value)];
      if (field.kind === "date") return [field.name, typeof value === "string" ? value.slice(0, 16) : ""];
      return [field.name, String(value)];
    }),
  );
}

function toPayload(config: ResourceConfig, form: FormState) {
  const payload: Record<string, unknown> = {};

  for (const field of config.fields) {
    const rawValue = (form[field.name] || "").trim();
    if (!rawValue) continue;

    if (field.kind === "json") {
      payload[field.name] = JSON.parse(rawValue);
      continue;
    }

    if (field.kind === "list") {
      payload[field.name] = rawValue
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
      continue;
    }

    if (field.kind === "date") {
      payload[field.name] = new Date(rawValue).toISOString();
      continue;
    }

    payload[field.name] = rawValue;
  }

  return payload;
}

function fieldOptions(
  field: FieldConfig,
  overview: OverviewData | null,
): Array<{ value: string; label: string }> | undefined {
  if (field.options) return field.options;
  if (!overview) return undefined;

  if (["reports_to", "owner_agent_id", "agent_id", "requested_by_agent_id", "reviewer_agent_id"].includes(field.name)) {
    return overview.agents.map((agent) => ({
      value: String(agent.id),
      label: String(agent.name || agent.code || agent.id),
    }));
  }

  if (field.name === "project_id") {
    return overview.projects.map((project) => ({
      value: String(project.id),
      label: String(project.name || project.slug || project.id),
    }));
  }

  if (field.name === "task_id") {
    return overview.tasks.map((task) => ({
      value: String(task.id),
      label: String(task.title || task.id),
    }));
  }

  return undefined;
}

function sortByCreatedAt(records: Record<string, unknown>[]) {
  return [...records].sort((left, right) =>
    String(right.created_at || "").localeCompare(String(left.created_at || "")),
  );
}

export function CommandCenter() {
  const supabase = useMemo(() => createClient(), []);
  const [resource, setResource] = useState<ResourceName>("tasks");
  const [session, setSession] = useState<Session | null>(null);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [drawerMode, setDrawerMode] = useState<"create" | "edit" | null>(null);
  const [form, setForm] = useState<FormState>({});
  const [error, setError] = useState<string>("");
  const [busy, startTransition] = useTransition();
  const deferredQuery = useDeferredValue(query);
  const config = RESOURCE_CONFIGS.find((item) => item.name === resource)!;

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      if (!data.session) {
        window.location.href = "/login";
        return;
      }

      setSession(data.session);
    }

    void loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) window.location.href = "/login";
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!session) return;

    startTransition(() => {
      void refreshOverview(session.access_token);
      void refreshResource(session.access_token, resource);
    });
  }, [resource, session]);

  async function apiFetch(path: string, init?: RequestInit) {
    if (!session?.access_token) throw new Error("Your session expired. Sign in again.");

    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        ...(init?.headers || {}),
      },
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiError | null;
      throw new Error(body?.error?.message || `Request failed with status ${response.status}.`);
    }

    return response.json();
  }

  async function refreshOverview(accessToken: string) {
    const response = await fetch("/api/v1/overview", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiError | null;
      throw new Error(body?.error?.message || "Could not load the operations overview.");
    }

    const payload = await response.json();
    setOverview(payload.data as OverviewData);
  }

  async function refreshResource(accessToken: string, nextResource: ResourceName) {
    const response = await fetch(`/api/v1/${nextResource}?limit=200&offset=0`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiError | null;
      throw new Error(body?.error?.message || `Could not load ${nextResource}.`);
    }

    const payload = (await response.json()) as CollectionResponse;
    setRecords(sortByCreatedAt(payload.data.items));
  }

  function openCreateDrawer() {
    setSelected(null);
    setForm(defaultFormState(config));
    setDrawerMode("create");
    setError("");
  }

  function openEditDrawer(record: Record<string, unknown>) {
    setSelected(record);
    setForm(defaultFormState(config, record));
    setDrawerMode("edit");
    setError("");
  }

  function inspectRecord(record: Record<string, unknown>) {
    setSelected(record);
    setDrawerMode(null);
    setForm({});
    setError("");
  }

  function closeDrawer() {
    setDrawerMode(null);
    setSelected(null);
    setForm({});
    setError("");
  }

  async function handleSave() {
    try {
      setError("");
      const payload = toPayload(config, form);
      const path = drawerMode === "edit" && selected?.id
        ? `/api/v1/${resource}/${selected.id}`
        : `/api/v1/${resource}`;

      await apiFetch(path, {
        method: drawerMode === "edit" ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });

      if (!session?.access_token) return;
      await refreshOverview(session.access_token);
      await refreshResource(session.access_token, resource);
      closeDrawer();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The record could not be saved.");
    }
  }

  async function handleDelete(record: Record<string, unknown>) {
    if (!config.mutable || !record.id) return;
    const confirmed = window.confirm(`Delete this ${config.singular}? This cannot be undone from the UI.`);
    if (!confirmed) return;

    try {
      setError("");
      await apiFetch(`/api/v1/${resource}/${record.id}`, { method: "DELETE" });
      if (!session?.access_token) return;
      await refreshOverview(session.access_token);
      await refreshResource(session.access_token, resource);
      if (selected?.id === record.id) closeDrawer();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "The record could not be deleted.");
    }
  }

  const filteredRecords = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    if (!needle) return records;

    return records.filter((record) =>
      JSON.stringify(record).toLowerCase().includes(needle),
    );
  }, [deferredQuery, records]);

  return (
    <div className="opsShell">
      <aside className="opsRail">
        <div className="deckBrand">
          <img src="/herzen-logo-white.png" alt="Herzen Co." />
          <span>Operational Command Center</span>
        </div>
        <div className="rule" />

        <div className="opsIdentity">
          <span className="railLabel">Operator</span>
          <strong>{overview?.viewer.display_name || "Lupe"}</strong>
          <small>{overview?.viewer.role || "operator"}</small>
        </div>

        <nav className="opsNav">
          {RESOURCE_CONFIGS.map((item) => (
            <button
              key={item.name}
              className={item.name === resource ? "active" : ""}
              onClick={() => {
                setQuery("");
                setResource(item.name);
              }}
            >
              <span>{item.label}</span>
              <em>{item.name === "tasks" ? overview?.counts.tasks ?? records.length : item.name === "agents" ? overview?.counts.agents ?? records.length : ""}</em>
            </button>
          ))}
        </nav>

        <div className="opsStats">
          <div>
            <span>Open tasks</span>
            <strong>{overview?.counts.open_tasks ?? EMPTY_COUNTS.open_tasks}</strong>
          </div>
          <div>
            <span>Pending approvals</span>
            <strong>{overview?.counts.pending_approvals ?? EMPTY_COUNTS.pending_approvals}</strong>
          </div>
          <div>
            <span>Projects</span>
            <strong>{overview?.counts.projects ?? EMPTY_COUNTS.projects}</strong>
          </div>
        </div>

        <form action="/api/auth/logout" method="post" className="opsSignOut">
          <button type="submit" className="signOut">Sign out</button>
        </form>
      </aside>

      <main className="opsMain">
        <header className="opsHeader">
          <div className="titleBlock">
            <span className="liveLabel"><i />Live operations</span>
            <h1>{config.label}</h1>
            <p>{config.description}</p>
          </div>

          <div className="opsToolbar">
            <label className="deckSearch">
              <span>/</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${config.label.toLowerCase()}`}
              />
            </label>
            <button
              className="outlineBtn"
              onClick={() => {
                if (!session?.access_token) return;
                startTransition(() => {
                  void refreshOverview(session.access_token);
                  void refreshResource(session.access_token, resource);
                });
              }}
            >
              Refresh
            </button>
            {config.mutable && (
              <button className="liveBtn" onClick={openCreateDrawer}>
                New {config.singular}
              </button>
            )}
          </div>
        </header>

        <section className="opsBody">
          {error ? <div className="opsError">{error}</div> : null}

          <div className="metricDeck opsMetricDeck">
            <div>
              <span>Loaded</span>
              <strong>{records.length}</strong>
              <small>Records fetched for this resource</small>
            </div>
            <div>
              <span>Filtered</span>
              <strong>{filteredRecords.length}</strong>
              <small>Visible after search</small>
            </div>
            <div>
              <span>Viewer role</span>
              <strong>{overview?.viewer.role || "operator"}</strong>
              <small>Write access required for mutations</small>
            </div>
            <div>
              <span>Status</span>
              <strong>{busy ? "Syncing" : "Ready"}</strong>
              <small>{config.mutable ? "CRUD enabled" : "Read-only audit trail"}</small>
            </div>
          </div>

          <div className="opsGrid">
            <section className="deckPanel opsListPanel">
              <div className="panelHead">
                <div>
                  <span>{config.label}</span>
                  <h2>{filteredRecords.length} visible records</h2>
                </div>
                <small>{config.mutable ? "Create, edit, delete" : "Read only"}</small>
              </div>

              <div className="opsList">
                {filteredRecords.map((record) => (
                  <article key={String(record.id)} className="opsCard">
                    <button
                      className="opsCardMain"
                      onClick={() => {
                        if (config.mutable) {
                          openEditDrawer(record);
                          return;
                        }
                        inspectRecord(record);
                      }}
                    >
                      <div className="opsCardTitle">
                        <strong>{String(record.title || record.name || record.code || record.id || "Untitled")}</strong>
                        <small>{String(record.status || record.role || record.entry_type || record.action || config.singular)}</small>
                      </div>
                      <dl className="opsMeta">
                        {Object.entries(record)
                          .filter(([key]) => !["before_data", "after_data", "metadata"].includes(key))
                          .slice(0, 6)
                          .map(([key, value]) => (
                            <div key={key}>
                              <dt>{formatLabel(key)}</dt>
                              <dd>{stringifyValue(value)}</dd>
                            </div>
                          ))}
                      </dl>
                    </button>

                    {config.mutable ? (
                      <div className="opsCardActions">
                        <button className="outlineBtn" onClick={() => openEditDrawer(record)}>Edit</button>
                        <button className="dangerBtn" onClick={() => void handleDelete(record)}>Delete</button>
                      </div>
                    ) : null}
                  </article>
                ))}

                {!filteredRecords.length ? (
                  <div className="opsEmpty">No records matched this view.</div>
                ) : null}
              </div>
            </section>

            <section className="deckPanel opsDetailPanel">
              <div className="panelHead">
                <div>
                  <span>{drawerMode ? (drawerMode === "create" ? "Create" : "Edit") : "Inspect"}</span>
                  <h2>
                    {drawerMode
                      ? `${drawerMode === "create" ? "New" : "Edit"} ${config.singular}`
                      : "Select a record"}
                  </h2>
                </div>
              </div>

              {drawerMode ? (
                <div className="opsForm">
                  {config.fields.map((field) => {
                    const options = fieldOptions(field, overview);
                    const value = form[field.name] || "";

                    return (
                      <label key={field.name}>
                        {field.label}
                        {field.kind === "textarea" ? (
                          <textarea
                            value={value}
                            onChange={(event) => setForm((current) => ({ ...current, [field.name]: event.target.value }))}
                            placeholder={field.placeholder}
                          />
                        ) : field.kind === "select" ? (
                          <select
                            value={value}
                            onChange={(event) => setForm((current) => ({ ...current, [field.name]: event.target.value }))}
                          >
                            <option value="">Select</option>
                            {options?.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={field.kind === "date" ? "datetime-local" : "text"}
                            value={value}
                            onChange={(event) => setForm((current) => ({ ...current, [field.name]: event.target.value }))}
                            placeholder={field.placeholder}
                          />
                        )}
                        {field.helper ? <small>{field.helper}</small> : null}
                      </label>
                    );
                  })}

                  <div className="opsFormActions">
                    <button className="ghostBtn" onClick={closeDrawer}>Cancel</button>
                    <button className="liveBtn" onClick={() => void handleSave()}>
                      {drawerMode === "create" ? "Create" : "Save"}
                    </button>
                  </div>
                </div>
              ) : selected ? (
                <pre className="opsInspect">{JSON.stringify(selected, null, 2)}</pre>
              ) : (
                <div className="opsEmpty opsEmptyDetail">
                  Choose a record to inspect or edit, or create a new one.
                </div>
              )}
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}
