import { WORKSPACE_PATHS } from "./workspaceRoutes";
import { openLearningReview } from "./postEventLearningReview";

export function navigateLearningReview(proposal, principalId, navigate) {
  if (!openLearningReview(proposal, principalId)) {
    throw new Error("The exact learning review context is unavailable.");
  }
  navigate(proposal.destination === "inventory" ? WORKSPACE_PATHS.inventory : WORKSPACE_PATHS.catalog);
  return { status: "review_opened" };
}

export default navigateLearningReview;
