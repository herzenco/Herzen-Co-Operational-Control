"use client";

import dagre from "@dagrejs/dagre";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  SelectionMode,
  addEdge,
  applyNodeChanges,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { demoWorkflow } from "../../lib/workflows/demo-workflow";
import { outputHandlesFor, parseNodeConfig, summarizeNodeConfig, workflowNodeRegistry, type WorkflowNodeType } from "../../lib/workflows/workflow-node-registry";
import type { WorkflowDocument, WorkflowDocumentNode, WorkflowEdge } from "../../lib/workflows/workflow-schema";
import { validateWorkflow } from "../../lib/workflows/validate-workflow";
import { WorkflowInspector } from "./workflow-inspector";
import { WorkflowList } from "./workflow-list";
import { WorkflowNodeCard, type WorkflowFlowNode } from "./workflow-node-card";
import { WorkflowEdge as WorkflowEdgeView, type WorkflowFlowEdge } from "./workflow-edge";
import { WorkflowPalette } from "./workflow-palette";
import type { WorkflowRow, WorkflowVersionRow } from "../../utils/api/workflows";

const LOCAL_DRAFT_KEY = "herzen.occ.workflow-designer.draft.v1";
const nodeTypes = { workflowNode: WorkflowNodeCard };
const edgeTypes = { workflowEdge: WorkflowEdgeView };
const NODE_WIDTH = 230;
const NODE_HEIGHT = 156;
const SNAP_GRID: [number, number] = [16, 16];
const MULTI_SELECTION_KEYS = ["Meta", "Control"];
const PAN_MOUSE_BUTTONS = [0, 1, 2];
const FIT_VIEW_OPTIONS = { padding: 0.18 };

type ClipboardState = { nodes: WorkflowDocumentNode[]; edges: WorkflowEdge[] };

function cloneWorkflow(workflow: WorkflowDocument): WorkflowDocument {
  return structuredClone(workflow);
}

function definitionNodes(workflow: WorkflowDocument): WorkflowDocumentNode[] {
  return [workflow.trigger, ...workflow.nodes];
}

