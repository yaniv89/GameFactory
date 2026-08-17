import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PackageDetail, PackageSummary, Review } from "../api/marketplaceApi";
import { MarketplaceDialog, type MarketplaceDialogProps } from "./MarketplaceDialog";

const NOOP = () => {};

const PACKAGE: PackageSummary = {
  id: "p1",
  name: "@acme/farming",
  kind: "module",
  displayName: "Farming",
  summary: "Plant, water, and harvest crops.",
  licenseSpdx: "MIT",
  isDeprecated: false,
  createdAt: "2026-01-01T00:00:00Z",
  latestVersion: "1.2.0",
};

const DETAIL: PackageDetail = {
  id: "p1",
  name: "@acme/farming",
  kind: "module",
  authorUserId: "author-1",
  displayName: "Farming",
  summary: "Plant, water, and harvest crops.",
  readmeMarkdown: "A full farming system.",
  homepageUrl: undefined,
  licenseSpdx: "MIT",
  isDeprecated: false,
  createdAt: "2026-01-01T00:00:00Z",
  averageRating: 4.5,
  reviewCount: 2,
  pricingModel: "one_time",
  priceCents: 999,
};

const REVIEW: Review = {
  id: "r1",
  userId: "user-1",
  rating: 5,
  body: "Great module!",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: undefined,
};

