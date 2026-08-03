import App from "../App";
import { EventTypeProvider } from "../context/EventTypeContext";
import { OrganizationProvider } from "../context/OrganizationContext";

export default function WorkspaceRoute() {
  return (
    <OrganizationProvider>
      <EventTypeProvider>
        <App />
      </EventTypeProvider>
    </OrganizationProvider>
  );
}
