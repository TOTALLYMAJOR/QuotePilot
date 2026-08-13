import { useCallback, useEffect, useRef, useState } from "react";
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

export function ScopedWorkspaceRoute({ tenantContext, authSession }) {
  const { route, replace } = useWorkspaceNavigation();
  const previousAuthenticatedUidRef = useRef("");
  const authenticatedUid = String(authSession.user?.uid || "").trim();
  const portalToken = String(route.portalToken || "").trim();
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
        <ActiveApp
          tenantContext={tenantContext}
          authSession={authSession}
          portalRouteAllowed={portalRouteAllowed}
          committedPortalToken={committedPortalToken}
          onPortalScopeCommit={commitPortalScope}
        />
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
