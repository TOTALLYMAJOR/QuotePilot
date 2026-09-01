import { useCallback, useEffect, useRef, useState } from "react";
import {
  createCatalogSetupRequestId,
  getCatalogSetupDraft,
  publishCatalogSetupDraft,
  reviewCatalogSetupDraft,
  saveCatalogSetupDraft
} from "../lib/catalogSetupDraftService";

export const CATALOG_DRAFT_AUTOSAVE_DELAY_MS = 800;
const CATALOG_SETUP_DEVICE_BUFFER_VERSION = "quotepilot.catalog-setup-device-buffer.v1";

export function catalogSetupDeviceBufferKey(organizationId = "") {
  const scope = encodeURIComponent(String(organizationId || "device").trim() || "device");
  return `${CATALOG_SETUP_DEVICE_BUFFER_VERSION}:${scope}`;
}

function localStorageApi() {
  try {
    return globalThis?.localStorage || null;
  } catch {
    return null;
  }
}

function readDeviceBuffer(organizationId = "") {
  const storage = localStorageApi();
  if (!storage || !organizationId) return null;
  try {
    const parsed = JSON.parse(storage.getItem(catalogSetupDeviceBufferKey(organizationId)) || "null");
    if (parsed?.version !== CATALOG_SETUP_DEVICE_BUFFER_VERSION) return null;
    if (parsed.organizationId !== organizationId || !Array.isArray(parsed.changes)) return null;
    const changes = mergeChanges([], parsed.changes).slice(0, 400);
    return changes.length > 0
      ? { changes, baseCatalogRevision: Math.max(0, Number(parsed.baseCatalogRevision || 0)) }
      : null;
  } catch {
    return null;
  }
}

