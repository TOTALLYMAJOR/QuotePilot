import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import ActiveApp from "quotepilot-active-app";
import { EventTypeProvider } from "../context/EventTypeContext";
import { OrganizationProvider } from "../context/OrganizationContext";
import {
  useWorkspaceNavigation,
  WorkspaceNavigationProvider
} from "../context/WorkspaceNavigationContext";
import { useAuthSession } from "../hooks/useAuthSession";
import { useTenantContext } from "../hooks/useTenantContext";
import { WORKSPACE_PATHS, WORKSPACE_ROUTE_IDS } from "../lib/workspaceRoutes";
import { buildWorkspaceRouteScopeKey } from "../lib/workspaceScope";
import { mountFirebaseEmailActionPage } from "./FirebaseEmailActionPage";

const QUOTE_WORKSPACE_CONCEPT_PATH = "/app/quote-workspace-concept";
const QUOTE_WORKSPACE_PATH = "/app/quote-workspace";
const QUOTE_WORKSPACE_ROLES = new Set(["admin", "sales"]);
const QuoteWorkspacePage = lazy(() => import("./QuoteWorkspaceConceptPage"));

function envEnabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export function ScopedWorkspaceRoute({ tenantContext, authSession }) {
  const { location, route, replace } = useWorkspaceNavigation();
  const previousAuthenticatedUidRef = useRef("");
  const authenticatedUid = String(authSession.user?.uid || "").trim();
  const authenticatedRole = String(authSession.role || tenantContext?.role || "").trim().toLowerCase();
  const portalToken = String(route.portalToken || "").trim();
  const normalizedPath = typeof window === "undefined"
    ? ""
    : window.location.pathname.replace(/\/+$/, "") || "/";
  const searchParams = new URLSearchParams(location?.search || "");
  const compatibilityWorkspaceRequested = normalizedPath === QUOTE_WORKSPACE_PATH
    || normalizedPath === QUOTE_WORKSPACE_CONCEPT_PATH;
  const exactQuoteWorkspaceRequested = route.routeId === WORKSPACE_ROUTE_IDS.QUOTE_DETAIL;
  const ambientOpportunityRequested = envEnabled(import.meta.env.VITE_AMBIENT_UI_ENABLED)
    && exactQuoteWorkspaceRequested;
  // The approved Ambient Opportunity owns ordinary exact-quote navigation
  // when that build-selected presentation is enabled. Explicit arrivals and
  // administration continue through the authoritative app; the connected
  // Quote Workspace remains a compatibility alias and rollback presentation.
  const existingAppOwnsArrival = Boolean(location?.state?.ambientArrival);
  const administrationRequested = searchParams.get("view") === "administration";
  const quoteWorkspaceRequested = !portalToken
    && !administrationRequested
    && !existingAppOwnsArrival
    && (compatibilityWorkspaceRequested || (
      exactQuoteWorkspaceRequested && !ambientOpportunityRequested
    ));
  const requestedQuoteId = exactQuoteWorkspaceRequested
    ? String(route.params?.quoteId || "").trim()
    : String(searchParams.get("quoteId") || "").trim();
  const quoteWorkspaceReady = quoteWorkspaceRequested
    && Boolean(authenticatedUid)
    && QUOTE_WORKSPACE_ROLES.has(authenticatedRole);
  const quoteWorkspaceDenied = quoteWorkspaceRequested
    && Boolean(authenticatedUid)
    && !QUOTE_WORKSPACE_ROLES.has(authenticatedRole);
  const [committedPortalToken, setCommittedPortalToken] = useState(() => (
    route.surface === "portal" ? portalToken : ""
  ));
  const portalRouteAllowed = route.surface !== "portal"
    ? !committedPortalToken
    : committedPortalToken === portalToken;
  const workspaceScopeKey = buildWorkspaceRouteScopeKey({
    publicPortalToken: committedPortalToken,
    tenantContext,
    authSession
  });
  const commitPortalScope = useCallback((nextToken = "") => {
    setCommittedPortalToken(String(nextToken || "").trim());
  }, []);

  useEffect(() => {
    const previousAuthenticatedUid = previousAuthenticatedUidRef.current;
    previousAuthenticatedUidRef.current = authenticatedUid;
    if (
      previousAuthenticatedUid
      && previousAuthenticatedUid !== authenticatedUid
      && route.surface === "workspace"
    ) {
      replace(WORKSPACE_PATHS.home, { preserveSearch: false, preserveHash: false });
    }
  }, [authenticatedUid, replace, route.surface]);

  return (
    <OrganizationProvider key={workspaceScopeKey}>
      <EventTypeProvider>
        {quoteWorkspaceReady ? (
          <Suspense fallback={<div className="qp-route-loading" role="status">Loading quote workspace...</div>}>
            <QuoteWorkspacePage
              tenantContext={tenantContext}
              authSession={authSession}
              quoteId={requestedQuoteId}
              onExit={() => replace(WORKSPACE_PATHS.quotes, { preserveSearch: false, preserveHash: false })}
            />
          </Suspense>
        ) : quoteWorkspaceDenied ? (
          <main className="qp-route-boundary" data-testid="quote-workspace-role-boundary">
            <p>Quote workspace</p>
            <h1>Staff access required</h1>
            <p>This workspace is limited to authorized sales and administrative staff.</p>
            <button
              type="button"
              onClick={() => replace(WORKSPACE_PATHS.home, { preserveSearch: false, preserveHash: false })}
            >
              Return to workspace
            </button>
          </main>
        ) : (
          <ActiveApp
            tenantContext={tenantContext}
            authSession={authSession}
            portalRouteAllowed={portalRouteAllowed}
            committedPortalToken={committedPortalToken}
            onPortalScopeCommit={commitPortalScope}
          />
        )}
      </EventTypeProvider>
    </OrganizationProvider>
  );
}

function AuthenticatedWorkspaceRoute() {
  const tenantContext = useTenantContext();
  const authSession = useAuthSession({ tenantContext });

  return (
    <WorkspaceNavigationProvider>
      <ScopedWorkspaceRoute tenantContext={tenantContext} authSession={authSession} />
    </WorkspaceNavigationProvider>
  );
}

export default function WorkspaceRoute() {
  const actionRoot = useCallback((node) => {
    if (node && !node.firstChild) mountFirebaseEmailActionPage(node);
  }, []);
  return window.location.pathname === "/app/auth/action"
    ? <div ref={actionRoot} />
    : <AuthenticatedWorkspaceRoute />;
}
