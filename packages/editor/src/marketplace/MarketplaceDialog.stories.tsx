import type { Meta, StoryObj } from "@storybook/react";
import type { PackageDetail, PackageSummary, Review } from "../api/marketplaceApi";
import { MarketplaceDialog } from "./MarketplaceDialog";

const meta: Meta<typeof MarketplaceDialog> = {
  title: "Editor/MarketplaceDialog",
  component: MarketplaceDialog,
};
export default meta;

type Story = StoryObj<typeof MarketplaceDialog>;

const NOOP = () => {};

const PACKAGES: PackageSummary[] = [
  {
    id: "p1",
    name: "@acme/farming",
    kind: "module",
    displayName: "Farming",
    summary: "Plant, water, and harvest crops with a full growth-cycle simulation.",
    licenseSpdx: "MIT",
    isDeprecated: false,
    createdAt: "2026-01-01T00:00:00Z",
    latestVersion: "1.2.0",
  },
  {
    id: "p2",
    name: "@acme/fantasy-pack",
    kind: "artpack",
    displayName: "Fantasy Tileset",
    summary: "A complete medieval-fantasy art pack with matching character sprites.",
    licenseSpdx: "CC-BY-4.0",
    isDeprecated: false,
    createdAt: "2026-01-01T00:00:00Z",
    latestVersion: "2.0.1",
  },
];

const DETAIL: PackageDetail = {
  id: "p1",
  name: "@acme/farming",
  kind: "module",
  authorUserId: "author-1",
  displayName: "Farming",
  summary: "Plant, water, and harvest crops with a full growth-cycle simulation.",
  readmeMarkdown: "A full farming system with **growth stages**, watering, and seasonal yield changes.",
  homepageUrl: undefined,
  licenseSpdx: "MIT",
  isDeprecated: false,
  createdAt: "2026-01-01T00:00:00Z",
  averageRating: 4.5,
  reviewCount: 2,
  pricingModel: "one_time",
  priceCents: 999,
};

const REVIEWS: Review[] = [
  { id: "r1", userId: "user-1", rating: 5, body: "Exactly what my farm sim needed.", createdAt: "2026-01-03T00:00:00Z", updatedAt: undefined },
  { id: "r2", userId: "user-2", rating: 4, body: "Great, though the config UI is a bit sparse.", createdAt: "2026-01-01T00:00:00Z", updatedAt: undefined },
];

const BROWSE_BASE = {
  open: true,
  onClose: NOOP,
  query: "",
  kind: undefined,
  sort: "ranked" as const,
  hasMoreList: false,
  loadingMoreList: false,
  onQueryChange: NOOP,
  onKindChange: NOOP,
  onSortChange: NOOP,
  onRetryList: NOOP,
  onLoadMoreList: NOOP,
  onSelectPackage: NOOP,
  selectedName: undefined,
  detailState: "populated" as const,
  detail: undefined,
  onBack: NOOP,
  onRetryDetail: NOOP,
  reviewsState: "populated" as const,
  reviews: [],
  reviewsAverage: undefined,
  reviewsCount: 0,
  hasMoreReviews: false,
  onLoadMoreReviews: NOOP,
  myReview: undefined,
  reviewSubmitting: false,
  reviewError: undefined,
  onSubmitReview: NOOP,
  onRemoveMyReview: NOOP,
  ownsLicense: false,
  buying: false,
  buyError: undefined,
  onBuy: NOOP,
  isInstalled: false,
  installing: false,
  installError: undefined,
  onInstall: NOOP,
};

export const BrowseLoading: Story = { args: { ...BROWSE_BASE, listState: "loading", packages: [] } };
export const BrowseEmpty: Story = { args: { ...BROWSE_BASE, listState: "empty", packages: [] } };
export const BrowseError: Story = { args: { ...BROWSE_BASE, listState: "error", packages: [] } };
export const BrowsePermissionDenied: Story = { args: { ...BROWSE_BASE, listState: "permission-denied", packages: [] } };
export const BrowseOffline: Story = { args: { ...BROWSE_BASE, listState: "offline", packages: [] } };
export const BrowsePopulated: Story = { args: { ...BROWSE_BASE, listState: "populated", packages: PACKAGES } };
export const BrowseWithLoadMore: Story = { args: { ...BROWSE_BASE, listState: "populated", packages: PACKAGES, hasMoreList: true } };

const DETAIL_BASE = { ...BROWSE_BASE, selectedName: "@acme/farming", detail: DETAIL };

export const DetailLoading: Story = { args: { ...DETAIL_BASE, detailState: "loading", detail: undefined } };
export const DetailError: Story = { args: { ...DETAIL_BASE, detailState: "error", detail: undefined } };
export const DetailFreePackage: Story = { args: { ...DETAIL_BASE, detail: { ...DETAIL, pricingModel: "free", priceCents: 0 } } };
export const DetailOwned: Story = { args: { ...DETAIL_BASE, ownsLicense: true } };
export const DetailNoReviewsYet: Story = { args: { ...DETAIL_BASE, reviewsState: "empty", reviews: [] } };
export const DetailWithReviews: Story = { args: { ...DETAIL_BASE, reviews: REVIEWS, reviewsAverage: 4.5, reviewsCount: 2 } };
export const DetailWithMyOwnReview: Story = {
  args: { ...DETAIL_BASE, reviews: [REVIEWS[0]!], myReview: REVIEWS[0], reviewsAverage: 5, reviewsCount: 1 },
};
export const DetailBuying: Story = { args: { ...DETAIL_BASE, buying: true } };
export const DetailBuyError: Story = { args: { ...DETAIL_BASE, buyError: "Could not start checkout." } };

// The Install action's own real state space: idle (not yet installed),
// installing, installed, and error — free-or-owned is the precondition
// that makes it show at all (BuySection's own `canInstall`), the same way
// a paid, not-yet-bought package shows no Install action here at all.
export const DetailFreeNotInstalled: Story = {
  args: { ...DETAIL_BASE, detail: { ...DETAIL, pricingModel: "free", priceCents: 0 }, isInstalled: false },
};
export const DetailFreeInstalled: Story = {
  args: { ...DETAIL_BASE, detail: { ...DETAIL, pricingModel: "free", priceCents: 0 }, isInstalled: true },
};
export const DetailOwnedNotInstalled: Story = { args: { ...DETAIL_BASE, ownsLicense: true, isInstalled: false } };
export const DetailOwnedInstalled: Story = { args: { ...DETAIL_BASE, ownsLicense: true, isInstalled: true } };
export const DetailInstalling: Story = { args: { ...DETAIL_BASE, ownsLicense: true, installing: true } };
export const DetailInstallError: Story = {
  args: { ...DETAIL_BASE, ownsLicense: true, installError: "Could not install this package." },
};
// A paid package the workspace doesn't own yet: no Install action at all,
// only Buy — the precondition BuySection's canInstall documents.
export const DetailNotOwnedNoInstallAction: Story = { args: { ...DETAIL_BASE, ownsLicense: false, isInstalled: false } };
