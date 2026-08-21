import { Button, Dialog, Tree } from "@forge/ds";
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "reactflow";
import "reactflow/dist/style.css";
import { JsonSchemaForm } from "../inspector/JsonSchemaForm";
import type { FormValues, ObjectSchema } from "../inspector/jsonSchema";
import { GraphCanvasNode, type GraphCanvasNodeData } from "./GraphCanvasNode";
import { isValidConnection, type GraphValidationEdge, type GraphValidationNode } from "./graphValidation";
import { NODE_REGISTRY, defaultConfigFor, groupNodesByCategory } from "./nodeRegistry";
import "./GraphEditorDialog.css";

const NODE_TYPES = { core: GraphCanvasNode };

const GRAPH_NAME_SCHEMA: ObjectSchema = {
  type: "object",
  properties: { name: { type: "string", title: "Name", minLength: 1, maxLength: 60 } },
  required: ["name"],
};

export interface GraphEditorDialogNode {
  readonly id: string;
  readonly type: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly config: Readonly<Record<string, unknown>>;
}

export interface GraphEditorDialogEdge {
  readonly id: string;
  readonly source: string;
  readonly sourceHandle: string;
  readonly target: string;
  readonly targetHandle: string;
}

export interface GraphEditorDialogProps {
  open: boolean;
  onClose: () => void;
  graphName: string;
  nodes: readonly GraphEditorDialogNode[];
  edges: readonly GraphEditorDialogEdge[];
  onRenameGraph: (name: string) => void;
  onAddNode: (type: string, position: { x: number; y: number }, config: Readonly<Record<string, unknown>>) => void;
  onMoveNode: (nodeId: string, position: { x: number; y: number }) => void;
  onConfigureNode: (nodeId: string, config: Readonly<Record<string, unknown>>) => void;
  onRemoveNode: (nodeId: string) => void;
  onAddEdge: (edge: Omit<GraphEditorDialogEdge, "id">) => void;
  onRemoveEdge: (edgeId: string) => void;
}

function toRfNodes(nodes: readonly GraphEditorDialogNode[]): Node<GraphCanvasNodeData>[] {
  return nodes.map((node) => ({ id: node.id, type: "core", position: node.position, data: { type: node.type } }));
}

/**
 * A full-screen `Dialog` (matching how `PackSwapDialog`/`MarketplaceDialog`
 * already use `Dialog` for a focused editing session, per M3's plan) rather
 * than a permanent dockview panel — the React Flow canvas needs room that
 * would otherwise fight the scene canvas for space.
 *
 * Three cooperating surfaces, docs/adr/0017 Decision 5's "editor validates,
 * runtime never trusts that it did" applied here as `isValidConnection`
 * gating every wire before it's ever proposed to the store:
 * - the canvas itself (mouse-driven: drag nodes, drag-connect edges,
 *   Delete key removes a selection) — CLAUDE.md 5.3's direct manipulation;
 * - the node palette (click/Enter-operable — keyboard path for adding a
 *   node, not just drag-from-nowhere);
 * - the "Graph Outline" `Tree` (CLAUDE.md 5.6's keyboard/screen-reader
 *   parallel of the canvas, the same mechanism `ScenesPanel` already
 *   established for the scene canvas) plus a real config form + delete
 *   button for whatever it selects — every canvas operation has a
 *   keyboard-complete equivalent here, even though *wiring a new edge*
 *   is deliberately a simpler two-step picker rather than trying to
 *   replicate freeform drag-to-connect by keyboard.
 */
