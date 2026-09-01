import { useCallback, useEffect, useRef, useState } from "react";
import {
  createCatalogSetupRequestId,
  getCatalogSetupDraft,
  publishCatalogSetupDraft,
  reviewCatalogSetupDraft,
  saveCatalogSetupDraft
} from "../lib/catalogSetupDraftService";

export const CATALOG_DRAFT_AUTOSAVE_DELAY_MS = 800;

function isConflict(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return code.includes("aborted")
    || message.includes("generation changed")
    || message.includes("revision changed")
    || message.includes("another device");
}

function mergeChanges(current = [], incoming = []) {
  const byId = new Map((Array.isArray(current) ? current : []).map((change) => [
    `${change.collection}:${change.recordId}`,
    change
  ]));
  (Array.isArray(incoming) ? incoming : []).forEach((change) => {
    byId.set(`${change.collection}:${change.recordId}`, change);
  });
  return [...byId.values()].sort((left, right) => (
    `${left.collection}:${left.recordId}`.localeCompare(`${right.collection}:${right.recordId}`)
  ));
}

export function catalogDraftStateLabel(state = "idle", changedRecordCount = 0) {
  if (state === "saving") return "Saving draft";
  if (state === "saved") return "Draft saved";
  if (state === "sync_failed") return "Sync failed — changes are device-only";
  if (state === "conflict") return "Revision conflict";
  if (state === "ready_review" || changedRecordCount > 0) return "Ready to review";
  return "Draft saved";
}

export function useCatalogSetupDraft({
  enabled = true,
  organizationId = "",
  baseCatalogRevision = 0,
  autosaveDelayMs = CATALOG_DRAFT_AUTOSAVE_DELAY_MS
} = {}) {
  const [state, setState] = useState({
    loading: enabled,
    status: "idle",
    generation: 0,
    changedRecordCount: 0,
    serverChanges: [],
    deviceChanges: [],
    deviceOnly: false,
    error: "",
    review: null,
    receipt: null
  });
  const pendingRef = useRef([]);
  const timerRef = useRef(null);
  const syncingRef = useRef(false);
  const generationRef = useRef(0);
  const baseRevisionRef = useRef(Number(baseCatalogRevision || 0));

  useEffect(() => {
    baseRevisionRef.current = Number(baseCatalogRevision || 0);
  }, [baseCatalogRevision]);

  useEffect(() => {
    let active = true;
    if (!enabled || !organizationId) {
      setState((previous) => ({ ...previous, loading: false }));
      return () => { active = false; };
    }
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    getCatalogSetupDraft({ organizationId }).then((result) => {
      if (!active) return;
      const draft = result?.draft || {};
      generationRef.current = Number(draft.generation || 0);
      if (draft.state === "open") {
        baseRevisionRef.current = Number(draft.baseCatalogRevision || baseCatalogRevision || 0);
      }
      setState((previous) => ({
        ...previous,
        loading: false,
        status: draft.changedRecordCount > 0 ? "ready_review" : "idle",
        generation: generationRef.current,
        changedRecordCount: Number(draft.changedRecordCount || 0),
        serverChanges: Array.isArray(draft.changes) ? draft.changes : [],
        error: ""
      }));
    }).catch((error) => {
      if (!active) return;
      setState((previous) => ({
        ...previous,
        loading: false,
        status: isConflict(error) ? "conflict" : "sync_failed",
        error: error?.message || "Failed to load the catalog setup draft."
      }));
    });
    return () => {
      active = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, organizationId]);

  const syncPending = useCallback(async () => {
    if (syncingRef.current || pendingRef.current.length === 0) return null;
    const patches = pendingRef.current;
    pendingRef.current = [];
    syncingRef.current = true;
    let completed = false;
    setState((previous) => ({
      ...previous,
      status: "saving",
      deviceChanges: patches,
      deviceOnly: false,
      error: ""
    }));
    try {
      const result = await saveCatalogSetupDraft({
        organizationId,
        requestId: createCatalogSetupRequestId("draft"),
        expectedGeneration: generationRef.current,
        baseCatalogRevision: baseRevisionRef.current,
        patches
      });
      const draft = result?.draft || {};
      generationRef.current = Number(draft.generation || generationRef.current);
      setState((previous) => ({
        ...previous,
        status: Number(draft.changedRecordCount || 0) > 0 ? "ready_review" : "saved",
        generation: generationRef.current,
        changedRecordCount: Number(draft.changedRecordCount || 0),
        serverChanges: Array.isArray(draft.changes) ? draft.changes : previous.serverChanges,
        deviceChanges: [],
        deviceOnly: false,
        error: ""
      }));
      completed = true;
      return result;
    } catch (error) {
      pendingRef.current = mergeChanges(patches, pendingRef.current);
      setState((previous) => ({
        ...previous,
        status: isConflict(error) ? "conflict" : "sync_failed",
        deviceChanges: pendingRef.current,
        deviceOnly: true,
        error: error?.message || "Draft synchronization failed."
      }));
      return null;
    } finally {
      syncingRef.current = false;
      if (completed && pendingRef.current.length > 0) {
        timerRef.current = setTimeout(() => void syncPending(), autosaveDelayMs);
      }
    }
  }, [autosaveDelayMs, organizationId]);

  const queueChanges = useCallback((changes = []) => {
    if (!enabled || !organizationId || !Array.isArray(changes) || changes.length === 0) return false;
    pendingRef.current = mergeChanges(pendingRef.current, changes);
    setState((previous) => ({
      ...previous,
      status: "saving",
      deviceChanges: pendingRef.current,
      deviceOnly: true,
      review: null,
      receipt: null,
      error: ""
    }));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void syncPending(), autosaveDelayMs);
    return true;
  }, [autosaveDelayMs, enabled, organizationId, syncPending]);

  const retry = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    return syncPending();
  }, [syncPending]);

  const review = useCallback(async () => {
    if (pendingRef.current.length > 0) await syncPending();
    const result = await reviewCatalogSetupDraft({
      organizationId,
      expectedGeneration: generationRef.current,
      baseCatalogRevision: baseRevisionRef.current
    });
    setState((previous) => ({ ...previous, status: "ready_review", review: result, error: "" }));
    return result;
  }, [organizationId, syncPending]);

  const publish = useCallback(async () => {
    if (pendingRef.current.length > 0) await syncPending();
    setState((previous) => ({ ...previous, status: "saving", error: "" }));
    try {
      const result = await publishCatalogSetupDraft({
        organizationId,
        requestId: createCatalogSetupRequestId("publish"),
        expectedGeneration: generationRef.current,
        baseCatalogRevision: baseRevisionRef.current
      });
      baseRevisionRef.current = Number(result.catalogRevisionAfter || baseRevisionRef.current);
      generationRef.current = 0;
      setState((previous) => ({
        ...previous,
        status: "saved",
        generation: 0,
        changedRecordCount: 0,
        serverChanges: [],
        deviceChanges: [],
        deviceOnly: false,
        review: null,
        receipt: result,
        error: ""
      }));
      return result;
    } catch (error) {
      setState((previous) => ({
        ...previous,
        status: isConflict(error) ? "conflict" : "sync_failed",
        error: error?.message || "Catalog publication failed."
      }));
      throw error;
    }
  }, [organizationId, syncPending]);

  return {
    ...state,
    label: catalogDraftStateLabel(state.status, state.changedRecordCount),
    baseCatalogRevision: baseRevisionRef.current,
    queueChanges,
    retry,
    review,
    publish,
    syncNow: syncPending
  };
}
