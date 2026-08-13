function text(value) {
  return String(value ?? "").trim();
}

function email(value) {
  const normalized = text(value).toLowerCase();
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) {
    throw new Error("Add a valid email address before opening the default email app.");
  }
  return normalized;
}

/**
 * Creates a browser handoff only. A mailto URL does not prove the user sent
 * anything and cannot safely attach generated files on their behalf.
 */
export function buildDefaultEmailAppHandoff({ to, subject = "", body = "" } = {}) {
  const recipient = email(to);
  const normalizedSubject = text(subject).slice(0, 300);
  const normalizedBody = String(body ?? "").replace(/\r\n?/gu, "\n").slice(0, 12_000);
  return Object.freeze({
    to: recipient,
    subject: normalizedSubject,
    body: normalizedBody,
    href: `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(normalizedSubject)}&body=${encodeURIComponent(normalizedBody)}`,
    evidence: "email_app_open_requested"
  });
}
