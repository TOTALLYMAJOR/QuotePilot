function includesId(values, id) {
  return Array.isArray(values) && values.includes(id);
}

function normalizedPositiveQuantity(value) {
  return Math.max(1, Number(value || 1));
}

export function recommendationWouldChangeForm(form = {}, item = {}) {
  const id = String(item?.id || "").trim();
  if (!id) return false;

  const changesTemplateOwnership = form.eventTemplateId !== "custom";
  if (item.kind === "package") {
    return changesTemplateOwnership || form.pkg !== id;
  }
  if (item.kind === "addon") {
    return changesTemplateOwnership
      || !includesId(form.addons, id)
      || Number(form.addonQuantities?.[id]) !== normalizedPositiveQuantity(form.addonQuantities?.[id]);
  }
  if (item.kind === "rental") {
    return changesTemplateOwnership
      || !includesId(form.rentals, id)
      || Number(form.rentalQuantities?.[id]) !== normalizedPositiveQuantity(form.rentalQuantities?.[id]);
  }
  return false;
}
