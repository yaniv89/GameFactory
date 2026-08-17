import { Button, Dialog, Input, Panel, Select, type ViewState } from "@forge/ds";
import { useState } from "react";
import type { MarketplaceSort, PackageDetail, PackageSummary, Review } from "../api/marketplaceApi";
import { RichDialogueText } from "../preview/RichDialogueText";
import "./MarketplaceDialog.css";

const KIND_OPTIONS = [
  { value: "", label: "All kinds" },
  { value: "module", label: "Module" },
  { value: "artpack", label: "Art Pack" },
  { value: "template", label: "Template" },
];

const SORT_OPTIONS = [
  { value: "ranked", label: "Best match" },
  { value: "name", label: "Name (A–Z)" },
];

function formatPriceCents(priceCents: number): string {
  return `$${(priceCents / 100).toFixed(2)}`;
}

function formatRating(rating: number | undefined): string {
  return rating === undefined ? "No reviews yet" : `${rating.toFixed(1)} / 5`;
}

export interface MarketplaceDialogProps {
  open: boolean;
  onClose: () => void;

  listState: ViewState;
  packages: readonly PackageSummary[];
  query: string;
  kind: string | undefined;
  sort: MarketplaceSort;
  hasMoreList: boolean;
  loadingMoreList: boolean;
  onQueryChange: (query: string) => void;
  onKindChange: (kind: string | undefined) => void;
  onSortChange: (sort: MarketplaceSort) => void;
  onRetryList: () => void;
  onLoadMoreList: () => void;
  onSelectPackage: (name: string) => void;

  selectedName: string | undefined;
  detailState: ViewState;
  detail: PackageDetail | undefined;
  onBack: () => void;
  onRetryDetail: () => void;

  reviewsState: ViewState;
  reviews: readonly Review[];
  reviewsAverage: number | undefined;
  reviewsCount: number;
  hasMoreReviews: boolean;
  onLoadMoreReviews: () => void;

  myReview: Review | undefined;
  reviewSubmitting: boolean;
  reviewError: string | undefined;
  onSubmitReview: (rating: number, body: string | undefined) => void;
  onRemoveMyReview: () => void;

  ownsLicense: boolean;
  buying: boolean;
  buyError: string | undefined;
  onBuy: () => void;
}

/**
 * docs/SPEC.md Section 16's marketplace, its first editor UI (G2) —
 * `ListPackagesEndpoint`/`PackageDetailAndVersionsEndpoint`/`ReviewsEndpoint`
 * (F1) had no consumer before this. Two sub-views in one Dialog rather
 * than a route: `selectedName` toggles between the browse list and a
 * package's own detail, the same "one Dialog, one piece of state decides
 * what's inside it" shape `PackSwapDialogContainer` already uses for its
 * own multi-step flow.
 */
