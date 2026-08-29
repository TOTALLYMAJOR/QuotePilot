const STORAGE_KEY = "quoteWizard.sessionDiagnostics";
const MAX_EVENTS = 200;
const APP_NAME = "firebase-quote-wizard";
const REDACTED = "[redacted]";
const SENSITIVE_KEY_PATTERN = /(email|phone|token|secret|password|authorization|cookie|api[_-]?key|apikey|private[_-]?key|card|ssn|(^|[_-])uid([_-]|$))/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi;
const TOKENISH_PATTERN = /\b(?:sk|pk|rk|whsec|pat|ghp|AIza|ya29|xox[baprs])[_-]?[A-Za-z0-9._~+/=-]{12,}/g;
const URL_QUERY_HASH_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/gi;
const HASH_PATTERN = /^hash:[a-z0-9]+$/i;

let initialized = false;
let handlersBound = false;

function nowISO() {
  return new Date().toISOString();
}

function canUseWindow() {
  return typeof window !== "undefined";
}

function canUseStorage() {
  return canUseWindow() && typeof window.localStorage !== "undefined";
}

function safeStorageRead() {
  if (!canUseStorage()) return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function safeStorageWrite(value) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Ignore storage write errors.
  }
}

function buildEventId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function hashText(value) {
  const text = String(value ?? "");
  if (!text) return "";
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `hash:${(hash >>> 0).toString(36)}`;
}

function stableHashText(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return HASH_PATTERN.test(text) ? text : hashText(text);
}

function stripUrlQueryAndHash(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    const url = new URL(text, canUseWindow() ? window.location.origin : "http://localhost");
    return `${url.origin}${url.pathname}`;
  } catch {
    return text.split(/[?#]/)[0];
  }
}

function redactSensitiveText(value) {
  return String(value ?? "")
    .replace(URL_QUERY_HASH_PATTERN, (match) => stripUrlQueryAndHash(match))
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(PHONE_PATTERN, "[redacted-phone]")
    .replace(BEARER_PATTERN, "Bearer [redacted-token]")
    .replace(TOKENISH_PATTERN, "[redacted-token]");
}

function safeText(value, fallback = "", maxLength = 500) {
  const text = redactSensitiveText(value).trim();
  if (!text) return fallback;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function safeContextValue(key, value) {
  if (value === null || value === undefined) return value;
  if (SENSITIVE_KEY_PATTERN.test(String(key || ""))) {
    return value ? REDACTED : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return safeText(value, "", 500);
  try {
    return safeText(JSON.stringify(value), "", 700);
  } catch {
    return safeText(String(value), "", 500);
  }
}

function sanitizeContext(input) {
  if (!input || typeof input !== "object") return {};
  const entries = Object.entries(input).slice(0, 30);
  return Object.fromEntries(
    entries.map(([key, value]) => [key, safeContextValue(key, value)])
  );
}

function normalizeError(input) {
  if (!input) return null;
  if (input instanceof Error) {
    return {
      name: safeText(input.name, "Error", 120),
      message: safeText(input.message, "Unknown error", 600),
      stack: input.stack ? stableHashText(input.stack) : ""
    };
  }
  if (typeof input === "object" && (Object.prototype.hasOwnProperty.call(input, "message") || Object.prototype.hasOwnProperty.call(input, "name"))) {
    return {
      name: safeText(input.name, "Error", 120),
      message: safeText(input.message, "Unknown error", 600),
      stack: input.stack ? stableHashText(input.stack) : ""
    };
  }
  if (typeof input === "string") {
    return {
      name: "Error",
      message: safeText(input, "Unknown error", 600),
      stack: ""
    };
  }
  try {
    return {
      name: "Error",
      message: safeText(JSON.stringify(input), "Unknown error", 600),
      stack: ""
    };
  } catch {
    return {
      name: "Error",
      message: safeText(String(input), "Unknown error", 600),
      stack: ""
    };
  }
}

function viewportInfo() {
  if (!canUseWindow()) return { width: 0, height: 0 };
  return {
    width: Number(window.innerWidth || 0),
    height: Number(window.innerHeight || 0)
  };
}

function safeLocationHref() {
  if (!canUseWindow()) return "";
  return stripUrlQueryAndHash(window.location.href);
}

function safePathname() {
  if (!canUseWindow()) return "";
  return safeText(window.location.pathname, "", 250);
}

function safeReferrer() {
  if (!canUseWindow() || typeof document === "undefined") return "";
  return stripUrlQueryAndHash(document.referrer || "");
}

function normalizeUserContext(input = {}) {
  const email = String(input.email || "").trim().toLowerCase();
  const emailHash = String(input.emailHash || "").trim();
  const uid = String(input.uid || "").trim();
  const hasRedactedEmail = email === REDACTED;
  const nextEmailHash = HASH_PATTERN.test(emailHash)
    ? emailHash
    : email && !hasRedactedEmail
      ? hashText(email)
      : "";
  return {
    uid: uid ? stableHashText(uid) : "",
    email: email || emailHash ? REDACTED : "",
    emailHash: nextEmailHash,
    role: safeText(input.role, "", 40).toLowerCase(),
    authenticated: Boolean(input.authenticated)
  };
}

function buildSession() {
  const timestamp = nowISO();
  const timezone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
      return "";
    }
  })();
  return {
    sessionId: buildEventId(),
    appName: APP_NAME,
    appVersion: "",
    startedAtISO: timestamp,
    lastUpdatedAtISO: timestamp,
    pageUrl: safeLocationHref(),
    path: safePathname(),
    referrer: safeReferrer(),
    userAgent: typeof navigator !== "undefined" ? safeText(navigator.userAgent, "", 350) : "",
    language: typeof navigator !== "undefined" ? safeText(navigator.language, "", 120) : "",
    timezone,
    viewport: viewportInfo(),
    user: normalizeUserContext()
  };
}

