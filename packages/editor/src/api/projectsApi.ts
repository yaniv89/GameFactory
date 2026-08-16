import { ApiError, httpJson } from "./httpClient";

/** Mirrors services/Forge.Api/Features/Auth/MeEndpoint.cs's `WorkspaceSummary`. */
export interface WorkspaceSummary {
  readonly workspaceId: string;
  readonly slug: string;
  readonly name: string;
  readonly plan: string;
  readonly role: string;
}

/** Mirrors `MeResponse`. */
export interface MeResponse {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly emailVerifiedAt: string | undefined;
  readonly workspaces: readonly WorkspaceSummary[];
}

/** Mirrors services/Forge.Api/Features/Projects/ProjectDtos.cs's `ProjectSummaryResponse`. */
export interface ProjectSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly slug: string;
  readonly title: string;
  readonly visibility: string;
  readonly headRevision: number | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateProjectInput {
  readonly slug: string;
  readonly title: string;
  readonly description?: string;
  readonly engineVersion: string;
  readonly genreTemplate?: string;
}

/** Mirrors `ProjectDocumentResponse` — `document` is whatever JSON the last commit stored, shaped like `ProjectDocument` in `store/projectStore.ts`. */
export interface ProjectDocumentEnvelope {
  readonly revisionId: number;
  readonly parentId: number | undefined;
  readonly label: string | undefined;
  readonly document: unknown;
  readonly createdAt: string;
}

export interface CommitRevisionInput {
  readonly expectedHeadRevision: number | undefined;
  readonly label: string | undefined;
  readonly isCheckpoint: boolean;
  readonly document: unknown;
}

export interface CommitRevisionResult {
  readonly revisionId: number;
  readonly docHash: string;
  readonly createdAt: string;
}

/** Mirrors `RevisionSummaryResponse` — one row of the history list, newest first. */
export interface RevisionSummary {
  readonly id: number;
  readonly parentId: number | undefined;
  readonly authorId: string | undefined;
  readonly label: string | undefined;
  readonly sizeBytes: number;
  readonly isCheckpoint: boolean;
  readonly createdAt: string;
}

/** Mirrors `RevisionHistoryResponse`. `nextCursor` is `undefined` once there's no older page left. */
export interface RevisionHistoryPage {
  readonly revisions: readonly RevisionSummary[];
  readonly nextCursor: number | undefined;
}

export interface RestoreRevisionInput {
  readonly expectedHeadRevision: number | undefined;
  readonly label: string | undefined;
}

/** `GET /api/v1/me` — profile, workspaces, and each workspace's plan, resolved from the token subject (MeEndpoint.cs). */
export function getMe(): Promise<MeResponse> {
  return httpJson<MeResponse>("/api/v1/me");
}

/** `GET /api/v1/workspaces/{workspaceId}/projects` */
export function listProjects(workspaceId: string): Promise<ProjectSummary[]> {
  return httpJson<ProjectSummary[]>(`/api/v1/workspaces/${workspaceId}/projects`);
}

/** `POST /api/v1/workspaces/{workspaceId}/projects` */
export function createProject(workspaceId: string, input: CreateProjectInput): Promise<ProjectSummary> {
  return httpJson<ProjectSummary>(`/api/v1/workspaces/${workspaceId}/projects`, { method: "POST", body: input });
}

/**
 * `GET /api/v1/projects/{projectId}/document` — 404s when the project has
 * no revisions yet (a project is created empty; the first save is what
 * creates revision 1), which the caller treats as "start from a blank
 * document", not as an error.
 */
export async function getProjectDocument(projectId: string): Promise<ProjectDocumentEnvelope | undefined> {
  try {
    return await httpJson<ProjectDocumentEnvelope>(`/api/v1/projects/${projectId}/document`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return undefined;
    throw error;
  }
}

/**
 * `POST /api/v1/projects/{projectId}/revisions` — the server enforces
 * optimistic concurrency on `expectedHeadRevision` (RevisionCommitService.cs):
 * a stale value throws an `ApiError` with `status === 409` and
 * `extensions.actualHeadRevision` set, which the caller must surface as a
 * conflict rather than silently retrying with the local document.
 */
export function commitRevision(projectId: string, input: CommitRevisionInput): Promise<CommitRevisionResult> {
  return httpJson<CommitRevisionResult>(`/api/v1/projects/${projectId}/revisions`, { method: "POST", body: input });
}

/**
 * `GET /api/v1/projects/{projectId}/revisions` — cursor-paginated, newest
 * first (ListRevisionsEndpoint.cs). `cursor` is the last-seen revision id
 * from a previous page's `nextCursor`; omit it for the first page.
 */
export function listRevisions(projectId: string, cursor?: number): Promise<RevisionHistoryPage> {
  const query = cursor !== undefined ? `?cursor=${cursor}` : "";
  return httpJson<RevisionHistoryPage>(`/api/v1/projects/${projectId}/revisions${query}`);
}

/**
 * `POST /api/v1/projects/{projectId}/revisions/{revisionId}/restore` —
 * forward-only like the rest of the log: this commits the old revision's
 * document as a brand new head rather than rewinding history
 * (RestoreRevisionEndpoint.cs), so nothing already committed is ever lost.
 * Same optimistic-concurrency conflict shape as `commitRevision` — a stale
 * `expectedHeadRevision` throws an `ApiError` with `status === 409`.
 */
export function restoreRevision(projectId: string, revisionId: number, input: RestoreRevisionInput): Promise<CommitRevisionResult> {
  return httpJson<CommitRevisionResult>(`/api/v1/projects/${projectId}/revisions/${revisionId}/restore`, { method: "POST", body: input });
}
