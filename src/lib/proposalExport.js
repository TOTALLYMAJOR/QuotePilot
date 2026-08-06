import { jsPDF } from "jspdf";
import { currency, serviceChargeLabel } from "./quoteCalculator";
import { sanitizeStripePaymentLink } from "./paymentLink";
import { buildProposalPayload } from "./proposalPayload";
import { PRODUCT_FULL_NAME } from "./productIdentity";

const BRAND_ASSET_CACHE = new Map();
const IMAGE_LOG_PREFIX = "[proposalExport:image]";

function text(v) {
  return String(v ?? "-");
}

function stablePdfFileId(seed) {
  const source = String(seed || "quotepilot-pdf");
  return [0, 1, 2, 3].map((salt) => {
    let hash = (0x811c9dc5 ^ salt) >>> 0;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }).join("");
}

function resolvePdfRevisionSeed(quote) {
  const versionId = String(
    quote?.activeVersionId
    || quote?.versionMeta?.versionId
    || quote?.latestVersionNumber
    || "legacy"
  ).trim();
  return [quote?.organizationId, quote?.id, quote?.quoteNumber, versionId]
    .map((value) => String(value || "").trim())
    .join("|");
}

function resolvePdfCreationDate(quote) {
  const candidate = String(
    quote?.versionMeta?.createdAt
    || quote?.updatedAtISO
    || quote?.createdAtISO
    || ""
  ).trim();
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime())
    ? new Date("2000-01-01T00:00:00.000Z")
    : parsed;
}

