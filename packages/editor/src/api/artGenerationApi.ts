import { httpBlob, httpJson } from "./httpClient";

/** Mirrors `services/Forge.Domain/Entities/GenerationRequest.cs`'s `ArtGenCategory`. */
export type ArtGenCategory = "tile" | "prop";

/** Mirrors `GenerationStatus`. */
export type GenerationStatus = "awaiting_confirmation" | "queued" | "generating" | "ready" | "failed" | "declined";

/** Mirrors `services/Forge.Api/Features/ArtGeneration/ArtGenerationDtos.cs`'s `GenerationVariationResponse`. */
export interface GenerationVariation {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly selected: boolean;
}

/** Mirrors `GenerationRequestResponse`. */
export interface GenerationRequestResult {
  readonly id: string;
  readonly category: ArtGenCategory;
  readonly status: GenerationStatus;
  readonly expandedPrompt: string | undefined;
  readonly errorMessage: string | undefined;
  readonly createdAt: string;
  readonly variations: readonly GenerationVariation[];
}

/** Mirrors `SelectGenerationVariationResponse`. */
export interface SelectVariationResult {
  readonly assetId: string;
  readonly originalName: string;
}

/**
 * `POST .../art-generation` (`CreateGenerationRequestEndpoint.cs`) — the
 * synchronous expansion call. Returns a row already resolved to
 * `awaiting_confirmation`, `declined`, or `failed`; there is nothing to
 * poll yet at this step (that endpoint's own doc comment).
 */
export function createGenerationRequest(
  workspaceId: string,
  projectId: string,
  userPrompt: string,
  category: ArtGenCategory,
): Promise<GenerationRequestResult> {
  return httpJson<GenerationRequestResult>(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/art-generation`, {
    method: "POST",
    body: { userPrompt, category },
  });
}

/** `POST .../art-generation/{id}/confirm` (`ConfirmGenerationRequestEndpoint.cs`) — moves `awaiting_confirmation` to `queued`, where `Forge.Functions.ArtGen` picks it up. */
export function confirmGenerationRequest(workspaceId: string, projectId: string, id: string): Promise<GenerationRequestResult> {
  return httpJson<GenerationRequestResult>(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/art-generation/${id}/confirm`, {
    method: "POST",
  });
}

/** `GET .../art-generation/{id}` (`GetGenerationRequestEndpoint.cs`) — the poll target once confirmed. */
export function getGenerationRequest(workspaceId: string, projectId: string, id: string): Promise<GenerationRequestResult> {
  return httpJson<GenerationRequestResult>(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/art-generation/${id}`);
}

/**
 * Fetches one Ready variation's real bytes (`GetGenerationVariationContentEndpoint.cs`)
 * and hands back a browser object URL, the same pattern
 * `fetchAssetContentUrl` uses for the identical reason (the endpoint
 * requires a Bearer token a plain `<img src>` can't carry). Callers own
 * revoking the returned URL.
 */
export async function fetchVariationContentUrl(workspaceId: string, projectId: string, requestId: string, variationId: string): Promise<string> {
  const blob = await httpBlob(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/art-generation/${requestId}/variations/${variationId}/content`);
  return URL.createObjectURL(blob);
}

/**
 * `POST .../art-generation/{id}/variations/{variationId}/select`
 * (`SelectGenerationVariationEndpoint.cs`) — promotes the chosen variation
 * into a real, named `Asset`. This is the step that makes the result
 * actually usable, not the generation itself (that endpoint's own doc
 * comment: "the point where this whole pipeline stops being a preview and
 * becomes real").
 */
export function selectGenerationVariation(
  workspaceId: string,
  projectId: string,
  requestId: string,
  variationId: string,
  assetName: string,
): Promise<SelectVariationResult> {
  return httpJson<SelectVariationResult>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/art-generation/${requestId}/variations/${variationId}/select`,
    { method: "POST", body: { assetName } },
  );
}
