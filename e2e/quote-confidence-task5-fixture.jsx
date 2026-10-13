import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import QuoteCompletionCommandPath from "../src/components/QuoteCompletionCommandPath";
import DecisionPacketPanel from "../src/components/DecisionPacketPanel";
import { PostEventLearningView } from "../src/components/PostEventLearningPanel";
import PostEventLearningReviewBanner from "../src/components/PostEventLearningReviewBanner";
import { buildQuoteCompletionProjection } from "../src/lib/quoteCompletionProjection";
import { buildPostEventLearningProjection } from "../src/lib/postEventLearningProjection";
import { openLearningReview, observeLearningInventoryReceipt } from "../src/lib/postEventLearningReview";
import { learningFixture } from "../src/lib/__tests__/postEventLearning.fixture";
import "../src/styles.css";

function Harness() {
  const [complete, setComplete] = useState(false);
  const [handoff, setHandoff] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const fixture = useMemo(learningFixture, []);
  const action = { id: "send_quote", label: "Send proposal", visible: true, enabled: true };
  const completion = buildQuoteCompletionProjection({
    quote: { id: "quote-one", activeVersionId: "version-one", status: "draft" },
    readiness: { complete, score: complete ? 100 : 70, gaps: complete ? [] : [{ id: "customer-name", label: "Customer name" }], recommendedGaps: [] },
    saveBlockers: complete ? [] : [{ id: "client-name", message: "Add the client name." }],
    configuredActions: { modelId: "configured-quote-action-state-v2", state: { versionSaved: true, providerAccepted: false }, actions: { send_quote: action }, primaryAction: action }
  });
  const projection = useMemo(() => buildPostEventLearningProjection(fixture), [fixture]);
  return <main data-e2e-authority="mock-server" style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
    <h1>Quote-to-Confidence local journey fixture</h1><p>Synthetic local authority adapters; no hosted acceptance or write.</p>
    <QuoteCompletionCommandPath enabled projection={completion} onAction={async () => { setComplete(true); return { status: "resolved" }; }} />
    <DecisionPacketPanel enabled quote={fixture.quote} source="firebase" onOpenAcceptedRevision={setHandoff} />
    {handoff && <p role="status" data-exact-handoff={handoff.acceptedRevisionId}>Accepted handoff: {handoff.quoteId} / {handoff.acceptedRevisionId} / {handoff.acceptanceReceiptId}. Booking and payment remain separate.</p>}
    <PostEventLearningView projection={projection} role="admin" onReview={async (proposal) => { openLearningReview(proposal, "admin-one"); setReviewOpen(true); return { status: "review_opened" }; }} />
    {reviewOpen && <section aria-label="Existing authority review fixture"><h2>Existing Library or Inventory review</h2>
      <PostEventLearningReviewBanner enabled organizationId="org-one" principalId="admin-one" role="admin" />
      <button type="button" className="ghost" onClick={() => observeLearningInventoryReceipt({ uid: "admin-one", payload: { command: { kind: "publish_menu_recipe", menuItemId: "dinner" } } }, { ok: true, organizationId: "org-one", receipt: { receiptId: "mock-existing-recipe-receipt" } })}>Return mock recipe authority receipt</button>
    </section>}
  </main>;
}
createRoot(document.getElementById("root")).render(<Harness />);
