import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import AuthGate from "./components/AuthGate";
import CustomerPortalView from "./components/CustomerPortalView";
import LiveBreakdown from "./components/LiveBreakdown";
import { StepEvent, StepMenu, StepReview, StepServices } from "./components/WizardSteps";
import { useEventType } from "./context/EventTypeContext";
import { useOrganization } from "./context/OrganizationContext";
import { DEFAULT_FEATURE_FLAGS, STAFF_RULES } from "./data/mockCatalog";
import { useAuthSession } from "./hooks/useAuthSession";
import { useCatalogData } from "./hooks/useCatalogData";
import { calculateQuotePricing, notifyOwnerNewQuote, sendQuoteToCustomerEmail } from "./lib/commerceOps";
import { setActiveOrganizationId } from "./lib/organizationService";
import { calculateQuote, currency } from "./lib/quoteCalculator";
import { buildUpsellRecommendations } from "./lib/recommendations";
import {
  applyEventTypeTemplateDefaults,
  buildStepperModel,
  buildStepStatus,
  buildStepValidation,
  findTemplateForEventType,
  STEP1_REQUIRED_FIELDS
} from "./lib/wizardUi";
import {
  checkEventAvailability,
  getQuoteById,
  setQuoteStoreOrganizationId,
  submitQuote,
  updateQuote,
  updateQuoteStatus
} from "./lib/quoteStore";
import { recordDiagnosticError, setDiagnosticsUserContext } from "./lib/sessionDiagnostics";

const AdminCatalogModal = lazy(() => import("./components/AdminCatalogModal"));
const EventScheduleModal = lazy(() => import("./components/EventScheduleModal"));
const IntegrationOpsModal = lazy(() => import("./components/IntegrationOpsModal"));
const DiagnosticsModal = lazy(() => import("./components/DiagnosticsModal"));
const QuoteCompareModal = lazy(() => import("./components/QuoteCompareModal"));
const QuoteHistoryModal = lazy(() => import("./components/QuoteHistoryModal"));
const ReportingDashboardModal = lazy(() => import("./components/ReportingDashboardModal"));

const E2E_ALLOW_NON_AUTHORITATIVE_PRICING = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_E2E_ALLOW_NON_AUTHORITATIVE_PRICING || "").trim().toLowerCase()
);

const INITIAL_FORM = {
  date: "",
  time: "",
  hours: 0,
  bartenders: 0,
  guests: 0,
  venue: "",
  venueAddress: "",
  eventName: "",
  clientOrg: "",
  style: "Buffet",
  name: "",
  phone: "",
  email: "",
  pkg: "classic",
  addons: [],
  addonQuantities: {},
  rentals: [],
  rentalQuantities: {},
  menuItems: [],
  menuItemQuantities: {},
  eventTypeId: "",
  bartenderRateTypeId: "",
  staffingRateTypeId: "",
  bartenderRateOverride: "",
  serverRateOverride: "",
  chefRateOverride: "",
  eventTemplateId: "custom",
  taxRegion: "",
  seasonProfileId: "auto",
  milesRT: 0,
  includeDisposables: true,
  depositLink: "",
  payMethod: "card"
};

function readPortalKeyFromUrl() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return String(params.get("portal") || "").trim();
}

function copyText(text) {
  if (!navigator?.clipboard) {
    throw new Error("Clipboard is unavailable in this browser.");
  }
  return navigator.clipboard.writeText(text);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toPositiveTimeout(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1_000, Math.round(parsed));
}

async function withTimeout(promise, timeoutMs, operation = "operation") {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

const SAVE_FLOW_TIMEOUT_MS = toPositiveTimeout(
  import.meta.env.VITE_SAVE_FLOW_TIMEOUT_MS,
  30_000
);
const OWNER_SMS_TIMEOUT_MS = toPositiveTimeout(
  import.meta.env.VITE_OWNER_SMS_TIMEOUT_MS,
  15_000
);

function toOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? n : "";
}

function normalizeFeatureFlags(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    customerPortal: source.customerPortal !== false,
    eventSchedule: source.eventSchedule !== false,
    integrationsOps: source.integrationsOps !== false,
    diagnostics: source.diagnostics !== false,
    reportingDashboard: source.reportingDashboard !== false,
    quoteCompare: source.quoteCompare !== false,
    crmSync: source.crmSync !== false,
    guidedSelling: source.guidedSelling !== false
  };
}

function normalizePricingLineCategory(value) {
  return String(value || "").trim().toLowerCase();
}

function sumPricingLineTotals(lineItems, categories = []) {
  const categorySet = new Set(categories.map((category) => normalizePricingLineCategory(category)));
  const source = Array.isArray(lineItems) ? lineItems : [];
  return source.reduce((sum, item) => {
    const category = normalizePricingLineCategory(item?.category);
    if (!categorySet.has(category)) return sum;
    return sum + toNumber(item?.total, 0);
  }, 0);
}