function hexToRgb(value, fallback) {
  const raw = String(value || "").trim();
  const full = /^#[\da-fA-F]{6}$/.test(raw)
    ? raw
    : /^#[\da-fA-F]{3}$/.test(raw)
      ? `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
      : "";
  if (!full) return fallback;
  const n = Number.parseInt(full.slice(1), 16);
  if (Number.isNaN(n)) return fallback;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function resolvePalette(meta) {
  return {
    ink: [31, 24, 15],
    gold: hexToRgb(meta?.brandPrimaryColor, [198, 145, 57]),
    goldSoft: hexToRgb(meta?.brandAccentColor, [242, 224, 184]),
    text: [56, 44, 30],
    muted: [103, 87, 62],
    cream: [251, 246, 234],
    line: hexToRgb(meta?.brandDarkAccentColor, [214, 184, 130])
  };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read image blob."));
    reader.readAsDataURL(blob);
  });
}

function resolveImageFormat(mimeType = "") {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "JPEG";
  if (mimeType === "image/webp") return "WEBP";
  return "PNG";
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer || 0);
  if (!bytes.length) return "";
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function logImageIssue(message, details = null, error = null) {
  const payload = details ? { ...details } : undefined;
  if (error) {
    // Keep PDF export resilient while surfacing enough context to debug broken image paths.
    console.warn(`${IMAGE_LOG_PREFIX} ${message}`, payload, error);
    return;
  }
  console.warn(`${IMAGE_LOG_PREFIX} ${message}`, payload);
}

function safeAddImage(doc, image, x, y, width, height, label) {
  if (!image?.dataUrl) return false;
  try {
    doc.addImage(image.dataUrl, image.format || "PNG", x, y, width, height);
    return true;
  } catch (error) {
    logImageIssue(`Failed to render ${label}.`, {
      format: image.format || "PNG",
      x,
      y,
      width,
      height
    }, error);
    return false;
  }
}

async function loadBrandImage(path, label = "image") {
  if (!path) return null;
  try {
    const response = await fetch(path);
    if (!response.ok) {
      logImageIssue(`Failed to load ${label}.`, {
        path,
        status: response.status,
        statusText: response.statusText
      });
      return null;
    }
    const blob = await response.blob();
    if (!blob?.size) {
      logImageIssue(`Received empty blob for ${label}.`, { path, mimeType: blob?.type || "unknown" });
      return null;
    }

    let dataUrl = "";
    try {
      dataUrl = await blobToDataUrl(blob);
    } catch (error) {
      logImageIssue(`Failed to convert ${label} blob to Data URL.`, { path, mimeType: blob.type || "unknown" }, error);
      return null;
    }
    if (!dataUrl) {
      logImageIssue(`Data URL conversion returned empty value for ${label}.`, { path, mimeType: blob.type || "unknown" });
      return null;
    }

    return {
      format: resolveImageFormat(blob.type),
      dataUrl
    };
  } catch (error) {
    logImageIssue(`Unexpected error while loading ${label}.`, { path }, error);
    return null;
  }
}

async function loadBrandAssets(branding) {
  const logoPath = branding?.logoPath || "";
  const crewMembers = Array.isArray(branding?.crewMembers) ? branding.crewMembers : [];
  const cacheKey = JSON.stringify([logoPath, ...crewMembers.map((member) => member?.imagePath || "")]);
  if (BRAND_ASSET_CACHE.has(cacheKey)) {
    return BRAND_ASSET_CACHE.get(cacheKey);
  }

  const [logo, ...crewImages] = await Promise.all([
    loadBrandImage(logoPath, "logo image"),
    ...crewMembers.map((member, index) => loadBrandImage(member?.imagePath, `crew image (${member?.label || index + 1})`))
  ]);

  const assets = {
    logo,
    crewMembers: crewMembers.map((member, index) => ({
      ...member,
      image: crewImages[index] || null
    }))
  };
  BRAND_ASSET_CACHE.set(cacheKey, assets);
  return assets;
}

function sectionItemLabel(label, count) {
  return count > 0 ? `${label} (${count} item${count === 1 ? "" : "s"})` : label;
}

function summarizeList(items, limit = 5) {
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!safeItems.length) return "";
  const preview = safeItems.slice(0, limit).join(", ");
  return safeItems.length > limit ? `${preview}...` : preview;
}

function resolvePortalLink(quote, basePortalUrl = "") {
  const portalKey = String(quote?.portalKey || "").trim();
  if (!portalKey) return "";
  const portalExpiry = String(quote?.portalExpiresAtISO || quote?.expiresAtISO || "").trim();
  if (portalExpiry) {
    const expiresAt = new Date(portalExpiry);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
      return "";
    }
  }
  const base = String(basePortalUrl || "").trim() || (
    typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : ""
  );
  if (!base) return "";
  return `${base}?portal=${encodeURIComponent(portalKey)}`;
}

function formatStaffTeam(servers, chefs, bartenders) {
  return [["server", servers], ["chef", chefs], ["bartender", bartenders]]
    .map(([role, count]) => [role, Math.max(0, Number(count || 0))])
    .filter(([, count]) => count > 0)
    .map(([role, count]) => `${count} ${role}${count === 1 ? "" : "s"}`)
    .join(" · ");
}

function paymentMethodLabel(payMethod) {
  const normalized = String(payMethod || "").trim().toLowerCase();
  if (normalized === "card") return "Card";
  if (normalized === "ach") return "ACH / Check";
  return payMethod || "-";
}

function depositStatusLabel(depositStatus) {
  const normalized = String(depositStatus || "unpaid").trim().toLowerCase();
  if (normalized === "unpaid") return "Awaiting deposit";
  if (normalized === "sent") return "Deposit requested";
  if (normalized === "paid") return "Paid";
  if (normalized === "refunded") return "Refunded";
  return depositStatus;
}

function appendFooterToAllPages({
  doc,
  palette,
  proposal,
  left,
  right,
  pageHeight
}) {
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...palette.line);
    doc.line(left, pageHeight - 34, right, pageHeight - 34);
    doc.setTextColor(...palette.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(
      `${proposal.branding.brandName ? `${proposal.branding.brandName} • ` : ""}Quote ${text(proposal.quoteNumber)}`,
      left,
      pageHeight - 22
    );
    doc.text(`Page ${page} of ${pageCount}`, right, pageHeight - 22, { align: "right" });
    doc.setFontSize(7);
    doc.text(`Created with ${PRODUCT_FULL_NAME}`, right, pageHeight - 10, { align: "right" });
  }
}

function renderHeader({
  doc,
  palette,
  brandAssets,
  branding,
  proposal,
  left,
  right,
  maxWidth,
  pageWidth,
  headerHeight,
  y
}) {
  doc.setFillColor(...palette.ink);
  doc.rect(0, 0, pageWidth, headerHeight, "F");
  doc.setFillColor(...palette.gold);
  doc.rect(0, headerHeight - 10, pageWidth, 10, "F");

  if (brandAssets.logo) {
    safeAddImage(doc, brandAssets.logo, left, 18, 52, 52, "logo image");
  }

  const crewChipSize = 42;
  const crewGap = 14;
  const crewCount = brandAssets.crewMembers.length;
  const crewBlockWidth =
    crewCount > 0 ? (crewCount * crewChipSize) + ((crewCount - 1) * crewGap) : 0;
  const crewStartX = right - crewBlockWidth;
  const crewTopY = 18;
  brandAssets.crewMembers.forEach((member, index) => {
    const chipX = crewStartX + (index * (crewChipSize + crewGap));
    doc.setFillColor(...palette.cream);
    doc.roundedRect(chipX - 2, crewTopY - 2, crewChipSize + 4, crewChipSize + 4, 8, 8, "F");
    if (member.image) {
      safeAddImage(doc, member.image, chipX, crewTopY, crewChipSize, crewChipSize, `crew image (${member.label || index + 1})`);
    }
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(text(member.label), chipX + (crewChipSize / 2), crewTopY + crewChipSize + 13, { align: "center" });
  });

  const titleX = brandAssets.logo ? left + 64 : left;
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(text(branding.title), titleX, 42);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  if (branding.brandTagline) {
    doc.text(branding.brandTagline, titleX, 58);
  }
  doc.text(`Quote #${text(proposal.quoteNumber)}`, titleX, 74);
  doc.text(`Created: ${proposal.createdOn}`, right, 94, { align: "right" });
  doc.text(`Valid Through: ${proposal.expiresOn}`, right, 110, { align: "right" });

  return y + 8;
}