export function MarketplaceDialog(props: MarketplaceDialogProps) {
  const { open, onClose, selectedName } = props;

  return (
    <Dialog
      open={open}
      title={selectedName ? "Package" : "Marketplace"}
      onClose={onClose}
      actions={
        <>
          {selectedName && (
            <Button variant="secondary" onClick={props.onBack}>
              Back to browse
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="fg-marketplace">{selectedName ? <PackageDetailView {...props} /> : <BrowseView {...props} />}</div>
    </Dialog>
  );
}

function BrowseView(props: MarketplaceDialogProps) {
  return (
    <div className="fg-marketplace__browse">
      <div className="fg-marketplace__filters">
        <Input label="Search" value={props.query} onChange={(e) => props.onQueryChange(e.target.value)} placeholder="Search packages…" />
        <Select
          label="Kind"
          options={KIND_OPTIONS}
          value={props.kind ?? ""}
          onChange={(e) => props.onKindChange(e.target.value || undefined)}
        />
        <Select
          label="Sort"
          options={SORT_OPTIONS}
          value={props.sort}
          onChange={(e) => props.onSortChange(e.target.value as MarketplaceSort)}
        />
      </div>

      <Panel
        title="Packages"
        state={props.listState}
        empty={{
          title: "No packages match your search",
          description: "Try a different search term or clear the kind filter.",
          actionLabel: "Clear filters",
          onAction: () => {
            props.onQueryChange("");
            props.onKindChange(undefined);
          },
        }}
        error={{
          title: "Couldn't load the marketplace",
          description: "The request timed out. Your connection may be slow, or the server may be unavailable.",
          onRetry: props.onRetryList,
        }}
        permissionDenied={{
          title: "You don't have access to browse the marketplace",
          description: "Ask a workspace owner or admin for access.",
        }}
        offline={{
          title: "Offline — can't browse the marketplace",
          description: "Reconnect to search and install packages.",
        }}
      >
        <ul className="fg-list fg-marketplace__list">
          {props.packages.map((pkg) => (
            <li key={pkg.id} className="fg-marketplace__row">
              <button type="button" className="fg-marketplace__row-button" onClick={() => props.onSelectPackage(pkg.name)}>
                <span className="fg-list__primary">{pkg.displayName}</span>
                <span className="fg-list__secondary">
                  {pkg.name} · {pkg.kind}
                  {pkg.latestVersion && ` · v${pkg.latestVersion}`}
                </span>
                <p className="fg-marketplace__summary">{pkg.summary}</p>
              </button>
            </li>
          ))}
        </ul>
        {props.hasMoreList && (
          <Button variant="secondary" onClick={props.onLoadMoreList} disabled={props.loadingMoreList}>
            {props.loadingMoreList ? "Loading…" : "Load more"}
          </Button>
        )}
      </Panel>
    </div>
  );
}

function PackageDetailView(props: MarketplaceDialogProps) {
  return (
    <div className="fg-marketplace__detail">
      <Panel
        title="Package"
        state={props.detailState}
        error={{ title: "Couldn't load this package", description: "The request timed out or the package no longer exists.", onRetry: props.onRetryDetail }}
        permissionDenied={{ title: "You don't have access to this package", description: "Ask a workspace owner or admin for access." }}
        offline={{ title: "Offline — can't load this package", description: "Reconnect to see its details." }}
      >
        {props.detail && (
          <>
            <header className="fg-marketplace__detail-header">
              <h3>{props.detail.displayName}</h3>
              <span className="fg-marketplace__detail-name">{props.detail.name}</span>
              <p>{props.detail.summary}</p>
              <div className="fg-marketplace__detail-meta">
                <span>{props.detail.licenseSpdx}</span>
                <span>{formatRating(props.detail.averageRating)}</span>
                <span>
                  {props.detail.reviewCount} review{props.detail.reviewCount === 1 ? "" : "s"}
                </span>
              </div>
              <BuySection {...props} detail={props.detail} />
            </header>

            {props.detail.readmeMarkdown && (
              <div className="fg-marketplace__readme">
                <RichDialogueText text={props.detail.readmeMarkdown} />
              </div>
            )}
          </>
        )}
      </Panel>

      {props.detail && <ReviewsSection {...props} />}
    </div>
  );
}

function BuySection({ detail, ownsLicense, buying, buyError, onBuy }: MarketplaceDialogProps & { detail: PackageDetail }) {
  if (detail.pricingModel === "free") {
    return <span className="fg-marketplace__price fg-marketplace__price--free">Free</span>;
  }
  if (ownsLicense) {
    return <span className="fg-marketplace__price fg-marketplace__price--owned">Owned</span>;
  }
  return (
    <div className="fg-marketplace__buy">
      <span className="fg-marketplace__price">{formatPriceCents(detail.priceCents)}</span>
      <Button variant="primary" loading={buying} onClick={onBuy}>
        Buy
      </Button>
      {buyError && (
        <p className="fg-marketplace__error" role="alert">
          {buyError}
        </p>
      )}
    </div>
  );
}

function ReviewsSection(props: MarketplaceDialogProps) {
  return (
    <Panel
      title="Reviews"
      state={props.reviewsState}
      empty={{
        title: "No reviews yet",
        description: "Be the first to share what you think of this package.",
        actionLabel: "Write a review",
        onAction: () => document.getElementById("fg-marketplace-review-rating")?.focus(),
      }}
      error={{ title: "Couldn't load reviews", description: "The request timed out. Try again.", onRetry: props.onRetryDetail }}
      permissionDenied={{ title: "You don't have access to these reviews", description: "Ask a workspace owner or admin for access." }}
      offline={{ title: "Offline — can't load reviews", description: "Reconnect to see what others think." }}
    >
      <ReviewComposer {...props} />
      <ul className="fg-list fg-marketplace__reviews">
        {props.reviews.map((review) => (
          <li key={review.id} className="fg-marketplace__review-row">
            <StarRatingDisplay rating={review.rating} />
            {review.id === props.myReview?.id && <span className="fg-marketplace__review-mine">Your review</span>}
            {review.body && <RichDialogueText text={review.body} />}
          </li>
        ))}
      </ul>
      {props.hasMoreReviews && (
        <Button variant="secondary" onClick={props.onLoadMoreReviews}>
          Load more reviews
        </Button>
      )}
    </Panel>
  );
}

function StarRatingDisplay({ rating }: { rating: number }) {
  return (
    <span className="fg-marketplace__stars" role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} aria-hidden="true" className={n <= rating ? "fg-marketplace__star fg-marketplace__star--filled" : "fg-marketplace__star"}>
          ★
        </span>
      ))}
    </span>
  );
}

function ReviewComposer(props: MarketplaceDialogProps) {
  const [rating, setRating] = useState(props.myReview?.rating ?? 0);
  const [body, setBody] = useState(props.myReview?.body ?? "");

  return (
    <div className="fg-marketplace__composer">
      <fieldset className="fg-marketplace__rating-input">
        <legend>{props.myReview ? "Update your rating" : "Rate this package"}</legend>
        <div role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              id={n === 1 ? "fg-marketplace-review-rating" : undefined}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              className={n <= rating ? "fg-marketplace__star-button fg-marketplace__star-button--filled" : "fg-marketplace__star-button"}
              onClick={() => setRating(n)}
            >
              ★
            </button>
          ))}
        </div>
      </fieldset>
      <Input
        label="Review (optional)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What did you think?"
      />
      <div className="fg-marketplace__composer-actions">
        <Button variant="primary" disabled={rating === 0} loading={props.reviewSubmitting} onClick={() => props.onSubmitReview(rating, body.trim() || undefined)}>
          {props.myReview ? "Update review" : "Submit review"}
        </Button>
        {props.myReview && (
          <Button variant="ghost" onClick={props.onRemoveMyReview}>
            Remove your review
          </Button>
        )}
      </div>
      {props.reviewError && (
        <p className="fg-marketplace__error" role="alert">
          {props.reviewError}
        </p>
      )}
    </div>
  );
}