const BASE_PROPS: MarketplaceDialogProps = {
  open: true,
  onClose: NOOP,

  listState: "populated",
  packages: [PACKAGE],
  query: "",
  kind: undefined,
  sort: "ranked",
  hasMoreList: false,
  loadingMoreList: false,
  onQueryChange: NOOP,
  onKindChange: NOOP,
  onSortChange: NOOP,
  onRetryList: NOOP,
  onLoadMoreList: NOOP,
  onSelectPackage: NOOP,

  selectedName: undefined,
  detailState: "populated",
  detail: undefined,
  onBack: NOOP,
  onRetryDetail: NOOP,

  reviewsState: "populated",
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

describe("MarketplaceDialog — browse", () => {
  it("lists packages and lets a person select one", async () => {
    const onSelectPackage = vi.fn();
    render(<MarketplaceDialog {...BASE_PROPS} onSelectPackage={onSelectPackage} />);

    expect(screen.getByText("Farming")).toBeInTheDocument();
    expect(screen.getByText(/Plant, water, and harvest crops\./)).toBeInTheDocument();

    await userEvent.click(screen.getByText("Farming"));
    expect(onSelectPackage).toHaveBeenCalledWith("@acme/farming");
  });

  it("shows the loading state", () => {
    render(<MarketplaceDialog {...BASE_PROPS} listState="loading" packages={[]} />);
    expect(screen.getByRole("status", { name: /loading packages/i })).toBeInTheDocument();
  });

  it("shows the empty state with a clear-filters action", async () => {
    const onQueryChange = vi.fn();
    const onKindChange = vi.fn();
    render(<MarketplaceDialog {...BASE_PROPS} listState="empty" packages={[]} onQueryChange={onQueryChange} onKindChange={onKindChange} />);

    expect(screen.getByText("No packages match your search")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onQueryChange).toHaveBeenCalledWith("");
    expect(onKindChange).toHaveBeenCalledWith(undefined);
  });

  it("shows the error state with a retry action", async () => {
    const onRetryList = vi.fn();
    render(<MarketplaceDialog {...BASE_PROPS} listState="error" packages={[]} onRetryList={onRetryList} />);

    expect(screen.getByText("Couldn't load the marketplace")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetryList).toHaveBeenCalled();
  });

  it("shows the permission-denied state", () => {
    render(<MarketplaceDialog {...BASE_PROPS} listState="permission-denied" packages={[]} />);
    expect(screen.getByText("You don't have access to browse the marketplace")).toBeInTheDocument();
  });

  it("shows the offline state", () => {
    render(<MarketplaceDialog {...BASE_PROPS} listState="offline" packages={[]} />);
    expect(screen.getByText("Offline — can't browse the marketplace")).toBeInTheDocument();
  });

  it("searches and filters by kind and sort", async () => {
    const onQueryChange = vi.fn();
    const onKindChange = vi.fn();
    const onSortChange = vi.fn();
    render(<MarketplaceDialog {...BASE_PROPS} onQueryChange={onQueryChange} onKindChange={onKindChange} onSortChange={onSortChange} />);

    await userEvent.type(screen.getByLabelText("Search"), "f");
    expect(onQueryChange).toHaveBeenCalled();

    await userEvent.selectOptions(screen.getByLabelText("Kind"), "module");
    expect(onKindChange).toHaveBeenCalledWith("module");

    await userEvent.selectOptions(screen.getByLabelText("Sort"), "name");
    expect(onSortChange).toHaveBeenCalledWith("name");
  });

  it("shows a Load more button when there's another page", async () => {
    const onLoadMoreList = vi.fn();
    render(<MarketplaceDialog {...BASE_PROPS} hasMoreList onLoadMoreList={onLoadMoreList} />);

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(onLoadMoreList).toHaveBeenCalled();
  });
});

describe("MarketplaceDialog — package detail", () => {
  const DETAIL_PROPS: MarketplaceDialogProps = { ...BASE_PROPS, selectedName: "@acme/farming", detail: DETAIL };

  it("shows package details, price, and a Buy button", () => {
    render(<MarketplaceDialog {...DETAIL_PROPS} />);

    expect(screen.getByText("Farming")).toBeInTheDocument();
    expect(screen.getByText("@acme/farming")).toBeInTheDocument();
    expect(screen.getByText("$9.99")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Buy" })).toBeInTheDocument();
  });

  it("shows Free instead of a Buy button for a free package", () => {
    render(<MarketplaceDialog {...DETAIL_PROPS} detail={{ ...DETAIL, pricingModel: "free", priceCents: 0 }} />);
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Buy" })).not.toBeInTheDocument();
  });

  it("shows Owned instead of a Buy button when the workspace already holds a license", () => {
    render(<MarketplaceDialog {...DETAIL_PROPS} ownsLicense />);
    expect(screen.getByText("Owned")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Buy" })).not.toBeInTheDocument();
  });

  it("starts checkout on Buy", async () => {
    const onBuy = vi.fn();
    render(<MarketplaceDialog {...DETAIL_PROPS} onBuy={onBuy} />);
    await userEvent.click(screen.getByRole("button", { name: "Buy" }));
    expect(onBuy).toHaveBeenCalled();
  });

  it("shows an Install action for a free package that isn't installed yet", async () => {
    const onInstall = vi.fn();
    render(<MarketplaceDialog {...DETAIL_PROPS} detail={{ ...DETAIL, pricingModel: "free", priceCents: 0 }} onInstall={onInstall} />);
    await userEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(onInstall).toHaveBeenCalled();
  });

  it("shows an Install action once a workspace license is held, even though Buy is gone", () => {
    render(<MarketplaceDialog {...DETAIL_PROPS} ownsLicense />);
    expect(screen.getByText("Owned")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument();
  });

  it("shows no Install action at all for a paid package the workspace doesn't own", () => {
    render(<MarketplaceDialog {...DETAIL_PROPS} ownsLicense={false} />);
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });

  it("shows Installed instead of an Install button once the module is already in this project", () => {
    render(<MarketplaceDialog {...DETAIL_PROPS} ownsLicense isInstalled />);
    expect(screen.getByText("Installed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });

  it("shows the Install button as loading while installing, and disables a second click", () => {
    render(<MarketplaceDialog {...DETAIL_PROPS} ownsLicense installing />);
    expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument();
  });

  it("surfaces an install error", () => {
    render(<MarketplaceDialog {...DETAIL_PROPS} ownsLicense installError="Could not install this package." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not install this package.");
  });

  it("shows a live-preview caveat note next to an available Install action, but not once installed", () => {
    const { rerender } = render(<MarketplaceDialog {...DETAIL_PROPS} ownsLicense isInstalled={false} />);
    expect(screen.getByText(/live in-editor preview/i)).toBeInTheDocument();

    rerender(<MarketplaceDialog {...DETAIL_PROPS} ownsLicense isInstalled />);
    expect(screen.queryByText(/live in-editor preview/i)).not.toBeInTheDocument();
  });

  it("goes back to browse", async () => {
    const onBack = vi.fn();
    render(<MarketplaceDialog {...DETAIL_PROPS} onBack={onBack} />);
    await userEvent.click(screen.getByRole("button", { name: "Back to browse" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("lists reviews and shows the average", () => {
    render(<MarketplaceDialog {...DETAIL_PROPS} reviews={[REVIEW]} reviewsCount={1} reviewsAverage={5} />);
    expect(screen.getByText("Great module!")).toBeInTheDocument();
    expect(screen.getByLabelText("5 out of 5 stars")).toBeInTheDocument();
  });

  it("marks the caller's own review", () => {
    render(<MarketplaceDialog {...DETAIL_PROPS} reviews={[REVIEW]} myReview={REVIEW} />);
    expect(screen.getByText("Your review")).toBeInTheDocument();
  });

  it("submits a new review with a chosen rating and body", async () => {
    const onSubmitReview = vi.fn();
    render(<MarketplaceDialog {...DETAIL_PROPS} onSubmitReview={onSubmitReview} />);

    const submitButton = screen.getByRole("button", { name: "Submit review" });
    expect(submitButton).toBeDisabled();

    await userEvent.click(screen.getByRole("radio", { name: "4 stars" }));
    expect(submitButton).toBeEnabled();

    await userEvent.type(screen.getByLabelText("Review (optional)"), "Solid.");
    await userEvent.click(submitButton);

    expect(onSubmitReview).toHaveBeenCalledWith(4, "Solid.");
  });

  it("offers to remove and pre-fills an existing review", () => {
    render(<MarketplaceDialog {...DETAIL_PROPS} myReview={REVIEW} />);
    expect(screen.getByRole("button", { name: "Update review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove your review" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "5 stars" })).toHaveAttribute("aria-checked", "true");
  });

  it("shows a review submission error", () => {
    render(<MarketplaceDialog {...DETAIL_PROPS} reviewError="Could not submit your review." />);
    expect(screen.getByText("Could not submit your review.")).toBeInTheDocument();
  });

  it("shows the detail error state", () => {
    render(<MarketplaceDialog {...DETAIL_PROPS} detailState="error" detail={undefined} />);
    expect(screen.getByText("Couldn't load this package")).toBeInTheDocument();
  });
});
