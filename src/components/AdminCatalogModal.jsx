import { useEffect, useState } from "react";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { firebaseReady, storage } from "../lib/firebase";
import { PORTAL_THEME_PRESETS } from "../data/mockCatalog";
import {
  createCategory,
  createEventType,
  createMenuItem,
  deleteMenuItem,
  getEventTypes,
  getMenuCategories,
  getMenuItems,
  updateCategory,
  updateEventType,
  updateMenuItem
} from "../lib/menuService";

const JSON_FIELD_META = [
  {
    key: "serviceFeeTiers",
    label: "Service Fee Tiers JSON",
    hint: "Array of { id, minGuests, maxGuests, pct }."
  },
  {
    key: "taxRegions",
    label: "Tax Regions JSON",
    hint: "Array of { id, name, rate }."
  },
  {
    key: "eventTemplates",
    label: "Event Templates JSON",
    hint: "Array of defaults used by template picker in Step 1."
  },
  {
    key: "seasonalProfiles",
    label: "Seasonal Profiles JSON",
    hint: "Array of { id, name, startMonth, startDay, endMonth, endDay, multipliers }."
  },
  {
    key: "brandCrew",
    label: "Brand Crew JSON",
    hint: "Array of { label, imageUrl } shown in header and proposal."
  }
];

const RULE_KIND_META = [
  { value: "addon", label: "Add-on" },
  { value: "rental", label: "Rental" },
  { value: "package", label: "Package" }
];

const ADMIN_TABS = [
  { id: "packages", label: "Packages" },
  { id: "addons", label: "Addons" },
  { id: "rentals", label: "Rentals" },
  { id: "menu", label: "Menu" },
  { id: "pricing", label: "Pricing" }
];

const CRM_PROVIDER_OPTIONS = [
  { value: "webhook", label: "Webhook" },
  { value: "webhook_bridge", label: "Webhook Bridge" },
  { value: "hubspot", label: "HubSpot Bridge" },
  { value: "salesforce", label: "Salesforce Bridge" }
];

const FEATURE_FLAG_META = [
  { id: "customerPortal", label: "Customer Portal" },
  { id: "eventSchedule", label: "Event Schedule" },
  { id: "integrationsOps", label: "Integrations Ops" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "reportingDashboard", label: "Reporting Dashboard" },
  { id: "quoteCompare", label: "Quote Compare" },
  { id: "crmSync", label: "CRM Sync" },
  { id: "guidedSelling", label: "Guided Selling" },
  { id: "aiAssist", label: "AI Assist (Suggestions)" },
  { id: "aiAutopilot", label: "AI Autopilot (Auto Apply)" }
];

function normalizePricingType(value, fallback = "per_event") {
  const raw = String(value || fallback).trim().toLowerCase();
  if (raw === "per_person" || raw === "per_item" || raw === "per_event") return raw;
  return fallback;
}

function normalizeStaffingChargeMode(value, fallback = "per_hour") {
  const raw = String(value || fallback).trim().toLowerCase();
  if (raw === "per_event_per_staff") return "per_event_per_staff";
  return "per_hour";
}

function normalizeCrmProvider(value, fallback = "webhook") {
  const raw = String(value || fallback).trim().toLowerCase();
  if (raw === "crm") return "webhook";
  if (raw === "webhook-bridge") return "webhook_bridge";
  if (raw === "webhook" || raw === "webhook_bridge" || raw === "hubspot" || raw === "salesforce") return raw;
  return fallback;
}

function defaultRuleName(kind) {
  if (kind === "rental") return "Rental recommendation";
  if (kind === "package") return "Package recommendation";
  return "Add-on recommendation";
}

function buildJsonDrafts(catalog) {
  const settings = catalog?.settings || {};
  return {
    serviceFeeTiers: JSON.stringify(settings.serviceFeeTiers || [], null, 2),
    taxRegions: JSON.stringify(settings.taxRegions || [], null, 2),
    eventTemplates: JSON.stringify(settings.eventTemplates || [], null, 2),
    seasonalProfiles: JSON.stringify(settings.seasonalProfiles || [], null, 2),
    brandCrew: JSON.stringify(settings.brandCrew || [], null, 2)
  };
}

function toDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function Section({ title, onAdd, children }) {
  return (
    <section className="admin-section">
      <div className="admin-section-head">
        <h3>{title}</h3>
        {onAdd && <button type="button" className="ghost" onClick={onAdd}>Add</button>}
      </div>
      <div className="admin-section-body">{children}</div>
    </section>
  );
}

