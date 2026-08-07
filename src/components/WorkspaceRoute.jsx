import App from "../App";
import { EventTypeProvider } from "../context/EventTypeContext";
import { OrganizationProvider } from "../context/OrganizationContext";
import { useAuthSession } from "../hooks/useAuthSession";
import { useTenantContext } from "../hooks/useTenantContext";
import { buildAuthenticatedWorkspaceScopeKey } from "../lib/workspaceScope";

export default function WorkspaceRoute() {
  const tenantContext = useTenantContext();
  const authSession = useAuthSession({ tenantContext });
  const workspaceScopeKey = buildAuthenticatedWorkspaceScopeKey({
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
