import { useEffect, type FC } from "react";
import type { ProjectSummary } from "../api/projectsApi";
import { useAuthStore } from "../auth/authStore";
import { ProjectsListView } from "./ProjectsListView";
import { useProjectsStore } from "./projectsStore";

function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Wires `ProjectsListView` to `projectsStore.ts` and `authStore.ts` — the piece `main.tsx` actually mounts. */
export const ProjectsListViewContainer: FC<{ onOpenProject: (project: ProjectSummary) => void }> = ({ onOpenProject }) => {
  const { status, projects, workspace, error, creating, createError, load, create } = useProjectsStore();
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ProjectsListView
      state={status}
      workspaceName={workspace?.name}
      projects={projects}
      error={error}
      creating={creating}
      createError={createError}
      onRetry={() => void load()}
      onSignOut={() => void logout()}
      onOpenProject={onOpenProject}
      onCreateProject={(title) => {
        const slug = slugify(title);
        if (!slug) return;
        void create({ title, slug }).then((project) => {
          if (project) onOpenProject(project);
        });
      }}
    />
  );
};
