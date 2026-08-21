import { Handle, Position, type NodeProps } from "reactflow";
import { NODE_REGISTRY } from "./nodeRegistry";
import "./GraphCanvasNode.css";

export interface GraphCanvasNodeData {
  readonly type: string;
}

/**
 * The canvas rendering of one placed node. Flow sockets are square, data
 * sockets are round — a shape distinction, not a color one, so socket kind
 * is never color-only information (CLAUDE.md 5.6). Every socket also
 * carries its own name and type as visible text, never relying on the
 * handle's position/shape alone to convey what it is.
 */
export function GraphCanvasNode({ data, selected }: NodeProps<GraphCanvasNodeData>) {
  const entry = NODE_REGISTRY[data.type];
  if (!entry) {
    return (
      <div className="fg-graph-node fg-graph-node--unknown" role="alert">
        Unknown node type "{data.type}"
      </div>
    );
  }

  return (
    <div className={`fg-graph-node${selected ? " fg-graph-node--selected" : ""}`}>
      <div className="fg-graph-node__header">{entry.editor.label}</div>
      <div className="fg-graph-node__body">
        <div className="fg-graph-node__sockets fg-graph-node__sockets--inputs">
          {entry.definition.inputs.map((socket) => (
            <div key={socket.name} className="fg-graph-node__socket">
              <Handle
                type="target"
                position={Position.Left}
                id={socket.name}
                className={socket.type === "flow" ? "fg-graph-node__handle--flow" : "fg-graph-node__handle--data"}
              />
              <span className="fg-graph-node__socket-name">{socket.name}</span>
              <span className="fg-graph-node__socket-type">{socket.type}</span>
            </div>
          ))}
        </div>
        <div className="fg-graph-node__sockets fg-graph-node__sockets--outputs">
          {entry.definition.outputs.map((socket) => (
            <div key={socket.name} className="fg-graph-node__socket fg-graph-node__socket--output">
              <span className="fg-graph-node__socket-type">{socket.type}</span>
              <span className="fg-graph-node__socket-name">{socket.name}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={socket.name}
                className={socket.type === "flow" ? "fg-graph-node__handle--flow" : "fg-graph-node__handle--data"}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
