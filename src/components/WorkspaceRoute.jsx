import App from "../App";
import { EventTypeProvider } from "../context/EventTypeContext";
import { OrganizationProvider } from "../context/OrganizationContext";
import { useAuthSession } from "../hooks/useAuthSession";
import { useTenantContext } from "../hooks/useTenantContext";
import { buildWorkspaceRouteScopeKey } from "../lib/workspaceScope";

function isDirectCustomerPortalRoute() {
  if (typeof window === "undefined") return false;
  return Boolean(String(new URLSearchParams(window.location.search).get("portal") || "").trim());
}

export default function WorkspaceRoute() {
  const tenantContext = useTenantContext();
  const authSession = useAuthSession({ tenantContext });
  const workspaceScopeKey = buildWorkspaceRouteScopeKey({
    publicPortal: isDirectCustomerPortalRoute(),
    tenantContext,
    authSession
  });

  return (
    <OrganizationProvider key={workspaceScopeKey}>
      <EventTypeProvider>
        <App tenantContext={tenantContext} authSession={authSession} />
      </EventTypeProvider>
    </OrganizationProvider>
  );
}
