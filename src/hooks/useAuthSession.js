import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { doc, getDoc } from "firebase/firestore";
import {
  refreshCurrentUserAccess,
  refreshCurrentUserVerification,
  resendCurrentUserVerification,
  signOutCurrentUser
} from "../lib/authClient";
import { auth, cloudFunctions, db, firebaseReady } from "../lib/firebase";
import { resolveOrganizationId } from "../lib/organizationService";
import { recordDiagnosticError, recordDiagnosticEvent } from "../lib/sessionDiagnostics";
import { clearTenantContextCache } from "../lib/tenantDomainService";

const ROLE_VALUES = new Set(["admin", "sales", "customer"]);
const E2E_AUTH_BYPASS = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_E2E_BYPASS_AUTH || "").trim().toLowerCase()
);
const E2E_ROLE = ROLE_VALUES.has(String(import.meta.env.VITE_E2E_ROLE || "").trim().toLowerCase())
  ? String(import.meta.env.VITE_E2E_ROLE || "").trim().toLowerCase()
  : "admin";
const E2E_EMAIL = String(import.meta.env.VITE_E2E_EMAIL || "e2e-admin@local.test").trim().toLowerCase();
const E2E_UID = String(import.meta.env.VITE_E2E_UID || "e2e-admin").trim() || "e2e-admin";
const E2E_ORGANIZATION_ID = String(
  import.meta.env.VITE_E2E_ORGANIZATION_ID
  ?? import.meta.env.VITE_DEFAULT_ORGANIZATION_ID
  ?? ""
).trim();
const E2E_PLATFORM_ADMIN = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_E2E_PLATFORM_ADMIN || "true").trim().toLowerCase()
);
const ORG_BOOTSTRAP_CALLABLE = "ensureOrganizationBootstrap";
const ORG_BOOTSTRAP_TIMEOUT_MS = Math.max(
  1000,
  Number(import.meta.env.VITE_ORG_BOOTSTRAP_TIMEOUT_MS || 12000) || 12000
);
function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return ROLE_VALUES.has(role) ? role : "customer";
}

function normalizeOrganizationIdStrict(value) {
  return resolveOrganizationId(value, "");
}

function resolveRuntimePrincipal({ claimOrg = "", roleRecord = { role: "customer", organizationId: "" } } = {}) {
  const normalizedClaimOrg = normalizeOrganizationIdStrict(claimOrg);
  const normalizedRoleDocRole = normalizeRole(roleRecord?.role);
  const normalizedRoleDocOrg = normalizeOrganizationIdStrict(roleRecord?.organizationId);

  if (normalizedClaimOrg && normalizedRoleDocOrg && normalizedClaimOrg !== normalizedRoleDocOrg) {
    throw new Error("Claim organization does not match role scope.");
  }

  return {
    role: normalizedRoleDocRole,
    organizationId: normalizedRoleDocOrg
  };
}