export default function AdminCatalogModal({
  open,
  catalog,
  organizationId = "",
  onClose,
  onSave,
  saving,
  selectedEventType: selectedEventTypeProp = "",
  onEventTypeChange,
  onToast
}) {
  const [draft, setDraft] = useState(catalog);
  const [activeTab, setActiveTab] = useState("packages");
  const [status, setStatus] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [jsonDrafts, setJsonDrafts] = useState(() => buildJsonDrafts(catalog));
  const [selectedEventType, setSelectedEventType] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [menuEventTypes, setMenuEventTypes] = useState([]);
  const [menuCategories, setMenuCategories] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [menuActionLoading, setMenuActionLoading] = useState(false);
  const [newEventTypeName, setNewEventTypeName] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [eventTypeEditName, setEventTypeEditName] = useState("");
  const [categoryEditName, setCategoryEditName] = useState("");
  const [newItemDraft, setNewItemDraft] = useState({
    name: "",
    price: 0,
    pricingType: "per_event",
    active: true
  });
  const [menuItemBaselines, setMenuItemBaselines] = useState({});
  const [menuItemDirty, setMenuItemDirty] = useState({});
  const [menuItemSavingId, setMenuItemSavingId] = useState("");
  const scopedOrganizationId = String(organizationId || "").trim();

  const pushToast = (message, tone = "info") => {
    if (typeof onToast === "function") {
      onToast(message, tone);
    }
  };

  const normalizeManagedMenuItem = (item) => {
    const pricingType = normalizePricingType(item?.pricingType || item?.type, "per_event");
    return {
      ...item,
      name: String(item?.name || "").trim(),
      price: Number(item?.price || 0),
      pricingType,
      type: pricingType,
      active: item?.active !== false
    };
  };

  const buildMenuItemBaselineMap = (items) =>
    (items || []).reduce((acc, item) => {
      acc[item.id] = { ...item };
      return acc;
    }, {});

  const applyManagedMenuItems = (items) => {
    const normalized = (items || []).map(normalizeManagedMenuItem);
    setMenuItems(normalized);
    setMenuItemBaselines(buildMenuItemBaselineMap(normalized));
    setMenuItemDirty({});
    setMenuItemSavingId("");
  };

  const setManagedEventType = (eventTypeId) => {
    const nextEventTypeId = String(eventTypeId || "").trim();
    setSelectedEventType(nextEventTypeId);
    if (typeof onEventTypeChange === "function") {
      onEventTypeChange(nextEventTypeId);
    }
  };

  useEffect(() => {
    if (open) {
      setDraft({
        ...catalog,
        settings: {
          ...(catalog?.settings || {}),
          featureFlags: { ...(catalog?.settings?.featureFlags || {}) }
        }
      });
      setJsonDrafts(buildJsonDrafts(catalog));
      setStatus("");
      setUploadingLogo(false);
      setActiveTab("packages");
      setSelectedEventType(String(selectedEventTypeProp || "").trim());
      setSelectedCategory("");
      setMenuEventTypes([]);
      setMenuCategories([]);
      setMenuItems([]);
      setMenuItemBaselines({});
      setMenuItemDirty({});
      setMenuItemSavingId("");
      setMenuLoading(false);
      setMenuActionLoading(false);
      setNewEventTypeName("");
      setNewCategoryName("");
      setEventTypeEditName("");
      setCategoryEditName("");
      setNewItemDraft({ name: "", price: 0, pricingType: "per_event", active: true });
    }
  }, [open, catalog, selectedEventTypeProp]);

  useEffect(() => {
    if (!open) return;
    let alive = true;

    async function loadEventTypeOptions() {
      setMenuLoading(true);
      try {
        const eventTypes = await getEventTypes({ organizationId: scopedOrganizationId });
        if (!alive) return;
        setMenuEventTypes(eventTypes);
        setManagedEventType(selectedEventTypeProp || eventTypes[0]?.id || "");
      } catch (err) {
        if (!alive) return;
        setStatus(err?.message || "Failed to load menu event types.");
        pushToast(err?.message || "Failed to load menu event types.", "error");
      } finally {
        if (alive) setMenuLoading(false);
      }
    }

    loadEventTypeOptions();
    return () => {
      alive = false;
    };
  }, [open, scopedOrganizationId, selectedEventTypeProp]);

  useEffect(() => {
    if (!open) return;
    const eventTypeId = String(selectedEventType || "").trim();
    if (!eventTypeId) {
      setMenuCategories([]);
      setMenuItems([]);
      setSelectedCategory("");
      return;
    }

    let alive = true;
    async function loadEventMenuData() {
      setMenuLoading(true);
      try {
        const [categories, items] = await Promise.all([
          getMenuCategories(eventTypeId, { organizationId: scopedOrganizationId }),
          getMenuItems(eventTypeId, { includeInactive: true, organizationId: scopedOrganizationId })
        ]);
        if (!alive) return;
        setMenuCategories(categories);
        applyManagedMenuItems(items);
        setSelectedCategory((current) => {
          const keepCurrent = current && categories.some((category) => category.id === current);
          if (keepCurrent) return current;
          return categories[0]?.id || "";
        });
      } catch (err) {
        if (!alive) return;
        setStatus(err?.message || "Failed to load menu categories/items.");
        pushToast(err?.message || "Failed to load menu categories/items.", "error");
      } finally {
        if (alive) setMenuLoading(false);
      }
    }

    loadEventMenuData();
    return () => {
      alive = false;
    };
  }, [open, scopedOrganizationId, selectedEventType]);

  useEffect(() => {
    if (!open) return;
    const selected = menuEventTypes.find((eventType) => eventType.id === selectedEventType);
    setEventTypeEditName(selected?.name || "");
  }, [open, selectedEventType, menuEventTypes]);

  useEffect(() => {
    if (!open) return;
    const selected = menuCategories.find((category) => category.id === selectedCategory);
    setCategoryEditName(selected?.name || "");
  }, [open, selectedCategory, menuCategories]);

  if (!open) return null;

  const patchArrayItem = (key, index, field, value) => {
    setDraft((prev) => {
      const next = { ...prev, [key]: [...prev[key]] };
      next[key][index] = { ...next[key][index], [field]: value };
      return next;
    });
  };

  const addRow = (key) => {
    const id = `${key}-${Date.now()}`;
    const template =
      key === "packages"
        ? { id, name: "New Package", ppp: 0, includedAddonIds: [], includedRentalIds: [], includedMenuItemIds: [] }
      : key === "addons"
          ? {
              id,
              name: "New Add-on",
              pricingType: "per_person",
              type: "per_person",
              price: 0,
              staffRole: "",
              active: true
            }
          : { id, name: "New Rental", pricingType: "per_item", type: "per_item", price: 0, qtyPerGuests: 10, active: true };

    setDraft((prev) => ({ ...prev, [key]: [...prev[key], template] }));
  };

  const removeRow = (key, index) => {
    setDraft((prev) => ({ ...prev, [key]: prev[key].filter((_, i) => i !== index) }));
  };

  const togglePackageInclusion = (packageIndex, field, itemId, checked) => {
    setDraft((prev) => {
      const packages = [...prev.packages];
      const current = { ...packages[packageIndex] };
      const ids = new Set(Array.isArray(current[field]) ? current[field] : []);
      if (checked) ids.add(itemId);
      else ids.delete(itemId);
      current[field] = [...ids];
      packages[packageIndex] = current;
      return { ...prev, packages };
    });
  };

  const applyPortalTheme = (theme) => {
    setDraft((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        portalThemeId: theme.id,
        brandPrimaryColor: theme.primary,
        brandAccentColor: theme.accent,
        brandDarkAccentColor: theme.dark,
        brandBackgroundStart: theme.surface,
        brandBackgroundMid: theme.surfaceAlt,
        brandBackgroundEnd: theme.canvas
      }
    }));
  };

  const patchNumericSetting = (field, value) => {
    setDraft((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        [field]: Number(value || 0)
      }
    }));
  };

  const patchTextSetting = (field, value) => {
    setDraft((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        [field]: value
      }
    }));
  };

  const patchToggleSetting = (field, checked) => {
    setDraft((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        [field]: Boolean(checked)
      }
    }));
  };

  const patchFeatureFlag = (flagId, checked) => {
    setDraft((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        featureFlags: {
          ...(prev.settings?.featureFlags || {}),
          [flagId]: Boolean(checked)
        }
      }
    }));
  };

  const patchUpsellRule = (index, field, value) => {
    setDraft((prev) => {
      const rules = [...(prev.settings?.upsellRules || [])];
      const current = { ...(rules[index] || {}) };

      if (field === "enabled") {
        current.enabled = Boolean(value);
      } else if (field === "minGuests" || field === "minHours") {
        current[field] = Math.max(0, Number(value || 0));
      } else if (field === "kind") {
        current.kind = value;
        current.targetId =
          value === "rental"
            ? prev.rentals?.[0]?.id || ""
            : value === "package"
              ? ""
              : prev.addons?.[0]?.id || "";
        current.name = current.name || defaultRuleName(value);
      } else {
        current[field] = value;
      }

      rules[index] = current;
      return {
        ...prev,
        settings: {
          ...prev.settings,
          upsellRules: rules
        }
      };
    });
  };

  const addUpsellRule = () => {
    const fallbackAddon = draft.addons?.[0]?.id || "";
    const nextRule = {
      id: `upsell-rule-${Date.now()}`,
      name: "New recommendation rule",
      kind: "addon",
      targetId: fallbackAddon,
      enabled: true,
      minGuests: 0,
      minHours: 0,
      reason: "Upsell rule matched this quote."
    };

    setDraft((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        upsellRules: [...(prev.settings?.upsellRules || []), nextRule]
      }
    }));
  };

  const removeUpsellRule = (index) => {
    setDraft((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        upsellRules: (prev.settings?.upsellRules || []).filter((_, idx) => idx !== index)
      }
    }));
  };

  const getUpsellTargetOptions = (kind) => {
    if (kind === "rental") {
      return (draft.rentals || []).map((item) => ({ value: item.id, label: item.name }));
    }
    if (kind === "package") {
      return (draft.packages || []).map((item) => ({ value: item.id, label: `${item.name} (${item.ppp}/person)` }));
    }
    return (draft.addons || []).map((item) => ({ value: item.id, label: item.name }));
  };

  const patchJsonDraft = (field, value) => {
    setJsonDrafts((prev) => ({ ...prev, [field]: value }));
  };

  const refreshEventTypes = async (preferredId = "") => {
    const items = await getEventTypes({ organizationId: scopedOrganizationId });
    setMenuEventTypes(items);
    const currentId = String(selectedEventType || "").trim();
    const nextId =
      (preferredId && items.some((item) => item.id === preferredId) && preferredId) ||
      (currentId && items.some((item) => item.id === currentId) && currentId) ||
      items[0]?.id ||
      "";
    setManagedEventType(nextId);
    return items;
  };

  const refreshEventMenuData = async (eventTypeId = selectedEventType) => {
    const nextEventTypeId = String(eventTypeId || "").trim();
    if (!nextEventTypeId) {
      setMenuCategories([]);
      setMenuItems([]);
      setSelectedCategory("");
      return;
    }
    const [categories, items] = await Promise.all([
      getMenuCategories(nextEventTypeId, { organizationId: scopedOrganizationId }),
      getMenuItems(nextEventTypeId, { includeInactive: true, organizationId: scopedOrganizationId })
    ]);
    setMenuCategories(categories);
    applyManagedMenuItems(items);
    setSelectedCategory((current) => {
      if (current && categories.some((category) => category.id === current)) return current;
      return categories[0]?.id || "";
    });
  };

  const handleCreateEventType = async () => {
    const name = String(newEventTypeName || "").trim();
    if (!name) {
      setStatus("Enter an event type name first.");
      return;
    }
    setMenuActionLoading(true);
    try {
      const created = await createEventType({ name, organizationId: scopedOrganizationId });
      setNewEventTypeName("");
      await refreshEventTypes(created.id);
      await refreshEventMenuData(created.id);
      const seededLabel = created?.seeded
        ? ` Seeded ${Number(created.seeded.categories || 0)} categories and ${Number(created.seeded.items || 0)} items.`
        : "";
      setStatus(`Event type "${created.name}" added.${seededLabel}`);
      pushToast(`Event type "${created.name}" added.${seededLabel}`, "success");
    } catch (err) {
      setStatus(err?.message || "Failed to create event type.");
      pushToast(err?.message || "Failed to create event type.", "error");
    } finally {
      setMenuActionLoading(false);
    }
  };

  const handleCreateCategory = async () => {
    const name = String(newCategoryName || "").trim();
    if (!selectedEventType) {
      setStatus("Choose an event type before adding a category.");
      return;
    }
    if (!name) {
      setStatus("Enter a category name first.");
      return;
    }
    setMenuActionLoading(true);
    try {
      const created = await createCategory({
        eventTypeId: selectedEventType,
        name,
        organizationId: scopedOrganizationId
      });
      setNewCategoryName("");
      await refreshEventMenuData(selectedEventType);
      setSelectedCategory(created.id);
      setStatus(`Category "${created.name}" added.`);
      pushToast(`Category "${created.name}" added.`, "success");
    } catch (err) {
      setStatus(err?.message || "Failed to create category.");
      pushToast(err?.message || "Failed to create category.", "error");
    } finally {
      setMenuActionLoading(false);
    }
  };

  const handleUpdateEventType = async () => {
    if (!selectedEventType) {
      setStatus("Choose an event type first.");
      return;
    }
    const name = String(eventTypeEditName || "").trim();
    if (!name) {
      setStatus("Event type name cannot be empty.");
      return;
    }

    setMenuActionLoading(true);
    try {
      await updateEventType(selectedEventType, { name, organizationId: scopedOrganizationId });
      await refreshEventTypes(selectedEventType);
      setStatus("Event type updated.");
      pushToast("Event type updated.", "success");
    } catch (err) {
      setStatus(err?.message || "Failed to update event type.");
      pushToast(err?.message || "Failed to update event type.", "error");
    } finally {
      setMenuActionLoading(false);
    }
  };

  const handleUpdateCategory = async () => {
    if (!selectedEventType || !selectedCategory) {
      setStatus("Choose event type and category first.");
      return;
    }
    const name = String(categoryEditName || "").trim();
    if (!name) {
      setStatus("Category name cannot be empty.");
      return;
    }

    setMenuActionLoading(true);
    try {
      await updateCategory(selectedCategory, {
        name,
        eventTypeId: selectedEventType,
        organizationId: scopedOrganizationId
      });
      await refreshEventMenuData(selectedEventType);
      setStatus("Category updated.");
      pushToast("Category updated.", "success");
    } catch (err) {
      setStatus(err?.message || "Failed to update category.");
      pushToast(err?.message || "Failed to update category.", "error");
    } finally {
      setMenuActionLoading(false);
    }
  };

  const handleCreateMenuItem = async () => {
    const name = String(newItemDraft.name || "").trim();
    if (!selectedEventType || !selectedCategory) {
      setStatus("Choose event type and category before adding an item.");
      return;
    }
    if (!name) {
      setStatus("Enter a menu item name first.");
      return;
    }
    setMenuActionLoading(true);
    try {
      await createMenuItem({
        eventTypeId: selectedEventType,
        categoryId: selectedCategory,
        name,
        price: Number(newItemDraft.price || 0),
        pricingType: normalizePricingType(newItemDraft.pricingType, "per_event"),
        active: newItemDraft.active !== false,
        organizationId: scopedOrganizationId
      });
      setNewItemDraft({ name: "", price: 0, pricingType: "per_event", active: true });
      await refreshEventMenuData(selectedEventType);
      setStatus("Menu item added.");
      pushToast("Menu item added.", "success");
    } catch (err) {
      setStatus(err?.message || "Failed to add menu item.");
      pushToast(err?.message || "Failed to add menu item.", "error");
    } finally {
      setMenuActionLoading(false);
    }
  };

  const patchManagedMenuItem = (id, field, value) => {
    setMenuItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        if (field === "pricingType") {
          const pricingType = normalizePricingType(value, "per_event");
          return { ...item, pricingType, type: pricingType };
        }
        if (field === "active") {
          return { ...item, active: Boolean(value) };
        }
        if (field === "price") {
          return { ...item, price: Number(value || 0) };
        }
        return { ...item, [field]: value };
      })
    );
    setMenuItemDirty((prev) => ({ ...prev, [id]: true }));
  };

  const handleUpdateManagedMenuItem = async (item) => {
    const itemId = String(item?.id || "").trim();
    if (!itemId) return;
    setMenuItemSavingId(itemId);
    try {
      const pricingType = normalizePricingType(item.pricingType || item.type, "per_event");
      const nextPayload = {
        name: String(item.name || "").trim() || "Untitled Item",
        price: Number(item.price || 0),
        pricingType,
        active: item.active !== false
      };
      await updateMenuItem(item.id, {
        ...nextPayload,
        eventTypeId: selectedEventType,
        categoryId: selectedCategory || item.categoryId,
        organizationId: scopedOrganizationId
      });
      setMenuItems((prev) =>
        prev.map((entry) =>
          entry.id === itemId
            ? {
              ...entry,
              ...nextPayload,
              type: pricingType
            }
            : entry
        )
      );
      setMenuItemBaselines((prev) => ({
        ...prev,
        [itemId]: {
          ...(prev[itemId] || item),
          ...nextPayload,
          type: pricingType
        }
      }));
      setMenuItemDirty((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      setStatus("Menu item updated.");
      pushToast("Menu item updated.", "success");
    } catch (err) {
      setStatus(err?.message || "Failed to update menu item.");
      const baseline = menuItemBaselines[itemId];
      if (baseline) {
        setMenuItems((prev) => prev.map((entry) => (entry.id === itemId ? { ...baseline } : entry)));
      }
      setMenuItemDirty((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      pushToast(err?.message || "Failed to update menu item.", "error");
    } finally {
      setMenuItemSavingId("");
    }
  };

  const handleManagedMenuItemBlur = (itemId) => {
    if (!menuItemDirty[itemId]) return;
    const current = menuItems.find((entry) => entry.id === itemId);
    if (!current) return;
    handleUpdateManagedMenuItem(current);
  };

  const handleManagedMenuItemKeyDown = (event, itemId) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.currentTarget.blur();
    handleManagedMenuItemBlur(itemId);
  };

  const handleDeleteManagedMenuItem = async (id) => {
    setMenuActionLoading(true);
    try {
      await deleteMenuItem(id, { organizationId: scopedOrganizationId });
      setStatus("Menu item deleted.");
      pushToast("Menu item deleted.", "success");
      await refreshEventMenuData(selectedEventType);
    } catch (err) {
      setStatus(err?.message || "Failed to delete menu item.");
      pushToast(err?.message || "Failed to delete menu item.", "error");
    } finally {
      setMenuActionLoading(false);
    }
  };

  const handleLogoUpload = async (file) => {
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      setStatus("Logo upload failed: choose an image file.");
      return;
    }

    setUploadingLogo(true);
    try {
      if (firebaseReady && storage) {
        const safeName = String(file.name || "logo").replace(/[^\w.-]+/g, "_");
        const path = `brand-assets/logos/${Date.now()}-${safeName}`;
        const logoRef = storageRef(storage, path);
        await uploadBytes(logoRef, file, { contentType: file.type || "image/png" });
        const downloadUrl = await getDownloadURL(logoRef);
        patchTextSetting("brandLogoUrl", downloadUrl);
        setStatus("Logo uploaded. Click Save Catalog to persist.");
      } else {
        const dataUrl = await toDataUrl(file);
        patchTextSetting("brandLogoUrl", dataUrl);
        setStatus("Logo loaded locally. Click Save Catalog to persist.");
      }
    } catch (err) {
      setStatus(err?.message || "Logo upload failed.");
    } finally {
      setUploadingLogo(false);
    }
  };

  const parseJsonArray = (field, label) => {
    try {
      const parsed = JSON.parse(jsonDrafts[field] || "[]");
      if (!Array.isArray(parsed)) {
        throw new Error("Must be a JSON array.");
      }
      return parsed;
    } catch (err) {
      throw new Error(`${label}: ${err.message}`);
    }
  };

  const handleSave = async () => {
    try {
      const serviceFeeTiers = parseJsonArray("serviceFeeTiers", "Service Fee Tiers JSON");
      const taxRegions = parseJsonArray("taxRegions", "Tax Regions JSON");
      const eventTemplates = parseJsonArray("eventTemplates", "Event Templates JSON");
      const seasonalProfiles = parseJsonArray("seasonalProfiles", "Seasonal Profiles JSON");
      const brandCrew = parseJsonArray("brandCrew", "Brand Crew JSON");
      const paidFeatureIds = Array.isArray(draft.settings?.featureFlagsPaid)
        ? draft.settings.featureFlagsPaid.map((value) => String(value || "").trim()).filter(Boolean)
        : [];
      const paidFeatureIdSet = new Set(paidFeatureIds);
      const enforceOrderFeatureAccess = draft.settings?.featureFlagsLocked === true && paidFeatureIdSet.size > 0;
      const normalizedFeatureFlags = {
        ...(draft.settings?.featureFlags || {})
      };
      if (enforceOrderFeatureAccess) {
        FEATURE_FLAG_META.forEach((flag) => {
          if (!paidFeatureIdSet.has(flag.id)) {
            normalizedFeatureFlags[flag.id] = false;
          }
        });
      }
      if (normalizedFeatureFlags.aiAssist === false) {
        normalizedFeatureFlags.aiAutopilot = false;
      }

      const nextDraft = {
        ...draft,
        settings: {
          ...draft.settings,
          featureFlags: normalizedFeatureFlags,
          serviceFeeTiers,
          taxRegions,
          eventTemplates,
          seasonalProfiles,
          brandCrew
        }
      };

      const result = await onSave(nextDraft);
      if (result.ok) {
        setStatus("Catalog saved.");
        pushToast("Catalog saved.", "success");
        return;
      }
      setStatus(result.error || "Save failed.");
      pushToast(result.error || "Save failed.", "error");
    } catch (err) {
      setStatus(err?.message || "Invalid JSON in advanced settings.");
      pushToast(err?.message || "Invalid JSON in advanced settings.", "error");
    }
  };

  const selectedCategoryItems = menuItems.filter((item) => item.categoryId === selectedCategory);
  const featureFlagsLocked = draft.settings?.featureFlagsLocked === true;
  const featureFlagsPaid = Array.isArray(draft.settings?.featureFlagsPaid)
    ? draft.settings.featureFlagsPaid.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const paidFeatureIdSet = new Set(featureFlagsPaid);
  const enforceOrderFeatureAccess = featureFlagsLocked && paidFeatureIdSet.size > 0;
  const isFeatureEditable = (featureId) => {
    if (!enforceOrderFeatureAccess) return true;
    return paidFeatureIdSet.has(featureId);
  };
  const isFeatureEnabled = (featureId) => {
    if (enforceOrderFeatureAccess && !paidFeatureIdSet.has(featureId)) return false;
    return draft.settings?.featureFlags?.[featureId] !== false;
  };
  const getFeatureAccessLabel = (featureId) => {
    if (!enforceOrderFeatureAccess) return "Editable in this catalog.";
    return paidFeatureIdSet.has(featureId) ? "Included in order." : "Locked (not in order).";
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="modal-head">
          <h2>Catalog Admin</h2>
          <button type="button" className="ghost" onClick={onClose}>Close</button>
        </div>

        <div className="admin-tabs" role="tablist" aria-label="Catalog admin sections">
          {ADMIN_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`admin-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "packages" && (
          <Section title="Packages" onAdd={() => addRow("packages")}>
          <p className="source-note">Bundle inclusions are covered by the package price and remain visible in the saved quote snapshot.</p>
          {draft.packages.map((item, i) => (
            <article className="bundle-config-card" key={item.id}>
              <div className="admin-row">
                <input value={item.id} disabled />
                <input value={item.name} onChange={(e) => patchArrayItem("packages", i, "name", e.target.value)} />
                <input type="number" value={item.ppp} onChange={(e) => patchArrayItem("packages", i, "ppp", Number(e.target.value))} />
                <button type="button" className="ghost" onClick={() => removeRow("packages", i)}>Delete</button>
              </div>
              <div className="bundle-config-groups">
                {[
                  ["includedAddonIds", "Included add-ons", draft.addons || []],
                  ["includedRentalIds", "Included rentals", draft.rentals || []],
                  ["includedMenuItemIds", "Included menu items", (draft.settings?.menuSections || []).flatMap((section) => section.items || [])]
                ].map(([field, label, options]) => (
                  <fieldset key={field}>
                    <legend>{label}</legend>
                    {options.length === 0 && <small>None configured</small>}
                    {options.map((option) => (
                      <label key={option.id}>
                        <input
                          type="checkbox"
                          checked={(item[field] || []).includes(option.id)}
                          onChange={(event) => togglePackageInclusion(i, field, option.id, event.target.checked)}
                        />
                        <span>{option.name}</span>
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>
            </article>
          ))}
          </Section>
        )}

        {activeTab === "addons" && (
          <Section title="Add-ons" onAdd={() => addRow("addons")}>
          <p className="source-note">
            Add-ons are <strong>price-only</strong> and do not change server/chef/bartender counts.
            Use quantity with <code>per_item</code> pricing when you need multiple units.
          </p>
          <div className="admin-row admin-row-headings" aria-hidden="true">
            <span>Item ID</span>
            <span>Display Name</span>
            <span>Pricing Type</span>
            <span>Price</span>
            <span>Active</span>
            <span>Actions</span>
          </div>
          {draft.addons.map((item, i) => (
            <div className="admin-row" key={item.id}>
              <input value={item.id} disabled />
              <input value={item.name} onChange={(e) => patchArrayItem("addons", i, "name", e.target.value)} />
              <select
                value={item.pricingType || item.type || "per_person"}
                onChange={(e) => {
                  const pricingType = normalizePricingType(e.target.value, "per_person");
                  patchArrayItem("addons", i, "pricingType", pricingType);
                  patchArrayItem("addons", i, "type", pricingType);
                }}
              >
                <option value="per_person">per_person</option>
                <option value="per_item">per_item</option>
                <option value="per_event">per_event</option>
              </select>
              <input type="number" value={item.price} onChange={(e) => patchArrayItem("addons", i, "price", Number(e.target.value))} />
              <label className="admin-inline-toggle">
                <span>Active</span>
                <input
                  type="checkbox"
                  checked={item.active !== false}
                  onChange={(e) => patchArrayItem("addons", i, "active", e.target.checked)}
                />
              </label>
              <button type="button" className="ghost" onClick={() => removeRow("addons", i)}>Delete</button>
            </div>
          ))}
          </Section>
        )}

        {activeTab === "rentals" && (
          <Section title="Rentals" onAdd={() => addRow("rentals")}>
          {draft.rentals.map((item, i) => (
            <div className="admin-row" key={item.id}>
              <input value={item.id} disabled />
              <input value={item.name} onChange={(e) => patchArrayItem("rentals", i, "name", e.target.value)} />
              <select
                value={item.pricingType || item.type || "per_item"}
                onChange={(e) => {
                  const pricingType = normalizePricingType(e.target.value, "per_item");
                  patchArrayItem("rentals", i, "pricingType", pricingType);
                  patchArrayItem("rentals", i, "type", pricingType);
                }}
              >
                <option value="per_item">per_item</option>
                <option value="per_person">per_person</option>
                <option value="per_event">per_event</option>
              </select>
              <input type="number" value={item.price} onChange={(e) => patchArrayItem("rentals", i, "price", Number(e.target.value))} />
              <input type="number" value={item.qtyPerGuests} onChange={(e) => patchArrayItem("rentals", i, "qtyPerGuests", Number(e.target.value))} />
              <label className="admin-inline-toggle">
                <span>Active</span>
                <input
                  type="checkbox"
                  checked={item.active !== false}
                  onChange={(e) => patchArrayItem("rentals", i, "active", e.target.checked)}
                />
              </label>
              <button type="button" className="ghost" onClick={() => removeRow("rentals", i)}>Delete</button>
            </div>
          ))}
          </Section>
        )}

        {activeTab === "menu" && (
          <section className="admin-section">
          <div className="admin-section-head"><h3>Menu Management</h3></div>
          <div className="admin-section-body">
            <div className="admin-menu-management-grid">
              <label>
                Event type
                <select
                  value={selectedEventType}
                  onChange={(e) => setManagedEventType(e.target.value)}
                  disabled={menuLoading}
                >
                  <option value="">Choose event type</option>
                  {menuEventTypes.map((eventType) => (
                    <option key={eventType.id} value={eventType.id}>{eventType.name}</option>
                  ))}
                </select>
              </label>
              <div className="admin-inline-actions">
                <input
                  type="text"
                  placeholder="Edit selected event type"
                  value={eventTypeEditName}
                  onChange={(e) => setEventTypeEditName(e.target.value)}
                  disabled={!selectedEventType || menuLoading}
                />
                <button
                  type="button"
                  className="ghost compact"
                  onClick={handleUpdateEventType}
                  disabled={menuActionLoading || !selectedEventType}
                >
                  {menuActionLoading ? "Saving..." : "Save Event Type"}
                </button>
              </div>
              <div className="admin-inline-actions">
                <input
                  type="text"
                  placeholder="New event type"
                  value={newEventTypeName}
                  onChange={(e) => setNewEventTypeName(e.target.value)}
                />
                <button type="button" className="ghost compact" onClick={handleCreateEventType} disabled={menuActionLoading}>
                  {menuActionLoading ? "Saving..." : "Add Event Type"}
                </button>
              </div>
            </div>

            <div className="admin-menu-management-grid">
              <label>
                Category
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  disabled={!selectedEventType || menuLoading}
                >
                  <option value="">Choose category</option>
                  {menuCategories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </label>
              <div className="admin-inline-actions">
                <input
                  type="text"
                  placeholder="Edit selected category"
                  value={categoryEditName}
                  onChange={(e) => setCategoryEditName(e.target.value)}
                  disabled={!selectedCategory}
                />
                <button
                  type="button"
                  className="ghost compact"
                  onClick={handleUpdateCategory}
                  disabled={menuActionLoading || !selectedCategory}
                >
                  {menuActionLoading ? "Saving..." : "Save Category"}
                </button>
              </div>
              <div className="admin-inline-actions">
                <input
                  type="text"
                  placeholder="New category"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  disabled={!selectedEventType}
                />
                <button type="button" className="ghost compact" onClick={handleCreateCategory} disabled={menuActionLoading || !selectedEventType}>
                  {menuActionLoading ? "Saving..." : "Add Category"}
                </button>
              </div>
            </div>

            <div className="admin-inline-actions admin-inline-actions-create-item">
              <input
                type="text"
                placeholder="New item name"
                value={newItemDraft.name}
                onChange={(e) => setNewItemDraft((prev) => ({ ...prev, name: e.target.value }))}
                disabled={!selectedCategory}
              />
              <input
                type="number"
                step="0.01"
                value={Number(newItemDraft.price || 0)}
                onChange={(e) => setNewItemDraft((prev) => ({ ...prev, price: Number(e.target.value) }))}
                disabled={!selectedCategory}
              />
              <select
                value={newItemDraft.pricingType}
                onChange={(e) =>
                  setNewItemDraft((prev) => ({
                    ...prev,
                    pricingType: normalizePricingType(e.target.value, "per_event")
                  }))
                }
                disabled={!selectedCategory}
              >
                <option value="per_event">per_event</option>
                <option value="per_person">per_person</option>
                <option value="per_item">per_item</option>
              </select>
              <label className="admin-inline-toggle">
                <span>Active</span>
                <input
                  type="checkbox"
                  checked={newItemDraft.active !== false}
                  onChange={(e) => setNewItemDraft((prev) => ({ ...prev, active: e.target.checked }))}
                  disabled={!selectedCategory}
                />
              </label>
              <button type="button" className="ghost compact" onClick={handleCreateMenuItem} disabled={menuActionLoading || !selectedCategory}>
                {menuActionLoading ? "Saving..." : "Add Item"}
              </button>
            </div>

            {menuLoading && <p className="source-note">Loading menu data...</p>}
            {!menuLoading && selectedCategory && selectedCategoryItems.length === 0 && (
              <p className="source-note">No menu items in this category yet.</p>
            )}

            {!menuLoading && selectedCategoryItems.map((item) => (
              <div className="admin-menu-row admin-menu-row-managed" key={item.id}>
                <input value={item.id || ""} disabled />
                <input
                  type="text"
                  value={item.name || ""}
                  onChange={(e) => patchManagedMenuItem(item.id, "name", e.target.value)}
                  onBlur={() => handleManagedMenuItemBlur(item.id)}
                  onKeyDown={(e) => handleManagedMenuItemKeyDown(e, item.id)}
                />
                <select
                  value={item.pricingType || item.type || "per_event"}
                  onChange={(e) => patchManagedMenuItem(item.id, "pricingType", e.target.value)}
                  onBlur={() => handleManagedMenuItemBlur(item.id)}
                  onKeyDown={(e) => handleManagedMenuItemKeyDown(e, item.id)}
                >
                  <option value="per_event">per_event</option>
                  <option value="per_person">per_person</option>
                  <option value="per_item">per_item</option>
                </select>
                <input
                  type="number"
                  step="0.01"
                  value={Number(item.price || 0)}
                  onChange={(e) => patchManagedMenuItem(item.id, "price", e.target.value)}
                  onBlur={() => handleManagedMenuItemBlur(item.id)}
                  onKeyDown={(e) => handleManagedMenuItemKeyDown(e, item.id)}
                />
                <label className="admin-inline-toggle">
                  <span>Active</span>
                  <input
                    type="checkbox"
                    checked={item.active !== false}
                    onChange={(e) => patchManagedMenuItem(item.id, "active", e.target.checked)}
                    onBlur={() => handleManagedMenuItemBlur(item.id)}
                  />
                </label>
                <span className="admin-row-state">
                  {menuItemSavingId === item.id ? "Saving..." : (menuItemDirty[item.id] ? "Unsaved" : "Saved")}
                </span>
                <button
                  type="button"
                  className="ghost compact"
                  onClick={() => handleDeleteManagedMenuItem(item.id)}
                  disabled={menuActionLoading}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </section>
        )}

        {activeTab === "pricing" && (
          <>
            <section className="admin-section">
          <div className="admin-section-head"><h3>Numeric Settings</h3></div>
          <div className="admin-grid-settings">
            <label>
              Per-mile rate
              <small className="admin-field-hint">Travel charge per mile up to the delivery threshold. Shown in Travel / Logistics.</small>
              <input type="number" step="0.01" value={draft.settings.perMileRate} onChange={(e) => patchNumericSetting("perMileRate", e.target.value)} />
            </label>
            <label>
              Long-distance per-mile
              <small className="admin-field-hint">Travel charge per mile after the threshold is exceeded.</small>
              <input type="number" step="0.01" value={draft.settings.longDistancePerMileRate} onChange={(e) => patchNumericSetting("longDistancePerMileRate", e.target.value)} />
            </label>
            <label>
              Delivery threshold miles
              <small className="admin-field-hint">Miles billed at Per-mile rate before Long-distance rate starts.</small>
              <input type="number" step="1" min="0" value={draft.settings.deliveryThresholdMiles} onChange={(e) => patchNumericSetting("deliveryThresholdMiles", e.target.value)} />
            </label>
            <label>
              Capacity limit
              <small className="admin-field-hint">Operations/scheduling warning limit for same-venue load.</small>
              <input type="number" step="1" min="1" value={draft.settings.capacityLimit || 400} onChange={(e) => patchNumericSetting("capacityLimit", e.target.value)} />
            </label>
            <label>
              Default bartender rate
              <small className="admin-field-hint">Event Basics uses this unless a quote-level bartender rate override is entered.</small>
              <input type="number" step="0.01" min="0" value={draft.settings.bartenderRate} onChange={(e) => patchNumericSetting("bartenderRate", e.target.value)} />
            </label>
            <label>
              Service fee pct fallback
              <small className="admin-field-hint">Used only when no service-fee tier matches guest count.</small>
              <input type="number" step="0.01" value={draft.settings.serviceFeePct} onChange={(e) => patchNumericSetting("serviceFeePct", e.target.value)} />
            </label>
            <label>
              Tax rate fallback
              <small className="admin-field-hint">Used only when no tax region is selected/found.</small>
              <input type="number" step="0.01" value={draft.settings.taxRate} onChange={(e) => patchNumericSetting("taxRate", e.target.value)} />
            </label>
            <label>
              Deposit pct
              <small className="admin-field-hint">Controls required deposit shown in totals and proposal summary.</small>
              <input type="number" step="0.01" value={draft.settings.depositPct} onChange={(e) => patchNumericSetting("depositPct", e.target.value)} />
            </label>
            <label>
              Quote validity days
              <small className="admin-field-hint">Printed on quote/proposal as the expiration window.</small>
              <input type="number" step="1" min="1" value={draft.settings.quoteValidityDays} onChange={(e) => patchNumericSetting("quoteValidityDays", e.target.value)} />
            </label>
            <label>
              Default server rate
              <small className="admin-field-hint">Event Basics uses this unless a quote-level server rate override is entered.</small>
              <input type="number" step="0.01" value={draft.settings.serverRate} onChange={(e) => patchNumericSetting("serverRate", e.target.value)} />
            </label>
            <label>
              Default chef rate
              <small className="admin-field-hint">Event Basics uses this unless a quote-level chef rate override is entered.</small>
              <input type="number" step="0.01" value={draft.settings.chefRate} onChange={(e) => patchNumericSetting("chefRate", e.target.value)} />
            </label>
            <label>Integration retry limit<input type="number" step="1" min="1" max="10" value={draft.settings.integrationRetryLimit || 3} onChange={(e) => patchNumericSetting("integrationRetryLimit", e.target.value)} /></label>
            <label>Integration audit retention<input type="number" step="1" min="10" max="200" value={draft.settings.integrationAuditRetention || 50} onChange={(e) => patchNumericSetting("integrationAuditRetention", e.target.value)} /></label>
          </div>
            </section>

            <section className="admin-section">
          <div className="admin-section-head">
            <h3>Guided Selling & Staffing Controls</h3>
            <button type="button" className="ghost" onClick={addUpsellRule}>Add Rule</button>
          </div>
          <div className="admin-grid-settings">
            <label>
              <span>Enable guided selling recommendations</span>
              <input
                type="checkbox"
                checked={draft.settings.guidedSellingEnabled !== false}
                onChange={(e) => patchToggleSetting("guidedSellingEnabled", e.target.checked)}
              />
            </label>
            <label>
              <span>Include staffing labor automation in totals</span>
              <small className="admin-field-hint">When off, server/chef/bartender labor is excluded from quote totals.</small>
              <input
                type="checkbox"
                checked={draft.settings.staffingLaborEnabled !== false}
                onChange={(e) => patchToggleSetting("staffingLaborEnabled", e.target.checked)}
              />
            </label>
            <label>
              Staffing charge mode
              <small className="admin-field-hint">Per hour = rate x staff count x hours. Per event = rate x staff count (hours ignored).</small>
              <select
                value={normalizeStaffingChargeMode(draft.settings?.staffingChargeMode, "per_hour")}
                onChange={(e) => patchTextSetting("staffingChargeMode", normalizeStaffingChargeMode(e.target.value, "per_hour"))}
              >
                <option value="per_hour">Per hour x staff count</option>
                <option value="per_event_per_staff">Per event x staff count</option>
              </select>
            </label>
          </div>
          <div className="rule-config-list">
            {(draft.settings?.upsellRules || []).map((rule, ruleIndex) => {
              const kind = String(rule.kind || "addon");
              const targets = getUpsellTargetOptions(kind);
              return (
                <article className="rule-config-card" key={rule.id || `rule-${ruleIndex}`}>
                  <div className="rule-config-head">
                    <strong>{rule.name || `Rule ${ruleIndex + 1}`}</strong>
                    <label className="rule-toggle">
                      <span>Enabled</span>
                      <input
                        type="checkbox"
                        checked={Boolean(rule.enabled)}
                        onChange={(e) => patchUpsellRule(ruleIndex, "enabled", e.target.checked)}
                      />
                    </label>
                  </div>
                  <div className="rule-config-grid">
                    <label>
                      Rule name
                      <input
                        type="text"
                        value={rule.name || ""}
                        onChange={(e) => patchUpsellRule(ruleIndex, "name", e.target.value)}
                      />
                    </label>
                    <label>
                      Rule type
                      <select
                        value={kind}
                        onChange={(e) => patchUpsellRule(ruleIndex, "kind", e.target.value)}
                      >
                        {RULE_KIND_META.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Target item
                      <select
                        value={rule.targetId || ""}
                        onChange={(e) => patchUpsellRule(ruleIndex, "targetId", e.target.value)}
                      >
                        {kind === "package" && <option value="">Auto next higher package</option>}
                        {kind !== "package" && <option value="">Choose target</option>}
                        {targets.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Min guests
                      <input
                        type="number"
                        min="0"
                        max="400"
                        value={Number(rule.minGuests || 0)}
                        onChange={(e) => patchUpsellRule(ruleIndex, "minGuests", e.target.value)}
                      />
                    </label>
                    <label>
                      Min hours
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="0.5"
                        value={Number(rule.minHours || 0)}
                        onChange={(e) => patchUpsellRule(ruleIndex, "minHours", e.target.value)}
                      />
                    </label>
                    <label className="rule-reason-field">
                      Reason shown in quote wizard
                      <input
                        type="text"
                        value={rule.reason || ""}
                        onChange={(e) => patchUpsellRule(ruleIndex, "reason", e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="rule-config-actions">
                    <button type="button" className="ghost compact" onClick={() => removeUpsellRule(ruleIndex)}>Delete Rule</button>
                  </div>
                </article>
              );
            })}
            {(draft.settings?.upsellRules || []).length === 0 && (
              <p className="source-note">No upsell rules are configured yet. Add at least one to power guided selling.</p>
            )}
          </div>
            </section>

            <section className="admin-section">
          <div className="admin-section-head"><h3>Optional Modules</h3></div>
          {enforceOrderFeatureAccess && (
            <p className="source-note">
              Modules not included in this order are locked. To change access, update provisioning entitlements for this org and reopen this modal.
            </p>
          )}
          <div className="admin-grid-settings">
            {FEATURE_FLAG_META.map((flag) => (
              <label key={flag.id}>
                <span>{flag.label}</span>
                {enforceOrderFeatureAccess && <small className="source-note">{getFeatureAccessLabel(flag.id)}</small>}
                <input
                  type="checkbox"
                  checked={isFeatureEnabled(flag.id)}
                  onChange={(e) => patchFeatureFlag(flag.id, e.target.checked)}
                  disabled={!isFeatureEditable(flag.id)}
                  title={getFeatureAccessLabel(flag.id)}
                />
              </label>
            ))}
          </div>
            </section>

            <section className="admin-section">
          <div className="admin-section-head"><h3>Quote Meta</h3></div>
          <div className="admin-grid-settings">
            <label>
              Quote prepared by
              <input
                type="text"
                value={draft.settings.quotePreparedBy || ""}
                onChange={(e) => patchTextSetting("quotePreparedBy", e.target.value)}
              />
            </label>
            <label>
              Business phone
              <input
                type="text"
                value={draft.settings.businessPhone || ""}
                onChange={(e) => patchTextSetting("businessPhone", e.target.value)}
              />
            </label>
            <label>
              Business email
              <input
                type="text"
                value={draft.settings.businessEmail || ""}
                onChange={(e) => patchTextSetting("businessEmail", e.target.value)}
              />
            </label>
            <label>
              Business address
              <input
                type="text"
                value={draft.settings.businessAddress || ""}
                onChange={(e) => patchTextSetting("businessAddress", e.target.value)}
              />
            </label>
            <label>
              Acceptance email
              <input
                type="text"
                value={draft.settings.acceptanceEmail || ""}
                onChange={(e) => patchTextSetting("acceptanceEmail", e.target.value)}
              />
            </label>
            <label>
              Disposables note
              <input
                type="text"
                value={draft.settings.disposablesNote || ""}
                onChange={(e) => patchTextSetting("disposablesNote", e.target.value)}
              />
            </label>
            <label>
              Deposit notice
              <input
                type="text"
                value={draft.settings.depositNotice || ""}
                onChange={(e) => patchTextSetting("depositNotice", e.target.value)}
              />
            </label>
          </div>
            </section>

            <section className="admin-section">
          <div className="admin-section-head"><h3>Integrations</h3></div>
          <div className="admin-grid-settings">
            <label>
              CRM provider
              <select
                value={normalizeCrmProvider(draft.settings.crmProvider || "webhook")}
                onChange={(e) => patchTextSetting("crmProvider", normalizeCrmProvider(e.target.value, "webhook"))}
              >
                {CRM_PROVIDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              CRM webhook URL
              <input
                type="url"
                value={draft.settings.crmWebhookUrl || ""}
                onChange={(e) => patchTextSetting("crmWebhookUrl", e.target.value)}
              />
            </label>
            <label>
              CRM webhook bridge URL
              <input
                type="url"
                value={draft.settings.crmWebhookBridgeUrl || ""}
                onChange={(e) => patchTextSetting("crmWebhookBridgeUrl", e.target.value)}
              />
            </label>
            <label>
              CRM HubSpot bridge URL
              <input
                type="url"
                value={draft.settings.crmHubspotBridgeUrl || ""}
                onChange={(e) => patchTextSetting("crmHubspotBridgeUrl", e.target.value)}
              />
            </label>
            <label>
              CRM Salesforce bridge URL
              <input
                type="url"
                value={draft.settings.crmSalesforceBridgeUrl || ""}
                onChange={(e) => patchTextSetting("crmSalesforceBridgeUrl", e.target.value)}
              />
            </label>
            <label>
              CRM bridge bearer token (optional)
              <input
                type="password"
                value={draft.settings.crmBridgeAuthToken || ""}
                onChange={(e) => patchTextSetting("crmBridgeAuthToken", e.target.value)}
              />
            </label>
            <label>
              <span>Enable CRM sync</span>
              <input
                type="checkbox"
                checked={Boolean(draft.settings.crmEnabled)}
                onChange={(e) => patchToggleSetting("crmEnabled", e.target.checked)}
              />
            </label>
            <label>
              <span>CRM auto-sync on sent</span>
              <input
                type="checkbox"
                checked={Boolean(draft.settings.crmAutoSyncOnSent)}
                onChange={(e) => patchToggleSetting("crmAutoSyncOnSent", e.target.checked)}
              />
            </label>
            <label>
              <span>CRM auto-sync on booked</span>
              <input
                type="checkbox"
                checked={Boolean(draft.settings.crmAutoSyncOnBooked)}
                onChange={(e) => patchToggleSetting("crmAutoSyncOnBooked", e.target.checked)}
              />
            </label>
          </div>
            </section>

            <section className="admin-section">
          <div className="admin-section-head"><h3>Branding</h3></div>
          <div className="theme-preset-grid" role="group" aria-label="Portal theme presets">
            {PORTAL_THEME_PRESETS.map((theme) => (
              <button
                type="button"
                key={theme.id}
                className={`theme-preset ${draft.settings?.portalThemeId === theme.id ? "active" : ""}`}
                onClick={() => applyPortalTheme(theme)}
                aria-pressed={draft.settings?.portalThemeId === theme.id}
              >
                <span className="theme-preset-swatches" aria-hidden="true">
                  <i style={{ background: theme.primary }} />
                  <i style={{ background: theme.accent }} />
                  <i style={{ background: theme.surface }} />
                </span>
                <strong>{theme.name}</strong>
              </button>
            ))}
          </div>
          <div className="admin-grid-settings">
            <label>
              Brand name
              <input
                type="text"
                value={draft.settings.brandName || ""}
                onChange={(e) => patchTextSetting("brandName", e.target.value)}
              />
            </label>
            <label>
              Brand tagline
              <input
                type="text"
                value={draft.settings.brandTagline || ""}
                onChange={(e) => patchTextSetting("brandTagline", e.target.value)}
              />
            </label>
            <label>
              Brand logo URL/path
              <input
                type="text"
                value={draft.settings.brandLogoUrl || ""}
                onChange={(e) => patchTextSetting("brandLogoUrl", e.target.value)}
              />
            </label>
            <label>
              Upload logo image
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleLogoUpload(e.target.files?.[0])}
                disabled={uploadingLogo}
              />
            </label>
            <label>
              Primary color
              <input
                type="color"
                value={draft.settings.brandPrimaryColor || "#c99334"}
                onChange={(e) => patchTextSetting("brandPrimaryColor", e.target.value)}
              />
            </label>
            <label>
              Accent color
              <input
                type="color"
                value={draft.settings.brandAccentColor || "#f0d29a"}
                onChange={(e) => patchTextSetting("brandAccentColor", e.target.value)}
              />
            </label>
            <label>
              Deep accent color
              <input
                type="color"
                value={draft.settings.brandDarkAccentColor || "#8d611a"}
                onChange={(e) => patchTextSetting("brandDarkAccentColor", e.target.value)}
              />
            </label>
            <label>
              Background start
              <input
                type="color"
                value={draft.settings.brandBackgroundStart || "#100d09"}
                onChange={(e) => patchTextSetting("brandBackgroundStart", e.target.value)}
              />
            </label>
            <label>
              Background mid
              <input
                type="color"
                value={draft.settings.brandBackgroundMid || "#221a12"}
                onChange={(e) => patchTextSetting("brandBackgroundMid", e.target.value)}
              />
            </label>
            <label>
              Background end
              <input
                type="color"
                value={draft.settings.brandBackgroundEnd || "#ae7d2b"}
                onChange={(e) => patchTextSetting("brandBackgroundEnd", e.target.value)}
              />
            </label>
            <label>
              Hero eyebrow
              <input
                type="text"
                value={draft.settings.heroEyebrow || ""}
                onChange={(e) => patchTextSetting("heroEyebrow", e.target.value)}
              />
            </label>
            <label>
              Hero headline
              <input
                type="text"
                value={draft.settings.heroHeadline || ""}
                onChange={(e) => patchTextSetting("heroHeadline", e.target.value)}
              />
            </label>
            <label>
              Hero description
              <textarea
                value={draft.settings.heroDescription || ""}
                onChange={(e) => patchTextSetting("heroDescription", e.target.value)}
              />
            </label>
          </div>
            </section>

            <section className="admin-section">
          <div className="admin-section-head"><h3>Default Selectors</h3></div>
          <div className="admin-grid-settings">
            <label>
              Default tax region id
              <input
                type="text"
                value={draft.settings.defaultTaxRegion || ""}
                onChange={(e) => patchTextSetting("defaultTaxRegion", e.target.value)}
              />
            </label>
            <label>
              Default season profile id
              <input
                type="text"
                value={draft.settings.defaultSeasonProfile || "auto"}
                onChange={(e) => patchTextSetting("defaultSeasonProfile", e.target.value)}
              />
            </label>
          </div>
            </section>

            <section className="admin-section">
          <div className="admin-section-head"><h3>Advanced Config (JSON)</h3></div>
          <div className="admin-section-body">
            {JSON_FIELD_META.map((field) => (
              <label key={field.key} className="json-label">
                <span>{field.label}</span>
                <textarea
                  className="json-editor"
                  value={jsonDrafts[field.key]}
                  onChange={(e) => patchJsonDraft(field.key, e.target.value)}
                />
                <small>{field.hint}</small>
              </label>
            ))}
          </div>
            </section>
          </>
        )}

        <div className="modal-foot">
          <span className="source-note">{status}</span>
          <button type="button" className="cta" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Catalog"}</button>
        </div>
      </div>
    </div>
  );
}
