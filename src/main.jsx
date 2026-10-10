import React, { Suspense } from "react";
import { createRoot } from "react-dom/client";
import MarketingPage from "./components/MarketingPage";
import {
  createRecoverableLazy,
  RecoverableErrorBoundary
} from "./components/RecoverableErrorBoundary";
import {
  initSessionDiagnostics,
  recordDiagnosticError,
  recordDiagnosticEvent
} from "./lib/sessionDiagnostics";
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
const StaffInvitationResponsePage = createRecoverableLazy(
  () => import("./components/StaffInvitationResponsePage"),
  "StaffInvitationResponsePage"
);
const PublicInquiryPage = createRecoverableLazy(
  () => import("./components/PublicInquiryPage"),
  "PublicInquiryPage"
);
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
const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";
const isRevenueAutopilotUnsubscribeRoute = !isPortalRoute
  && Boolean(String(searchParams.get("unsubscribe") || "").trim());
const isStaffInvitationRoute = !isPortalRoute
  && !isRevenueAutopilotUnsubscribeRoute
  && normalizedPath === "/staffing/respond"
  && Boolean(String(searchParams.get("staffing") || "").trim());
const isMarketingRoute = normalizedPath === "/" && !isPortalRoute;
const isSystemMarketingRoute = normalizedPath === "/system" && !isPortalRoute;
const isBuyerAccessRoute = normalizedPath === "/start" && !isPortalRoute;
const isPublicInquiryRoute = !isPortalRoute && /^\/inquire\/[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/u.test(normalizedPath);
const routeKind = isPublicInquiryRoute
  ? "public-inquiry"
  : isStaffInvitationRoute
  ? "staff-invitation"
  : isRevenueAutopilotUnsubscribeRoute
    ? "revenue-autopilot-unsubscribe"
    : isMarketingRoute
      ? "marketing"
      : isSystemMarketingRoute
        ? "system-marketing"
        : isBuyerAccessRoute
          ? "buyer-access"
          : isPortalRoute
            ? "customer-portal"
            : "workspace";

recordDiagnosticEvent({
  level: "info",
  type: "route.resolved",
  message: "Route resolved",
  context: {
    routeKind,
    path: normalizedPath
  }
});

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isPublicInquiryRoute ? (
      <LazyPublicRoute
        surfaceName="Event inquiry"
        loadingMessage="Loading inquiry page…"
        component={PublicInquiryPage}
      />
    ) : isStaffInvitationRoute ? (
      <LazyPublicRoute
        surfaceName="Staff assignment invitation"
        loadingMessage="Loading staff assignment…"
        component={StaffInvitationResponsePage}
      />
    ) : isRevenueAutopilotUnsubscribeRoute ? (
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
    ) : (
      <LazyPublicRoute
        surfaceName="QuotePilot workspace"
        loadingMessage="Loading QuotePilot workspace..."
        component={WorkspaceRoute}
      />
    )}
  </React.StrictMode>
);
