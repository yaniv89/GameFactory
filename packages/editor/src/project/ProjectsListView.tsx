import { Button, Input, Panel, type ViewState } from "@forge/ds";
import { useState, type FC, type FormEvent } from "react";
import type { ProjectSummary } from "../api/projectsApi";
import "./ProjectsListView.css";

export interface ProjectsListViewProps {
  readonly state: ViewState;
  readonly workspaceName: string | undefined;
  readonly projects: readonly ProjectSummary[];
  readonly error: string | undefined;
  readonly creating: boolean;
  readonly createError: string | undefined;
  readonly onRetry: () => void;
  readonly onSignOut: () => void;
  readonly onOpenProject: (project: ProjectSummary) => void;
  readonly onCreateProject: (title: string) => void;
}

/**
 * Pure, storyable half — same Container/View split as `ScenesPanel` /
 * `ScenesPanelContainer` (`shell/DockviewPanels.tsx`), for the same
 * reason: a component that reads a store directly can't be driven from
 * Storybook args. `ProjectsListViewContainer` below wires this to
 * `projectsStore.ts`; that's the one `main.tsx` actually mounts.
 *
 * Shown after sign-in, before the editor shell — the project a person is
 * about to work on has to be chosen (or created) before `App.tsx`'s
 * canvas/panels have anything to load. Six-state coverage per CLAUDE.md
 * 5.4, built on the same `Panel` primitive `ScenesPanel`/`ModulesPanel`
 * already use for the same "collection view" shape.
 */
export const ProjectsListView: FC<ProjectsListViewProps> = ({
  state,
  workspaceName,
  projects,
  error,
  creating,
  createError,
  onRetry,
  onSignOut,
  onOpenProject,
  onCreateProject,
}) => {
  const [title, setTitle] = useState("");

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (title.trim().length === 0) return;
    onCreateProject(title);
    setTitle("");
  };

  return (
    <div className="fg-projects">
      <header className="fg-projects__header">
        <span className="fg-projects__title">Forge</span>
        {workspaceName && <span className="fg-projects__workspace">{workspaceName}</span>}
        <Button variant="secondary" onClick={onSignOut}>
          Sign out
        </Button>
      </header>
      <div className="fg-projects__body">
        <Panel
          title="Your projects"
          state={state}
          empty={{
            title: "No projects yet",
            description: "A project is one game — its scenes, modules, and art pack. Create your first one below.",
            actionLabel: "Focus the create form",
            onAction: () => document.querySelector<HTMLInputElement>(".fg-projects__create input")?.focus(),
          }}
          error={{
            title: "Couldn't load your projects",
            description: error ?? "The request failed. Check your connection and try again.",
            onRetry,
          }}
          permissionDenied={{
            title: "You don't have access to this workspace",
            description: "Ask a workspace owner to add you as a member.",
          }}
          offline={{
            title: "You're offline",
            description: "Your project list will load once you're back online.",
          }}
        >
          <ul className="fg-projects__list">
            {projects.map((project) => (
              <li key={project.id}>
                <button className="fg-projects__item" onClick={() => onOpenProject(project)}>
                  <span className="fg-projects__item-title">{project.title}</span>
                  <span className="fg-projects__item-meta">
                    {project.headRevision === undefined ? "No saves yet" : `Revision ${project.headRevision}`} · Updated{" "}
                    {new Date(project.updatedAt).toLocaleDateString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
        {(state === "populated" || state === "empty") && (
          <form className="fg-projects__create" onSubmit={handleSubmit}>
            <Input label="New project name" placeholder="My first game" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Button type="submit" variant="primary" disabled={creating || title.trim().length === 0}>
              {creating ? "Creating…" : "Create project"}
            </Button>
            {createError && (
              <p className="fg-projects__create-error" role="alert">
                Couldn't create the project: {createError}. Try a different name.
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
};
