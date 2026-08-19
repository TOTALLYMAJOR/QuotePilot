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
import { WORKSPACE_PATHS } from "../lib/workspaceRoutes";
import { buildWorkspaceRouteScopeKey } from "../lib/workspaceScope";

const QUOTE_WORKSPACE_CONCEPT_PATH = "/app/quote-workspace-concept";
const QUOTE_WORKSPACE_PATH = "/app/quote-workspace";
const QUOTE_WORKSPACE_ROLES = new Set(["admin", "sales"]);
const QuoteWorkspaceConceptPage = lazy(() => import("./QuoteWorkspaceConceptPage"));

export function ScopedWorkspaceRoute({ tenantContext, authSession }) {
  const { route, replace } = useWorkspaceNavigation();
  const previousAuthenticatedUidRef = useRef("");
  const authenticatedUid = String(authSession.user?.uid || "").trim();
  const authenticatedRole = String(authSession.role || tenantContext?.role || "").trim().toLowerCase();
  const portalToken = String(route.portalToken || "").trim();
  const normalizedPath = typeof window === "undefined"
    ? ""
    : window.location.pathname.replace(/\/+$/, "") || "/";
  const conceptRouteRequested = !portalToken
    && (
      normalizedPath === QUOTE_WORKSPACE_PATH
      || normalizedPath === QUOTE_WORKSPACE_CONCEPT_PATH
    );
  const conceptRouteReady = conceptRouteRequested
    && Boolean(authenticatedUid)
    && QUOTE_WORKSPACE_ROLES.has(authenticatedRole);
  const conceptRouteDenied = conceptRouteRequested
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
        {conceptRouteReady ? (
          <Suspense fallback={<div className="qp-route-loading" role="status">Loading quote workspace concept...</div>}>
            <QuoteWorkspaceConceptPage
              tenantContext={tenantContext}
              authSession={authSession}
              onExit={() => replace(WORKSPACE_PATHS.quotes, { preserveSearch: false, preserveHash: false })}
            />
          </Suspense>
        ) : conceptRouteDenied ? (
          <main className="qp-route-boundary" data-testid="quote-workspace-role-boundary">
            <p>Quote workspace</p>
            <h1>Staff access required</h1>
            <p>This evaluation surface is limited to authorized sales and administrative staff.</p>
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

export default function WorkspaceRoute() {
  const tenantContext = useTenantContext();
  const authSession = useAuthSession({ tenantContext });

  return (
    <WorkspaceNavigationProvider>
      <ScopedWorkspaceRoute tenantContext={tenantContext} authSession={authSession} />
    </WorkspaceNavigationProvider>
  );
}
