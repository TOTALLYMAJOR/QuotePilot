import { WORKSPACE_PATHS } from "./workspaceRoutes";
// Tab-memory presentation context only. Reload clears it; it never authorizes a write.
let current = null;
const listeners = new Set();
const emit = () => listeners.forEach((listener) => { try { listener(); } catch { /* observers never affect authority */ } });
export const subscribeLearningReview = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export const getLearningReview = () => current;
export function clearLearningReview() { current = null; emit(); }
export function openLearningReview(proposal, principalId) {
  if (!proposal?.scope?.organizationId || !principalId) return false;
  current = { ...structuredClone(proposal), principalId, receipt: null, confirmed: false };
  emit(); return true;
}
export function navigateLearningReview(proposal, principalId, navigate) {
  if (!openLearningReview(proposal, principalId)) throw new Error("The exact learning review context is unavailable.");
  navigate(proposal.destination === "inventory" ? WORKSPACE_PATHS.inventory : WORKSPACE_PATHS.catalog);
  return { status: "review_opened" };
}
export function observeLearningInventoryReceipt(attempt, result) {
  if (!current || result?.ok !== true || current.scope.organizationId !== result.organizationId || current.principalId !== attempt.uid) return false;
  const command = attempt?.payload?.command || {};
  const category = command.kind === "publish_menu_recipe" ? "recipe" : command.kind === "publish_pack_conversion" ? "pack_conversion" : null;
  const targetId = category === "recipe" ? command.menuItemId : command.ingredientId;
  if (category !== current.category || !Array.isArray(current.targetIds) || !current.targetIds.includes(targetId) || !result.receipt?.receiptId) return false;
  current = { ...current, receipt: { receiptId: result.receipt.receiptId, targetId, commandKind: command.kind }, confirmed: false };
  emit(); return true;
}
export function confirmLearningReview({ organizationId, principalId, receiptId }) {
  if (!current || current.confirmed || current.scope.organizationId !== organizationId || current.principalId !== principalId || !receiptId || current.receipt?.receiptId !== receiptId) return null;
  current = { ...current, confirmed: true }; emit(); return current.category;
}