function buildTotalsFromPricingSnapshot(pricingSnapshot = {}, fallbackTotals = {}) {
  const lineItems = Array.isArray(pricingSnapshot?.lineItems) ? pricingSnapshot.lineItems : [];
  const rules = pricingSnapshot?.rulesSnapshot && typeof pricingSnapshot.rulesSnapshot === "object"
    ? pricingSnapshot.rulesSnapshot
    : {};
  const laborSnapshot = rules.laborRateSnapshot && typeof rules.laborRateSnapshot === "object"
    ? rules.laborRateSnapshot
    : {};
  const selectedPackage = pricingSnapshot?.inputs?.selection?.package || {};

  const base = toNumber(
    sumPricingLineTotals(lineItems, ["package"]),
    toNumber(fallbackTotals.base, 0)
  );
  const addons = toNumber(
    sumPricingLineTotals(lineItems, ["addon", "addons"]),
    toNumber(fallbackTotals.addons, 0)
  );
  const rentals = toNumber(
    sumPricingLineTotals(lineItems, ["rental", "rentals"]),
    toNumber(fallbackTotals.rentals, 0)
  );
  const menu = toNumber(
    sumPricingLineTotals(lineItems, ["menu_item", "menu_items", "menu"]),
    toNumber(fallbackTotals.menu, 0)
  );

  return {
    ...fallbackTotals,
    selectedPkg: {
      ...(fallbackTotals.selectedPkg || {}),
      id: String(selectedPackage?.id || fallbackTotals.selectedPkg?.id || "").trim(),
      name: String(selectedPackage?.name || fallbackTotals.selectedPkg?.name || "").trim()
    },
    base,
    addons,
    rentals,
    menu,
    labor: toNumber(pricingSnapshot?.fees?.labor, toNumber(fallbackTotals.labor, 0)),
    bartenderLabor: toNumber(pricingSnapshot?.fees?.bartenderLabor, toNumber(fallbackTotals.bartenderLabor, 0)),
    bartenderRateApplied: toNumber(laborSnapshot.bartenderRateApplied, toNumber(fallbackTotals.bartenderRateApplied, 0)),
    serverRateApplied: toNumber(laborSnapshot.serverRateApplied, toNumber(fallbackTotals.serverRateApplied, 0)),
    chefRateApplied: toNumber(laborSnapshot.chefRateApplied, toNumber(fallbackTotals.chefRateApplied, 0)),
    bartenderRateTypeId: String(laborSnapshot.bartenderRateTypeId || fallbackTotals.bartenderRateTypeId || ""),
    bartenderRateTypeName: String(laborSnapshot.bartenderRateTypeName || fallbackTotals.bartenderRateTypeName || ""),
    staffingRateTypeId: String(laborSnapshot.staffingRateTypeId || fallbackTotals.staffingRateTypeId || ""),
    staffingRateTypeName: String(laborSnapshot.staffingRateTypeName || fallbackTotals.staffingRateTypeName || ""),
    travel: toNumber(pricingSnapshot?.fees?.travel, toNumber(fallbackTotals.travel, 0)),
    serviceFee: toNumber(pricingSnapshot?.fees?.serviceFee, toNumber(fallbackTotals.serviceFee, 0)),
    tax: toNumber(pricingSnapshot?.tax?.amount, toNumber(fallbackTotals.tax, 0)),
    total: toNumber(pricingSnapshot?.grandTotal, toNumber(fallbackTotals.total, 0)),
    deposit: toNumber(pricingSnapshot?.deposit?.amount, toNumber(fallbackTotals.deposit, 0)),
    serviceFeePctApplied: toNumber(rules.serviceFeePctApplied, toNumber(fallbackTotals.serviceFeePctApplied, 0)),
    taxRateApplied: toNumber(pricingSnapshot?.tax?.rate, toNumber(fallbackTotals.taxRateApplied, 0)),
    taxRegionId: String(pricingSnapshot?.tax?.regionId || fallbackTotals.taxRegionId || ""),
    taxRegionName: String(pricingSnapshot?.tax?.regionName || fallbackTotals.taxRegionName || ""),
    seasonProfileId: String(rules.seasonProfileId || fallbackTotals.seasonProfileId || ""),
    seasonProfileName: String(rules.seasonProfileName || fallbackTotals.seasonProfileName || ""),
    packageMultiplier: toNumber(rules.packageMultiplier, toNumber(fallbackTotals.packageMultiplier, 1)),
    addonMultiplier: toNumber(rules.addonMultiplier, toNumber(fallbackTotals.addonMultiplier, 1)),
    rentalMultiplier: toNumber(rules.rentalMultiplier, toNumber(fallbackTotals.rentalMultiplier, 1))
  };
}

