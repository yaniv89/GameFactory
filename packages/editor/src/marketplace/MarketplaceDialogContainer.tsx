import { useMarketplaceStore } from "../project/marketplaceStore";
import { useProjectStore } from "../store/projectStore";
import { MarketplaceDialog } from "./MarketplaceDialog";

/**
 * Wires `useMarketplaceStore` to the presentational `MarketplaceDialog` —
 * the same Container/View split every other dialog in this app uses
 * (`AssetsLibraryDialogContainer`, `PackSwapDialogContainer`). Unlike
 * those, `open`/`onClose` aren't props here — `marketplaceStore.ts`'s own
 * doc comment explains why (two independent open triggers: the toolbar
 * and `ModulesPanel`'s empty-state action, which lives inside dockview's
 * component tree).
 */
export function MarketplaceDialogContainer() {
  const state = useMarketplaceStore();
  const isInstalled = useProjectStore((s) => (state.selectedName ? state.selectedName in s.document.installedModules : false));

  return (
    <MarketplaceDialog
      open={state.dialogOpen}
      onClose={state.close}
      listState={state.listStatus}
      packages={state.packages}
      query={state.query}
      kind={state.kind}
      sort={state.sort}
      hasMoreList={state.nextCursor !== undefined}
      loadingMoreList={state.loadingMore}
      onQueryChange={state.setQuery}
      onKindChange={state.setKind}
      onSortChange={state.setSort}
      onRetryList={() => void state.loadList()}
      onLoadMoreList={() => void state.loadMoreList()}
      onSelectPackage={(name) => void state.selectPackage(name)}
      selectedName={state.selectedName}
      detailState={state.detailStatus}
      detail={state.detail}
      onBack={state.clearSelection}
      onRetryDetail={() => state.selectedName && void state.selectPackage(state.selectedName)}
      reviewsState={state.reviewsStatus}
      reviews={state.reviews}
      reviewsAverage={state.reviewsAverage}
      reviewsCount={state.reviewsCount}
      hasMoreReviews={state.reviewsNextCursor !== undefined}
      onLoadMoreReviews={() => void state.loadMoreReviews()}
      myReview={state.myReview}
      reviewSubmitting={state.reviewSubmitting}
      reviewError={state.reviewError}
      onSubmitReview={(rating, body) => void state.submitReview(rating, body)}
      onRemoveMyReview={() => void state.removeMyReview()}
      ownsLicense={state.ownsLicense}
      buying={state.buying}
      buyError={state.buyError}
      onBuy={() => void state.buy()}
      isInstalled={isInstalled}
      installing={state.installing}
      installError={state.installError}
      onInstall={() => void state.install()}
    />
  );
}
