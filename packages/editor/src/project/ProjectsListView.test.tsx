import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "../api/projectsApi";
import { ProjectsListView } from "./ProjectsListView";

const PROJECT: ProjectSummary = {
  id: "p1",
  workspaceId: "ws1",
  slug: "starter-rpg",
  title: "Starter RPG",
  visibility: "private",
  headRevision: 3,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-08-10T00:00:00Z",
};

const BASE = {
  workspaceName: "Ada's Workspace",
  error: undefined,
  creating: false,
  createError: undefined,
  onRetry: () => {},
  onSignOut: () => {},
  onOpenProject: () => {},
  onCreateProject: () => {},
};

describe("ProjectsListView", () => {
  it("shows the empty-state copy when there are no projects", () => {
    render(<ProjectsListView {...BASE} state="empty" projects={[]} />);
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
  });

  it("lists projects and opens one on click", async () => {
    const onOpenProject = vi.fn();
    render(<ProjectsListView {...BASE} state="populated" projects={[PROJECT]} onOpenProject={onOpenProject} />);
    await userEvent.click(screen.getByRole("button", { name: /Starter RPG/ }));
    expect(onOpenProject).toHaveBeenCalledWith(PROJECT);
  });

  it("shows an error message and retries", async () => {
    const onRetry = vi.fn();
    render(<ProjectsListView {...BASE} state="error" projects={[]} error="Server unavailable." onRetry={onRetry} />);
    expect(screen.getByText("Couldn't load your projects")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows permission-denied copy", () => {
    render(<ProjectsListView {...BASE} state="permission-denied" projects={[]} />);
    expect(screen.getByText("You don't have access to this workspace")).toBeInTheDocument();
  });

  it("shows offline copy", () => {
    render(<ProjectsListView {...BASE} state="offline" projects={[]} />);
    expect(screen.getByText("You're offline")).toBeInTheDocument();
  });

  it("shows a loading skeleton", () => {
    render(<ProjectsListView {...BASE} state="loading" projects={[]} />);
    expect(screen.getByRole("status", { name: "Loading your projects" })).toBeInTheDocument();
  });

  it("submits the create form with the typed title and clears it", async () => {
    const onCreateProject = vi.fn();
    render(<ProjectsListView {...BASE} state="populated" projects={[]} onCreateProject={onCreateProject} />);
    const input = screen.getByLabelText("New project name");
    await userEvent.type(input, "My New Game");
    await userEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(onCreateProject).toHaveBeenCalledWith("My New Game");
    expect(input).toHaveValue("");
  });

  it("shows a create error without losing the populated list", () => {
    render(<ProjectsListView {...BASE} state="populated" projects={[PROJECT]} createError="Slug already in use." />);
    expect(screen.getByText(/Slug already in use/)).toBeInTheDocument();
    expect(screen.getByText("Starter RPG")).toBeInTheDocument();
  });

  it("fires onSignOut from the header", async () => {
    const onSignOut = vi.fn();
    render(<ProjectsListView {...BASE} state="empty" projects={[]} onSignOut={onSignOut} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
