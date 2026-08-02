"use client";

import type { ChangeEvent } from "react";
import type { ConfigFieldDescriptor } from "../../lib/workflows/config-field-descriptors";
import { configSchemaToFieldDescriptors } from "../../lib/workflows/config-field-descriptors";
import { parseNodeConfig, workflowNodeRegistry } from "../../lib/workflows/workflow-node-registry";
import type { WorkflowDocumentNode } from "../../lib/workflows/workflow-schema";

type InspectorProps = {
  node: WorkflowDocumentNode | null;
  onChange: (node: WorkflowDocumentNode) => void;
  onClose?: () => void;
};

function getAtPath(source: unknown, path: Array<string | number>): unknown {
  return path.reduce<unknown>((current, part) => {
    if (Array.isArray(current) && typeof part === "number") return current[part];
    if (current && typeof current === "object" && typeof part === "string") return (current as Record<string, unknown>)[part];
    return undefined;
  }, source);
}

function setAtPath(source: Record<string, unknown>, path: Array<string | number>, value: unknown): Record<string, unknown> {
  if (path.length === 0) return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : source;
  const [head, ...tail] = path;
  if (typeof head === "number") return source;
  const clone = { ...source };
  if (tail.length === 0) {
    clone[head] = value;
    return clone;
  }
  const current = clone[head];
  if (typeof tail[0] === "number") {
    const array = Array.isArray(current) ? [...current] : [];
    const index = tail[0] as number;
    const nestedPath = tail.slice(1);
    if (nestedPath.length === 0) array[index] = value;
    else array[index] = setAtPath(array[index] && typeof array[index] === "object" && !Array.isArray(array[index]) ? array[index] as Record<string, unknown> : {}, nestedPath, value);
    clone[head] = array;
    return clone;
  }
  clone[head] = setAtPath(current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : {}, tail, value);
  return clone;
}

function fieldDefault(field: ConfigFieldDescriptor): unknown {
  if (field.kind === "boolean") return false;
  if (field.kind === "number") return 0;
  if (field.kind === "select") return field.options?.[0]?.value ?? "";
  if (field.kind === "array") return [];
  if (field.kind === "object") return Object.fromEntries((field.children ?? []).map((child) => [child.key, fieldDefault(child)]));
  if (field.kind === "union") return Object.fromEntries((field.variants?.[0]?.fields ?? []).map((child) => [child.key, fieldDefault(child)]));
  if (field.kind === "json") return {};
  return "";
}

function materializePath(path: string[], indices: number[]): Array<string | number> {
  let indexCursor = 0;
  return path.map((part) => part === "*" ? indices[indexCursor++] ?? 0 : part);
}

type FieldProps = {
  field: ConfigFieldDescriptor;
  config: Record<string, unknown>;
  errors: Map<string, string[]>;
  indices?: number[];
  onConfigChange: (config: Record<string, unknown>) => void;
};

