import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import MarketingPage from "./components/MarketingPage";
import { EventTypeProvider } from "./context/EventTypeContext";
import { OrganizationProvider } from "./context/OrganizationContext";
import { initSessionDiagnostics, recordDiagnosticError } from "./lib/sessionDiagnostics";
import "./styles.css";

initSessionDiagnostics({
  appVersion: String(import.meta.env.VITE_APP_VERSION || "0.1.0")
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      recordDiagnosticError(err, {
        surface: "service-worker",
        action: "register"
      });
    });
  });
}

const searchParams = new URLSearchParams(window.location.search);
const isPortalRoute = Boolean(String(searchParams.get("portal") || "").trim());
const isMarketingRoute = window.location.pathname === "/" && !isPortalRoute;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isMarketingRoute ? (
      <MarketingPage />
    ) : (
      <OrganizationProvider>
        <EventTypeProvider>
          <App />
        </EventTypeProvider>
      </OrganizationProvider>
    )}
  </React.StrictMode>
);
