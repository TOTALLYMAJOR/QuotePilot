function activeIds(records = []) {
  return new Set((records || [])
    .filter((item) => item?.active !== false)
    .map((item) => String(item?.id || "").trim())
    .filter(Boolean));
}

function validPackageIds(records = []) {
  return (records || [])
    .filter((item) => (
      item?.active !== false
      && String(item?.id || "").trim()
      && String(item?.name || "").trim()
      && Number.isFinite(Number(item?.ppp))
      && Number(item.ppp) > 0
    ))
    .map((item) => String(item.id).trim());
}

function reconcileList(values, allowed) {
  const source = Array.isArray(values) ? values : [];
  const seen = new Set();
  const next = source.flatMap((value) => {
    const id = String(value || "").trim();
    if (!id || !allowed.has(id) || seen.has(id)) return [];
    seen.add(id);
    return [id];
  });
  return {
    next,
    removed: source.flatMap((value, index) => {
      const id = String(value || "").trim();
      if (!id || !allowed.has(id) || source.findIndex((item) => String(item || "").trim() === id) !== index) {
        return id ? [id] : [];
      }
      return [];
    })
  };
}

function reconcileQuantities(values, selectedIds) {
  const source = values && typeof values === "object" ? values : {};
  return Object.fromEntries(Object.entries(source)
    .map(([id, quantity]) => {
      const normalizedId = String(id || "").trim();
      const parsedQuantity = Number(quantity);
      return [normalizedId, Number.isFinite(parsedQuantity) ? Math.max(1, Math.round(parsedQuantity)) : 1];
    })
    .filter(([id]) => selectedIds.has(id)));
}

function sameList(left = [], right = []) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameKeys(left, right) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
}

export function reconcileCatalogSelections({ form = {}, catalog = {}, menuItemIds = null } = {}) {
  const packages = validPackageIds(catalog.packages);
  const addonIds = activeIds(catalog.addons);
  const rentalIds = activeIds(catalog.rentals);
  const addons = reconcileList(form.addons, addonIds);
  const rentals = reconcileList(form.rentals, rentalIds);
  const menu = menuItemIds instanceof Set
    ? reconcileList(form.menuItems, menuItemIds)
    : { next: Array.isArray(form.menuItems) ? form.menuItems : [], removed: [] };
  const nextPackageId = packages.includes(String(form.pkg || "").trim())
    ? String(form.pkg).trim()
    : packages[0] || "";
  const addonQuantities = reconcileQuantities(form.addonQuantities, new Set(addons.next));
  const rentalQuantities = reconcileQuantities(form.rentalQuantities, new Set(rentals.next));
  const menuItemQuantities = reconcileQuantities(form.menuItemQuantities, new Set(menu.next));
  const removedPackage = String(form.pkg || "").trim() && nextPackageId !== String(form.pkg).trim()
    ? [String(form.pkg).trim()]
    : [];

  const changed = nextPackageId !== String(form.pkg || "").trim()
    || !sameList(addons.next, Array.isArray(form.addons) ? form.addons : [])
    || !sameList(rentals.next, Array.isArray(form.rentals) ? form.rentals : [])
    || !sameList(menu.next, Array.isArray(form.menuItems) ? form.menuItems : [])
    || !sameKeys(addonQuantities, form.addonQuantities || {})
    || !sameKeys(rentalQuantities, form.rentalQuantities || {})
    || !sameKeys(menuItemQuantities, form.menuItemQuantities || {});

  return {
    changed,
    userSelectionChanged: Boolean(
      removedPackage.length || addons.removed.length || rentals.removed.length || menu.removed.length
    ),
    removed: {
      packages: removedPackage,
      addons: addons.removed,
      rentals: rentals.removed,
      menuItems: menu.removed
    },
    form: changed ? {
      ...form,
      pkg: nextPackageId,
      addons: addons.next,
      addonQuantities,
      rentals: rentals.next,
      rentalQuantities,
      menuItems: menu.next,
      menuItemQuantities
    } : form
  };
}

export function catalogReconciliationNotice(removed = {}) {
  const labels = [
    [removed.packages, "package"],
    [removed.addons, "add-on"],
    [removed.rentals, "rental"],
    [removed.menuItems, "menu item"]
  ].flatMap(([values, label]) => (values || []).length ? [`${values.length} ${label}${values.length === 1 ? "" : "s"}`] : []);
  return labels.length
    ? `Catalog availability changed. Removed ${labels.join(", ")} from this quote. Review and save the quote before leaving.`
    : "";
}
