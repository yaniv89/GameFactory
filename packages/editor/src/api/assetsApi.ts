import { httpBlob, httpJson } from "./httpClient";

/** Mirrors services/Forge.Api/Features/Assets/AssetDtos.cs's `AssetSummaryResponse`. */
export interface AssetSummary {
  readonly id: string;
  readonly projectId: string | undefined;
  readonly originalName: string;
  readonly status: "pending" | "processing" | "ready" | "failed";
  readonly sizeBytes: number;
  readonly width: number | undefined;
  readonly height: number | undefined;
  readonly errorMessage: string | undefined;
  readonly createdAt: string;
  readonly completedAt: string | undefined;
}

/** Mirrors `UploadAssetResponse`. */
export interface UploadAssetResult {
  readonly id: string;
  readonly status: string;
  readonly createdAt: string;
}

/** `GET /api/v1/workspaces/{workspaceId}/assets` — newest first (`ListAssetsEndpoint.cs`). */
export function listAssets(workspaceId: string): Promise<{ assets: readonly AssetSummary[] }> {
  return httpJson<{ assets: readonly AssetSummary[] }>(`/api/v1/workspaces/${workspaceId}/assets`);
}

/**
 * `POST /api/v1/workspaces/{workspaceId}/assets` — `originalName` doubles
 * as the resolution path `@forge/art-pack`'s `resolveAsset` (tier 2) and
 * `GetAssetContentEndpoint.cs` both key on (that endpoint's own doc
 * comment explains why project-uploaded assets share one path namespace
 * rather than one URL per asset id). `file` is read client-side into
 * base64 — `UploadAssetEndpoint.cs` never accepts a multipart body,
 * matching every other bundle-upload endpoint in this API
 * (`PublishVersionEndpoint.cs`'s own convention).
 */
export async function uploadAsset(workspaceId: string, originalName: string, declaredMimeType: string, file: File): Promise<UploadAssetResult> {
  const contentBase64 = await fileToBase64(file);
  return httpJson<UploadAssetResult>(`/api/v1/workspaces/${workspaceId}/assets`, {
    method: "POST",
    body: { originalName, declaredMimeType, contentBase64, projectId: undefined },
  });
}

/** `DELETE /api/v1/assets/{id}` (`DeleteAssetEndpoint.cs`). */
export function deleteAsset(assetId: string): Promise<undefined> {
  return httpJson<undefined>(`/api/v1/assets/${assetId}`, { method: "DELETE" });
}

/**
 * Fetches a `Ready` asset's real decoded content (`GetAssetContentEndpoint.cs`,
 * path-keyed by `originalName`) and hands back a browser object URL a
 * plain `<img src>` or PixiJS `Assets.load()` can use directly — neither
 * can attach the `Authorization` header this endpoint requires, so the
 * bytes have to come through `httpBlob` first. Callers own revoking the
 * returned URL (`URL.revokeObjectURL`) once they're done with it; this
 * function has no lifecycle hook to do that itself.
 */
export async function fetchAssetContentUrl(workspaceId: string, path: string): Promise<string> {
  const blob = await httpBlob(`/api/v1/workspaces/${workspaceId}/assets/content/${encodePathSegments(path)}`);
  return URL.createObjectURL(blob);
}

function encodePathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // `readAsDataURL`'s own result shape: `data:<mime>;base64,<data>` —
      // the part after the first comma is exactly the base64 payload
      // `UploadAssetRequest.ContentBase64` expects, without this
      // function needing its own chunked-binary-to-base64 loop.
      const result = reader.result as string;
      const commaIndex = result.indexOf(",");
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read '${file.name}'.`));
    reader.readAsDataURL(file);
  });
}
