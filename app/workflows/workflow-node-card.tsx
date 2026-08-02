"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { outputHandlesFor, summarizeNodeConfig, workflowNodeRegistry } from "../../lib/workflows/workflow-node-registry";
import type { WorkflowDocumentNode } from "../../lib/workflows/workflow-schema";

export type WorkflowNodeData = {
  definition: WorkflowDocumentNode;
  errors: string[];
};

export type WorkflowFlowNode = Node<WorkflowNodeData, "workflowNode">;

export function WorkflowNodeCard({ data, selected }: NodeProps<WorkflowFlowNode>) {
  const node = data.definition;
  const definition = workflowNodeRegistry[node.type];
  const outputs = outputHandlesFor(node.type, node.config);
  return (
    <article className={`workflowNodeCard ${selected ? "selected" : ""} ${data.errors.length ? "invalid" : ""}`} aria-label={`${definition.label} workflow node`}>
      {definition.inputs.map((handle, index) => <Handle key={handle.id} id={handle.id} type="target" position={Position.Top} style={{ left: `${((index + 1) / (definition.inputs.length + 1)) * 100}%` }} aria-label={`${handle.label} input`} />)}
      <header><i aria-hidden="true">{definition.icon.slice(0, 2).toUpperCase()}</i><span>{definition.category}</span>{data.errors.length ? <em title={data.errors.join("\n")}>{data.errors.length} error{data.errors.length === 1 ? "" : "s"}</em> : null}</header>
      <h3>{node.label}</h3>
      <p>{summarizeNodeConfig(node.type, node.config)}</p>
      <footer><span>{definition.label}</span><span>{outputs.length} out</span></footer>
      {outputs.map((handle, index) => <Handle key={handle.id} id={handle.id} type="source" position={Position.Bottom} style={{ left: `${((index + 1) / (outputs.length + 1)) * 100}%` }} aria-label={`${handle.label} output`} />)}
    </article>
  );
}
