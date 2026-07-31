"use client";

import { triggerSummaryFromDefinition, type WorkflowRow, type WorkflowVersionRow } from "../../utils/api/workflows";

type WorkflowListProps = {
  items: WorkflowRow[];
  loading: boolean;
  error: string;
  versions: Record<string, WorkflowVersionRow[]>;
  onCreate: () => void;
  onImport: () => void;
  onEdit: (row: WorkflowRow) => void;
  onDuplicate: (row: WorkflowRow) => void;
  onExport: (row: WorkflowRow) => void;
  onDelete: (row: WorkflowRow) => void;
  onVersions: (row: WorkflowRow) => void;
  onRestore: (row: WorkflowRow, version: number) => void;
};

function editedLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(date);
}

export function WorkflowList({ items, loading, error, versions, onCreate, onImport, onEdit, onDuplicate, onExport, onDelete, onVersions, onRestore }: WorkflowListProps) {
  return (
    <section className="workflowListView" aria-label="Workflow definitions">
      <header className="workflowListHeader">
        <div><span>Definition library</span><h2>Workflows</h2><p>Validated operating definitions. Execution is managed separately.</p></div>
        <div><button className="workflowToolButton" onClick={onImport}>Import JSON</button><button className="workflowSaveButton" onClick={onCreate}>New workflow</button></div>
      </header>
      {error ? <div className="workflowListError">{error}</div> : null}
      {loading ? <div className="workflowListEmpty">Loading workflow definitions…</div> : null}
      {!loading && !items.length ? <div className="workflowListEmpty"><b>No saved workflows</b><p>Create from the hand-authored example or import a workflow JSON definition.</p></div> : null}
      <div className="workflowListCards">
        {items.map((row) => (
          <article className="workflowListCard" key={row.id}>
            <header><div><span>{row.status} · v{row.version}</span><h3>{row.name}</h3></div><time dateTime={row.updated_at}>{editedLabel(row.updated_at)}</time></header>
            <p>{row.description || "No description."}</p>
            <dl><div><dt>Trigger</dt><dd>{triggerSummaryFromDefinition(row.definition)}</dd></div><div><dt>Nodes</dt><dd>{row.definition.nodes.length + 1}</dd></div><div><dt>Owner</dt><dd>{row.owner_id.slice(0, 8)}</dd></div><div><dt>Last edited</dt><dd>{editedLabel(row.updated_at)}</dd></div></dl>
            <footer>
              <button className="workflowPrimaryCardAction" onClick={() => onEdit(row)}>Open editor</button>
              <button onClick={() => onDuplicate(row)}>Duplicate</button>
              <button onClick={() => onVersions(row)}>Versions</button>
              <button onClick={() => onExport(row)}>Export</button>
              <button className="workflowDangerAction" onClick={() => onDelete(row)}>Delete</button>
            </footer>
            {versions[row.id] ? <section className="workflowVersions"><header><span>Immutable versions</span><b>{versions[row.id].length}</b></header>{versions[row.id].map((snapshot) => <div key={snapshot.id}><span>Version {snapshot.version}</span><time dateTime={snapshot.created_at}>{editedLabel(snapshot.created_at)}</time><button disabled={snapshot.version === row.version} onClick={() => onRestore(row, snapshot.version)}>{snapshot.version === row.version ? "Current" : "Restore"}</button></div>)}</section> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