function withTimeout(promise, timeoutMs, label = "operation") {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function loadRoleReadOnly(user) {
  if (!user || !db) {
    return {
      role: "customer",
      organizationId: resolveOrganizationId("", ""),
      platformAdmin: false
    };
  }

  const roleRef = doc(db, "userRoles", user.uid);
  const roleSnap = await getDoc(roleRef);
  const existing = roleSnap.exists() ? (roleSnap.data() || {}) : {};
  return {
    role: normalizeRole(existing.role),
    organizationId: resolveOrganizationId(existing.organizationId, ""),
    platformAdmin: false
  };
}

async function bootstrapRoleWithCallable(user) {
  if (!cloudFunctions || !user) {
    throw new Error("Callable organization bootstrap is unavailable.");
  }
  const call = httpsCallable(cloudFunctions, ORG_BOOTSTRAP_CALLABLE);
  const result = await withTimeout(call({}), ORG_BOOTSTRAP_TIMEOUT_MS, "organization bootstrap callable");
  const data = result?.data || {};
  return {
    role: normalizeRole(data.role),
    organizationId: resolveOrganizationId(data.organizationId, ""),
    platformAdmin: data.platformAdmin === true
  };
}

function mustFailClosedOnBootstrapError(error) {
  const code = String(error?.code || "").trim().toLowerCase();
  return [
    "functions/failed-precondition",
    "functions/permission-denied",
    "functions/unauthenticated"
  ].includes(code);
}

async function loadOrCreateRole(user) {
  if (!user || !db) {
    return {
      role: "customer",
      organizationId: resolveOrganizationId("", "")
    };
  }

  try {
    const callableResult = await bootstrapRoleWithCallable(user);
    return callableResult;
  } catch (err) {
    if (mustFailClosedOnBootstrapError(err)) {
      throw err;
    }
    recordDiagnosticEvent({
      level: "warning",
      type: "auth.org-bootstrap.callable-fallback",
      message: err?.message || "Falling back to read-only role lookup."
    });
  }

  return loadRoleReadOnly(user);
}

export function useAuthSession({ tenantContext = null } = {}) {
  const [state, setState] = useState({
    loading: true,
    user: null,
    role: "customer",
    organizationId: normalizeOrganizationIdStrict(""),
    platformAdmin: false,
    error: ""
  });

  useEffect(() => {
    let active = true;

    if (tenantContext?.loading) {
      setState((prev) => ({
        ...prev,
        loading: true
      }));
      return () => {
        active = false;
      };
    }

    if (tenantContext?.blocked) {
      setState({
        loading: false,
        user: null,
        role: "customer",
        organizationId: normalizeOrganizationIdStrict(""),
        platformAdmin: false,
        error: tenantContext.error || "Tenant host is not active."
      });
      return () => {
        active = false;
      };
    }

    if (E2E_AUTH_BYPASS) {
      setState({
        loading: false,
        user: {
          uid: E2E_UID,
          email: E2E_EMAIL
        },
        role: E2E_ROLE,
        organizationId: tenantContext?.hostType === "tenant"
          ? normalizeOrganizationIdStrict(tenantContext.organizationId)
          : normalizeOrganizationIdStrict(E2E_ORGANIZATION_ID),
        platformAdmin: E2E_PLATFORM_ADMIN,
        error: ""
      });
      return () => {
        active = false;
      };
    }

    if (!firebaseReady || !auth || !db) {
      recordDiagnosticEvent({
        level: "warning",
        type: "auth.unavailable",
        message: "Firebase auth unavailable in current session."
      });
      setState({
        loading: false,
        user: null,
        role: "customer",
        organizationId: normalizeOrganizationIdStrict(""),
        platformAdmin: false,
        error: "Firebase Auth is unavailable. Check env config."
      });
      return () => {
        active = false;
      };
    }

    const stop = onAuthStateChanged(auth, async (nextUser) => {
      if (!active) return;
      if (!nextUser) {
        setState({
          loading: false,
          user: null,
          role: "customer",
          organizationId: normalizeOrganizationIdStrict(""),
          platformAdmin: false,
          error: ""
        });
        return;
      }

      setState((prev) => ({ ...prev, loading: true, error: "" }));
      try {
        if (nextUser.emailVerified !== true) {
          if (!active) return;
          setState({
            loading: false,
            user: nextUser,
            role: "customer",
            organizationId: normalizeOrganizationIdStrict(""),
            platformAdmin: false,
            error: "Verify your email address before staff or owner access can be activated."
          });
          return;
        }
        const tokenResult = await nextUser.getIdTokenResult();
        const claimOrg = normalizeOrganizationIdStrict(tokenResult?.claims?.organizationId);
        const roleRecord = await loadOrCreateRole(nextUser);
        const runtimePrincipal = resolveRuntimePrincipal({
          claimOrg,
          roleRecord
        });
        let organizationId = normalizeOrganizationIdStrict(runtimePrincipal.organizationId);
        const platformAdmin = roleRecord.platformAdmin === true;
        const tenantHostOrg = tenantContext?.hostType === "tenant"
          ? normalizeOrganizationIdStrict(tenantContext.organizationId)
          : "";
        if (tenantHostOrg) {
          if (!organizationId || organizationId !== tenantHostOrg) {
            throw new Error("Signed-in account is outside this tenant.");
          }
        }
        if (
          (runtimePrincipal.role === "admin" || runtimePrincipal.role === "sales")
          && !organizationId
          && !platformAdmin
        ) {
          throw new Error("Staff account is missing organization scope.");
        }
        if (!active) return;
        setState({
          loading: false,
          user: nextUser,
          role: runtimePrincipal.role,
          organizationId,
          platformAdmin,
          error: ""
        });
      } catch (err) {
        if (!active) return;
        recordDiagnosticError(err, {
          surface: "auth-session",
          action: "resolve-role",
          uid: nextUser?.uid || ""
        });
        setState({
          loading: false,
          user: nextUser,
          role: "customer",
          organizationId: normalizeOrganizationIdStrict(""),
          platformAdmin: false,
          error: err?.message || "Failed to load role data."
        });
      }
    });

    return () => {
      active = false;
      stop();
    };
  }, [tenantContext?.loading, tenantContext?.blocked, tenantContext?.error, tenantContext?.hostType, tenantContext?.organizationId]);

  const roleFlags = useMemo(() => {
    const isAdmin = state.role === "admin";
    const isStaff = isAdmin || state.role === "sales";
    return { isAdmin, isStaff };
  }, [state.role]);

  return {
    ...state,
    ...roleFlags,
    resendVerification: E2E_AUTH_BYPASS
      ? async () => ({ alreadyVerified: true })
      : resendCurrentUserVerification,
    refreshVerification: E2E_AUTH_BYPASS
      ? async () => ({ emailVerified: true })
      : refreshCurrentUserVerification,
    refreshAccess: E2E_AUTH_BYPASS
      ? async () => ({ refreshed: true, emailVerified: true })
      : refreshCurrentUserAccess,
    signOut: E2E_AUTH_BYPASS
      ? async () => {
        clearTenantContextCache();
        setState({
          loading: false,
          user: null,
        role: "customer",
        organizationId: normalizeOrganizationIdStrict(""),
        platformAdmin: false,
        error: ""
        });
      }
      : async () => {
        clearTenantContextCache();
        await signOutCurrentUser();
      }
  };
}
