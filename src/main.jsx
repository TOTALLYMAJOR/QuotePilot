import React, { Suspense } from "react";
import { createRoot } from "react-dom/client";
import MarketingPage from "./components/MarketingPage";
import {
  createRecoverableLazy,
  RecoverableErrorBoundary
} from "./components/RecoverableErrorBoundary";
import { initSessionDiagnostics, recordDiagnosticError } from "./lib/sessionDiagnostics";
import "./styles.css";

const SystemMarketingPage = createRecoverableLazy(
  () => import("./components/SystemMarketingPage"),
  "SystemMarketingPage"
);
const BuyerAccessPage = createRecoverableLazy(
  () => import("./components/BuyerAccessPage"),
  "BuyerAccessPage"
);
const RevenueAutopilotUnsubscribePage = createRecoverableLazy(
  () => import("./components/RevenueAutopilotUnsubscribePage"),
  "RevenueAutopilotUnsubscribePage"
);
const Auth0SetupPage = import.meta.env.DEV
  ? createRecoverableLazy(
    () => import("./components/Auth0SetupPage"),
    "Auth0SetupPage"
  )
  : null;
const WorkspaceRoute = createRecoverableLazy(
  () => import("./components/WorkspaceRoute"),
  "WorkspaceRoute"
);

function LazyPublicRoute({ surfaceName, loadingMessage, component: LazyComponent }) {
  return (
    <RecoverableErrorBoundary
      surfaceName={surfaceName}
      surfaceKind="route"
      onRetry={LazyComponent.retry}
      onClose={() => window.location.assign("/")}
    >
      <Suspense fallback={<div className="qp-route-loading" role="status">{loadingMessage}</div>}>
        <LazyComponent />
      </Suspense>
    </RecoverableErrorBoundary>
  );
}

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
const isRevenueAutopilotUnsubscribeRoute = !isPortalRoute
  && Boolean(String(searchParams.get("unsubscribe") || "").trim());
const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";
const isMarketingRoute = normalizedPath === "/" && !isPortalRoute;
const isSystemMarketingRoute = normalizedPath === "/system" && !isPortalRoute;
const isBuyerAccessRoute = normalizedPath === "/start" && !isPortalRoute;
const isAuth0SetupRoute = import.meta.env.DEV
  && normalizedPath === "/auth0"
  && !isPortalRoute;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isRevenueAutopilotUnsubscribeRoute ? (
      <LazyPublicRoute
        surfaceName="Email preferences"
        loadingMessage="Loading email preferences..."
        component={RevenueAutopilotUnsubscribePage}
      />
    ) : isMarketingRoute ? (
      <MarketingPage />
    ) : isSystemMarketingRoute ? (
      <LazyPublicRoute
        surfaceName="QuotePilot platform overview"
        loadingMessage="Loading QuotePilot platform..."
        component={SystemMarketingPage}
      />
    ) : isBuyerAccessRoute ? (
      <LazyPublicRoute
        surfaceName="Secure buyer access"
        loadingMessage="Loading secure buyer access..."
        component={BuyerAccessPage}
      />
    ) : isAuth0SetupRoute && Auth0SetupPage ? (
      <LazyPublicRoute
        surfaceName="Auth0 SDK verification"
        loadingMessage="Loading Auth0 SDK verification..."
        component={Auth0SetupPage}
      />
    ) : (
      <LazyPublicRoute
        surfaceName="QuotePilot workspace"
        loadingMessage="Loading QuotePilot workspace..."
        component={WorkspaceRoute}
      />
    )}
  </React.StrictMode>
);
