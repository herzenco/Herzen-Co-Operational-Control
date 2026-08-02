"use client";

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Position, type Edge, type EdgeProps } from "@xyflow/react";

export type WorkflowFlowEdge = Edge<{ labelOffset?: number }, "workflowEdge">;

export function WorkflowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, label, data }: EdgeProps<WorkflowFlowEdge>) {
  const labelOffset = data?.labelOffset ?? 0;
  const vertical = sourcePosition === Position.Top || sourcePosition === Position.Bottom;
  const routeCenter = vertical
    ? { centerX: (sourceX + targetX) / 2 + labelOffset }
    : { centerY: (sourceY + targetY) / 2 + labelOffset };
  const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, ...routeCenter, borderRadius: 0 });

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {label ? (
        <EdgeLabelRenderer>
          <span
            className="workflowEdgeLabel nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {String(label)}
          </span>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
