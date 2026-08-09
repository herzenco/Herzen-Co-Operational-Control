import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "../../../utils/supabase/server";

type WorkItemRecord = {
  id: string;
  title: string;
  work_item_type: string;
  status: string;
  summary: string | null;
  body: string | null;
  notes: string | null;
  attachments: unknown;
  lane: string | null;
  content_item_id: string | null;
  campaign_id: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
  agent: { code: string; name: string } | null;
  project: { name: string; status: string } | null;
};

type RelatedWorkItem = { id: string; title: string; status: string; work_item_type: string };
type DependencyRecord = {
  id: string;
  required: boolean;
  notes: string | null;
  upstream_work_item_id: string;
  downstream_work_item_id: string;
  upstream: RelatedWorkItem | null;
  downstream: RelatedWorkItem | null;
};
type FeedbackRecord = { id: string; status: string; required: boolean; body: string; resolution_note: string | null };
type ApprovalRecord = { id: string; title: string; status: string; due_at: string | null; recommendation: string | null; risk: string | null };
type Attachment = { label: string; url: string; type?: string };

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Work item — Herzen Co. Operations",
  description: "Authenticated OCC work-item detail.",
};

function label(value: string | null | undefined, fallback = "Not recorded") {
  const normalized = value?.trim().replaceAll("_", " ");
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : fallback;
}

function labeledLine(body: string | null, name: string): string | null {
  const match = body?.match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
  return match?.[1]?.trim() || null;
}

function safeAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.url !== "string") return [];
    try {
      const url = new URL(record.url);
      if (!['http:', 'https:'].includes(url.protocol)) return [];
      return [{
        url: url.toString(),
        label: typeof record.label === "string" && record.label.trim() ? record.label.trim() : "Linked deliverable",
        type: typeof record.type === "string" ? record.type : undefined,
      }];
    } catch {
      return [];
    }
  });
}

function formatDate(value: string | null, empty = "Not recorded") {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(date);
}

export default async function WorkItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("operations_members")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!membership) notFound();

  const { data, error } = await supabase
    .from("agent_work_items")
    .select("id,title,work_item_type,status,summary,body,notes,attachments,lane,content_item_id,campaign_id,project_id,created_at,updated_at,agent:agents(code,name),project:projects(name,status)")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) notFound();
  const item = data as unknown as WorkItemRecord;

  const [dependencyResult, feedbackResult, approvalResult] = await Promise.all([
    supabase
      .from("agent_work_dependencies")
      .select("id,required,notes,upstream_work_item_id,downstream_work_item_id,upstream:agent_work_items!agent_work_dependencies_upstream_work_item_id_fkey(id,title,status,work_item_type),downstream:agent_work_items!agent_work_dependencies_downstream_work_item_id_fkey(id,title,status,work_item_type)")
      .or(`upstream_work_item_id.eq.${id},downstream_work_item_id.eq.${id}`),
    supabase.from("content_feedback").select("id,status,required,body,resolution_note").eq("work_item_id", id).order("created_at", { ascending: false }),
    item.project_id
      ? supabase.from("approvals").select("id,title,status,due_at,recommendation,risk").eq("project_id", item.project_id).order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const dependencies = (dependencyResult.data || []) as unknown as DependencyRecord[];
  const feedback = (feedbackResult.data || []) as unknown as FeedbackRecord[];
  const approvals = (approvalResult.data || []) as unknown as ApprovalRecord[];
  const attachments = safeAttachments(item.attachments);
  const dueDate = labeledLine(item.body, "Due date") || approvals.find((approval) => approval.due_at)?.due_at || null;
  const approvalState = labeledLine(item.body, "Approval status") || approvals[0]?.status || "Not requested";
  const blockers = labeledLine(item.body, "Blockers") || (item.status === "blocked" ? item.notes : null) || "None recorded";
  const requestedAction = labeledLine(item.body, "Requested action") || labeledLine(item.body, "Current status") || item.summary || "Review the work item and linked deliverables.";

  return (
    <main className="workItemPage">
      <header className="workItemTopbar">
        <Link href="/" className="workItemBrand" aria-label="Back to OCC">
          <Image src="/herzen-logo-white.png" alt="Herzen Co." width={150} height={37} priority />
          <span>Operational Command Center</span>
        </Link>
        <Link href="/" className="workItemBack">← Back to command center</Link>
      </header>

      <article className="workItemShell">
        <header className="workItemHero">
          <div>
            <span className="workItemEyebrow">{label(item.work_item_type)} · {item.lane || "general"}</span>
            <h1>{item.title}</h1>
            {item.summary && <p>{item.summary}</p>}
          </div>
          <span className={`workItemStatus workItemStatus-${item.status}`}>{label(item.status)}</span>
        </header>

        <dl className="workItemFacts">
          <div><dt>Owner</dt><dd>{item.agent?.name || item.agent?.code || "Unassigned"}</dd></div>
          <div><dt>Due date</dt><dd>{dueDate?.match(/^\d{4}-\d{2}-\d{2}T/) ? formatDate(dueDate) : dueDate || "No committed due date"}</dd></div>
          <div><dt>Approval state</dt><dd>{label(approvalState)}</dd></div>
          <div><dt>Project</dt><dd>{item.project?.name || "No linked project"}</dd></div>
        </dl>

        <div className="workItemGrid">
          <section className="workItemPanel workItemNarrative">
            <h2>Requested action</h2>
            <p>{requestedAction}</p>
            <h2>Ticket detail</h2>
            <p className="workItemPrewrap">{item.body || "No additional detail was recorded."}</p>
          </section>

          <aside className="workItemSidebar">
            <section className="workItemPanel">
              <h2>Blockers</h2>
              <p>{blockers}</p>
            </section>
            <section className="workItemPanel">
              <h2>Linked deliverables</h2>
              {attachments.length ? <ul className="workItemLinks">{attachments.map((attachment) => (
                <li key={attachment.url}><a href={attachment.url} target="_blank" rel="noreferrer">{attachment.label} ↗</a><small>{label(attachment.type, "External resource")}</small></li>
              ))}</ul> : <p>No deliverables attached.</p>}
            </section>
          </aside>
        </div>

        {(dependencies.length > 0 || feedback.length > 0 || approvals.length > 0) && (
          <section className="workItemPanel workItemRelated">
            <h2>Related workflow records</h2>
            <div>
              {dependencies.map((dependency) => {
                const related = dependency.upstream_work_item_id === item.id ? dependency.downstream : dependency.upstream;
                return related ? <Link key={dependency.id} href={`/work-items/${related.id}`}><b>{related.title}</b><span>{label(related.work_item_type)} · {label(related.status)}{dependency.required ? " · Required" : ""}</span></Link> : null;
              })}
              {approvals.map((approval) => <div key={approval.id}><b>{approval.title}</b><span>Approval · {label(approval.status)}{approval.due_at ? ` · Due ${formatDate(approval.due_at)}` : ""}</span></div>)}
              {feedback.map((entry) => <div key={entry.id}><b>{entry.required ? "Required feedback" : "Feedback"}</b><span>{label(entry.status)}</span><p>{entry.body}</p></div>)}
            </div>
          </section>
        )}

        {item.notes && <section className="workItemPanel"><h2>Operational notes</h2><p className="workItemPrewrap">{item.notes}</p></section>}

        <footer className="workItemFooter">
          <span>Ticket ID {item.id}</span>
          <span>Updated {formatDate(item.updated_at)}</span>
        </footer>
      </article>
    </main>
  );
}
