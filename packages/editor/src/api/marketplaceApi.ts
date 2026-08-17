import { httpJson } from "./httpClient";

/** Mirrors services/Forge.Api/Features/Registry/PackageDtos.cs's `PackageSummaryResponse`. */
export interface PackageSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly displayName: string;
  readonly summary: string;
  readonly licenseSpdx: string;
  readonly isDeprecated: boolean;
  readonly createdAt: string;
  readonly latestVersion: string | undefined;
}

/** Mirrors `PackageListResponse`. */
export interface PackageListPage {
  readonly packages: readonly PackageSummary[];
  readonly nextCursor: string | undefined;
}

/** Mirrors `PackageDetailResponse` (G2: gained `pricingModel`/`priceCents`). */
export interface PackageDetail {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly authorUserId: string;
  readonly displayName: string;
  readonly summary: string;
  readonly readmeMarkdown: string | undefined;
  readonly homepageUrl: string | undefined;
  readonly licenseSpdx: string;
  readonly isDeprecated: boolean;
  readonly createdAt: string;
  readonly averageRating: number | undefined;
  readonly reviewCount: number;
  readonly pricingModel: "free" | "one_time" | "subscription";
  readonly priceCents: number;
}

/** Mirrors `ReviewDtos.cs`'s `ReviewResponse`. */
export interface Review {
  readonly id: string;
  readonly userId: string | undefined;
  readonly rating: number;
  readonly body: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string | undefined;
}

/** Mirrors `ReviewListResponse`. */
export interface ReviewListPage {
  readonly reviews: readonly Review[];
  readonly nextCursor: string | undefined;
  readonly averageRating: number | undefined;
  readonly reviewCount: number;
}

/** Mirrors `Forge.Api.Features.Marketplace.MarketplaceDtos.cs`'s `LicenseResponse`. */
export interface License {
  readonly id: string;
  readonly packageName: string;
  readonly grantedVia: string;
  readonly grantedAt: string;
  readonly expiresAt: string | undefined;
}

export type MarketplaceSort = "name" | "ranked";

/** `GET /api/v1/packages` (`ListPackagesEndpoint.cs`) — anonymous, but this app only ever calls it from within a signed-in session. */
export function listPackages(
  options: { query?: string | undefined; kind?: string | undefined; sort?: MarketplaceSort | undefined; cursor?: string | undefined } = {},
): Promise<PackageListPage> {
  const params = new URLSearchParams();
  if (options.query) params.set("q", options.query);
  if (options.kind) params.set("kind", options.kind);
  if (options.sort) params.set("sort", options.sort);
  if (options.cursor) params.set("cursor", options.cursor);
  const qs = params.toString();
  return httpJson<PackageListPage>(`/api/v1/packages${qs ? `?${qs}` : ""}`);
}

/** `GET /api/v1/packages/{name}` (`PackageDetailAndVersionsEndpoint.cs`). A scoped name's own `/` is passed through unencoded — the route is a catch-all, same convention every other package-name caller here follows. */
export function getPackage(name: string): Promise<PackageDetail> {
  return httpJson<PackageDetail>(`/api/v1/packages/${name}`);
}

/** `GET /api/v1/packages/{name}/reviews` — newest first. */
export function listReviews(name: string, cursor?: string): Promise<ReviewListPage> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return httpJson<ReviewListPage>(`/api/v1/packages/${name}/reviews${qs}`);
}

/** `PUT /api/v1/packages/{name}/reviews` — create-or-update the caller's own review (`ReviewsEndpoint.cs`). */
export function upsertReview(name: string, rating: number, body: string | undefined): Promise<Review> {
  return httpJson<Review>(`/api/v1/packages/${name}/reviews`, { method: "PUT", body: { rating, body } });
}

/** `DELETE /api/v1/packages/{name}/reviews`. */
export function deleteReview(name: string): Promise<undefined> {
  return httpJson<undefined>(`/api/v1/packages/${name}/reviews`, { method: "DELETE" });
}

/** `GET /api/v1/workspaces/{workspaceId}/licenses` (`LicensesEndpoint.cs`) — a bare array, not wrapped, and already filtered to non-revoked licenses. Used to tell "already owned" apart from "buy". */
export function listLicenses(workspaceId: string): Promise<readonly License[]> {
  return httpJson<readonly License[]>(`/api/v1/workspaces/${workspaceId}/licenses`);
}

/**
 * `POST /api/v1/checkout/sessions` (`PurchaseCheckoutSessionEndpoint.cs`)
 * — creates a real Stripe Checkout Session and a `Pending` `Purchase` row;
 * only the signature-verified webhook ever grants the `License`, so the
 * caller's job is just to navigate the browser to the returned URL, not
 * to treat this response as proof of purchase.
 */
export function createCheckoutSession(workspaceId: string, packageName: string): Promise<{ url: string }> {
  return httpJson<{ url: string }>("/api/v1/checkout/sessions", { method: "POST", body: { workspaceId, packageName } });
}
