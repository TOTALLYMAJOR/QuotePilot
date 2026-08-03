import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import MarketingPage from "./components/MarketingPage";
import { initSessionDiagnostics, recordDiagnosticError } from "./lib/sessionDiagnostics";
import "./styles.css";

const SystemMarketingPage = lazy(() => import("./components/SystemMarketingPage"));
const WorkspaceRoute = lazy(() => import("./components/WorkspaceRoute"));

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
const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";
const isMarketingRoute = normalizedPath === "/" && !isPortalRoute;
const isSystemMarketingRoute = normalizedPath === "/system" && !isPortalRoute;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isMarketingRoute ? (
      <MarketingPage />
    ) : isSystemMarketingRoute ? (
      <Suspense fallback={<div className="qp-route-loading" role="status">Loading QuotePilot platform...</div>}>
        <SystemMarketingPage />
      </Suspense>
    ) : (
      <Suspense fallback={<div className="qp-route-loading" role="status">Loading QuotePilot workspace...</div>}>
        <WorkspaceRoute />
      </Suspense>
    )}
  </React.StrictMode>
);
