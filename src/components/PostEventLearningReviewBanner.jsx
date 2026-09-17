import { useEffect, useSyncExternalStore } from "react";
import { clearLearningReview, confirmLearningReview, getLearningReview, subscribeLearningReview } from "../lib/postEventLearningReview";
import { recordPostEventLearningApplied } from "../lib/productAnalyticsAmbient";

export default function PostEventLearningReviewBanner({ organizationId, principalId, role, enabled }) {
  const review = useSyncExternalStore(subscribeLearningReview, getLearningReview, () => null);
  const eligible = enabled && role === "admin" && review?.scope.organizationId === organizationId && review?.principalId === principalId;
  useEffect(() => { if (review && !eligible) clearLearningReview(); }, [eligible, review]);
  if (!review || !eligible) return null;
  return <aside className="post-event-learning container" aria-label="Event learning review context" data-capability-id="post-event-learning-review" data-capability-state={review.confirmed ? "receipt" : review.receipt ? "review_required" : "ready"}>
    <h2>Review a lesson from the accepted event</h2>
    <p>{review.rationale}</p><p>Source quote {review.scope.quoteId}, accepted version {review.scope.sourceVersionId}. Make and approve changes through the existing editor below.</p>
    {review.targetIds.length > 0 && <p>Review target references: {review.targetIds.join(", ")}. Select these existing records in the editor; nothing is prefilled or published.</p>}
    <details><summary>Recommendation source references</summary><ul>{review.sourceReferences.map((reference, index) => <li key={index}>{reference}</li>)}</ul></details>
    {review.receipt ? <><p>Existing authority receipt: {review.receipt.receiptId}. Target: {review.receipt.targetId}.</p>
      {review.confirmed ? <p role="status">You confirmed that this published change applies the recommendation. The observation is not outcome evidence.</p> : <button type="button" className="ghost" onClick={() => {
        const category = confirmLearningReview({ organizationId, principalId, receiptId: review.receipt.receiptId });
        if (category) recordPostEventLearningApplied({ category, receiptVerified: true });
      }}>Confirm this receipt applies the recommendation</button>}
    </> : <p>{["recipe", "pack_conversion"].includes(review.category) && review.targetIds.length ? "Application remains unconfirmed until the exact target returns an existing publication receipt and you confirm that it applies this recommendation." : "Application tracking is blocked by integration: this recommendation has no compatible existing adoption receipt. Review manually; no applied observation will be emitted."}</p>}
    <button type="button" className="ghost" onClick={clearLearningReview}>Close learning context</button>
  </aside>;
}
