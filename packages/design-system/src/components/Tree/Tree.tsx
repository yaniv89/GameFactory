import { useMemo, useState, type KeyboardEvent } from "react";
import { Button } from "../Button/Button";
import type { ViewState } from "../shared/viewState";
import "./Tree.css";

export interface TreeNodeDef {
  id: string;
  label: string;
  children?: TreeNodeDef[];
}

export interface TreeProps {
  label: string;
  state: ViewState;
  nodes?: TreeNodeDef[];
  onSelect?: (id: string) => void;
  empty?: { title: string; description: string; actionLabel: string; onAction: () => void };
  error?: { title: string; description: string; onRetry: () => void };
  permissionDenied?: { title: string; description: string };
  offline?: { title: string; description: string };
}

interface FlatNode {
  node: TreeNodeDef;
  depth: number;
  parentId: string | undefined;
}

function flatten(
  nodes: TreeNodeDef[],
  expanded: Set<string>,
  depth = 0,
  parentId?: string,
): FlatNode[] {
  return nodes.flatMap((node) => {
    const self: FlatNode = { node, depth, parentId };
    if (node.children && node.children.length > 0 && expanded.has(node.id)) {
      return [self, ...flatten(node.children, expanded, depth + 1, node.id)];
    }
    return [self];
  });
}

/**
 * Full keyboard-navigable, screen-reader-readable parallel of the scene
 * canvas (CLAUDE.md 5.6): every canvas operation needs a tree equivalent
 * eventually, but the tree navigation model itself — arrow keys, roving
 * tabindex, aria-expanded — is established here.
 */
export function Tree({
  label,
  state,
  nodes = [],
  onSelect,
  empty,
  error,
  permissionDenied,
  offline,
}: TreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | undefined>(nodes[0]?.id);
  const [selectedId, setSelectedId] = useState<string | undefined>();

  const flat = useMemo(() => flatten(nodes, expanded), [nodes, expanded]);
  const activeIndex = flat.findIndex((f) => f.node.id === activeId);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const select = (id: string) => {
    setSelectedId(id);
    setActiveId(id);
    onSelect?.(id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (flat.length === 0) return;
    const current = flat[activeIndex];
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveId(flat[Math.min(activeIndex + 1, flat.length - 1)]?.node.id);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveId(flat[Math.max(activeIndex - 1, 0)]?.node.id);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (current && current.node.children?.length) {
          if (!expanded.has(current.node.id)) toggle(current.node.id);
          else setActiveId(current.node.children[0]?.id);
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (current) {
          if (current.node.children?.length && expanded.has(current.node.id)) {
            toggle(current.node.id);
          } else if (current.parentId) {
            setActiveId(current.parentId);
          }
        }
        break;
      case "Home":
        e.preventDefault();
        setActiveId(flat[0]?.node.id);
        break;
      case "End":
        e.preventDefault();
        setActiveId(flat[flat.length - 1]?.node.id);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (current) select(current.node.id);
        break;
    }
  };

  if (state === "loading") {
    return (
      <div role="status" aria-label={`Loading ${label.toLowerCase()}`} className="fg-tree__state">
        Loading…
      </div>
    );
  }
  if (state === "empty" && empty) {
    return (
      <div className="fg-tree__state">
        <span className="fg-tree__state-title">{empty.title}</span>
        <p>{empty.description}</p>
        <Button variant="primary" onClick={empty.onAction}>
          {empty.actionLabel}
        </Button>
      </div>
    );
  }
  if (state === "error" && error) {
    return (
      <div className="fg-tree__state" role="alert">
        <span className="fg-tree__state-title">{error.title}</span>
        <p>{error.description}</p>
        <Button variant="secondary" onClick={error.onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  if (state === "permission-denied" && permissionDenied) {
    return (
      <div className="fg-tree__state">
        <span className="fg-tree__state-title">{permissionDenied.title}</span>
        <p>{permissionDenied.description}</p>
      </div>
    );
  }
  if (state === "offline" && offline) {
    return (
      <div className="fg-tree__state" role="status">
        <span className="fg-tree__state-title">{offline.title}</span>
        <p>{offline.description}</p>
      </div>
    );
  }

  return (
    <ul role="tree" aria-label={label} className="fg-tree" onKeyDown={onKeyDown}>
      {flat.map(({ node, depth }) => {
        const hasChildren = Boolean(node.children?.length);
        const isExpanded = expanded.has(node.id);
        return (
          <li
            key={node.id}
            role="treeitem"
            tabIndex={node.id === activeId ? 0 : -1}
            aria-selected={node.id === selectedId}
            aria-expanded={hasChildren ? isExpanded : undefined}
            className="fg-tree__item"
            style={{ ["--fg-tree-depth" as string]: depth }}
            onClick={() => select(node.id)}
            onFocus={() => setActiveId(node.id)}
          >
            <span
              className="fg-tree__disclosure"
              aria-hidden="true"
              onClick={(e) => {
                if (hasChildren) {
                  e.stopPropagation();
                  toggle(node.id);
                }
              }}
            >
              {hasChildren ? (isExpanded ? "▾" : "▸") : ""}
            </span>
            {node.label}
          </li>
        );
      })}
    </ul>
  );
}
