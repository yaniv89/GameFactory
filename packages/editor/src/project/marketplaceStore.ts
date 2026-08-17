import type { ViewState } from "@forge/ds";
import { create } from "zustand";
import { ApiError, NetworkError } from "../api/httpClient";
import {
  createCheckoutSession,
  deleteReview,
  getPackage,
  listLicenses,
  listPackages,
  listReviews,
  upsertReview,
  type License,
  type MarketplaceSort,
  type PackageDetail,
  type PackageSummary,
  type Review,
} from "../api/marketplaceApi";
import { getMe } from "../api/projectsApi";
import { useProjectsStore } from "./projectsStore";

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function toErrorState(error: unknown, fallback: string): { status: ViewState; error: string } {
  if (error instanceof NetworkError) return { status: "offline", error: error.message };
  // Cross-tenant/unauthorized access returns 404, never 403 (CLAUDE.md
  // Section 4.5) — same convention every other store in this app follows.
  if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
    return { status: "permission-denied", error: error.message };
  }
  return { status: "error", error: error instanceof Error ? error.message : fallback };
}

interface MarketplaceState {
  readonly dialogOpen: boolean;
  readonly currentUserId: string | undefined;

  // Browse list
  readonly listStatus: ViewState;
  readonly listError: string | undefined;
  readonly packages: readonly PackageSummary[];
  readonly nextCursor: string | undefined;
  readonly loadingMore: boolean;
  readonly query: string;
  readonly kind: string | undefined;
  readonly sort: MarketplaceSort;

  // Selected package detail + reviews
  readonly selectedName: string | undefined;
  readonly detailStatus: ViewState;
  readonly detailError: string | undefined;
  readonly detail: PackageDetail | undefined;
  readonly reviewsStatus: ViewState;
  readonly reviews: readonly Review[];
  readonly reviewsNextCursor: string | undefined;
  readonly reviewsAverage: number | undefined;
  readonly reviewsCount: number;
  readonly myReview: Review | undefined;
  readonly reviewSubmitting: boolean;
  readonly reviewError: string | undefined;
  readonly ownsLicense: boolean;
  readonly buying: boolean;
  readonly buyError: string | undefined;

  open: () => void;
  close: () => void;
  setQuery: (query: string) => void;
  setKind: (kind: string | undefined) => void;
  setSort: (sort: MarketplaceSort) => void;
  loadList: () => Promise<void>;
  loadMoreList: () => Promise<void>;
  selectPackage: (name: string) => Promise<void>;
  clearSelection: () => void;
  loadMoreReviews: () => Promise<void>;
  submitReview: (rating: number, body: string | undefined) => Promise<void>;
  removeMyReview: () => Promise<void>;
  buy: () => Promise<void>;
}

/**
 * The editor's own marketplace browse/detail/review surface (G2) —
 * `ListPackagesEndpoint`/`PackageDetailAndVersionsEndpoint`/`ReviewsEndpoint`
 * (F1) had no UI consumer at all before this. Lives in `project/` next to
 * `assetsStore`/`revisionHistoryStore`, the same "one store per
 * independently-loading concern" shape those already established.
 *
 * `dialogOpen` lives here rather than as local `useState` in `App.tsx`
 * (unlike `PackSwapDialogContainer`/`AssetsLibraryDialogContainer`,
 * both driven by props from `App.tsx`) because this dialog has two real
 * open triggers — the toolbar and `ModulesPanel`'s "Browse the
 * marketplace" empty-state action, which lives inside dockview's own
 * component tree, not `App.tsx`'s JSX — and a store is the natural
 * place two unrelated call sites share one piece of UI state without
 * prop-drilling through the dockview panel registry.
 */
