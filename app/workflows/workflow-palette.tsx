"use client";

import { useDeferredValue, useState } from "react";
import { WORKFLOW_NODE_CATEGORIES, workflowNodeRegistry, workflowNodeTypes, type WorkflowNodeCategory, type WorkflowNodeType } from "../../lib/workflows/workflow-node-registry";

type WorkflowPaletteProps = {
  hasTrigger: boolean;
  onAdd: (type: WorkflowNodeType) => void;
};

const CATEGORY_LABELS: Record<WorkflowNodeCategory, string> = {
  trigger: "Triggers",
  work: "Work",
  agents: "Agents",
  approvals: "Approvals",
  content: "Content",
  logic: "Logic",
  data: "Data",
  communication: "Communication",
};

export function WorkflowPalette({ hasTrigger, onAdd }: WorkflowPaletteProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const visible = workflowNodeTypes.filter((type) => {
    const definition = workflowNodeRegistry[type];
    return !deferredQuery || `${definition.label} ${definition.description} ${definition.category}`.toLowerCase().includes(deferredQuery);
  });

  return (
    <aside className="workflowPalette">
      <header><span>Node palette</span><h2>Compose the definition</h2></header>
      <label className="workflowPaletteSearch"><span>/</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search node types" aria-label="Search workflow node types" /></label>
      <div className="workflowPaletteGroups">
        {WORKFLOW_NODE_CATEGORIES.map((category) => {
          const types = visible.filter((type) => workflowNodeRegistry[type].category === category);
          if (!types.length) return null;
          return <section key={category}><h3>{CATEGORY_LABELS[category]}</h3>{types.map((type) => {
            const definition = workflowNodeRegistry[type];
            const disabled = category === "trigger" && hasTrigger;
            return (
              <button
                type="button"
                key={type}
                draggable={!disabled}
                disabled={disabled}
                onDragStart={(event) => { event.dataTransfer.setData("application/herzen-workflow-node", type); event.dataTransfer.effectAllowed = "copy"; }}
                onClick={() => onAdd(type)}
                aria-label={`Add ${definition.label} node`}
              >
                <i aria-hidden="true">{definition.icon.slice(0, 2).toUpperCase()}</i>
                <span><b>{definition.label}</b><small>{disabled ? "Trigger already defined" : definition.description}</small></span>
                <em>{disabled ? "Used" : "+"}</em>
              </button>
            );
          })}</section>;
        })}
        {!visible.length ? <p className="workflowPaletteEmpty">No node types match “{query}”.</p> : null}
      </div>
    </aside>
  );
}