export async function exportQuoteProposal(quote, {
  basePortalUrl = "",
  output = "save",
  compact = false,
  includePortalLink = false
} = {}) {
  if (!quote) {
    throw new Error("Missing quote data for PDF export.");
  }

  const proposal = buildProposalPayload(quote);
  const depositPaymentLink = sanitizeStripePaymentLink(proposal.payment.depositLink);
  const { branding, meta } = proposal;
  const includeBrandImages = compact !== true;
  const brandAssets = includeBrandImages
    ? await loadBrandAssets(branding)
    : { logo: null, crewMembers: [] };
  const doc = new jsPDF({
    unit: "pt",
    format: "letter",
    compress: compact === true
  });
  doc.setCreationDate(resolvePdfCreationDate(quote));
  doc.setFileId(stablePdfFileId(resolvePdfRevisionSeed(quote)));
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = 44;
  const right = pageWidth - 44;
  const maxWidth = right - left;
  const lineGap = 17;
  const contentBottomPadding = 74;
  const palette = resolvePalette(meta);
  const quoteIsDraft = String(quote?.status || "draft").trim().toLowerCase() === "draft";
  const portalLink = !quoteIsDraft && includePortalLink === true
    ? resolvePortalLink(quote, basePortalUrl)
    : "";
  const showDisposablesNote = meta.includeDisposables !== false;
  const perPersonRate = proposal.event.guests > 0 ? proposal.totals.base / proposal.event.guests : 0;
  const headerHeight = 124;
  let y = headerHeight + 18;

  doc.setProperties({
    title: `${text(proposal.quoteNumber)} Proposal`,
    subject: proposal.branding.brandName
      ? `${text(proposal.branding.brandName)} Catering Proposal`
      : "Catering Proposal",
    author: text(meta.quotePreparedBy || proposal.branding.brandName || "The catering team"),
    creator: PRODUCT_FULL_NAME,
    keywords: "proposal, catering, quote"
  });

  const ensureSpace = (needed = 24) => {
    if (y + needed <= pageHeight - contentBottomPadding) return;
    doc.addPage();
    y = 64;
  };

  const section = (label) => {
    ensureSpace(40);
    doc.setFillColor(...palette.goldSoft);
    doc.roundedRect(left, y - 14, maxWidth, 20, 6, 6, "F");
    doc.setTextColor(...palette.text);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(label.toUpperCase(), left + 10, y);
    y += 20;
  };

  const row = (label, value) => {
    const safeValue = text(value);
    const wrapped = doc.splitTextToSize(safeValue, maxWidth - 188);
    ensureSpace(lineGap * Math.max(1, wrapped.length) + 4);
    doc.setTextColor(...palette.muted);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(`${label}:`, left + 2, y);
    doc.setTextColor(...palette.text);
    doc.setFont("helvetica", "normal");
    doc.text(wrapped, left + 128, y);
    y += lineGap * Math.max(1, wrapped.length);
  };

  const subtotalRow = (label, amount) => {
    ensureSpace(24);
    doc.setTextColor(...palette.text);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(`${label}:`, left + 2, y);
    doc.setTextColor(...palette.gold);
    doc.text(currency(amount || 0), left + 128, y);
    y += lineGap + 4;
  };

  const countedAmountRow = (label, items, amount) => {
    const safeItems = Array.isArray(items) ? items : [];
    row(sectionItemLabel(label, safeItems.length), currency(amount || 0));
    if (!safeItems.length) return;
    const itemPreview = summarizeList(safeItems, 5);
    if (!itemPreview) return;
    const wrapped = doc.splitTextToSize(itemPreview, maxWidth - 140);
    ensureSpace((8 * Math.max(1, wrapped.length)) + 2);
    doc.setTextColor(...palette.muted);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.text(wrapped, left + 130, y);
    y += (8 * Math.max(1, wrapped.length)) + 2;
  };

  // Render branded cover/header block first so body sections can flow page-by-page.
  y = renderHeader({
    doc,
    palette,
    brandAssets,
    branding,
    proposal,
    left,
    right,
    maxWidth,
    pageWidth,
    headerHeight,
    y
  });

  section("Client and Event");
  row("Responsible Party / Client", proposal.customer.name);
  row("Organization", proposal.customer.organization || "-");
  row("Phone", proposal.customer.phone || "-");
  row("Email", proposal.customer.email);
  row("Event Name", proposal.event.name || "-");
  row("Event Date", proposal.event.date);
  row("Start Time", proposal.event.time);
  row("Venue", proposal.event.venue);
  row("Venue Address", proposal.event.venueAddress || "-");
  row("Guests", proposal.event.guests);
  row("Service Style", proposal.event.style);
  const staffTeam = formatStaffTeam(proposal.event.servers, proposal.event.chefs, proposal.event.bartenders);
  if (staffTeam) row("Staffing team", staffTeam);
  row("Dietary Restrictions", proposal.event.dietaryRestrictions || "-");

  section("Selections");
  row("Package", proposal.selection.packageName || proposal.selection.packageId);
  const packageInclusions = [
    ...(proposal.selection.packageInclusions?.menuItems || []),
    ...(proposal.selection.packageInclusions?.addons || []),
    ...(proposal.selection.packageInclusions?.rentals || [])
  ];
  row("Package Includes", packageInclusions.join(", ") || "-");
  row(
    "Menu Selections",
    (proposal.selection.menuItemNames.length ? proposal.selection.menuItemNames : proposal.selection.menuItems).join(", ") || "-"
  );
  row("Add-ons", proposal.selection.addons.join(", ") || "-");
  row("Rentals", proposal.selection.rentals.join(", ") || "-");
  row("Travel (miles RT)", proposal.selection.milesRT);
  row("Payment Method", paymentMethodLabel(proposal.selection.payMethod));

  section("Action and Acceptance");
  const acceptanceContact = meta.acceptanceEmail || meta.businessEmail || "";
  if (acceptanceContact) row("Acceptance Contact", acceptanceContact);
  if (portalLink) row("Customer Portal", portalLink);
  if (depositPaymentLink) row("Deposit Payment Link", depositPaymentLink);
  row("Deposit Status", depositStatusLabel(proposal.payment.depositStatus));

  section("Pricing");

  // Keep pricing in grouped blocks to make the PDF easier to scan.
  row("Per Person", `${currency(perPersonRate)} x ${proposal.event.guests || 0}`);
  row("  Base Package", currency(proposal.totals.base || 0));
  row("  Menu Selections", currency(proposal.totals.menu || 0));

  const foodSubtotal = (proposal.totals.base || 0) + (proposal.totals.menu || 0);
  subtotalRow("Food Subtotal", foodSubtotal);

  countedAmountRow("Add-ons", proposal.selection.addons, proposal.totals.addons);
  countedAmountRow("Rentals", proposal.selection.rentals, proposal.totals.rentals);

  const laborTotal = Number(proposal.totals.labor || 0);
  const bartenderLaborTotal = Number(proposal.totals.bartenderLabor || 0);
  const hasServerLabor = proposal.totals.serverLabor !== undefined && proposal.totals.serverLabor !== null;
  const hasChefLabor = proposal.totals.chefLabor !== undefined && proposal.totals.chefLabor !== null;
  const staffingLaborTotal = laborTotal - bartenderLaborTotal;
  const parsedServerLabor = Number(proposal.totals.serverLabor);
  const serverLabor = hasServerLabor && Number.isFinite(parsedServerLabor)
    ? parsedServerLabor
    : staffingLaborTotal;
  const parsedChefLabor = Number(proposal.totals.chefLabor);
  const chefLabor = hasChefLabor && Number.isFinite(parsedChefLabor)
    ? parsedChefLabor
    : (hasServerLabor ? staffingLaborTotal - serverLabor : 0);
  row("  Server Labor", currency(serverLabor));
  row("  Chef Labor", currency(chefLabor));
  row("  Bartender Labor", currency(proposal.totals.bartenderLabor || 0));

  const laborSubtotal = serverLabor + chefLabor + (proposal.totals.bartenderLabor || 0);
  subtotalRow("Labor Subtotal", laborSubtotal);

  row("Travel/Mileage", currency(proposal.totals.travel || 0));

  const prefeeSubtotal = foodSubtotal + 
    (proposal.totals.addons || 0) + 
    (proposal.totals.rentals || 0) + 
    laborSubtotal + 
    (proposal.totals.travel || 0);

  ensureSpace(26);
  doc.setFillColor(...palette.goldSoft);
  doc.roundedRect(left, y - 10, maxWidth, 22, 4, 4, "F");
  doc.setDrawColor(...palette.line);
  doc.roundedRect(left, y - 10, maxWidth, 22, 4, 4);
  doc.setTextColor(...palette.text);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Pre-fee Subtotal:", left + 12, y + 2);
  doc.setTextColor(...palette.gold);
  doc.text(currency(prefeeSubtotal), left + 128, y + 2);
  y += 26;
  
  // Service fee and Tax
  row(
    serviceChargeLabel(proposal.totals.serviceFeePctApplied),
    currency(proposal.totals.serviceFee || 0)
  );
  row(
    `Tax (${Math.round(Number(proposal.totals.taxRateApplied || 0) * 1000) / 10}%)`,
    currency(proposal.totals.tax || 0)
  );
  
  // Total before fees (for clarity)
  const totalBeforeTaxServiceFee = prefeeSubtotal;
  ensureSpace(24);
  doc.setTextColor(...palette.muted);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Total Before Tax/Service Fee:", left + 2, y);
  doc.text(currency(totalBeforeTaxServiceFee), left + 128, y);
  y += lineGap + 2;

  ensureSpace(56);
  doc.setFillColor(...palette.goldSoft);
  doc.roundedRect(left, y - 2, maxWidth, 52, 10, 10, "F");
  doc.setDrawColor(...palette.line);
  doc.roundedRect(left, y - 2, maxWidth, 52, 10, 10);
  y += 16;
  doc.setTextColor(...palette.text);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(`Estimated Total: ${currency(proposal.totals.total || 0)}`, left + 12, y);
  y += 18;
  doc.text(`Deposit Due: ${currency(proposal.totals.deposit || 0)}`, left + 12, y);

  y += 20;
  ensureSpace(84);
  if (showDisposablesNote) {
    doc.setTextColor(...palette.text);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(meta.disposablesNote || "All disposables are included in this quote.", left, y);
    y += 14;
  }
  if (meta.quotePreparedBy) {
    doc.text(`Quote prepared by: ${meta.quotePreparedBy}`, left, y);
  }
  doc.text(`Quote is valid for ${Number(meta.quoteValidityDays || 30)} days.`, right, y, { align: "right" });
  y += 14;
  const acceptanceInstruction = portalLink
    ? `To accept this quote, open your customer portal link: ${portalLink}`
    : (acceptanceContact ? `To accept quote, please sign and return to ${acceptanceContact}` : "");
  if (acceptanceInstruction) {
    const acceptanceLines = doc.splitTextToSize(acceptanceInstruction, maxWidth);
    doc.text(acceptanceLines, left, y);
    y += 14 * acceptanceLines.length;
  }
  if (meta.depositNotice) {
    doc.setFillColor(255, 232, 77);
    doc.roundedRect(left, y - 10, maxWidth, 16, 3, 3, "F");
    doc.setTextColor(37, 25, 0);
    doc.text(meta.depositNotice, left + 4, y);
    y += 18;
  }

  y += 8;
  ensureSpace(20);
  doc.setTextColor(...palette.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(
    `${text(meta.businessAddress || "")} ${meta.businessPhone ? `  |  ${meta.businessPhone}` : ""} ${meta.businessEmail ? `  |  ${meta.businessEmail}` : ""}`.trim(),
    left,
    y
  );
  appendFooterToAllPages({
    doc,
    palette,
    proposal,
    left,
    right,
    pageHeight
  });

  const filename = [
    text(proposal.quoteNumber || "quote"),
    text(proposal.event.date || ""),
    text(proposal.customer.name || "")
  ]
    .filter(Boolean)
    .join("-")
    .replace(/[^\w.-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^-+|-+$/g, "");
  const pdfFilename = `${filename || "quote"}.pdf`;

  if (output === "base64") {
    const arrayBuffer = doc.output("arraybuffer");
    return {
      filename: pdfFilename,
      mimeType: "application/pdf",
      base64: arrayBufferToBase64(arrayBuffer)
    };
  }

  doc.save(pdfFilename);
  return {
    filename: pdfFilename
  };
}
