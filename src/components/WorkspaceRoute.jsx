import { useEffect, useRef } from "react";
import App from "../App";
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

function ScopedWorkspaceRoute({ tenantContext, authSession }) {
  const { route, replace } = useWorkspaceNavigation();
  const previousAuthenticatedUidRef = useRef("");
  const authenticatedUid = String(authSession.user?.uid || "").trim();
  const workspaceScopeKey = buildWorkspaceRouteScopeKey({
    publicPortal: route.surface === "portal",
    tenantContext,
    authSession
  });

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
        <App tenantContext={tenantContext} authSession={authSession} />
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
