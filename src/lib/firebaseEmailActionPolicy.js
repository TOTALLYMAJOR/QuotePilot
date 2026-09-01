const APPROVED_EMAIL_ACTION_HOSTS = new Set([
  "quotepilot.mbmapps.com",
  "quotepilot-staging-20260804.web.app"
]);
export const CANONICAL_EMAIL_ACTION_URL = "https://quotepilot.mbmapps.com/app";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackHttpUrl(parsed) {
  return parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname);
}

export function validateFirebaseEmailActionContinueUrl(candidate) {
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("QuotePilot email action URL is invalid.");
  }

  const localHttp = isLoopbackHttpUrl(parsed);
  const approvedHttps = parsed.protocol === "https:"
    && APPROVED_EMAIL_ACTION_HOSTS.has(parsed.hostname)
    && !parsed.port;
  if (
    (!approvedHttps && !localHttp)
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/app"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("QuotePilot email action URL must use an approved HTTPS /app location.");
  }

  return parsed.toString();
}