function ConfigField({ field, config, errors, indices = [], onConfigChange }: FieldProps) {
  const path = materializePath(field.path, indices);
  const value = getAtPath(config, path);
  const fieldErrors = errors.get(path.join(".")) ?? [];
  const update = (nextValue: unknown) => onConfigChange(setAtPath(config, path, nextValue));
  const shared = { "aria-invalid": fieldErrors.length > 0 || undefined, "aria-describedby": fieldErrors.length ? `field-error-${path.join("-")}` : undefined };

  if (field.kind === "object") {
    return <fieldset className="workflowFieldGroup"><legend>{field.label}</legend>{field.children?.map((child) => <ConfigField key={child.path.join(".")} field={child} config={config} errors={errors} indices={indices} onConfigChange={onConfigChange} />)}</fieldset>;
  }
  if (field.kind === "union") {
    const variants = field.variants ?? [];
    const activeIndex = Math.max(0, variants.findIndex((variant) => variant.fields.some((child) => child.kind === "select" && child.options?.length === 1 && getAtPath(config, materializePath(child.path, indices)) === child.options[0].value)));
    const active = variants[activeIndex];
    return (
      <fieldset className="workflowFieldGroup">
        <legend>{field.label}</legend>
        <label className="workflowField"><span>Variant</span><select value={activeIndex} onChange={(event) => { const variant = variants[Number(event.target.value)]; const next = { ...config }; for (const child of variant?.fields ?? []) next[child.key] = fieldDefault(child); onConfigChange(next); }}>{variants.map((variant, index) => <option value={index} key={`${variant.label}-${index}`}>{variant.label}</option>)}</select></label>
        {active?.fields.map((child) => <ConfigField key={child.path.join(".")} field={child} config={config} errors={errors} indices={indices} onConfigChange={onConfigChange} />)}
      </fieldset>
    );
  }
  if (field.kind === "array") {
    const items = Array.isArray(value) ? value : [];
    const child = field.children?.[0];
    return (
      <fieldset className="workflowFieldGroup workflowArrayField">
        <legend>{field.label}{field.required ? " *" : ""}</legend>
        {child && items.map((_item, index) => <div className="workflowArrayItem" key={`${path.join(".")}-${index}`}><ConfigField field={child} config={config} errors={errors} indices={[...indices, index]} onConfigChange={onConfigChange} /><button type="button" className="workflowTextAction" onClick={() => update(items.filter((_entry, itemIndex) => itemIndex !== index))}>Remove</button></div>)}
        <button type="button" className="workflowAddField" onClick={() => update([...items, child ? fieldDefault(child) : ""])}>+ Add item</button>
      </fieldset>
    );
  }

  let control;
  if (field.kind === "boolean") {
    control = <input type="checkbox" checked={Boolean(value)} onChange={(event) => update(event.target.checked)} {...shared} />;
  } else if (field.kind === "select") {
    control = <select value={value === undefined ? "" : String(value)} onChange={(event) => { const option = field.options?.find((entry) => String(entry.value) === event.target.value); update(option?.value ?? event.target.value); }} {...shared}><option value="" disabled>Select…</option>{field.options?.map((option) => <option value={String(option.value)} key={String(option.value)}>{option.label}</option>)}</select>;
  } else if (field.kind === "number") {
    control = <input type="number" value={typeof value === "number" ? value : ""} onChange={(event) => update(event.target.value === "" ? undefined : Number(event.target.value))} {...shared} />;
  } else if (field.kind === "json") {
    control = <textarea value={JSON.stringify(value ?? {}, null, 2)} readOnly aria-label={`${field.label} JSON value`} />;
  } else {
    control = <input type="text" value={typeof value === "string" ? value : ""} onChange={(event: ChangeEvent<HTMLInputElement>) => update(event.target.value)} {...shared} />;
  }

  return <label className={`workflowField ${field.kind === "boolean" ? "workflowCheckboxField" : ""}`}><span>{field.label}{field.required ? " *" : ""}</span>{control}{field.description ? <small>{field.description}</small> : null}{fieldErrors.length ? <small className="workflowFieldError" id={`field-error-${path.join("-")}`}>{fieldErrors.join(" · ")}</small> : null}</label>;
}

export function WorkflowInspector({ node, onChange, onClose }: InspectorProps) {
  if (!node) return <aside className="workflowInspector"><header><div><span>Inspector</span><h2>Nothing selected</h2></div>{onClose ? <button onClick={onClose} aria-label="Close inspector">Close</button> : null}</header><div className="workflowInspectorEmpty"><b>Select a node</b><p>Configuration fields and validation details will appear here.</p></div></aside>;
  const definition = workflowNodeRegistry[node.type];
  const parsed = parseNodeConfig(node.type, node.config);
  const errors = new Map<string, string[]>();
  if (!parsed.success) for (const issue of parsed.error.issues) {
    const key = issue.path.map(String).join(".");
    errors.set(key, [...(errors.get(key) ?? []), issue.message]);
  }
  const fields = configSchemaToFieldDescriptors(definition.configSchema);
  return (
    <aside className="workflowInspector">
      <header><div><span>Inspector · {definition.category}</span><h2>{definition.label}</h2></div>{onClose ? <button onClick={onClose} aria-label="Close inspector">Close</button> : null}</header>
      <div className="workflowInspectorBody">
        <label className="workflowField"><span>Node label *</span><input value={node.label} onChange={(event) => onChange({ ...node, label: event.target.value })} /></label>
        <p className="workflowNodeDescription">{definition.description}</p>
        {fields.map((field) => <ConfigField key={field.key} field={field} config={node.config} errors={errors} onConfigChange={(config) => onChange({ ...node, config })} />)}
        {parsed.success ? <div className="workflowInspectorValid"><i />Configuration valid</div> : <div className="workflowInspectorErrors"><b>{parsed.error.issues.length} configuration {parsed.error.issues.length === 1 ? "issue" : "issues"}</b>{parsed.error.issues.map((issue, index) => <span key={`${issue.path.join(".")}-${index}`}>{issue.path.join(".") || "Configuration"}: {issue.message}</span>)}</div>}
      </div>
    </aside>
  );
}