export const useMarketplaceStore = create<MarketplaceState>()((set, get) => ({
  dialogOpen: false,
  currentUserId: undefined,

  listStatus: "loading",
  listError: undefined,
  packages: [],
  nextCursor: undefined,
  loadingMore: false,
  query: "",
  kind: undefined,
  sort: "ranked",

  selectedName: undefined,
  detailStatus: "loading",
  detailError: undefined,
  detail: undefined,
  reviewsStatus: "loading",
  reviews: [],
  reviewsNextCursor: undefined,
  reviewsAverage: undefined,
  reviewsCount: 0,
  myReview: undefined,
  reviewSubmitting: false,
  reviewError: undefined,
  ownsLicense: false,
  buying: false,
  buyError: undefined,

  open: () => {
    set({ dialogOpen: true, selectedName: undefined });
    if (!get().currentUserId) void getMe().then((me) => set({ currentUserId: me.userId }));
    void get().loadList();
  },

  close: () => set({ dialogOpen: false }),

  setQuery: (query) => {
    set({ query });
    void get().loadList();
  },

  setKind: (kind) => {
    set({ kind });
    void get().loadList();
  },

  setSort: (sort) => {
    set({ sort });
    void get().loadList();
  },

  loadList: async () => {
    if (isOffline()) {
      set({ listStatus: "offline" });
      return;
    }
    const { query, kind, sort } = get();
    set({ listStatus: "loading", listError: undefined });
    try {
      const page = await listPackages({ query: query || undefined, kind, sort });
      set({ listStatus: page.packages.length === 0 ? "empty" : "populated", packages: page.packages, nextCursor: page.nextCursor });
    } catch (error) {
      const { status, error: message } = toErrorState(error, "Could not load the marketplace catalog.");
      set({ listStatus: status, listError: message });
    }
  },

  loadMoreList: async () => {
    const { nextCursor, loadingMore, query, kind, sort } = get();
    // sort=ranked never returns a cursor (ListPackagesEndpoint's own
    // contract) — nextCursor being undefined already guards that case.
    if (!nextCursor || loadingMore) return;
    set({ loadingMore: true });
    try {
      const page = await listPackages({ query: query || undefined, kind, sort, cursor: nextCursor });
      set((state) => ({ packages: [...state.packages, ...page.packages], nextCursor: page.nextCursor, loadingMore: false }));
    } catch {
      // Same "leave the already-loaded page visible" posture
      // revisionHistoryStore's own loadMore uses.
      set({ loadingMore: false });
    }
  },

  selectPackage: async (name) => {
    set({
      selectedName: name,
      detailStatus: "loading",
      detailError: undefined,
      detail: undefined,
      reviewsStatus: "loading",
      reviews: [],
      reviewsNextCursor: undefined,
      myReview: undefined,
      reviewError: undefined,
      ownsLicense: false,
      buyError: undefined,
    });
    if (isOffline()) {
      set({ detailStatus: "offline", reviewsStatus: "offline" });
      return;
    }
    try {
      const detail = await getPackage(name);
      set({ detailStatus: "populated", detail });
    } catch (error) {
      const { status, error: message } = toErrorState(error, "Could not load this package.");
      set({ detailStatus: status, detailError: message });
      return;
    }
    try {
      const page = await listReviews(name);
      const currentUserId = get().currentUserId;
      const myReview = currentUserId ? page.reviews.find((r) => r.userId === currentUserId) : undefined;
      set({
        reviewsStatus: page.reviews.length === 0 ? "empty" : "populated",
        reviews: page.reviews,
        reviewsNextCursor: page.nextCursor,
        reviewsAverage: page.averageRating,
        reviewsCount: page.reviewCount,
        myReview,
      });
    } catch (error) {
      const { status, error: message } = toErrorState(error, "Could not load reviews for this package.");
      set({ reviewsStatus: status, reviewError: message });
    }
    const workspaceId = useProjectsStore.getState().workspace?.workspaceId;
    if (workspaceId) {
      try {
        const licenses = await listLicenses(workspaceId);
        set({ ownsLicense: licenses.some((l) => l.packageName === name) });
      } catch {
        // Ownership just stays "unknown" (false) — the Buy button is a
        // real, working retry path, not a state this failure has to be
        // surfaced as its own error for.
      }
    }
  },

  clearSelection: () => set({ selectedName: undefined }),

  loadMoreReviews: async () => {
    const { selectedName, reviewsNextCursor } = get();
    if (!selectedName || !reviewsNextCursor) return;
    try {
      const page = await listReviews(selectedName, reviewsNextCursor);
      set((state) => ({ reviews: [...state.reviews, ...page.reviews], reviewsNextCursor: page.nextCursor }));
    } catch {
      // Same "leave what's loaded" posture as loadMoreList.
    }
  },

  submitReview: async (rating, body) => {
    const { selectedName } = get();
    if (!selectedName) return;
    set({ reviewSubmitting: true, reviewError: undefined });
    try {
      const review = await upsertReview(selectedName, rating, body);
      set((state) => ({
        reviewSubmitting: false,
        myReview: review,
        // Edit-in-place, matching the backend's own upsert semantics —
        // replace the row if it was already in the (already-loaded) page,
        // otherwise it's a brand new review and belongs at the top
        // (newest-first, the list's own real order).
        reviews: state.reviews.some((r) => r.id === review.id)
          ? state.reviews.map((r) => (r.id === review.id ? review : r))
          : [review, ...state.reviews],
        reviewsStatus: "populated",
      }));
    } catch (error) {
      set({ reviewSubmitting: false, reviewError: error instanceof Error ? error.message : "Could not submit your review." });
    }
  },

  removeMyReview: async () => {
    const { selectedName, myReview } = get();
    if (!selectedName || !myReview) return;
    const previousReviews = get().reviews;
    set((state) => ({ reviews: state.reviews.filter((r) => r.id !== myReview.id), myReview: undefined }));
    try {
      await deleteReview(selectedName);
    } catch (error) {
      set({ reviews: previousReviews, myReview, reviewError: error instanceof Error ? error.message : "Could not remove your review." });
    }
  },

  buy: async () => {
    const { selectedName } = get();
    const workspaceId = useProjectsStore.getState().workspace?.workspaceId;
    if (!selectedName || !workspaceId) return;
    set({ buying: true, buyError: undefined });
    try {
      const { url } = await createCheckoutSession(workspaceId, selectedName);
      // A real redirect to Stripe Checkout, the same "navigate the whole
      // tab away, the callback brings you back" flow the subscription
      // checkout (Billing) already uses — this response is the session
      // URL, not proof of purchase (createCheckoutSession's own doc
      // comment); only the webhook ever grants the License.
      window.location.href = url;
    } catch (error) {
      set({ buying: false, buyError: error instanceof Error ? error.message : "Could not start checkout." });
    }
  },
}));
