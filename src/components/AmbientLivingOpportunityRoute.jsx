import { forwardRef, useCallback, useMemo } from "react";
import { AmbientContextProvider } from "../context/AmbientContext";
import {
  buildSavedAmbientPricingMargin,
  prepareAmbientPricingPreview
} from "../lib/ambientPricingPreview";
import { buildAmbientPackageMenuCatalogEvidence } from "../lib/ambientPackageMenuCatalogEvidence";
import AmbientLivingOpportunity from "./AmbientLivingOpportunity";
import { buildMarginPresentation } from "./marginPresentation";

const STAFF_ROLES = new Set(["admin", "sales"]);

const AmbientLivingOpportunityRoute = forwardRef(function AmbientLivingOpportunityRoute({
  quote,
  ambientContext = null,
  source = "",
  ordinaryEditAllowed = false,
  ambientPricingCatalog = null,
  ambientPricingSettings = null,
  ...props
}, forwardedRef) {
  const quoteId = String(quote?.id || quote?.quoteId || "selected");
  const context = ambientContext || {
    organizationId: String(quote?.organizationId || "local-fallback"),
    role: "non_staff",
    route: `/app/quotes/${encodeURIComponent(quoteId)}`,
    activeOpportunityId: quoteId,
    selectedObject: {
      id: quoteId,
      type: "opportunity",
      label: String(quote?.event?.name || quote?.quoteNumber || "Selected opportunity")
    },
    revision: quote?.activeVersionId || quote?.versionMeta?.versionId || null,
    sourceFreshness: {
      state: "unknown",
      reason: "The last-updated time is unavailable for this quote."
    },
    pendingPreview: null
  };
  const organizationId = String(context.organizationId || "").trim();
  const role = String(context.role || "").trim().toLowerCase();
  const exactSource = String(source || "").trim().toLowerCase();
  const staffRole = STAFF_ROLES.has(role);
  const packageMenuCatalogEvidence = useMemo(() => (
    buildAmbientPackageMenuCatalogEvidence({
      organizationId,
      catalog: ambientPricingCatalog
    })
  ), [ambientPricingCatalog, organizationId]);
  const savedPackageId = String(quote?.selection?.packageId || "").trim();
  const savedPackageAvailable = Boolean(
    savedPackageId
    && Array.isArray(ambientPricingCatalog?.packages)
    && ambientPricingCatalog.packages.some((item) => (
      String(item?.id || "").trim() === savedPackageId
      && item?.active !== false
    ))
  );
  const pricingInputsAvailable = Boolean(
    staffRole
    && ordinaryEditAllowed
    && ["firebase", "local"].includes(exactSource)
    && ambientPricingCatalog
    && ambientPricingSettings
    && savedPackageAvailable
  );
  const pricingMargin = useMemo(() => {
    if (!staffRole) return null;
    return buildSavedAmbientPricingMargin({
      organizationId,
      quote,
      catalog: ambientPricingCatalog,
      settings: ambientPricingSettings,
      evaluateMargin: buildMarginPresentation
    });
  }, [ambientPricingCatalog, ambientPricingSettings, organizationId, quote, staffRole]);
  const simulatePricing = useCallback(async ({ guestCount, requestId = "" } = {}) => {
    let connected = {};
    if (exactSource === "firebase") {
      const client = await import("../lib/commercialChangeAuthorityClient");
      connected = {
        simulate: client.simulateCommercialQuoteChange,
        createRequestId: client.buildCommercialChangeRequestId,
        isDefinitiveError: client.isDefinitiveCommercialChangeError
      };
    }
    return prepareAmbientPricingPreview({
      source: exactSource,
      organizationId,
      quote,
      guestCount,
      catalog: ambientPricingCatalog,
      settings: ambientPricingSettings,
      timestamp: new Date().toISOString(),
      requestId,
      evaluateMargin: buildMarginPresentation,
      ...connected
    });
  }, [ambientPricingCatalog, ambientPricingSettings, exactSource, organizationId, quote]);

  return (
    <AmbientContextProvider value={context}>
      <AmbientLivingOpportunity
        ref={forwardedRef}
        quote={quote}
        source={source}
        ordinaryEditAllowed={ordinaryEditAllowed}
        pricingPreviewAvailable={pricingInputsAvailable}
        pricingMargin={pricingMargin}
        packageMenuCatalogEvidence={packageMenuCatalogEvidence}
        onSimulatePricing={pricingInputsAvailable ? simulatePricing : undefined}
        {...props}
      />
    </AmbientContextProvider>
  );
});

export default AmbientLivingOpportunityRoute;