function writeDeviceBuffer(organizationId, baseCatalogRevision, changes) {
  const storage = localStorageApi();
  if (!storage || !organizationId) return false;
  try {
    const normalized = mergeChanges([], changes).slice(0, 400);
    const key = catalogSetupDeviceBufferKey(organizationId);
    if (normalized.length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify({
      version: CATALOG_SETUP_DEVICE_BUFFER_VERSION,
      organizationId,
      baseCatalogRevision: Math.max(0, Number(baseCatalogRevision || 0)),
      changes: normalized
    }));
    return true;
  } catch {
    return false;
  }
}

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
  const initialBufferRef = useRef(undefined);
  if (initialBufferRef.current === undefined) {
    initialBufferRef.current = readDeviceBuffer(organizationId) || null;
  }
  const initialBuffer = initialBufferRef.current;
  const [state, setState] = useState({
    loading: enabled,
    status: initialBuffer ? "sync_failed" : "idle",
    generation: 0,
    changedRecordCount: initialBuffer?.changes?.length || 0,
    serverChanges: [],
    deviceChanges: initialBuffer?.changes || [],
    deviceOnly: Boolean(initialBuffer),
    error: "",
    review: null,
    receipt: null
  });
  const pendingRef = useRef(initialBuffer?.changes || []);
  const timerRef = useRef(null);
  const syncingRef = useRef(false);
  const generationRef = useRef(0);
  const baseRevisionRef = useRef(Number(initialBuffer?.baseCatalogRevision ?? baseCatalogRevision ?? 0));

  useEffect(() => {
    if (pendingRef.current.length === 0) {
      baseRevisionRef.current = Number(baseCatalogRevision || 0);
    }
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
      const bufferedChanges = pendingRef.current;
      const serverChanges = Array.isArray(draft.changes) ? draft.changes : [];
      const serverBaseRevision = Number(
        draft.state === "open"
          ? draft.baseCatalogRevision
          : result?.currentCatalogRevision ?? baseCatalogRevision ?? 0
      );
      const revisionConflict = bufferedChanges.length > 0
        && Number(initialBuffer?.baseCatalogRevision ?? baseCatalogRevision ?? 0) !== serverBaseRevision;
      baseRevisionRef.current = serverBaseRevision;
      setState((previous) => ({
        ...previous,
        loading: false,
        status: revisionConflict ? "conflict"
          : bufferedChanges.length > 0 ? "sync_failed"
            : draft.changedRecordCount > 0 ? "ready_review" : "idle",
        generation: generationRef.current,
        changedRecordCount: mergeChanges(serverChanges, bufferedChanges).length,
        serverChanges,
        deviceChanges: bufferedChanges,
        deviceOnly: bufferedChanges.length > 0,
        error: ""
      }));
    }).catch((error) => {
      if (!active) return;
      setState((previous) => ({
        ...previous,
        loading: false,
        status: isConflict(error) ? "conflict" : "sync_failed",
        changedRecordCount: mergeChanges(previous.serverChanges, pendingRef.current).length,
        deviceChanges: pendingRef.current,
        deviceOnly: pendingRef.current.length > 0,
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
      deviceOnly: true,
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
      const remainingChanges = pendingRef.current;
      const serverChanges = Array.isArray(draft.changes) ? draft.changes : [];
      if (remainingChanges.length > 0) {
        writeDeviceBuffer(organizationId, baseRevisionRef.current, remainingChanges);
      } else {
        writeDeviceBuffer(organizationId, baseRevisionRef.current, []);
      }
      setState((previous) => ({
        ...previous,
        status: remainingChanges.length > 0
          ? "saving"
          : Number(draft.changedRecordCount || 0) > 0 ? "ready_review" : "saved",
        generation: generationRef.current,
        changedRecordCount: mergeChanges(serverChanges, remainingChanges).length,
        serverChanges: serverChanges.length > 0 ? serverChanges : previous.serverChanges,
        deviceChanges: remainingChanges,
        deviceOnly: remainingChanges.length > 0,
        error: ""
      }));
      completed = true;
      return result;
    } catch (error) {
      pendingRef.current = mergeChanges(patches, pendingRef.current);
      writeDeviceBuffer(organizationId, baseRevisionRef.current, pendingRef.current);
      setState((previous) => ({
        ...previous,
        status: isConflict(error) ? "conflict" : "sync_failed",
        changedRecordCount: mergeChanges(previous.serverChanges, pendingRef.current).length,
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
    writeDeviceBuffer(organizationId, baseRevisionRef.current, pendingRef.current);
    setState((previous) => ({
      ...previous,
      status: "saving",
      changedRecordCount: mergeChanges(previous.serverChanges, pendingRef.current).length,
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

  const discardDeviceChanges = useCallback((changes = []) => {
    const keys = new Set((Array.isArray(changes) ? changes : []).map((change) => (
      `${change?.collection || ""}:${change?.recordId || ""}`
    )));
    if (keys.size === 0) return false;
    const nextPending = pendingRef.current.filter((change) => (
      !keys.has(`${change.collection}:${change.recordId}`)
    ));
    if (nextPending.length === pendingRef.current.length) return false;
    pendingRef.current = nextPending;
    writeDeviceBuffer(organizationId, baseRevisionRef.current, nextPending);
    setState((previous) => {
      const serverChanges = Array.isArray(previous.serverChanges) ? previous.serverChanges : [];
      return {
        ...previous,
        status: nextPending.length > 0
          ? "sync_failed"
          : serverChanges.length > 0 ? "ready_review" : "idle",
        changedRecordCount: mergeChanges(serverChanges, nextPending).length,
        deviceChanges: nextPending,
        deviceOnly: nextPending.length > 0,
        error: nextPending.length > 0 ? previous.error : ""
      };
    });
    return true;
  }, [organizationId]);

  const review = useCallback(async () => {
    if (pendingRef.current.length > 0) {
      await syncPending();
      if (pendingRef.current.length > 0) {
        throw new Error("Synchronize the device-only changes before reviewing this catalog draft.");
      }
    }
    const result = await reviewCatalogSetupDraft({
      organizationId,
      expectedGeneration: generationRef.current,
      baseCatalogRevision: baseRevisionRef.current
    });
    setState((previous) => ({ ...previous, status: "ready_review", review: result, error: "" }));
    return result;
  }, [organizationId, syncPending]);

  const publish = useCallback(async () => {
    if (pendingRef.current.length > 0) {
      await syncPending();
      if (pendingRef.current.length > 0) {
        throw new Error("Synchronize the device-only changes before publishing this catalog draft.");
      }
    }
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
      writeDeviceBuffer(organizationId, baseRevisionRef.current, []);
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
    changes: mergeChanges(state.serverChanges, state.deviceChanges),
    label: catalogDraftStateLabel(state.status, state.changedRecordCount),
    baseCatalogRevision: baseRevisionRef.current,
    queueChanges,
    discardDeviceChanges,
    retry,
    review,
    publish,
    syncNow: syncPending
  };
}