export function GraphEditorDialog({
  open,
  onClose,
  graphName,
  nodes,
  edges,
  onRenameGraph,
  onAddNode,
  onMoveNode,
  onConfigureNode,
  onRemoveNode,
  onAddEdge,
  onRemoveEdge,
}: GraphEditorDialogProps) {
  const [rfNodes, setRfNodes] = useState<Node<GraphCanvasNodeData>[]>(() => toRfNodes(nodes));
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [connectFrom, setConnectFrom] = useState<{ nodeId: string; handle: string } | undefined>();

  useEffect(() => {
    setRfNodes(toRfNodes(nodes));
  }, [nodes]);

  const rfEdges: Edge[] = useMemo(
    () => edges.map((edge) => ({ id: edge.id, source: edge.source, sourceHandle: edge.sourceHandle, target: edge.target, targetHandle: edge.targetHandle })),
    [edges],
  );

  const validationNodes: GraphValidationNode[] = useMemo(() => nodes.map((node) => ({ id: node.id, type: node.type })), [nodes]);
  const validationEdges: GraphValidationEdge[] = useMemo(
    () => edges.map((edge) => ({ source: edge.source, sourceHandle: edge.sourceHandle, target: edge.target, targetHandle: edge.targetHandle })),
    [edges],
  );

  const checkConnection = useCallback(
    (candidate: { source: string; sourceHandle: string; target: string; targetHandle: string }) =>
      isValidConnection(validationNodes, validationEdges, candidate),
    [validationNodes, validationEdges],
  );

  const isValidConnectionForCanvas = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) return false;
      return checkConnection({
        source: connection.source,
        sourceHandle: connection.sourceHandle,
        target: connection.target,
        targetHandle: connection.targetHandle,
      }).valid;
    },
    [checkConnection],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) return;
      onAddEdge({ source: connection.source, sourceHandle: connection.sourceHandle, target: connection.target, targetHandle: connection.targetHandle });
    },
    [onAddEdge],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === "remove") onRemoveNode(change.id);
        if (change.type === "select" && change.selected) setSelectedNodeId(change.id);
      }
      setRfNodes((current) => applyNodeChanges(changes.filter((change) => change.type !== "remove"), current));
    },
    [onRemoveNode],
  );

  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node<GraphCanvasNodeData>) => {
      onMoveNode(node.id, node.position);
    },
    [onMoveNode],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === "remove") onRemoveEdge(change.id);
      }
    },
    [onRemoveEdge],
  );

  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const selectedEntry = selectedNode ? NODE_REGISTRY[selectedNode.type] : undefined;

  const addNodeFromPalette = (type: string) => {
    const index = nodes.length;
    const position = { x: 40 + (index % 6) * 190, y: 40 + Math.floor(index / 6) * 130 };
    onAddNode(type, position, defaultConfigFor(type));
  };

  return (
    <Dialog open={open} title={`Graph — ${graphName}`} onClose={onClose}>
      <div className="fg-graph-editor">
        <div className="fg-graph-editor__header">
          <JsonSchemaForm schema={GRAPH_NAME_SCHEMA} values={{ name: graphName }} onSubmit={(values: FormValues) => onRenameGraph(values.name as string)} />
        </div>
        <div className="fg-graph-editor__body">
          <aside className="fg-graph-editor__palette" aria-label="Node palette">
            {groupNodesByCategory().map((group) => (
              <div key={group.category} className="fg-graph-editor__palette-group">
                <h3 className="fg-graph-editor__palette-heading">{group.category}</h3>
                {group.entries.map((entry) => (
                  <Button key={entry.definition.type} variant="secondary" onClick={() => addNodeFromPalette(entry.definition.type)}>
                    {entry.editor.label}
                  </Button>
                ))}
              </div>
            ))}
          </aside>

          <div className="fg-graph-editor__canvas">
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={NODE_TYPES}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDragStop={onNodeDragStop}
              onConnect={onConnect}
              isValidConnection={isValidConnectionForCanvas}
              onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
              fitView
            >
              <Background />
              <Controls />
            </ReactFlow>
          </div>

          <aside className="fg-graph-editor__inspector" aria-label="Node inspector">
            <div className="fg-graph-editor__outline">
              <Tree
                label="Graph Outline"
                state="populated"
                nodes={nodes.map((node) => ({ id: node.id, label: NODE_REGISTRY[node.type]?.editor.label ?? node.type }))}
                onSelect={setSelectedNodeId}
              />
            </div>

            {selectedNode && selectedEntry ? (
              <div className="fg-graph-editor__node-config">
                <h3>{selectedEntry.editor.label}</h3>
                <JsonSchemaForm
                  schema={selectedEntry.editor.configSchema}
                  values={selectedEntry.editor.toFormValues ? selectedEntry.editor.toFormValues(selectedNode.config) : (selectedNode.config as FormValues)}
                  onSubmit={(values) =>
                    onConfigureNode(selectedNode.id, selectedEntry.editor.fromFormValues ? selectedEntry.editor.fromFormValues(values) : values)
                  }
                />
                <Button variant="destructive" onClick={() => onRemoveNode(selectedNode.id)}>
                  Delete node
                </Button>

                <div className="fg-graph-editor__connect-picker">
                  <h3>Connect a wire</h3>
                  <p className="fg-list__secondary">Pick an output on this node, then an input on another node — the keyboard-operable equivalent of dragging a wire on the canvas.</p>
                  <div className="fg-graph-editor__connect-picker-outputs">
                    {selectedEntry.definition.outputs.map((socket) => (
                      <Button
                        key={socket.name}
                        variant={connectFrom?.nodeId === selectedNode.id && connectFrom.handle === socket.name ? "primary" : "secondary"}
                        onClick={() => setConnectFrom({ nodeId: selectedNode.id, handle: socket.name })}
                      >
                        Output: {socket.name} ({socket.type})
                      </Button>
                    ))}
                  </div>
                  {connectFrom && (
                    <div className="fg-graph-editor__connect-picker-inputs">
                      {nodes
                        .filter((node) => node.id !== connectFrom.nodeId)
                        .flatMap((node) => {
                          const entry = NODE_REGISTRY[node.type];
                          if (!entry) return [];
                          return entry.definition.inputs.map((socket) => {
                            const candidate = { source: connectFrom.nodeId, sourceHandle: connectFrom.handle, target: node.id, targetHandle: socket.name };
                            const result = checkConnection(candidate);
                            return (
                              <Button
                                key={`${node.id}:${socket.name}`}
                                variant="secondary"
                                disabled={!result.valid}
                                onClick={() => {
                                  onAddEdge(candidate);
                                  setConnectFrom(undefined);
                                }}
                              >
                                {entry.editor.label}.{socket.name} ({socket.type})
                              </Button>
                            );
                          });
                        })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="fg-list__secondary">Select a node to edit its config, delete it, or wire a connection.</p>
            )}
          </aside>
        </div>
      </div>
    </Dialog>
  );
}
