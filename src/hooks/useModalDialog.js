import { useEffect, useRef } from "react";
import { isolateModalBackground } from "../lib/modalBackgroundIsolation";

export const MODAL_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])"
].join(", ");

let bodyScrollLockCount = 0;
let bodyOverflowBeforeLock = "";
const activeModalTokens = [];

export function acquireModalBodyScrollLock() {
  if (typeof document === "undefined") return () => {};
  if (bodyScrollLockCount === 0) {
    bodyOverflowBeforeLock = document.body.style.overflow;
  }
  bodyScrollLockCount += 1;
  document.body.style.overflow = "hidden";

  let released = false;
  return () => {
    if (released) return;
    released = true;
    bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
    if (bodyScrollLockCount === 0) {
      document.body.style.overflow = bodyOverflowBeforeLock;
      bodyOverflowBeforeLock = "";
    }
  };
}

export function resolveModalFocusWrap({
  activeIndex = -1,
  focusableCount = 0,
  shiftKey = false,
  activeInside = true
} = {}) {
  if (focusableCount <= 0) return "container";
  if (!activeInside) return shiftKey ? "last" : "first";
  if (shiftKey && activeIndex === 0) return "last";
  if (!shiftKey && activeIndex === focusableCount - 1) return "first";
  return "";
}

function visibleFocusableElements(dialog) {
  return Array.from(dialog?.querySelectorAll(MODAL_FOCUSABLE_SELECTOR) || [])
    .filter((element) => (
      element instanceof HTMLElement
      && element.getClientRects().length > 0
      && element.getAttribute("aria-hidden") !== "true"
    ));
}

function resolveConfiguredReturnFocus(returnFocusRef) {
  const configured = returnFocusRef?.current;
  if (configured instanceof HTMLElement) return configured;
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

export function useModalDialog({
  open,
  onRequestClose,
  canClose = true,
  onCloseBlocked,
  initialFocusRef = null,
  returnFocusRef = null,
  isolateBackground = false
} = {}) {
  const dialogRef = useRef(null);
  const onRequestCloseRef = useRef(onRequestClose);
  const onCloseBlockedRef = useRef(onCloseBlocked);
  const canCloseRef = useRef(canClose);

  useEffect(() => {
    onRequestCloseRef.current = onRequestClose;
    onCloseBlockedRef.current = onCloseBlocked;
    canCloseRef.current = canClose;
  }, [canClose, onCloseBlocked, onRequestClose]);

  useEffect(() => {
    if (!open || typeof window === "undefined" || typeof document === "undefined") {
      return undefined;
    }

    const dialog = dialogRef.current;
    const modalToken = {};
    activeModalTokens.push(modalToken);
    const returnTarget = resolveConfiguredReturnFocus(returnFocusRef);
    const releaseBodyScrollLock = acquireModalBodyScrollLock();
    // Move focus before hiding the branch that contained the invoking control.
    if (isolateBackground) dialog?.focus?.({ preventScroll: true });
    const releaseBackground = isolateBackground
      ? isolateModalBackground(dialog)
      : () => {};
    const focusFrame = window.requestAnimationFrame(() => {
      if (activeModalTokens.at(-1) !== modalToken) return;
      const focusable = visibleFocusableElements(dialog);
      const preferred = initialFocusRef?.current
        || dialog?.querySelector("[data-modal-initial-focus]");
      const target = focusable.includes(preferred) ? preferred : focusable[0] || dialog;
      target?.focus?.({ preventScroll: true });
    });

    const handleKeyDown = (event) => {
      if (activeModalTokens.at(-1) !== modalToken) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        const closeAllowed = typeof canCloseRef.current === "function"
          ? canCloseRef.current()
          : canCloseRef.current !== false;
        if (!closeAllowed) {
          onCloseBlockedRef.current?.();
          return;
        }
        onRequestCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = visibleFocusableElements(dialog);
      const activeIndex = focusable.indexOf(document.activeElement);
      const destination = resolveModalFocusWrap({
        activeIndex,
        focusableCount: focusable.length,
        shiftKey: event.shiftKey,
        activeInside: Boolean(dialog?.contains(document.activeElement))
      });
      if (!destination) return;
      event.preventDefault();
      if (destination === "container") {
        dialog?.focus?.({ preventScroll: true });
      } else if (destination === "last") {
        focusable[focusable.length - 1]?.focus?.({ preventScroll: true });
      } else {
        focusable[0]?.focus?.({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      const stackIndex = activeModalTokens.lastIndexOf(modalToken);
      if (stackIndex >= 0) activeModalTokens.splice(stackIndex, 1);
      releaseBackground();
      releaseBodyScrollLock();
      window.requestAnimationFrame(() => {
        if (
          activeModalTokens.length > 0
          || document.querySelector('[role="dialog"][aria-modal="true"]')
        ) return;
        if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
      });
    };
  }, [initialFocusRef, isolateBackground, open, returnFocusRef]);

  return { dialogRef };
}