function defaultState() {
  return {
    session: buildSession(),
    events: []
  };
}

function normalizeState(input) {
  if (!input || typeof input !== "object") return defaultState();
  const fallback = defaultState();
  const session = {
    ...fallback.session,
    ...(input.session || {})
  };
  const events = Array.isArray(input.events)
    ? input.events
      .slice(0, MAX_EVENTS)
      .filter((event) => event && typeof event === "object")
      .map((event) => ({
        id: safeText(event.id, buildEventId(), 120),
        atISO: safeText(event.atISO, nowISO(), 40),
        level: safeText(event.level, "info", 20),
        type: safeText(event.type, "event", 40),
        message: safeText(event.message, "", 700),
        context: sanitizeContext(event.context),
        error: normalizeError(event.error)
      }))
    : [];
  return {
    session: {
      ...session,
      pageUrl: stripUrlQueryAndHash(session.pageUrl),
      path: safeText(session.path, "", 250),
      referrer: stripUrlQueryAndHash(session.referrer),
      viewport: {
        ...(fallback.session.viewport || {}),
        ...((session.viewport && typeof session.viewport === "object") ? session.viewport : {})
      },
      user: normalizeUserContext(session.user)
    },
    events
  };
}

function loadState() {
  const raw = safeStorageRead();
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch {
    return defaultState();
  }
}

let state = loadState();

function persistState() {
  safeStorageWrite(JSON.stringify(state));
}

function pushEvent({
  level = "info",
  type = "event",
  message = "",
  context = {},
  error = null
} = {}) {
  const entry = {
    id: buildEventId(),
    atISO: nowISO(),
    level: safeText(level, "info", 20).toLowerCase(),
    type: safeText(type, "event", 40),
    message: safeText(message, "", 700),
    context: sanitizeContext(context),
    error: normalizeError(error)
  };
  state = {
    ...state,
    session: {
      ...state.session,
      lastUpdatedAtISO: entry.atISO,
      pageUrl: canUseWindow() ? safeLocationHref() : state.session.pageUrl,
      path: canUseWindow() ? safePathname() : state.session.path,
      viewport: viewportInfo()
    },
    events: [entry, ...state.events].slice(0, MAX_EVENTS)
  };
  persistState();
  return entry;
}

function bindGlobalHandlers() {
  if (!canUseWindow() || handlersBound) return;

  window.addEventListener("error", (event) => {
    pushEvent({
      level: "error",
      type: "window.error",
      message: safeText(event.message, "Unhandled runtime error", 600),
      context: {
        filename: event.filename || "",
        lineno: Number(event.lineno || 0),
        colno: Number(event.colno || 0)
      },
      error: event.error || event.message
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    pushEvent({
      level: "error",
      type: "window.unhandledrejection",
      message: "Unhandled promise rejection",
      context: {},
      error: event.reason
    });
  });

  handlersBound = true;
}

export function initSessionDiagnostics({ appVersion = "" } = {}) {
  if (!initialized) {
    state = loadState();
    bindGlobalHandlers();
    initialized = true;
    pushEvent({
      level: "info",
      type: "session.start",
      message: "Diagnostics initialized",
      context: {
        appVersion: safeText(appVersion, "", 80)
      }
    });
  }

  if (appVersion) {
    state = {
      ...state,
      session: {
        ...state.session,
        appVersion: safeText(appVersion, "", 80),
        lastUpdatedAtISO: nowISO()
      }
    };
    persistState();
  }

  return readSessionDiagnostics();
}

export function setDiagnosticsUserContext({
  uid = "",
  email = "",
  role = "",
  authenticated = false
} = {}) {
  state = {
    ...state,
    session: {
      ...state.session,
      user: {
        ...normalizeUserContext({ uid, email, role, authenticated })
      },
      lastUpdatedAtISO: nowISO()
    }
  };
  persistState();
}

export function recordDiagnosticEvent({
  level = "info",
  type = "event",
  message = "",
  context = {}
} = {}) {
  return pushEvent({ level, type, message, context, error: null });
}

export function recordDiagnosticError(error, context = {}) {
  const normalized = normalizeError(error);
  return pushEvent({
    level: "error",
    type: "app.error",
    message: normalized?.message || "Unexpected error",
    context,
    error: normalized
  });
}

export function clearSessionDiagnostics() {
  const nextSession = {
    ...state.session,
    lastUpdatedAtISO: nowISO(),
    viewport: viewportInfo()
  };
  state = {
    session: nextSession,
    events: []
  };
  persistState();
}

export function readSessionDiagnostics() {
  state = loadState();
  const events = Array.isArray(state.events) ? [...state.events] : [];
  const summary = events.reduce(
    (acc, entry) => {
      acc.total += 1;
      if (entry.level === "error") acc.errors += 1;
      else if (entry.level === "warning" || entry.level === "warn") acc.warnings += 1;
      else acc.info += 1;
      return acc;
    },
    { total: 0, errors: 0, warnings: 0, info: 0 }
  );
  const lastError = events.find((entry) => entry.level === "error");
  return {
    session: {
      ...state.session
    },
    summary: {
      ...summary,
      lastErrorAtISO: lastError?.atISO || ""
    },
    events
  };
}
