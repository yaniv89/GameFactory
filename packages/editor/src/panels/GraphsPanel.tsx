import { Button, Panel, type ViewState } from "@forge/ds";
import { JsonSchemaForm } from "../inspector/JsonSchemaForm";
import type { ObjectSchema } from "../inspector/jsonSchema";

/** Mirrors `SceneInspector.SCENE_SCHEMA` exactly — a graph's name is the same kind of field a scene's already is, so it gets the same JSON-Schema-driven, commit-on-blur treatment (CLAUDE.md 5.3) rather than a bespoke input. */
const GRAPH_NAME_SCHEMA: ObjectSchema = {
  type: "object",
  properties: { name: { type: "string", title: "Name", minLength: 1, maxLength: 60 } },
  required: ["name"],
};

export interface GraphSummary {
  readonly id: string;
  readonly name: string;
  readonly nodeCount: number;
}

export interface GraphsPanelProps {
  state: ViewState;
  graphs?: readonly GraphSummary[];
  onCreateGraph: () => void;
  onRenameGraph?: (graphId: string, name: string) => void;
  onOpenGraph?: (graphId: string) => void;
  onDeleteGraph?: (graphId: string) => void;
  onRetry?: () => void;
}

/**
 * Pure presentational component, per the same discipline `ModulesPanel`
 * already establishes — no dockview types, no store access, independently
 * testable and storyable (CLAUDE.md 5.4). See `GraphsPanelContainer` for
 * the dockview-shaped wrapper.
 *
 * A row-of-buttons list (not a `Tree`), mirroring `ModulesPanel` rather
 * than `ScenesPanel`: "which graphs exist" is a flat CRUD catalog, not
 * itself a canvas needing a keyboard/screen-reader parallel — that
 * requirement belongs to the graph *editor* (`GraphEditorDialog`'s own
 * "Graph Outline" `Tree`), one level down, per docs/adr/0017's own
 * authoring-layer split.
 */
export function GraphsPanel({ state, graphs = [], onCreateGraph, onRenameGraph, onOpenGraph, onDeleteGraph, onRetry }: GraphsPanelProps) {
  return (
    <Panel
      title="Graphs"
      state={state}
      empty={{
        title: "No graphs yet",
        description: "A graph is a visual set of rules — a quest, a mechanic, a branching conversation — built from nodes you wire together.",
        actionLabel: "Create a graph",
        onAction: onCreateGraph,
      }}
      error={{
        title: "Couldn't load graphs",
        description: "The request timed out. Your connection may be slow or the project may be very large.",
        onRetry: onRetry ?? (() => {}),
      }}
      permissionDenied={{
        title: "You have view access to this project",
        description: "Ask the project owner for editor access to create or edit graphs.",
      }}
      offline={{
        title: "Offline — changes stored locally",
        description: "Graphs will sync automatically when you reconnect.",
      }}
    >
      <ul className="fg-list">
        {graphs.map((graph) => (
          <li key={graph.id} className="fg-graphs-list__row">
            <div className="fg-graphs-list__name">
              <JsonSchemaForm
                schema={GRAPH_NAME_SCHEMA}
                values={{ name: graph.name }}
                onSubmit={(values) => onRenameGraph?.(graph.id, values.name as string)}
              />
              <span className="fg-list__secondary">
                {graph.nodeCount} node{graph.nodeCount === 1 ? "" : "s"}
              </span>
            </div>
            <div className="fg-graphs-list__actions">
              <Button variant="primary" onClick={() => onOpenGraph?.(graph.id)}>
                Open
              </Button>
              <Button variant="destructive" onClick={() => onDeleteGraph?.(graph.id)}>
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Button variant="secondary" onClick={onCreateGraph}>
        New graph
      </Button>
    </Panel>
  );
}
