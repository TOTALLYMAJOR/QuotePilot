export const INVENTORY_RECEIVING_BATCH_LIMIT = 25;

const LOCKED_STATES = new Set([
  "submitting",
  "receipt",
  "committed",
  "uncertain",
  "reconciliation",
  "definitive_failure"
]);

function batchError(code, message) {
  return Object.assign(new Error(message), { code });
}

function exactLine(line) {
  if (!line || typeof line !== "object" || Array.isArray(line)) {
    throw batchError("invalid-argument", "A receiving line is required.");
  }
  if (typeof line.lineId !== "string" || !line.lineId.trim()) {
    throw batchError("invalid-argument", "Each receiving line requires a stable identity.");
  }
  if (!line.command || line.command.kind !== "receive_stock") {
    throw batchError("invalid-argument", "Each receiving line requires one receive-stock command.");
  }
  return line;
}

function safeError(error) {
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  return (message || "Inventory did not return a verified receiving receipt.").slice(0, 240);
}

function receiptLine(line, result) {
  return {
    ...line,
    state: "receipt",
    error: "",
    receipt: result.receipt,
    confirmation: result.confirmation
  };
}

function failedLine(line, error, isDefinitiveError) {
  return {
    ...line,
    state: isDefinitiveError(error) ? "definitive_failure" : "uncertain",
    error: safeError(error),
    receipt: null,
    confirmation: null
  };
}

export function buildInventoryReceivingLineId(cryptoProvider = globalThis.crypto) {
  if (typeof cryptoProvider?.getRandomValues !== "function") {
    throw batchError("failed-precondition", "Secure receiving-line identity generation is unavailable.");
  }
  const bytes = new Uint8Array(16);
  cryptoProvider.getRandomValues(bytes);
  const suffix = [...bytes].map((entry) => entry.toString(16).padStart(2, "0")).join("");
  return `inventory_receiving_line_${suffix}`;
}

export function createInventoryReceivingLine({ lineId = buildInventoryReceivingLineId(), command = null } = {}) {
  if (typeof lineId !== "string" || !lineId.trim()) {
    throw batchError("invalid-argument", "A receiving line requires a stable identity.");
  }
  return {
    lineId,
    command,
    state: "draft",
    requestId: "",
    error: "",
    receipt: null,
    confirmation: null
  };
}

export function isInventoryReceivingLineLocked(line) {
  return LOCKED_STATES.has(line?.state);
}

export async function submitInventoryReceivingBatch({
  lines,
  scope,
  submitCommand,
  createRequestId,
  isDefinitiveError,
  onLineState = () => {}
}) {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > INVENTORY_RECEIVING_BATCH_LIMIT) {
    throw batchError("invalid-argument", `Receiving requires 1 to ${INVENTORY_RECEIVING_BATCH_LIMIT} bounded lines.`);
  }
  if (typeof submitCommand !== "function" || typeof createRequestId !== "function" || typeof isDefinitiveError !== "function") {
    throw batchError("invalid-argument", "Receiving submission dependencies are unavailable.");
  }
  const identities = new Set();
  lines.forEach((line) => {
    exactLine(line);
    if (identities.has(line.lineId)) throw batchError("invalid-argument", "Receiving line identities must be unique.");
    identities.add(line.lineId);
  });

  const outcomes = [];
  for (const original of lines) {
    if (original.state !== "draft") {
      outcomes.push(original);
      continue;
    }
    const requestId = original.requestId || createRequestId();
    const submitting = { ...original, state: "submitting", requestId, error: "" };
    onLineState(submitting);
    try {
      const result = await submitCommand({ ...scope, requestId, command: original.command });
      const received = receiptLine(submitting, result);
      outcomes.push(received);
      onLineState(received);
    } catch (error) {
      const failed = failedLine(submitting, error, isDefinitiveError);
      outcomes.push(failed);
      onLineState(failed);
    }
  }
  return outcomes;
}

export async function reconcileInventoryReceivingLine({
  line,
  scope,
  reconcileCommand,
  isDefinitiveError,
  onLineState = () => {}
}) {
  exactLine(line);
  if (line.state !== "uncertain" || !line.requestId) {
    throw batchError("failed-precondition", "Only an uncertain receiving line can be reconciled.");
  }
  const reconciling = { ...line, state: "reconciliation", error: "" };
  onLineState(reconciling);
  try {
    const result = await reconcileCommand({ ...scope, requestId: line.requestId });
    const received = receiptLine(reconciling, result);
    onLineState(received);
    return received;
  } catch (error) {
    const failed = failedLine(reconciling, error, isDefinitiveError);
    onLineState(failed);
    return failed;
  }
}

export async function retryInventoryReceivingLine({
  line,
  scope,
  resetCommand,
  submitCommand,
  isDefinitiveError,
  onLineState = () => {}
}) {
  exactLine(line);
  if (line.state !== "definitive_failure" || !line.requestId) {
    throw batchError("failed-precondition", "Only a definitively rejected receiving line can be retried.");
  }
  if (resetCommand({ ...scope, requestId: line.requestId }) !== true) {
    throw batchError("failed-precondition", "The rejected receiving request could not be reset safely.");
  }
  const submitting = { ...line, state: "submitting", error: "" };
  onLineState(submitting);
  try {
    const result = await submitCommand({ ...scope, requestId: line.requestId, command: line.command });
    const received = receiptLine(submitting, result);
    onLineState(received);
    return received;
  } catch (error) {
    const failed = failedLine(submitting, error, isDefinitiveError);
    onLineState(failed);
    return failed;
  }
}

export function confirmInventoryReceivingReceipts(lines, projectionModel, confirmsReceipt) {
  if (!Array.isArray(lines) || typeof confirmsReceipt !== "function") return lines;
  let changed = false;
  const next = lines.map((line) => {
    if (line.state !== "receipt" || !confirmsReceipt(projectionModel, line)) return line;
    changed = true;
    return { ...line, state: "committed" };
  });
  return changed ? next : lines;
}