export default function App() {
  const wizardRef = useRef(null);
  const { eventTypeId: globalEventTypeId, setEventTypeId: setGlobalEventTypeId } = useEventType();
  const { setOrganizationId } = useOrganization();
  const authSession = useAuthSession();
  const [portalKey, setPortalKey] = useState(() => readPortalKeyFromUrl());
  const [portalMode, setPortalMode] = useState(Boolean(portalKey));
  const catalog = useCatalogData({
    enabled: authSession.isStaff,
    organizationId: authSession.organizationId
  });
  const [dynamicMenuSections, setDynamicMenuSections] = useState([]);
  const [dynamicMenuLoading, setDynamicMenuLoading] = useState(false);
  const [dynamicMenuError, setDynamicMenuError] = useState("");
  const [step, setStep] = useState(1);
  const [adminOpen, setAdminOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [submitState, setSubmitState] = useState({
    saving: false,
    sendingQuoteEmail: false,
    message: "",
    portalLink: "",
    quoteId: "",
    quoteNumber: ""
  });
  const [availabilityNotice, setAvailabilityNotice] = useState("");
  const [editingQuote, setEditingQuote] = useState({ id: "", quoteNumber: "" });
  const [toasts, setToasts] = useState([]);
  const [form, setForm] = useState(INITIAL_FORM);
  const [touchedFields, setTouchedFields] = useState({});
  const [showStepValidation, setShowStepValidation] = useState(false);
  const [stepValidation, setStepValidation] = useState(() => buildStepValidation(INITIAL_FORM));
  const [stepStatus, setStepStatus] = useState(() => buildStepStatus({
    currentStep: 1,
    stepValidation: buildStepValidation(INITIAL_FORM)
  }));

  const pushToast = (message, tone = "info") => {
    const id = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    setToasts((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 3600);
  };

  const markFieldsTouched = (fields = []) => {
    const unique = Array.from(new Set(fields.filter(Boolean)));
    if (!unique.length) return;
    setTouchedFields((prev) => {
      const next = { ...prev };
      let changed = false;
      unique.forEach((field) => {
        if (!next[field]) {
          next[field] = true;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  };

  const handleStep1FieldChange = (field, value) => {
    markFieldsTouched([field]);
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleStep1FieldBlur = (field) => {
    markFieldsTouched([field]);
  };

  const handleSelectionTouched = (field) => {
    markFieldsTouched([field]);
  };

  const stepperModel = useMemo(
    () => buildStepperModel({ currentStep: step, stepStatus }),
    [step, stepStatus]
  );
  const step1Validation = stepValidation.step1 || { valid: false, missingFields: [], fieldErrors: {} };
  const step1CanAdvance = step1Validation.valid;

  const effectiveMenuSections = useMemo(
    () => (Array.isArray(dynamicMenuSections) ? dynamicMenuSections : []),
    [dynamicMenuSections]
  );

  const effectiveSettings = useMemo(() => {
    const featureFlags = {
      ...DEFAULT_FEATURE_FLAGS,
      ...normalizeFeatureFlags(catalog.settings?.featureFlags)
    };
    return {
      ...catalog.settings,
      menuSections: effectiveMenuSections,
      featureFlags,
      guidedSellingEnabled: (catalog.settings?.guidedSellingEnabled !== false) && featureFlags.guidedSelling
    };
  }, [catalog.settings, effectiveMenuSections]);
  const featureFlags = effectiveSettings.featureFlags || DEFAULT_FEATURE_FLAGS;
  const customerPortalEnabled = featureFlags.customerPortal !== false;
  const eventScheduleEnabled = featureFlags.eventSchedule !== false;
  const integrationsEnabled = featureFlags.integrationsOps !== false;
  const diagnosticsEnabled = featureFlags.diagnostics !== false;
  const dashboardEnabled = featureFlags.reportingDashboard !== false;
  const quoteCompareEnabled = featureFlags.quoteCompare !== false;

  useEffect(() => {
    setStepValidation(buildStepValidation(form));
  }, [form]);

  useEffect(() => {
    setStepStatus(buildStepStatus({
      currentStep: step,
      stepValidation
    }));
  }, [step, stepValidation]);

  useEffect(() => {
    if (step === 1 && !step1CanAdvance) return;
    if (!showStepValidation) return;
    setShowStepValidation(false);
  }, [showStepValidation, step, step1CanAdvance]);

  useEffect(() => {
    setOrganizationId(authSession.organizationId);
    setActiveOrganizationId(authSession.organizationId);
    setQuoteStoreOrganizationId(authSession.organizationId);
  }, [authSession.organizationId, setOrganizationId]);

  useEffect(() => {
    if (catalog.loading) return;
    const currentEventTypeId = String(form.eventTypeId || "").trim();
    if (currentEventTypeId) return;
    const fallbackEventTypeId = String(catalog.eventTypes?.[0]?.id || "").trim();
    if (!fallbackEventTypeId) return;
    setGlobalEventTypeId(fallbackEventTypeId);
    setForm((prev) => {
      if (String(prev.eventTypeId || "").trim()) return prev;
      return {
        ...prev,
        eventTypeId: fallbackEventTypeId
      };
    });
  }, [catalog.eventTypes, catalog.loading, form.eventTypeId, setGlobalEventTypeId]);

  useEffect(() => {
    const nextGlobal = String(globalEventTypeId || "").trim();
    if (!nextGlobal) return;
    if (nextGlobal === String(form.eventTypeId || "").trim()) return;
    setForm((prev) => ({
      ...prev,
      eventTypeId: nextGlobal,
      menuItems: [],
      menuItemQuantities: {}
    }));
  }, [globalEventTypeId, form.eventTypeId]);

  const totals = useMemo(
    () => calculateQuote(form, catalog, effectiveSettings),
    [form, catalog, effectiveSettings]
  );

  const recommendations = useMemo(
    () => buildUpsellRecommendations({ form, catalog, totals, settings: effectiveSettings }),
    [form, catalog, totals, effectiveSettings]
  );
  const isEditingQuote = Boolean(editingQuote.id);
  const brandName = catalog.settings?.brandName || "Tasteful Touch Catering";
  const brandTagline = catalog.settings?.brandTagline || "Chef Toni and Grill Master Ervin";
  const brandLogoUrl = catalog.settings?.brandLogoUrl || "/brand/logo.png";
  const brandPrimaryColor = catalog.settings?.brandPrimaryColor || "#c99334";
  const brandAccentColor = catalog.settings?.brandAccentColor || "#f0d29a";
  const brandDarkAccentColor = catalog.settings?.brandDarkAccentColor || "#8d611a";
  const brandBackgroundStart = catalog.settings?.brandBackgroundStart || "#100d09";
  const brandBackgroundMid = catalog.settings?.brandBackgroundMid || "#221a12";
  const brandBackgroundEnd = catalog.settings?.brandBackgroundEnd || "#ae7d2b";
  const brandCrew = Array.isArray(catalog.settings?.brandCrew) ? catalog.settings.brandCrew : [];
  const scheduleStaffLeads = brandCrew
    .map((member) => String(member?.label || "").trim())
    .filter(Boolean);
  const scheduleCapacityLimit = Math.max(1, Number(catalog.settings?.capacityLimit || 400));
  const heroEyebrow = catalog.settings?.heroEyebrow || "Premium Event Catering Workbench";
  const heroHeadline = catalog.settings?.heroHeadline || "Signature flavor. Configurable quotes.";
  const heroDescription =
    catalog.settings?.heroDescription ||
    "A polished sales cockpit for weddings, corporate events, and celebrations up to 400 guests. Build scenarios, apply smart upsells, and send better proposals faster.";
  const appThemeVars = {
    "--tone-gold-1": brandAccentColor,
    "--tone-gold-2": brandPrimaryColor,
    "--tone-gold-3": brandDarkAccentColor,
    "--app-bg-start": brandBackgroundStart,
    "--app-bg-mid": brandBackgroundMid,
    "--app-bg-end": brandBackgroundEnd
  };

  useEffect(() => {
    let alive = true;

    if (catalog.loading) {
      return () => {
        alive = false;
      };
    }

    const nextEventTypeId = String(form.eventTypeId || "").trim();
    if (!nextEventTypeId) {
      setDynamicMenuSections([]);
      setDynamicMenuLoading(false);
      setDynamicMenuError("");
      return () => {
        alive = false;
      };
    }

    async function loadMenu() {
      setDynamicMenuLoading(true);
      setDynamicMenuError("");
      setDynamicMenuSections([]);
      try {
        const sections = await catalog.loadMenuByEvent(nextEventTypeId);
        if (!alive) return;
        setDynamicMenuSections(Array.isArray(sections) ? sections : []);
      } catch (err) {
        if (!alive) return;
        setDynamicMenuSections([]);
        setDynamicMenuError(err?.message || "Failed to load event type menu.");
      } finally {
        if (alive) {
          setDynamicMenuLoading(false);
        }
      }
    }

    loadMenu();
    return () => {
      alive = false;
    };
  }, [catalog.loading, catalog.loadMenuByEvent, form.eventTypeId]);

  useEffect(() => {
    const availableMenuItemIds = new Set(
      effectiveMenuSections.flatMap((section) => (section.items || []).map((item) => item.id))
    );
    setForm((prev) => {
      const filtered = (prev.menuItems || []).filter((id) => availableMenuItemIds.has(id));
      const nextMenuQty = Object.entries(prev.menuItemQuantities || {}).reduce((acc, [id, quantity]) => {
        if (availableMenuItemIds.has(id)) {
          acc[id] = Math.max(1, Number(quantity || 1));
        }
        return acc;
      }, {});
      const unchangedSelection = filtered.length === (prev.menuItems || []).length;
      const unchangedQuantities =
        Object.keys(nextMenuQty).length === Object.keys(prev.menuItemQuantities || {}).length;
      if (unchangedSelection && unchangedQuantities) {
        return prev;
      }
      return {
        ...prev,
        menuItems: filtered,
        menuItemQuantities: nextMenuQty
      };
    });
  }, [effectiveMenuSections]);

  useEffect(() => {
    if (catalog.loading) return;
    setForm((prev) => {
      let changed = false;
      const next = { ...prev };
      const defaultTaxRegion = catalog.settings?.defaultTaxRegion || catalog.settings?.taxRegions?.[0]?.id || "";
      const defaultSeasonProfile = catalog.settings?.defaultSeasonProfile || "auto";
      const defaultBartenderRateType =
        catalog.settings?.defaultBartenderRateType || catalog.settings?.bartenderRateTypes?.[0]?.id || "";
      const defaultStaffingRateType =
        catalog.settings?.defaultStaffingRateType || catalog.settings?.staffingRateTypes?.[0]?.id || "";

      if (!next.taxRegion && defaultTaxRegion) {
        next.taxRegion = defaultTaxRegion;
        changed = true;
      }
      if (!next.seasonProfileId) {
        next.seasonProfileId = defaultSeasonProfile;
        changed = true;
      }
      if (!next.eventTemplateId) {
        next.eventTemplateId = "custom";
        changed = true;
      }
      if (!next.bartenderRateTypeId && defaultBartenderRateType) {
        next.bartenderRateTypeId = defaultBartenderRateType;
        changed = true;
      }
      if (!next.staffingRateTypeId && defaultStaffingRateType) {
        next.staffingRateTypeId = defaultStaffingRateType;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [catalog.loading, catalog.settings]);

  useEffect(() => {
    if (!eventScheduleEnabled) setScheduleOpen(false);
    if (!integrationsEnabled) setIntegrationsOpen(false);
    if (!diagnosticsEnabled) setDiagnosticsOpen(false);
    if (!dashboardEnabled) setDashboardOpen(false);
    if (!quoteCompareEnabled) setCompareOpen(false);
  }, [eventScheduleEnabled, integrationsEnabled, diagnosticsEnabled, dashboardEnabled, quoteCompareEnabled]);

  useEffect(() => {
    if (!customerPortalEnabled) {
      setPortalMode(false);
      setPortalKey("");
    }
  }, [customerPortalEnabled]);

  useEffect(() => {
    setAvailabilityNotice("");
  }, [form.date, form.venue]);

  useEffect(() => {
    setDiagnosticsUserContext({
      uid: authSession.user?.uid || "",
      email: authSession.user?.email || "",
      role: authSession.role || "customer",
      authenticated: Boolean(authSession.user)
    });
  }, [authSession.user?.uid, authSession.user?.email, authSession.role]);

  useEffect(() => {
    if (!authSession.error) return;
    recordDiagnosticError(new Error(authSession.error), {
      surface: "auth-session",
      action: "load-user-role"
    });
  }, [authSession.error]);

  useEffect(() => {
    if (!catalog.error) return;
    recordDiagnosticError(new Error(catalog.error), {
      surface: "catalog",
      action: "load-catalog"
    });
  }, [catalog.error]);

  const applyEventTemplate = (templateId) => {
    if (templateId === "custom") {
      setForm((prev) => ({ ...prev, eventTemplateId: "custom" }));
      return;
    }

    const templates = Array.isArray(catalog.settings?.eventTemplates) ? catalog.settings.eventTemplates : [];
    const template = templates.find((item) => item.id === templateId);
    if (!template) {
      setForm((prev) => ({ ...prev, eventTemplateId: "custom" }));
      return;
    }

    const addonIds = new Set(catalog.addons.map((item) => item.id));
    const rentalIds = new Set(catalog.rentals.map((item) => item.id));
    const menuItemIds = new Set(
      effectiveMenuSections.flatMap((section) => (section.items || []).map((item) => item.id))
    );
    const templateMenuItems = (template.menuItems || []).filter((id) => menuItemIds.has(id));
    const templateAddons = (template.addons || []).filter((id) => addonIds.has(id));
    const templateRentals = (template.rentals || []).filter((id) => rentalIds.has(id));
    if (template.eventTypeId) {
      setGlobalEventTypeId(template.eventTypeId);
    }

    setForm((prev) => ({
      ...prev,
      eventTemplateId: template.id,
      eventTypeId: template.eventTypeId || prev.eventTypeId || "",
      style: template.style || prev.style,
      hours: Number(template.hours || prev.hours || 0),
      bartenders: Number(template.bartenders ?? prev.bartenders ?? 0),
      pkg: template.pkg || prev.pkg,
      addons: templateAddons,
      addonQuantities: templateAddons.reduce((acc, id) => ({ ...acc, [id]: 1 }), {}),
      rentals: templateRentals,
      rentalQuantities: templateRentals.reduce((acc, id) => ({ ...acc, [id]: 1 }), {}),
      menuItems: templateMenuItems,
      menuItemQuantities: templateMenuItems.reduce((acc, id) => ({ ...acc, [id]: 1 }), {}),
      milesRT: Number(template.milesRT || prev.milesRT || 0),
      payMethod: template.payMethod || prev.payMethod,
      taxRegion: template.taxRegion || prev.taxRegion || catalog.settings.defaultTaxRegion || "",
      seasonProfileId: template.seasonProfileId || prev.seasonProfileId || "auto",
      bartenderRateTypeId: template.bartenderRateTypeId || prev.bartenderRateTypeId || "",
      staffingRateTypeId: template.staffingRateTypeId || prev.staffingRateTypeId || "",
      bartenderRateOverride:
        template.bartenderRateOverride === "" || template.bartenderRateOverride === null || template.bartenderRateOverride === undefined
          ? prev.bartenderRateOverride
          : Number(template.bartenderRateOverride),
      serverRateOverride:
        template.serverRateOverride === "" || template.serverRateOverride === null || template.serverRateOverride === undefined
          ? prev.serverRateOverride
          : Number(template.serverRateOverride),
      chefRateOverride:
        template.chefRateOverride === "" || template.chefRateOverride === null || template.chefRateOverride === undefined
          ? prev.chefRateOverride
          : Number(template.chefRateOverride)
    }));
  };

  const handleEventTypeChange = (eventTypeId) => {
    const nextEventTypeId = String(eventTypeId || "").trim();
    markFieldsTouched(["eventTypeId"]);
    setGlobalEventTypeId(nextEventTypeId);
    const templates = Array.isArray(catalog.settings?.eventTemplates) ? catalog.settings.eventTemplates : [];
    const matchedTemplate = findTemplateForEventType({
      eventTypeId: nextEventTypeId,
      templates,
      eventTypes: catalog.eventTypes
    });

    setForm((prev) => {
      const baseForm = {
        ...prev,
        eventTypeId: nextEventTypeId,
        eventTemplateId: "custom"
      };
      const { nextForm } = applyEventTypeTemplateDefaults({
        form: baseForm,
        template: matchedTemplate,
        catalog,
        touchedFields,
        initialForm: INITIAL_FORM
      });
      return nextForm;
    });
  };

  const applyRecommendation = (item) => {
    if (!item) return;
    if (item.kind === "package") markFieldsTouched(["pkg"]);
    if (item.kind === "addon") markFieldsTouched(["addons"]);
    if (item.kind === "rental") markFieldsTouched(["rentals"]);

    setForm((prev) => {
      if (item.kind === "package") {
        return { ...prev, eventTemplateId: "custom", pkg: item.id };
      }
      if (item.kind === "addon") {
        const next = new Set(prev.addons || []);
        next.add(item.id);
        return {
          ...prev,
          eventTemplateId: "custom",
          addons: [...next],
          addonQuantities: {
            ...(prev.addonQuantities || {}),
            [item.id]: Math.max(1, Number(prev.addonQuantities?.[item.id] || 1))
          }
        };
      }
      if (item.kind === "rental") {
        const next = new Set(prev.rentals || []);
        next.add(item.id);
        return {
          ...prev,
          eventTemplateId: "custom",
          rentals: [...next],
          rentalQuantities: {
            ...(prev.rentalQuantities || {}),
            [item.id]: Math.max(1, Number(prev.rentalQuantities?.[item.id] || 1))
          }
        };
      }
      return prev;
    });
  };

  const handleNextStep = () => {
    if (catalog.loading) return;
    if (step === 1 && !step1CanAdvance) {
      markFieldsTouched(STEP1_REQUIRED_FIELDS.map((field) => field.key));
      setShowStepValidation(true);
      return;
    }
    setShowStepValidation(false);
    setStep((current) => Math.min(5, current + 1));
  };

  const handleSubmitQuote = async () => {
    const requiredError =
      totals.guests <= 0
        ? "Add guest count before saving a quote."
        : !form.name.trim()
          ? "Client name is required."
          : !form.email.trim()
            ? "Client email is required."
            : !/^\S+@\S+\.\S+$/.test(form.email.trim())
              ? "Client email format is invalid."
              : !form.eventTypeId
                ? "Event type is required."
                : !form.date
                  ? "Event date is required."
                  : !form.eventName.trim()
                    ? "Event name is required."
                    : !form.venue.trim()
                      ? "Venue is required."
                      : "";

    if (requiredError) {
      setSubmitState((prev) => ({ ...prev, saving: false, message: requiredError }));
      return;
    }

    setSubmitState((prev) => ({
      ...prev,
      saving: true,
      message: "",
      portalLink: "",
      quoteId: "",
      quoteNumber: ""
    }));
    try {
      const availability = await checkEventAvailability({
        eventDate: form.date,
        venue: form.venue,
        eventTime: form.time,
        eventHours: form.hours,
        eventGuests: form.guests,
        capacityLimit: scheduleCapacityLimit,
        excludeQuoteId: isEditingQuote ? editingQuote.id : "",
        organizationId: authSession.organizationId
      });
      if (availability.hasBlockingConflict) {
        const conflictRefs = availability.conflicts
          .filter((item) => item.status === "booked")
          .slice(0, 3)
          .map((item) => item.quoteNumber || item.id)
          .join(", ");
        const capacityNote = availability.capacityExceeded
          ? ` Capacity alert: projected load (${availability.sameVenueLoad}) exceeds configured threshold (${availability.capacityLimit}).`
          : "";
        setSubmitState({
          saving: false,
          sendingQuoteEmail: false,
          message:
            `Availability conflict: this date/venue is already booked.` +
            `${conflictRefs ? ` Existing booking(s): ${conflictRefs}.` : ""}` +
            capacityNote,
          portalLink: "",
          quoteId: "",
          quoteNumber: ""
        });
        return;
      }
      const softConflicts = availability.conflicts.filter((item) => item.status === "accepted");
      const notes = [];
      if (softConflicts.length) {
        const refs = softConflicts
          .slice(0, 3)
          .map((item) => item.quoteNumber || item.id)
          .join(", ");
        notes.push(
          `Availability note: ${softConflicts.length} accepted quote(s) already exist for this date/venue${refs ? ` (${refs})` : ""}.`
        );
      }
      if (availability.capacityExceeded) {
        notes.push(
          `Capacity note: projected same-venue load is ${availability.sameVenueLoad} guests (limit ${availability.capacityLimit}).`
        );
      }
      if (notes.length) {
        setAvailabilityNotice(notes.join(" "));
      } else {
        setAvailabilityNotice("");
      }

      const requiresAuthoritativePricing =
        !E2E_ALLOW_NON_AUTHORITATIVE_PRICING
        && String(catalog.source || "").trim().toLowerCase().startsWith("firebase");
      const pricingInput = {
        organizationId: authSession.organizationId || "",
        quoteId: isEditingQuote ? editingQuote.id : "",
        quoteNumber: isEditingQuote ? editingQuote.quoteNumber || "" : "",
        actor: {
          uid: authSession.user?.uid || "",
          email: authSession.user?.email || "",
          role: authSession.role || "sales"
        },
        form,
        metadata: {
          source: catalog.source || "",
          generatedAt: new Date().toISOString()
        }
      };
      let totalsForPersistence = totals;
      let pricingSnapshot = null;
      let pricingAdjustmentNote = "";

      try {
        const pricingResult = await calculateQuotePricing({
          organizationId: authSession.organizationId || "",
          pricingInput
        });
        const authoritativePricing = pricingResult?.pricing && typeof pricingResult.pricing === "object"
          ? pricingResult.pricing
          : null;
        if (!authoritativePricing) {
          throw new Error("Authoritative pricing response was empty.");
        }
        pricingSnapshot = authoritativePricing;
        totalsForPersistence = buildTotalsFromPricingSnapshot(authoritativePricing, totals);
        const previewTotal = toNumber(totals.total, 0);
        const authoritativeTotal = toNumber(totalsForPersistence.total, previewTotal);
        if (Math.abs(authoritativeTotal - previewTotal) >= 0.01) {
          pricingAdjustmentNote = ` Server pricing adjusted total from ${currency(previewTotal)} to ${currency(authoritativeTotal)}.`;
        }
      } catch (pricingErr) {
        if (requiresAuthoritativePricing) {
          throw new Error(pricingErr?.message || "Failed to calculate authoritative quote pricing.");
        }
      }

      const result = await withTimeout(
        isEditingQuote
          ? updateQuote({
            quoteId: editingQuote.id,
            form,
            totals: totalsForPersistence,
            pricingSnapshot,
            catalogSource: catalog.source,
            settings: effectiveSettings,
            catalog,
            ownerUid: authSession.user?.uid || "",
            ownerEmail: authSession.user?.email || "",
            organizationId: authSession.organizationId
          })
          : submitQuote({
            form,
            totals: totalsForPersistence,
            pricingSnapshot,
            catalogSource: catalog.source,
            settings: effectiveSettings,
            catalog,
            ownerUid: authSession.user?.uid || "",
            ownerEmail: authSession.user?.email || "",
            organizationId: authSession.organizationId
          }),
        SAVE_FLOW_TIMEOUT_MS,
        isEditingQuote ? "updateQuote" : "submitQuote"
      );
      const basePath = `${window.location.origin}${window.location.pathname}`;
      const portalLink = result.portalKey ? `${basePath}?portal=${result.portalKey}` : "";

      if (isEditingQuote) {
        setSubmitState({
          saving: false,
          sendingQuoteEmail: false,
          message: `Quote ${result.quoteNumber} updated in ${result.storage}. Version snapshot saved and rates locked.${pricingAdjustmentNote}`,
          portalLink,
          quoteId: result.id,
          quoteNumber: result.quoteNumber || ""
        });
        pushToast(`Quote ${result.quoteNumber} updated.`, "success");
        setHistoryOpen(true);
        return;
      }

      let smsSuffix = "";
      if (result.storage === "firebase") {
        try {
          const smsResult = await withTimeout(
            notifyOwnerNewQuote({
              quoteId: result.id,
              portalLink
            }),
            OWNER_SMS_TIMEOUT_MS,
            "notifyOwnerNewQuote"
          );
          if (smsResult?.sms?.sent) {
            smsSuffix = " Owner SMS sent.";
          } else if (smsResult?.sms?.reason === "sms_not_configured") {
            smsSuffix = " Owner SMS not configured yet.";
          } else if (smsResult?.sms?.reason === "sms_disabled") {
            smsSuffix = " Owner SMS disabled by configuration.";
          } else if (smsResult?.sms?.reason === "sms_send_failed") {
            smsSuffix = " Owner SMS failed to send.";
          }
        } catch (smsErr) {
          smsSuffix = " Owner SMS failed to send.";
        }
      }
      setSubmitState({
        saving: false,
        sendingQuoteEmail: false,
        message: `Quote ${result.quoteNumber} saved to ${result.storage}.${smsSuffix}${pricingAdjustmentNote}`,
        portalLink,
        quoteId: result.id,
        quoteNumber: result.quoteNumber || ""
      });
      pushToast(`Quote ${result.quoteNumber} saved.`, "success");
      setHistoryOpen(true);
    } catch (err) {
      recordDiagnosticError(err, {
        surface: "app",
        action: "submit-quote",
        eventDate: form.date,
        venue: form.venue,
        guests: totals.guests
      });
      pushToast(err?.message || "Failed to save quote.", "error");
      setSubmitState((prev) => ({
        ...prev,
        saving: false,
        sendingQuoteEmail: false,
        message: err?.message || "Failed to save quote.",
        portalLink: "",
        quoteId: "",
        quoteNumber: ""
      }));
    }
  };

  const handleEditQuote = (quote) => {
    if (!quote?.id) return;

    const selection = quote.selection || {};
    const event = quote.event || {};
    const customer = quote.customer || {};
    const menuItemsFromSelection = Array.isArray(selection.menuItems) ? selection.menuItems : [];
    const menuItemsFromDetails = Array.isArray(selection.menuItemDetails)
      ? selection.menuItemDetails.map((item) => String(item?.id || "").trim()).filter(Boolean)
      : [];
    const menuItems = menuItemsFromSelection.length ? menuItemsFromSelection : menuItemsFromDetails;
    const menuItemQuantitiesFromDetails = Array.isArray(selection.menuItemDetails)
      ? selection.menuItemDetails.reduce((acc, item) => {
        const id = String(item?.id || "").trim();
        if (!id) return acc;
        acc[id] = Math.max(1, Number(item?.quantity || 1));
        return acc;
      }, {})
      : {};
    const menuItemQuantities = {
      ...menuItemQuantitiesFromDetails,
      ...(selection.menuItemQuantities || {})
    };
    const addonQuantities = selection.addonQuantities || {};
    const rentalQuantities = selection.rentalQuantities || {};
    const quoteEventTypeId = String(quote.eventTypeId || selection.eventTypeId || event.eventTypeId || "");
    setGlobalEventTypeId(quoteEventTypeId);

    // Lock labor rates during editing by defaulting overrides to the applied snapshot.
    const laborRateSnapshot = selection.laborRateSnapshot || {};
    const bartenderApplied = toOptionalNumber(
      laborRateSnapshot.bartenderRateApplied ?? quote.totals?.bartenderRateApplied
    );
    const serverApplied = toOptionalNumber(
      laborRateSnapshot.serverRateApplied ?? quote.totals?.serverRateApplied
    );
    const chefApplied = toOptionalNumber(
      laborRateSnapshot.chefRateApplied ?? quote.totals?.chefRateApplied
    );

    setForm((prev) => ({
      ...prev,
      date: event.date || "",
      time: event.time || "",
      hours: toNumber(event.hours, 0),
      bartenders: toNumber(event.bartenders, 0),
      guests: toNumber(event.guests, 0),
      venue: event.venue || "",
      venueAddress: event.venueAddress || "",
      eventName: event.name || "",
      clientOrg: customer.organization || "",
      style: event.style || prev.style,
      name: customer.name || "",
      phone: customer.phone || "",
      email: customer.email || "",
      pkg: selection.packageId || prev.pkg,
      addons: Array.isArray(selection.addons) ? selection.addons : [],
      addonQuantities,
      rentals: Array.isArray(selection.rentals) ? selection.rentals : [],
      rentalQuantities,
      menuItems,
      menuItemQuantities,
      eventTypeId: quoteEventTypeId,
      bartenderRateTypeId:
        String(selection.bartenderRateTypeId || laborRateSnapshot.bartenderRateTypeId || ""),
      staffingRateTypeId:
        String(selection.staffingRateTypeId || laborRateSnapshot.staffingRateTypeId || ""),
      bartenderRateOverride:
        selection.bartenderRateOverride !== "" && selection.bartenderRateOverride !== null && selection.bartenderRateOverride !== undefined
          ? toOptionalNumber(selection.bartenderRateOverride)
          : bartenderApplied,
      serverRateOverride:
        selection.serverRateOverride !== "" && selection.serverRateOverride !== null && selection.serverRateOverride !== undefined
          ? toOptionalNumber(selection.serverRateOverride)
          : serverApplied,
      chefRateOverride:
        selection.chefRateOverride !== "" && selection.chefRateOverride !== null && selection.chefRateOverride !== undefined
          ? toOptionalNumber(selection.chefRateOverride)
          : chefApplied,
      eventTemplateId: selection.eventTemplateId || "custom",
      taxRegion: selection.taxRegion || prev.taxRegion,
      seasonProfileId: selection.seasonProfileId || prev.seasonProfileId || "auto",
      milesRT: toNumber(selection.milesRT, 0),
      includeDisposables: quote.quoteMeta?.includeDisposables !== false,
      depositLink: quote.payment?.depositLink || "",
      payMethod: selection.payMethod || prev.payMethod
    }));

    setEditingQuote({
      id: quote.id,
      quoteNumber: quote.quoteNumber || quote.id
    });
    setTouchedFields({});
    setShowStepValidation(false);
    setHistoryOpen(false);
    setStep(1);
    setSubmitState({
      saving: false,
      sendingQuoteEmail: false,
      message: `Editing ${quote.quoteNumber || quote.id}. Save will update this quote and keep a version snapshot.`,
      portalLink: "",
      quoteId: "",
      quoteNumber: ""
    });
    wizardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleCopyPortalLink = async () => {
    try {
      if (!submitState.portalLink) return;
      await copyText(submitState.portalLink);
      setSubmitState((prev) => ({ ...prev, message: "Customer portal link copied." }));
    } catch (err) {
      recordDiagnosticError(err, {
        surface: "app",
        action: "copy-portal-link"
      });
      setSubmitState((prev) => ({
        ...prev,
        message: err?.message || "Failed to copy customer portal link."
      }));
    }
  };

  const handleSendQuoteEmail = async () => {
    const quoteId = String(submitState.quoteId || "").trim();
    if (!quoteId) {
      setSubmitState((prev) => ({ ...prev, message: "Save a quote before sending email." }));
      return;
    }

    setSubmitState((prev) => ({
      ...prev,
      sendingQuoteEmail: true,
      message: ""
    }));

    try {
      const quote = await getQuoteById(quoteId);
      const { exportQuoteProposal } = await import("./lib/proposalExport");
      const basePortalUrl = `${window.location.origin}${window.location.pathname}`;
      const attachment = await exportQuoteProposal(quote, {
        basePortalUrl,
        output: "base64",
        compact: true
      });
      const fallbackPortalLink = quote.portalKey ? `${basePortalUrl}?portal=${quote.portalKey}` : "";
      const portalLink = submitState.portalLink || fallbackPortalLink;

      await sendQuoteToCustomerEmail({
        quoteId,
        portalLink,
        attachment
      });

      const currentStatus = String(quote.status || "draft").trim().toLowerCase();
      if (currentStatus === "draft") {
        try {
          await updateQuoteStatus(quoteId, "sent");
        } catch (statusErr) {
          recordDiagnosticError(statusErr, {
            surface: "app",
            action: "mark-quote-sent-after-email",
            quoteId
          });
        }
      }

      setSubmitState((prev) => ({
        ...prev,
        sendingQuoteEmail: false,
        message: `Quote ${quote.quoteNumber || submitState.quoteNumber || quoteId} emailed with portal link and PDF attachment.`
      }));
      pushToast(`Quote ${quote.quoteNumber || quoteId} emailed to customer.`, "success");
    } catch (err) {
      recordDiagnosticError(err, {
        surface: "app",
        action: "send-quote-email",
        quoteId
      });
      setSubmitState((prev) => ({
        ...prev,
        sendingQuoteEmail: false,
        message: err?.message || "Failed to send quote email."
      }));
      pushToast(err?.message || "Failed to send quote email.", "error");
    }
  };

  const handleGetInstantQuote = () => {
    setEditingQuote({ id: "", quoteNumber: "" });
    setTouchedFields({});
    setShowStepValidation(false);
    setStep(1);
    wizardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleSignOut = async () => {
    try {
      await authSession.signOut();
    } catch (err) {
      recordDiagnosticError(err, {
        surface: "app",
        action: "sign-out"
      });
      setSubmitState((prev) => ({ ...prev, message: err?.message || "Failed to sign out." }));
    }
  };

  const openPortalMode = () => {
    if (!customerPortalEnabled) return;
    setPortalKey("");
    setPortalMode(true);
  };

  const closePortalMode = () => {
    setPortalMode(false);
    setPortalKey("");
    const nextUrl = `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
  };

  if (portalMode && customerPortalEnabled) {
    return (
      <div className="app-shell" style={appThemeVars}>
        <CustomerPortalView initialPortalKey={portalKey} onBackToStaff={closePortalMode} />
      </div>
    );
  }

  if (authSession.loading) {
    return (
      <main className="auth-shell container">
        <section className="panel auth-card">
          <h1>Loading</h1>
          <p className="muted">Checking your session...</p>
        </section>
      </main>
    );
  }

  if (!authSession.user) {
    return <AuthGate sessionError={authSession.error} />;
  }

  if (!authSession.isStaff) {
    return (
      <main className="auth-shell container">
        <section className="panel auth-card">
          <h1>Access Restricted</h1>
          <p className="muted">
            Signed in as {authSession.user.email}. Your account role is <strong>{authSession.role}</strong>.
          </p>
          <p className="source-note">Ask an admin to set your role to `sales` or `admin` in `userRoles/{authSession.user.uid}`.</p>
          <div className="auth-actions">
            {customerPortalEnabled && <button type="button" className="ghost" onClick={openPortalMode}>Open Customer Portal</button>}
            <button type="button" className="cta" onClick={handleSignOut}>Sign Out</button>
          </div>
        </section>
      </main>
    );
  }

  if (catalog.requiresFirebase) {
    return (
      <main className="auth-shell container">
        <section className="panel auth-card">
          <h1>Catalog Unavailable</h1>
          <p className="muted">
            Firebase catalog access is required in this environment.
          </p>
          <p className="source-note">{catalog.error || "Configure Firebase credentials and reload."}</p>
          <div className="auth-actions">
            <button type="button" className="ghost" onClick={handleSignOut}>Sign Out</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell" style={appThemeVars}>
      <header className="site-header">
        <div className="container nav">
          <div className="brand-lockup">
            <img
              className="brand-logo"
              src={brandLogoUrl}
              alt={`${brandName} logo`}
              loading="eager"
              decoding="async"
            />
            <div className="brand-copy">
              <div className="brand">{brandName}</div>
              <p>{brandTagline}</p>
            </div>
          </div>
          {brandCrew.length > 0 && (
            <div className="brand-crew">
              {brandCrew.map((member, idx) => (
                <figure className="crew-chip" key={`${member.label || "member"}-${idx}`}>
                  {member.imageUrl ? (
                    <img src={member.imageUrl} alt={member.label || `Team member ${idx + 1}`} loading="lazy" decoding="async" />
                  ) : (
                    <img src={brandLogoUrl} alt={member.label || `Team member ${idx + 1}`} loading="lazy" decoding="async" />
                  )}
                  <figcaption>{member.label || `Team member ${idx + 1}`}</figcaption>
                </figure>
              ))}
            </div>
          )}
          <div className="right-actions header-actions">
            {eventScheduleEnabled && <button className="ghost" onClick={() => setScheduleOpen(true)}>Schedule</button>}
            {integrationsEnabled && <button className="ghost" onClick={() => setIntegrationsOpen(true)}>Integrations</button>}
            {diagnosticsEnabled && <button className="ghost" onClick={() => setDiagnosticsOpen(true)}>Diagnostics</button>}
            {dashboardEnabled && <button className="ghost" onClick={() => setDashboardOpen(true)}>Dashboard</button>}
            <button className="ghost" onClick={() => setHistoryOpen(true)}>Quote History</button>
            {authSession.isAdmin && <button className="ghost" onClick={() => setAdminOpen(true)}>Admin Catalog</button>}
            {customerPortalEnabled && <button className="ghost" onClick={openPortalMode}>Customer Portal</button>}
            <button className="cta header-quick-cta" onClick={handleGetInstantQuote}>Quick Quote</button>
            <button className="ghost" onClick={handleSignOut}>Sign Out</button>
          </div>
        </div>
      </header>

      <section className="hero container">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">{heroEyebrow}</p>
            <h1>{heroHeadline}</h1>
            <p>{heroDescription}</p>
            <div className="hero-cta-row">
              <button className="cta hero-primary-cta" type="button" onClick={handleGetInstantQuote}>
                Get Instant Quote
              </button>
              <p className="hero-cta-note">Start the guided flow with required fields first, then build the full proposal.</p>
            </div>
            <div className="hero-pills">
              <span>Signed in: {authSession.user.email}</span>
              <span>Role: {authSession.role}</span>
              <span>Source: {catalog.source}</span>
            </div>
          </div>
          <aside className="hero-card">
            <h3>Live Quote Snapshot</h3>
            <dl>
              <div><dt>Current Total</dt><dd>{currency(totals.total)}</dd></div>
              <div><dt>Deposit</dt><dd>{currency(totals.deposit)}</dd></div>
              <div><dt>Tax Region</dt><dd>{totals.taxRegionName}</dd></div>
              <div><dt>Season</dt><dd>{totals.seasonProfileName}</dd></div>
            </dl>
          </aside>
        </div>
      </section>

      <main className="container wizard-grid" ref={wizardRef}>
        <section className="panel wizard-panel">
          <ol className="stepper">
            {stepperModel.map((stepMeta) => {
              const stepOneMissing = stepMeta.stepNumber === 1 && !step1Validation.valid;
              return (
                <li
                  key={stepMeta.label}
                  className={`stepper-item status-${stepMeta.status} ${stepMeta.isLocked ? "is-locked" : ""}`.trim()}
                >
                  <span className="step-badge">
                    {stepMeta.status === "completed" ? "✓" : stepOneMissing ? "!" : stepMeta.stepNumber}
                  </span>
                  <div className="step-copy">
                    <em>{stepMeta.label}</em>
                    <small>{stepMeta.microcopy}</small>
                    {stepOneMissing && (
                      <small className="step-warning">Missing required fields</small>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="step-stage" key={step}>
            {catalog.loading && <p className="source-note">Loading catalog...</p>}
            {!catalog.loading && step === 1 && (
              <StepEvent
                form={form}
                setForm={setForm}
                styles={Object.keys(STAFF_RULES)}
                settings={effectiveSettings}
                onTemplateChange={applyEventTemplate}
                eventTypes={catalog.eventTypes || []}
                onEventTypeChange={handleEventTypeChange}
                onFieldChange={handleStep1FieldChange}
                onFieldBlur={handleStep1FieldBlur}
                touchedFields={touchedFields}
                fieldErrors={step1Validation.fieldErrors}
                showValidation={showStepValidation}
              />
            )}
            {!catalog.loading && step === 1 && showStepValidation && !step1CanAdvance && (
              <p className="warning-note step-guidance">
                Complete required fields before continuing: {step1Validation.missingFields.map((field) => field.label).join(", ")}.
              </p>
            )}
            {!catalog.loading && step === 2 && (
              <StepMenu
                form={form}
                setForm={setForm}
                menuSections={effectiveMenuSections}
                menuLoading={dynamicMenuLoading}
                onSelectionTouched={handleSelectionTouched}
              />
            )}
            {!catalog.loading && step === 3 && (
              <StepServices
                form={form}
                setForm={setForm}
                catalog={catalog}
                recommendations={recommendations}
                guidedSellingEnabled={effectiveSettings.guidedSellingEnabled !== false}
                onApplyRecommendation={applyRecommendation}
                onSelectionTouched={handleSelectionTouched}
              />
            )}
            {!catalog.loading && step === 4 && <StepReview form={form} totals={totals} settings={effectiveSettings} />}
            {!catalog.loading && step === 5 && (
              <div className="grid two-col">
                <label className="field">
                  <span>Payment method</span>
                  <select
                    value={form.payMethod}
                    onChange={(e) => {
                      handleSelectionTouched("payMethod");
                      setForm((f) => ({ ...f, payMethod: e.target.value }));
                    }}
                  >
                    <option value="card">Pay by Card</option>
                    <option value="ach">Pay by ACH/Check</option>
                  </select>
                </label>
              <label className="field deposit-link-field">
                <span>Deposit payment link (optional)</span>
                <input
                  type="url"
                  placeholder="https://payment-link.example.com"
                  value={form.depositLink}
                  onChange={(e) => setForm((f) => ({ ...f, depositLink: e.target.value }))}
                />
              </label>
                <article className="summary-total">
                  <p><strong>Final total:</strong> {currency(totals.total)}</p>
                  <p><strong>Deposit due:</strong> {currency(totals.deposit)}</p>
                  <p className="muted">Saving will keep a version snapshot for edits and lifecycle changes.</p>
                </article>
              </div>
            )}
          </div>

          <div className="wizard-actions">
            <div className="right-actions">
              <button className="ghost" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1 || catalog.loading}>Back</button>
              {quoteCompareEnabled && (
                <button className="ghost" onClick={() => setCompareOpen(true)} disabled={catalog.loading || step < 2}>
                  Compare Scenario
                </button>
              )}
            </div>
            <div className="right-actions">
              {step < 5 ? (
                <button
                  className="cta"
                  onClick={handleNextStep}
                  disabled={catalog.loading || (step === 1 && !step1CanAdvance)}
                >
                  Next
                </button>
              ) : (
                <>
                <button
                  className="cta"
                  onClick={handleSubmitQuote}
                  disabled={submitState.saving || catalog.loading || totals.guests <= 0}
                >
                    {submitState.saving ? (isEditingQuote ? "Saving Changes..." : "Saving...") : (isEditingQuote ? "Save Changes" : "Save & Submit")}
                  </button>
                </>
              )}
            </div>
          </div>

          {(submitState.portalLink || submitState.quoteId) && (
            <div className="portal-link-row">
              {submitState.portalLink && <input type="text" readOnly value={submitState.portalLink} />}
              {submitState.portalLink && (
                <button type="button" className="ghost" onClick={handleCopyPortalLink}>Copy Portal Link</button>
              )}
              {submitState.quoteId && (
                <button
                  type="button"
                  className="cta"
                  onClick={handleSendQuoteEmail}
                  disabled={submitState.saving || submitState.sendingQuoteEmail}
                >
                  {submitState.sendingQuoteEmail ? "Sending Quote Email..." : "Send Quote Email (Portal + PDF)"}
                </button>
              )}
            </div>
          )}

          <p className="source-note">Quote validity: {Math.max(1, Number(catalog.settings?.quoteValidityDays || 30))} days</p>
          {isEditingQuote && (
            <p className="warning-note">
              Editing quote {editingQuote.quoteNumber}. Saving updates this quote (with version history) and keeps labor rates locked by snapshot.
            </p>
          )}
          {catalog.error && <p className="error-note">{catalog.error}</p>}
          {dynamicMenuError && <p className="warning-note">{dynamicMenuError}</p>}
          {availabilityNotice && <p className="warning-note">{availabilityNotice}</p>}
          {submitState.message && <p className="source-note">{submitState.message}</p>}
        </section>

        <LiveBreakdown form={form} totals={totals} settings={effectiveSettings} catalog={catalog} />
      </main>

      {toasts.length > 0 && (
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.tone || "info"}`}>
              {toast.message}
            </div>
          ))}
        </div>
      )}

      <Suspense fallback={null}>
        {authSession.isAdmin && (
          <AdminCatalogModal
            open={adminOpen}
            catalog={catalog}
            organizationId={authSession.organizationId}
            onClose={() => setAdminOpen(false)}
            onSave={catalog.saveCatalog}
            saving={catalog.saving}
            selectedEventType={globalEventTypeId}
            onEventTypeChange={setGlobalEventTypeId}
            onToast={pushToast}
          />
        )}

        <QuoteHistoryModal
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          basePortalUrl={`${window.location.origin}${window.location.pathname}`}
          organizationId={authSession.organizationId}
          currentUserUid={authSession.user?.uid || ""}
          currentUserEmail={authSession.user?.email || ""}
          onEditQuote={handleEditQuote}
          onToast={pushToast}
        />

        {eventScheduleEnabled && (
          <EventScheduleModal
            open={scheduleOpen}
            onClose={() => setScheduleOpen(false)}
            organizationId={authSession.organizationId}
            staffLeads={scheduleStaffLeads}
            capacityLimit={scheduleCapacityLimit}
          />
        )}

        {integrationsEnabled && (
          <IntegrationOpsModal
            open={integrationsOpen}
            onClose={() => setIntegrationsOpen(false)}
            organizationId={authSession.organizationId}
            settings={effectiveSettings}
            currentUserEmail={authSession.user?.email || ""}
          />
        )}

        {diagnosticsEnabled && (
          <DiagnosticsModal
            open={diagnosticsOpen}
            onClose={() => setDiagnosticsOpen(false)}
          />
        )}

        {quoteCompareEnabled && (
          <QuoteCompareModal
            open={compareOpen}
            onClose={() => setCompareOpen(false)}
            form={form}
            setForm={setForm}
            catalog={catalog}
            settings={effectiveSettings}
            styles={Object.keys(STAFF_RULES)}
            primaryTotals={totals}
          />
        )}

        {dashboardEnabled && (
          <ReportingDashboardModal
            open={dashboardOpen}
            onClose={() => setDashboardOpen(false)}
            organizationId={authSession.organizationId}
          />
        )}
      </Suspense>
    </div>
  );
}
