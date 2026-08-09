import { Tooltip } from "@forge/ds";
import { usePresence, type PresenceEntry, type PresenceStatus, type UsePresenceOptions } from "./usePresence";
import "./PresenceIndicator.css";

const STATUS_LABEL: Record<Exclude<PresenceStatus, "populated">, string> = {
  loading: "Connecting to collaborators…",
  error: "Not connected to collaborators",
  offline: "Offline — collaborator list unavailable",
};

function rosterTooltip(names: readonly string[]): string {
  if (names.length === 0) return "No one else is here";
  return names.join(", ");
}

export interface PresenceIndicatorViewProps {
  readonly status: PresenceStatus;
  readonly roster: readonly PresenceEntry[];
}

/**
 * The pure, storyable half of the indicator — `status`/`roster` as props
 * rather than a live hook, same shape as every other stateful panel in
 * this app (e.g. `ScenesPanel`'s own `state` prop). docs/SPEC.md Section
 * 12.2's toolbar mockup: "○○○ (3 online)". "loading"/"offline"/"error"
 * render as a muted status dot with no count; "populated" renders the
 * real dot-per-collaborator plus count. See `usePresence`'s own doc
 * comment for why "empty" and "permission-denied" are not states this
 * component can independently reach.
 */
export function PresenceIndicatorView({ status, roster }: PresenceIndicatorViewProps) {
  if (status !== "populated") {
    return (
      <div className="fg-presence" data-status={status} role="status">
        <span className="fg-presence__dot" aria-hidden="true" />
        <span className="fg-presence__label">{STATUS_LABEL[status]}</span>
      </div>
    );
  }

  const names = roster.map((entry) => entry.displayName);
  const visibleDots = roster.slice(0, 5);

  return (
    <Tooltip content={rosterTooltip(names)}>
      <div className="fg-presence" data-status="populated" role="status">
        {visibleDots.map((entry) => (
          <span key={entry.connectionId} className="fg-presence__dot fg-presence__dot--online" aria-hidden="true" />
        ))}
        <span className="fg-presence__label">{roster.length} online</span>
      </div>
    </Tooltip>
  );
}

/**
 * `hubUrl`/`projectId`/`accessToken` are required props, not read from
 * an editor-wide store: as of M7 Phase 1 the editor SPA has no signed-in
 * session or open-project concept yet (no auth store, no tracked project
 * id — a real, separate, larger gap this phase doesn't invent a
 * shortcut around). A caller wires this in once that exists; until then
 * this component is real and tested, just not yet mounted in App.tsx.
 */
export function PresenceIndicator(props: UsePresenceOptions) {
  const { status, roster } = usePresence(props);
  return <PresenceIndicatorView status={status} roster={roster} />;
}
