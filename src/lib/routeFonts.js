const FONT_STYLESHEET_ID = "quotepilot-route-fonts";

const FONT_PROFILES = Object.freeze({
  marketing: "family=Bodoni+Moda:opsz,wght@6..96,500;6..96,700&family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700",
  "system-marketing": "family=DM+Mono:wght@400;500&family=Inter:wght@300;400;500;600",
  "public-inquiry": "family=Inter:wght@500;600;700",
  "public-action": "family=Manrope:wght@400;500;600;700",
  workspace: "family=Bodoni+Moda:opsz,wght@6..96,500;6..96,700&family=DM+Mono:wght@300;400;500&family=Inter:wght@400;500;600;700&family=Manrope:wght@400;500;600;700"
});

const ROUTE_PROFILE = Object.freeze({
  marketing: "marketing",
  "system-marketing": "system-marketing",
  "public-inquiry": "public-inquiry",
  "buyer-access": "public-action",
  "staff-invitation": "public-action",
  "revenue-autopilot-unsubscribe": "public-action",
  workspace: "workspace",
  "customer-portal": "workspace"
});

function profileFor(routeKind) {
  const profileId = ROUTE_PROFILE[routeKind] || "marketing";
  return FONT_PROFILES[profileId];
}

function ensurePreconnect(href, crossOrigin = "") {
  let link = document.head.querySelector(`link[data-quotepilot-font-preconnect="${href}"]`);
  if (link) return link;
  link = document.createElement("link");
  link.rel = "preconnect";
  link.href = href;
  link.dataset.quotepilotFontPreconnect = href;
  if (crossOrigin) link.crossOrigin = crossOrigin;
  document.head.appendChild(link);
  return link;
}

export function ensureRouteFonts(routeKind) {
  ensurePreconnect("https://fonts.googleapis.com");
  ensurePreconnect("https://fonts.gstatic.com", "anonymous");

  let link = document.getElementById(FONT_STYLESHEET_ID);
  if (!link) {
    link = document.createElement("link");
    link.id = FONT_STYLESHEET_ID;
    link.rel = "stylesheet";
    link.dataset.quotepilotRouteFonts = "true";
    document.head.appendChild(link);
  }
  link.href = `https://fonts.googleapis.com/css2?${profileFor(routeKind)}&display=swap`;
  return link;
}
