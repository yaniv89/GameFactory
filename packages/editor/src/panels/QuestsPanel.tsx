import { Button, Panel, type ViewState } from "@forge/ds";
import { JsonSchemaForm } from "../inspector/JsonSchemaForm";
import type { ObjectSchema } from "../inspector/jsonSchema";

/** A quest's name/description, edited together — the same "one form, submitted on blur" treatment `GraphsPanel`'s `GRAPH_NAME_SCHEMA` gives a graph's name, just with a second field since `QuestDefinition` has one. */
const QUEST_SCHEMA: ObjectSchema = {
  type: "object",
  properties: {
    name: { type: "string", title: "Name", minLength: 1, maxLength: 60 },
    description: { type: "string", title: "Description", maxLength: 500 },
  },
  required: ["name"],
};

const OBJECTIVE_SCHEMA: ObjectSchema = {
  type: "object",
  properties: { description: { type: "string", title: "Objective", minLength: 1, maxLength: 200 } },
  required: ["description"],
};

export interface QuestObjectiveSummary {
  readonly id: string;
  readonly description: string;
}

export interface QuestSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly objectives: readonly QuestObjectiveSummary[];
}

export interface QuestsPanelProps {
  state: ViewState;
  quests?: readonly QuestSummary[];
  onCreateQuest: () => void;
  onEditQuest?: (questId: string, name: string, description: string) => void;
  onDeleteQuest?: (questId: string) => void;
  onAddObjective?: (questId: string) => void;
  onEditObjective?: (questId: string, objectiveId: string, description: string) => void;
  onRemoveObjective?: (questId: string, objectiveId: string) => void;
  onRetry?: () => void;
}

/**
 * docs/adr/0018 Decision 1 / M8: authors a quest's *static* shape — name,
 * description, objectives — the same flat CRUD-catalog treatment
 * `GraphsPanel`/`ModulesPanel` already establish. The quest's *logic*
 * (when an objective completes, what happens on completion) is
 * deliberately NOT authored here: it's an ordinary graph, wired through
 * the unchanged `GraphsPanel`/`GraphEditorDialog` using
 * `core:questStart`/`core:questCompleteObjective`/`core:questIsActive`/
 * `core:questIsObjectiveComplete` (`@forge/graph-nodes-core`), which
 * reference a quest/objective by the id shown here — this panel is where
 * those ids come from, copied by hand into a graph node's config field,
 * the same "referenced by id, not by import" relationship `prefabId`
 * already has with `@forge/core`'s prefab registry.
 */
export function QuestsPanel({
  state,
  quests = [],
  onCreateQuest,
  onEditQuest,
  onDeleteQuest,
  onAddObjective,
  onEditObjective,
  onRemoveObjective,
  onRetry,
}: QuestsPanelProps) {
  return (
    <Panel
      title="Quests"
      state={state}
      empty={{
        title: "No quests yet",
        description: "A quest tracks per-player progress through a set of objectives — wire its logic with a graph once it exists.",
        actionLabel: "Create a quest",
        onAction: onCreateQuest,
      }}
      error={{
        title: "Couldn't load quests",
        description: "The request timed out. Your connection may be slow or the project may be very large.",
        onRetry: onRetry ?? (() => {}),
      }}
      permissionDenied={{
        title: "You have view access to this project",
        description: "Ask the project owner for editor access to create or edit quests.",
      }}
      offline={{
        title: "Offline — changes stored locally",
        description: "Quests will sync automatically when you reconnect.",
      }}
    >
      <ul className="fg-list">
        {quests.map((quest) => (
          <li key={quest.id} className="fg-quests-list__row">
            <div className="fg-quests-list__header">
              <JsonSchemaForm
                schema={QUEST_SCHEMA}
                values={{ name: quest.name, description: quest.description }}
                onSubmit={(values) => onEditQuest?.(quest.id, values.name as string, values.description as string)}
              />
              <code className="fg-id-tag" title="Reference this quest in a graph node's questId field">
                {quest.id}
              </code>
              <Button variant="destructive" onClick={() => onDeleteQuest?.(quest.id)}>
                Delete quest
              </Button>
            </div>

            <ul className="fg-quests-list__objectives">
              {quest.objectives.map((objective) => (
                <li key={objective.id} className="fg-quests-list__objective-row">
                  <JsonSchemaForm
                    schema={OBJECTIVE_SCHEMA}
                    values={{ description: objective.description }}
                    onSubmit={(values) => onEditObjective?.(quest.id, objective.id, values.description as string)}
                  />
                  <code className="fg-id-tag" title="Reference this objective in a graph node's objectiveId field">
                    {objective.id}
                  </code>
                  <Button variant="destructive" onClick={() => onRemoveObjective?.(quest.id, objective.id)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            <Button variant="secondary" onClick={() => onAddObjective?.(quest.id)}>
              Add objective
            </Button>
          </li>
        ))}
      </ul>
      <Button variant="secondary" onClick={onCreateQuest}>
        New quest
      </Button>
    </Panel>
  );
}
