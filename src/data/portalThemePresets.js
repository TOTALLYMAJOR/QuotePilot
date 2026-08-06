const PORTAL_THEME_COLOR_KEYS = Object.freeze([
  "brandPrimaryColor",
  "brandAccentColor",
  "brandDarkAccentColor",
  "brandBackgroundStart",
  "brandBackgroundMid",
  "brandBackgroundEnd"
]);

function freezePreset({ id, name, description, colors }) {
  return Object.freeze({
    id,
    name,
    description,
    colors: Object.freeze({ ...colors })
  });
}

export const PORTAL_THEME_PRESETS = Object.freeze([
  freezePreset({
    id: "midnight-amber",
    name: "Midnight Amber",
    description: "Dark, cinematic backdrop with warm gold accents.",
    colors: {
      brandPrimaryColor: "#c99334",
      brandAccentColor: "#f0d29a",
      brandDarkAccentColor: "#8d611a",
      brandBackgroundStart: "#100d09",
      brandBackgroundMid: "#221a12",
      brandBackgroundEnd: "#ae7d2b"
    }
  }),
  freezePreset({
    id: "warm-linen",
    name: "Warm Linen",
    description: "Soft neutral canvas for classic, elegant events.",
    colors: {
      brandPrimaryColor: "#8b5e34",
      brandAccentColor: "#d8b98f",
      brandDarkAccentColor: "#5e3d22",
      brandBackgroundStart: "#fffaf1",
      brandBackgroundMid: "#f4eadb",
      brandBackgroundEnd: "#ede3d3"
    }
  }),
  freezePreset({
    id: "garden-sage",
    name: "Garden Sage",
    description: "Calm green palette for natural and community settings.",
    colors: {
      brandPrimaryColor: "#436b55",
      brandAccentColor: "#a7c4a0",
      brandDarkAccentColor: "#294536",
      brandBackgroundStart: "#f4f7f1",
      brandBackgroundMid: "#e1eadc",
      brandBackgroundEnd: "#d5e1cf"
    }
  }),
  freezePreset({
    id: "coastal-blue",
    name: "Coastal Blue",
    description: "Fresh blue palette for clean, modern proposals.",
    colors: {
      brandPrimaryColor: "#295f78",
      brandAccentColor: "#9bc7d8",
      brandDarkAccentColor: "#173e52",
      brandBackgroundStart: "#f2f8fa",
      brandBackgroundMid: "#dfeef3",
      brandBackgroundEnd: "#d3e6ed"
    }
  })
]);

const FALLBACK_THEME_COLORS = PORTAL_THEME_PRESETS[0].colors;

function safeHexColor(value, fallback) {
  const candidate = String(value || "").trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(candidate) ? candidate : fallback;
}

function relativeLuminance(color) {
  const channels = color.slice(1).match(/.{2}/g).map((value) => parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map((value) => (
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function contrastRatio(left, right) {
  const lighter = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (lighter + 0.05) / (darker + 0.05);
}

function accessibleActionText(background) {
  const white = "#ffffff";
  const ink = "#17130f";
  return contrastRatio(background, white) >= contrastRatio(background, ink) ? white : ink;
}

export function applyPortalThemePreset(settings = {}, presetId = "") {
  const preset = PORTAL_THEME_PRESETS.find((item) => item.id === presetId);
  return preset ? { ...settings, ...preset.colors } : { ...settings };
}

export function findPortalThemePreset(settings = {}) {
  return PORTAL_THEME_PRESETS.find((preset) => (
    PORTAL_THEME_COLOR_KEYS.every((key) => (
      safeHexColor(settings?.[key], "") === preset.colors[key]
    ))
  )) || null;
}

export function buildPortalThemeStyle(settings = {}) {
  const primary = safeHexColor(settings.brandPrimaryColor, FALLBACK_THEME_COLORS.brandPrimaryColor);
  const accent = safeHexColor(settings.brandAccentColor, FALLBACK_THEME_COLORS.brandAccentColor);
  const dark = safeHexColor(settings.brandDarkAccentColor, FALLBACK_THEME_COLORS.brandDarkAccentColor);
  const surface = safeHexColor(settings.brandBackgroundStart, FALLBACK_THEME_COLORS.brandBackgroundStart);
  const surfaceAlt = safeHexColor(settings.brandBackgroundMid, FALLBACK_THEME_COLORS.brandBackgroundMid);
  const canvas = safeHexColor(settings.brandBackgroundEnd, FALLBACK_THEME_COLORS.brandBackgroundEnd);

  return {
    "--portal-brand": primary,
    "--portal-accent": accent,
    "--portal-brand-dark": dark,
    "--portal-action": dark,
    "--portal-action-text": accessibleActionText(dark),
    "--portal-surface": surface,
    "--portal-surface-alt": surfaceAlt,
    "--portal-canvas": canvas
  };
}

export { PORTAL_THEME_COLOR_KEYS };
