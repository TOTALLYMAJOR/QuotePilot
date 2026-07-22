import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { collection, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { signOutCurrentUser } from "../lib/authClient";
import { auth, cloudFunctions, db, firebaseReady } from "../lib/firebase";
import { buildOrganizationProfile, DEFAULT_ORGANIZATION_ID, resolveOrganizationId } from "../lib/organizationService";
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
const ORG_BOOTSTRAP_CALLABLE = "ensureOrganizationBootstrap";
const ORG_BOOTSTRAP_TIMEOUT_MS = Math.max(
  1000,
  Number(import.meta.env.VITE_ORG_BOOTSTRAP_TIMEOUT_MS || 12000) || 12000
);
const AUTH_CLAIMS_MODE = String(import.meta.env.VITE_AUTH_CLAIMS_MODE || "dual").trim().toLowerCase() || "dual";
const BOOTSTRAP_ADMINS = new Set(
  String(import.meta.env.VITE_BOOTSTRAP_ADMIN_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return ROLE_VALUES.has(role) ? role : "customer";
}

function normalizeOrganizationIdStrict(value) {
  return resolveOrganizationId(value, "");
}

function resolveRuntimePrincipal({ claimRole = "customer", claimOrg = "", roleRecord = { role: "customer", organizationId: "" } } = {}) {
  const normalizedClaimRole = normalizeRole(claimRole);
  const normalizedClaimOrg = normalizeOrganizationIdStrict(claimOrg);
  const normalizedRoleDocRole = normalizeRole(roleRecord?.role);
  const normalizedRoleDocOrg = normalizeOrganizationIdStrict(roleRecord?.organizationId);

  if (normalizedClaimOrg && normalizedRoleDocOrg && normalizedClaimOrg !== normalizedRoleDocOrg) {
    throw new Error("Claim organization does not match role scope.");
  }

  if (AUTH_CLAIMS_MODE === "claims") {
    return {
      role: normalizedClaimRole,
      organizationId: normalizedClaimOrg
    };
  }

  if (AUTH_CLAIMS_MODE === "roles") {
    return {
      role: normalizedRoleDocRole,
      organizationId: normalizedRoleDocOrg
    };
  }

  return {
    role: normalizedClaimRole !== "customer" ? normalizedClaimRole : normalizedRoleDocRole,
    organizationId: normalizedClaimOrg || normalizedRoleDocOrg
  };
}

function generateOrganizationId() {
  if (!db) return "";
  return doc(collection(db, "organizations")).id;
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

async function loadOrCreateRoleLegacy(user) {
  if (!user || !db) {
    return {
      role: "customer",
      organizationId: resolveOrganizationId("", "")
    };
  }

  const email = normalizeEmail(user.email);
  const bootstrapRole = BOOTSTRAP_ADMINS.has(email) ? "admin" : "customer";
  const generatedOrganizationId = generateOrganizationId();
  const defaultOrganizationId = bootstrapRole === "admin"
    ? resolveOrganizationId(generatedOrganizationId, DEFAULT_ORGANIZATION_ID)
    : resolveOrganizationId("", "");
  const roleRef = doc(db, "userRoles", user.uid);
  const roleSnap = await getDoc(roleRef);
  if (roleSnap.exists()) {
    const existing = roleSnap.data() || {};
    const role = normalizeRole(existing.role);
    const roleFallbackOrgId = role === "admin" || role === "sales"
      ? resolveOrganizationId(generatedOrganizationId, DEFAULT_ORGANIZATION_ID)
      : "";
    const organizationId = resolveOrganizationId(existing.organizationId, roleFallbackOrgId);

    if (!existing.organizationId) {
      await setDoc(roleRef, {
        organizationId,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

    if (role === "admin") {
      const orgRef = doc(db, "organizations", organizationId);
      const orgSnap = await getDoc(orgRef);
      if (!orgSnap.exists()) {
        const organizationProfile = buildOrganizationProfile({
          organizationId,
          name: "Default Organization",
          slug: "default-organization",
          ownerUid: user.uid,
          ownerEmail: email
        });
        await setDoc(orgRef, {
          name: organizationProfile.name,
          slug: organizationProfile.slug,
          ownerUid: organizationProfile.ownerUid,
          ownerEmail: organizationProfile.ownerEmail,
          updatedAtISO: organizationProfile.updatedAtISO,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });
      }
    }

    return { role, organizationId };
  }

  await setDoc(roleRef, {
    role: bootstrapRole,
    email,
    organizationId: defaultOrganizationId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  if (bootstrapRole === "admin") {
    const orgRef = doc(db, "organizations", defaultOrganizationId);
    const organizationProfile = buildOrganizationProfile({
      organizationId: defaultOrganizationId,
      name: "Default Organization",
      slug: "default-organization",
      ownerUid: user.uid,
      ownerEmail: email
    });
    await setDoc(orgRef, {
      name: organizationProfile.name,
      slug: organizationProfile.slug,
      ownerUid: organizationProfile.ownerUid,
      ownerEmail: organizationProfile.ownerEmail,
      updatedAtISO: organizationProfile.updatedAtISO,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  return {
    role: bootstrapRole,
    organizationId: defaultOrganizationId
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
    organizationId: resolveOrganizationId(data.organizationId, "")
  };
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
    if (callableResult.organizationId || callableResult.role !== "customer") {
      return callableResult;
    }
  } catch (err) {
    recordDiagnosticEvent({
      level: "warning",
      type: "auth.org-bootstrap.callable-fallback",
      message: err?.message || "Falling back to client role bootstrap."
    });
  }

  return loadOrCreateRoleLegacy(user);
}

export function useAuthSession({ tenantContext = null } = {}) {
  const [state, setState] = useState({
    loading: true,
    user: null,
    role: "customer",
    organizationId: normalizeOrganizationIdStrict(""),
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
          : normalizeOrganizationIdStrict(""),
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
          error: ""
        });
        return;
      }

      setState((prev) => ({ ...prev, loading: true, error: "" }));
      try {
        const tokenResult = await nextUser.getIdTokenResult();
        const claimRole = normalizeRole(tokenResult?.claims?.role);
        const claimOrg = normalizeOrganizationIdStrict(tokenResult?.claims?.organizationId);
        const roleRecord = await loadOrCreateRole(nextUser);
        const runtimePrincipal = resolveRuntimePrincipal({
          claimRole,
          claimOrg,
          roleRecord
        });
        let organizationId = normalizeOrganizationIdStrict(runtimePrincipal.organizationId);
        const tenantHostOrg = tenantContext?.hostType === "tenant"
          ? normalizeOrganizationIdStrict(tenantContext.organizationId)
          : "";
        if (tenantHostOrg) {
          if (organizationId && organizationId !== tenantHostOrg) {
            throw new Error("Signed-in account is outside this tenant.");
          }
          organizationId = tenantHostOrg;
        }
        if ((runtimePrincipal.role === "admin" || runtimePrincipal.role === "sales") && !organizationId) {
          throw new Error("Staff account is missing organization scope.");
        }
        if (!active) return;
        setState({
          loading: false,
          user: nextUser,
          role: runtimePrincipal.role,
          organizationId,
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
    signOut: E2E_AUTH_BYPASS
      ? async () => {
        clearTenantContextCache();
        setState({
          loading: false,
          user: null,
          role: "customer",
          organizationId: normalizeOrganizationIdStrict(""),
          error: ""
        });
      }
      : async () => {
        clearTenantContextCache();
        await signOutCurrentUser();
      }
  };
}