function nodeErrorMap(workflow: WorkflowDocument): Map<string, string[]> {
  const errors = new Map<string, string[]>();
  for (const node of definitionNodes(workflow)) {
    const parsed = parseNodeConfig(node.type, node.config);
    if (!parsed.success) errors.set(node.id, parsed.error.issues.map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`));
  }
  for (const error of validateWorkflow(workflow).errors) {
    if (!error.nodeId) continue;
    errors.set(error.nodeId, [...(errors.get(error.nodeId) ?? []), error.message]);
  }
  return errors;
}

function flowNodes(workflow: WorkflowDocument, selectedIds: Set<string>): WorkflowFlowNode[] {
  const errorMap = nodeErrorMap(workflow);
  return definitionNodes(workflow).map((node) => ({
    id: node.id,
    type: "workflowNode",
    position: node.position,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    initialWidth: NODE_WIDTH,
    initialHeight: NODE_HEIGHT,
    measured: { width: NODE_WIDTH, height: NODE_HEIGHT },
    selected: selectedIds.has(node.id),
    data: { definition: node, errors: errorMap.get(node.id) ?? [] },
  }));
}

function flowEdges(workflow: WorkflowDocument, selectedIds: Set<string>): WorkflowFlowEdge[] {
  const siblingGroups = new Map<string, WorkflowEdge[]>();
  for (const edge of workflow.edges) {
    const key = `${edge.source}\u0000${edge.target}`;
    siblingGroups.set(key, [...(siblingGroups.get(key) ?? []), edge]);
  }
  return workflow.edges.map((edge) => {
    const siblings = siblingGroups.get(`${edge.source}\u0000${edge.target}`) ?? [edge];
    const siblingIndex = siblings.findIndex((candidate) => candidate.id === edge.id);
    const labelOffset = (siblingIndex - (siblings.length - 1) / 2) * 84;
    return { id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: "input", label: edge.label, selected: selectedIds.has(edge.id), type: "workflowEdge", data: { labelOffset } };
  });
}

function withUpdatedNode(workflow: WorkflowDocument, updated: WorkflowDocumentNode): WorkflowDocument {
  if (workflow.trigger.id === updated.id) return { ...workflow, trigger: updated };
  return { ...workflow, nodes: workflow.nodes.map((node) => node.id === updated.id ? updated : node) };
}

function layoutWorkflow(workflow: WorkflowDocument): WorkflowDocument {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "TB", ranksep: 72, nodesep: 42, marginx: 34, marginy: 34 });
  for (const node of definitionNodes(workflow)) graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const edge of workflow.edges) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);
  const place = (node: WorkflowDocumentNode): WorkflowDocumentNode => {
    const position = graph.node(node.id) as { x: number; y: number } | undefined;
    return position ? { ...node, position: { x: position.x - NODE_WIDTH / 2, y: position.y - NODE_HEIGHT / 2 } } : node;
  };
  return { ...workflow, trigger: place(workflow.trigger), nodes: workflow.nodes.map(place) };
}

function connectionProblem(connection: Connection, workflow: WorkflowDocument): string | null {
  if (!connection.source || !connection.target) return "Connect an output handle to a node input.";
  if (connection.source === connection.target) return "A node cannot connect directly to itself. Use an explicit Loop node.";
  const source = definitionNodes(workflow).find((node) => node.id === connection.source);
  const target = definitionNodes(workflow).find((node) => node.id === connection.target);
  if (!source || !target) return "The connection references a node that is no longer available.";
  if (workflowNodeRegistry[target.type].inputs.length === 0) return `${workflowNodeRegistry[target.type].label} is a trigger and does not accept incoming connections.`;
  if (!connection.sourceHandle || !outputHandlesFor(source.type, source.config).some((handle) => handle.id === connection.sourceHandle)) return `Choose a compatible output from ${workflowNodeRegistry[source.type].label}.`;
  return null;
}

function triggerSummary(workflow: WorkflowDocument): string {
  return summarizeNodeConfig(workflow.trigger.type, workflow.trigger.config);
}

function sameIds(current: Set<string>, next: Set<string>): boolean {
  return current.size === next.size && [...current].every((id) => next.has(id));
}

type WorkflowDesignerProps = { accessToken: string };

type ApiEnvelope<T> = { data?: T; error?: { message?: string } };

export function WorkflowDesigner({ accessToken }: WorkflowDesignerProps) {
  const [workflow, setWorkflow] = useState<WorkflowDocument>(() => cloneWorkflow(demoWorkflow));
  const workflowRef = useRef(workflow);
  const pastRef = useRef<WorkflowDocument[]>([]);
  const futureRef = useRef<WorkflowDocument[]>([]);
  const clipboardRef = useRef<ClipboardState>({ nodes: [], edges: [] });
  const dragStartRef = useRef<WorkflowDocument | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<ReactFlowInstance<WorkflowFlowNode, Edge> | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set());
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(() => new Set());
  const [historyAvailability, setHistoryAvailability] = useState({ canUndo: false, canRedo: false });
  const [notice, setNotice] = useState("Hand-authored JSON loaded. Select a node to inspect its schema-driven configuration.");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved">("saved");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [screen, setScreen] = useState<"list" | "editor">("list");
  const [persistedId, setPersistedId] = useState<string | null>(null);
  const [workflowRows, setWorkflowRows] = useState<WorkflowRow[]>([]);
  const [versions, setVersions] = useState<Record<string, WorkflowVersionRow[]>>({});
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { workflowRef.current = workflow; }, [workflow]);
  useEffect(() => {
    const stored = window.localStorage.getItem(LOCAL_DRAFT_KEY);
    if (!stored) return;
    window.queueMicrotask(() => {
      try {
        setWorkflow(JSON.parse(stored) as WorkflowDocument);
      } catch {
        setNotice("The local draft could not be read; the hand-authored example remains loaded.");
      }
    });
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(workflow));
      setSaveState("saved");
    }, 700);
    return () => window.clearTimeout(timer);
  }, [workflow]);

  const apiRequest = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, ...(init?.headers ?? {}) },
    });
    const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
    if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message || `Workflow request failed (${response.status}).`);
    return payload.data;
  }, [accessToken]);

  const loadWorkflows = useCallback(async () => {
    setListLoading(true);
    try {
      const result = await apiRequest<{ items: WorkflowRow[] }>("/api/v1/workflows?limit=500&offset=0");
      setWorkflowRows(result.items);
      setListError("");
    } catch (requestError) {
      setListError(requestError instanceof Error ? requestError.message : "Saved workflows could not be loaded.");
    } finally {
      setListLoading(false);
    }
  }, [apiRequest]);

  useEffect(() => {
    window.queueMicrotask(() => void loadWorkflows());
  }, [loadWorkflows]);

  const pushPast = useCallback((snapshot: WorkflowDocument) => {
    pastRef.current = [...pastRef.current.slice(-99), cloneWorkflow(snapshot)];
    futureRef.current = [];
    setHistoryAvailability({ canUndo: true, canRedo: false });
  }, []);

  const commit = useCallback((nextOrUpdater: WorkflowDocument | ((current: WorkflowDocument) => WorkflowDocument)) => {
    setWorkflow((current) => {
      const next = typeof nextOrUpdater === "function" ? nextOrUpdater(current) : nextOrUpdater;
      if (JSON.stringify(current) === JSON.stringify(next)) return current;
      pushPast(current);
      setSaveState("unsaved");
      return { ...next, updatedAt: new Date().toISOString() };
    });
  }, [pushPast]);

  const undo = useCallback(() => {
    const previous = pastRef.current.at(-1);
    if (!previous) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [cloneWorkflow(workflowRef.current), ...futureRef.current.slice(0, 99)];
    setWorkflow(cloneWorkflow(previous));
    setHistoryAvailability({ canUndo: pastRef.current.length > 0, canRedo: true });
    setNotice("Undid the last workflow edit.");
  }, []);
  const redo = useCallback(() => {
    const next = futureRef.current[0];
    if (!next) return;
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current.slice(-99), cloneWorkflow(workflowRef.current)];
    setWorkflow(cloneWorkflow(next));
    setHistoryAvailability({ canUndo: true, canRedo: futureRef.current.length > 0 });
    setNotice("Redid the workflow edit.");
  }, []);

  const validation = useMemo(() => validateWorkflow(workflow), [workflow]);
  const nodes = useMemo(() => flowNodes(workflow, selectedNodeIds), [workflow, selectedNodeIds]);
  const edges = useMemo(() => flowEdges(workflow, selectedEdgeIds), [workflow, selectedEdgeIds]);
  const selectedNode = useMemo(() => definitionNodes(workflow).find((node) => selectedNodeIds.has(node.id)) ?? null, [workflow, selectedNodeIds]);

  const addNode = useCallback((type: WorkflowNodeType, position?: { x: number; y: number }) => {
    const definition = workflowNodeRegistry[type];
    if (definition.category === "trigger") {
      setNotice("A workflow has exactly one trigger. Edit the existing trigger instead of adding another.");
      return;
    }
    const fallback = { x: 420 + workflowRef.current.nodes.length * 24, y: 180 + workflowRef.current.nodes.length * 18 };
    const node: WorkflowDocumentNode = { id: `node_${crypto.randomUUID()}`, type, position: position ?? fallback, label: definition.label, config: structuredClone(definition.defaultConfig) };
    commit((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedNodeIds(new Set([node.id]));
    setSelectedEdgeIds(new Set());
    setInspectorOpen(true);
    setNotice(`${definition.label} added. Configure it in the inspector.`);
  }, [commit]);

  const addAtViewportCenter = useCallback((type: WorkflowNodeType) => {
    const instance = instanceRef.current;
    const canvas = canvasRef.current;
    if (!instance || !canvas) return addNode(type);
    const bounds = canvas.getBoundingClientRect();
    addNode(type, instance.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }));
  }, [addNode]);

  const deleteSelection = useCallback(() => {
    const selectedNodes = [...selectedNodeIds].filter((id) => id !== workflowRef.current.trigger.id);
    if (selectedNodeIds.has(workflowRef.current.trigger.id)) setNotice("The entry trigger cannot be deleted. Change its configuration instead.");
    if (!selectedNodes.length && !selectedEdgeIds.size) return;
    const removed = new Set(selectedNodes);
    commit((current) => ({ ...current, nodes: current.nodes.filter((node) => !removed.has(node.id)), edges: current.edges.filter((edge) => !selectedEdgeIds.has(edge.id) && !removed.has(edge.source) && !removed.has(edge.target)) }));
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
  }, [commit, selectedEdgeIds, selectedNodeIds]);

  const copySelection = useCallback(() => {
    const copiedNodes = workflowRef.current.nodes.filter((node) => selectedNodeIds.has(node.id));
    const copiedIds = new Set(copiedNodes.map((node) => node.id));
    clipboardRef.current = { nodes: cloneWorkflow({ ...workflowRef.current, trigger: workflowRef.current.trigger, nodes: copiedNodes }).nodes, edges: workflowRef.current.edges.filter((edge) => copiedIds.has(edge.source) && copiedIds.has(edge.target)).map((edge) => structuredClone(edge)) };
    setNotice(`${copiedNodes.length} node${copiedNodes.length === 1 ? "" : "s"} copied.`);
  }, [selectedNodeIds]);

  const pasteSelection = useCallback(() => {
    const copied = clipboardRef.current;
    if (!copied.nodes.length) return;
    const idMap = new Map(copied.nodes.map((node) => [node.id, `node_${crypto.randomUUID()}`]));
    const pastedNodes = copied.nodes.map((node) => ({ ...structuredClone(node), id: idMap.get(node.id) as string, position: { x: node.position.x + 36, y: node.position.y + 36 } }));
    const pastedEdges = copied.edges.map((edge) => ({ ...structuredClone(edge), id: `edge_${crypto.randomUUID()}`, source: idMap.get(edge.source) as string, target: idMap.get(edge.target) as string }));
    commit((current) => ({ ...current, nodes: [...current.nodes, ...pastedNodes], edges: [...current.edges, ...pastedEdges] }));
    setSelectedNodeIds(new Set(pastedNodes.map((node) => node.id)));
    setSelectedEdgeIds(new Set());
    setNotice(`${pastedNodes.length} node${pastedNodes.length === 1 ? "" : "s"} pasted.`);
  }, [commit]);

  const duplicateSelection = useCallback(() => { copySelection(); pasteSelection(); }, [copySelection, pasteSelection]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      const command = event.metaKey || event.ctrlKey;
      if ((event.key === "Delete" || event.key === "Backspace") && !command) { event.preventDefault(); deleteSelection(); }
      else if (command && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateSelection(); }
      else if (command && event.key.toLowerCase() === "c") { event.preventDefault(); copySelection(); }
      else if (command && event.key.toLowerCase() === "v") { event.preventDefault(); pasteSelection(); }
      else if (command && event.key.toLowerCase() === "z" && event.shiftKey) { event.preventDefault(); redo(); }
      else if (command && event.key.toLowerCase() === "z") { event.preventDefault(); undo(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [copySelection, deleteSelection, duplicateSelection, pasteSelection, redo, undo]);

  const onNodesChange = useCallback((changes: NodeChange<WorkflowFlowNode>[]) => {
    const positionChanges = changes.filter((change) => change.type === "position");
    if (!positionChanges.length) return;
    setWorkflow((current) => {
      const changed = applyNodeChanges(positionChanges, flowNodes(current, selectedNodeIds));
      const positions = new Map(changed.map((node) => [node.id, node.position]));
      return { ...current, trigger: { ...current.trigger, position: positions.get(current.trigger.id) ?? current.trigger.position }, nodes: current.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })) };
    });
  }, [selectedNodeIds]);

  const onConnect = useCallback((connection: Connection) => {
    const problem = connectionProblem(connection, workflowRef.current);
    if (problem) { setNotice(problem); return; }
    const edge = addEdge({ ...connection, id: `edge_${crypto.randomUUID()}` }, []) as Edge[];
    const created = edge[0];
    if (!created?.sourceHandle) return;
    commit((current) => ({ ...current, edges: [...current.edges, { id: created.id, source: created.source, target: created.target, sourceHandle: created.sourceHandle as string }] }));
    setNotice("Connection added to the workflow definition.");
  }, [commit]);

  const onConnectEnd = useCallback((_event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (state.isValid) return;
    if (!state.toNode) setNotice("Connection rejected: drop on a compatible node input.");
    else if (state.fromNode && state.toNode) setNotice(connectionProblem({ source: state.fromNode.id, target: state.toNode.id, sourceHandle: state.fromHandle?.id ?? null, targetHandle: state.toHandle?.id ?? null }, workflowRef.current) ?? "Connection rejected: incompatible handles.");
  }, []);

  const isValidConnection = useCallback((connection: Connection | Edge) => connectionProblem({
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle ?? null,
    targetHandle: connection.targetHandle ?? null,
  }, workflowRef.current) === null, []);

  const onSelectionChange = useCallback(({ nodes: selectedNodes, edges: selectedEdges }: { nodes: WorkflowFlowNode[]; edges: Edge[] }) => {
    const nextNodes = new Set(selectedNodes.map((node) => node.id));
    const nextEdges = new Set(selectedEdges.map((edge) => edge.id));
    setSelectedNodeIds((current) => sameIds(current, nextNodes) ? current : nextNodes);
    setSelectedEdgeIds((current) => sameIds(current, nextEdges) ? current : nextEdges);
    if (selectedNodes.length === 1) setInspectorOpen(true);
  }, []);

  const onNodeClick = useCallback((_event: React.MouseEvent, node: WorkflowFlowNode) => {
    setSelectedNodeIds(new Set([node.id]));
    setSelectedEdgeIds(new Set());
    setInspectorOpen(true);
  }, []);

  const arrange = useCallback(() => {
    commit((current) => layoutWorkflow(current));
    window.requestAnimationFrame(() => instanceRef.current?.fitView({ padding: 0.18, duration: 350 }));
    setNotice("Auto-layout applied from top to bottom for a readable workflow view.");
  }, [commit]);

  const save = useCallback(async () => {
    const checked = validateWorkflow(workflowRef.current);
    if (!checked.valid) {
      setNotice(`${checked.errors.length} validation issues must be resolved before saving.`);
      return;
    }
    setSaveState("saving");
    try {
      const path = persistedId ? `/api/v1/workflows/${persistedId}` : "/api/v1/workflows";
      const row = await apiRequest<WorkflowRow>(path, { method: persistedId ? "PATCH" : "POST", body: JSON.stringify({ definition: workflowRef.current }) });
      setWorkflow(cloneWorkflow(row.definition));
      setPersistedId(row.id);
      setSaveState("saved");
      setNotice(`Version ${row.version} saved. An immutable snapshot was created.`);
      await loadWorkflows();
    } catch (requestError) {
      setSaveState("unsaved");
      setNotice(requestError instanceof Error ? requestError.message : "The workflow could not be saved.");
    }
    window.localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(workflowRef.current));
  }, [apiRequest, loadWorkflows, persistedId]);

  const createWorkflow = useCallback(() => {
    const now = new Date().toISOString();
    const fresh = layoutWorkflow(cloneWorkflow(demoWorkflow));
    fresh.id = crypto.randomUUID();
    fresh.name = "Untitled workflow";
    fresh.version = 1;
    fresh.status = "draft";
    fresh.createdAt = now;
    fresh.updatedAt = now;
    setWorkflow(fresh);
    setPersistedId(null);
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
    pastRef.current = [];
    futureRef.current = [];
    setHistoryAvailability({ canUndo: false, canRedo: false });
    setScreen("editor");
    setNotice("New definition created from the hand-authored JSON example.");
  }, []);

  const openWorkflow = useCallback((row: WorkflowRow) => {
    setWorkflow(cloneWorkflow(row.definition));
    setPersistedId(row.id);
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
    pastRef.current = [];
    futureRef.current = [];
    setHistoryAvailability({ canUndo: false, canRedo: false });
    setScreen("editor");
    setNotice(`Version ${row.version} loaded from Supabase.`);
  }, []);

  const duplicateWorkflow = useCallback(async (row: WorkflowRow) => {
    const now = new Date().toISOString();
    const duplicate = cloneWorkflow(row.definition);
    duplicate.id = crypto.randomUUID();
    duplicate.name = `${row.name} copy`;
    duplicate.version = 1;
    duplicate.status = "draft";
    duplicate.createdAt = now;
    duplicate.updatedAt = now;
    try {
      await apiRequest<WorkflowRow>("/api/v1/workflows", { method: "POST", body: JSON.stringify({ definition: duplicate }) });
      await loadWorkflows();
      setListError("");
    } catch (requestError) {
      setListError(requestError instanceof Error ? requestError.message : "The workflow could not be duplicated.");
    }
  }, [apiRequest, loadWorkflows]);

  const exportWorkflow = useCallback((row: WorkflowRow) => {
    const blob = new Blob([JSON.stringify(row.definition, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${row.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workflow"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const deleteWorkflow = useCallback(async (row: WorkflowRow) => {
    if (!window.confirm(`Delete “${row.name}” and all immutable versions?`)) return;
    try {
      await apiRequest<{ deleted: WorkflowRow }>(`/api/v1/workflows/${row.id}`, { method: "DELETE" });
      await loadWorkflows();
    } catch (requestError) {
      setListError(requestError instanceof Error ? requestError.message : "The workflow could not be deleted.");
    }
  }, [apiRequest, loadWorkflows]);

  const loadVersions = useCallback(async (row: WorkflowRow) => {
    try {
      const result = await apiRequest<{ items: WorkflowVersionRow[] }>(`/api/v1/workflows/${row.id}/versions?limit=500&offset=0`);
      setVersions((current) => ({ ...current, [row.id]: result.items }));
    } catch (requestError) {
      setListError(requestError instanceof Error ? requestError.message : "Workflow versions could not be loaded.");
    }
  }, [apiRequest]);

  const restoreVersion = useCallback(async (row: WorkflowRow, version: number) => {
    try {
      await apiRequest<WorkflowRow>(`/api/v1/workflows/${row.id}/versions/${version}/restore`, { method: "POST" });
      await loadWorkflows();
      await loadVersions(row);
    } catch (requestError) {
      setListError(requestError instanceof Error ? requestError.message : "The workflow version could not be restored.");
    }
  }, [apiRequest, loadVersions, loadWorkflows]);

  const importWorkflow = useCallback(async (file: File) => {
    try {
      const candidate = JSON.parse(await file.text()) as unknown;
      const checked = validateWorkflow(candidate);
      if (!checked.valid) throw new Error(`Import rejected: ${checked.errors.map((issue) => issue.message).join(" · ")}`);
      setWorkflow(structuredClone(candidate) as WorkflowDocument);
      setPersistedId(null);
      setScreen("editor");
      setNotice("Imported JSON validated. Save to create the persisted workflow.");
    } catch (importError) {
      setListError(importError instanceof Error ? importError.message : "The selected file is not a valid workflow definition.");
    }
  }, []);

  return (
    <div className="workflowModule">
      <input ref={importInputRef} className="workflowImportInput" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importWorkflow(file); event.target.value = ""; }} />
      {screen === "list" ? <WorkflowList items={workflowRows} loading={listLoading} error={listError} versions={versions} onCreate={createWorkflow} onImport={() => importInputRef.current?.click()} onEdit={openWorkflow} onDuplicate={(row) => void duplicateWorkflow(row)} onExport={exportWorkflow} onDelete={(row) => void deleteWorkflow(row)} onVersions={(row) => void loadVersions(row)} onRestore={(row, version) => void restoreVersion(row, version)} /> : null}
      {screen === "editor" ? <>
      <section className="workflowMobileList" aria-label="Workflows read-only list">
        <header><span>Workflow definitions</span><h2>Read-only on mobile</h2><p>Return to the workflow library or open the desktop Command Center to edit the canvas.</p><button className="workflowToolButton" onClick={() => setScreen("list")}>Back to workflows</button></header>
        <article><div><b>{workflow.name}</b><span>{workflow.status}</span></div><p>{workflow.description}</p><dl><div><dt>Trigger</dt><dd>{triggerSummary(workflow)}</dd></div><div><dt>Nodes</dt><dd>{workflow.nodes.length + 1}</dd></div><div><dt>Validation</dt><dd>{validation.valid ? "Valid" : `${validation.errors.length} issues`}</dd></div><div><dt>Last edited</dt><dd>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(workflow.updatedAt))}</dd></div></dl></article>
      </section>

      <section className="workflowDesktop">
        <header className="workflowToolbar">
          <div className="workflowIdentity"><span>Workflow definition</span><input value={workflow.name} onChange={(event) => commit((current) => ({ ...current, name: event.target.value }))} aria-label="Workflow name" /></div>
          <label className={`workflowStatus ${workflow.status}`}><span>Status</span><select value={workflow.status} onChange={(event) => commit((current) => ({ ...current, status: event.target.value as WorkflowDocument["status"] }))} aria-label="Workflow status"><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></select></label>
          <div className="workflowToolbarActions">
            <button className="workflowToolButton" onClick={() => setScreen("list")}>Back</button>
            <button className="workflowToolButton" disabled={!historyAvailability.canUndo} onClick={undo} aria-label="Undo last workflow edit">Undo</button>
            <button className="workflowToolButton" disabled={!historyAvailability.canRedo} onClick={redo} aria-label="Redo workflow edit">Redo</button>
            <button className="workflowToolButton" onClick={arrange}>Auto-layout</button>
            <button className={`workflowValidateButton ${validation.valid ? "valid" : "invalid"}`} onClick={() => setNotice(validation.valid ? "Workflow definition is valid." : `${validation.errors.length} validation issues require attention.`)}>Validate · {validation.valid ? "Valid" : validation.errors.length}</button>
            <button className="workflowSaveButton" onClick={() => void save()}>Save</button>
          </div>
          <span className={`workflowSaveState ${saveState}`}>{saveState === "saving" ? "Autosaving…" : saveState === "saved" ? "Draft saved" : "Unsaved changes"}</span>
        </header>
        <div className="workflowDesignerGrid">
          <WorkflowPalette hasTrigger onAdd={addAtViewportCenter} />
          <div className="workflowCanvas" ref={canvasRef} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={(event) => { event.preventDefault(); const type = event.dataTransfer.getData("application/herzen-workflow-node") as WorkflowNodeType; if (!type || !workflowNodeRegistry[type]) return; const position = instanceRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }); addNode(type, position); }}>
            <ReactFlow<WorkflowFlowNode, Edge>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onInit={(instance) => { instanceRef.current = instance; }}
              onNodesChange={onNodesChange}
              onNodeDragStart={() => { dragStartRef.current = cloneWorkflow(workflowRef.current); }}
              onNodeDragStop={() => { const before = dragStartRef.current; dragStartRef.current = null; if (before && JSON.stringify(before) !== JSON.stringify(workflowRef.current)) { pushPast(before); setSaveState("unsaved"); } }}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              isValidConnection={isValidConnection}
              onSelectionChange={onSelectionChange}
              onNodeClick={onNodeClick}
              deleteKeyCode={null}
              selectionOnDrag={false}
              selectionKeyCode="Shift"
              selectionMode={SelectionMode.Partial}
              multiSelectionKeyCode={MULTI_SELECTION_KEYS}
              panOnDrag={PAN_MOUSE_BUTTONS}
              snapToGrid
              snapGrid={SNAP_GRID}
              fitView
              fitViewOptions={FIT_VIEW_OPTIONS}
              minZoom={0.25}
              maxZoom={1.8}
              nodesFocusable
              edgesFocusable
              aria-label="Workflow definition canvas"
            >
              <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable nodeStrokeWidth={2} aria-label="Workflow minimap" />
            </ReactFlow>
            <div className="workflowCanvasNotice" role="status">{notice}</div>
            <button className="workflowInspectorToggle" onClick={() => setInspectorOpen(true)}>Inspector</button>
          </div>
          <div className={inspectorOpen ? "workflowInspectorSlot open" : "workflowInspectorSlot"}><WorkflowInspector node={selectedNode} onClose={() => setInspectorOpen(false)} onChange={(node) => commit((current) => withUpdatedNode(current, node))} /></div>
        </div>
      </section>
      </> : null}
    </div>
  );
}
