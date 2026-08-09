#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const MANIFEST_PATH = "docs/capability-surfacing-contracts.json";
export const REQUIRED_READ_STATES = Object.freeze([
  "loading",
  "empty",
  "success",
  "stale",
  "partial",
  "error",
  "recovery"
]);
export const REQUIRED_MUTATION_STATES = Object.freeze([
  "ready",
  "submitting",
  "uncertain",
  "reconciliation",
  "receipt",
  "error",
  "recovery"
]);
export const REQUIRED_USER_STATES = Object.freeze([
  ...new Set([...REQUIRED_READ_STATES, ...REQUIRED_MUTATION_STATES])
]);

const REQUIRED_USER_DOCS = Object.freeze([
  "docs/FEATURE_MATRIX.md",
  "docs/USER_MANUAL.md"
]);
const USER_DELIVERY_TYPES = new Set(["user_relevant", "headless"]);
const CAPABILITY_KINDS = new Set([
  "read_surface",
  "mutation_surface",
  "mixed_surface",
  "headless_operational",
  "security_private",
  "developer_infrastructure"
]);
const HEADLESS_KINDS = new Set([
  "headless_operational",
  "security_private",
  "developer_infrastructure"
]);
const SURFACE_REVIEWS = new Set(["changed", "verified_existing"]);
const STATE_EXCEPTION_CODES = new Set(["separate_program"]);
const ALLOWED_CONTRACT_FIELDS = new Set([
  "id",
  "reviewRevision",
  "status",
  "retirementReason",
  "deliveryType",
  "capabilityKind",
  "audiences",
  "summary",
  "backendPaths",
  "backendExports",
  "affectedBackendExports",
  "frontendPaths",
  "entryPointLocators",
  "testPaths",
  "testLocators",
  "documentationPaths",
  "documentationLocators",
  "surfaceReview",
  "surfaceReviewNote",
  "stateEvidence",
  "stateExceptions",
  "headlessReason",
  "safeOutcome"
]);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTIONS_ENTRYPOINT_PATH = "functions/index.js";
const FUNCTION_EXPORT_DECLARATION_PATTERN = /^[\t ]*exports\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=|>)/gm;
const MUTATION_EXPORT_NAME_PATTERN = /^(?:accept|activate|apply|approve|archive|book|cancel|charge|claim|close|confirm|convert|create|deactivate|decline|delete|dispatch|duplicate|ensure|expire|finalize|hardDelete|invite|link|mark|mutate|notify|pay|persist|provision|publish|purge|reconcile|record|refund|reopen|repair|request|reschedule|rollback|rotate|save|schedule|send|set|sign|submit|sync|update|upsert|void|write)/i;
const MUTATION_SOURCE_WRITE_PATTERN = /(?:\.\s*(?:add|commit|create|delete|set|update)\s*\(|\b(?:addDoc|createUser|deleteDoc|deleteUser|recursiveDelete|runTransaction|setCustomUserClaims|setDoc|updateDoc|updateUser|writeBatch)\s*\()/;
const CLIENT_PRESENTATION_PREFIXES = Object.freeze([
  "src/components/"
]);
const CLIENT_PRESENTATION_EXCLUSIONS = new Set([
  "src/App.jsx",
  "src/main.jsx",
  "src/context/WorkspaceNavigationContext.jsx",
  "src/hooks/useBrowserLocation.js",
  "src/hooks/useCommercialWorkspaceSnapshot.js",
  "src/hooks/useWorkspaceRouteHeadingFocus.js",
  "src/lib/statusSemantics.js",
  "src/lib/workspacePresentation.js",
  "src/lib/workspaceRoutes.js"
]);
const DIRECT_CLIENT_AUTHORITY_IMPORT_PATTERN = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'](?:firebase(?:\/|["'])|@google-cloud\/|@supabase\/|stripe(?:\/|["']))/;
const DIRECT_CLIENT_AUTHORITY_CALL_PATTERN = /\b(?:addDoc|deleteDoc|fetch|getDoc|getDocs|httpsCallable|onSnapshot|runTransaction|setDoc|updateDoc|uploadBytes|writeBatch)\s*\(/;
const AUTHORITY_SCRIPT_PATTERN = /(?:^|[-_.])(?:acceptance|backfill|bootstrap|cleanup|import|migrat(?:e|ion)|provision|purge|reconcil(?:e|iation)|repair|rotate|seed|sync)(?:[-_.]|$)/i;

function normalizePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();
}

function isRuntimeCodeFile(file) {
  return /\.(?:cjs|js|jsx|mjs|ts|tsx)$/.test(file) && !file.endsWith(".d.ts");
}

export function hasDirectClientAuthoritySignals(source) {
  const input = String(source || "");
  if (!input) return false;
  return DIRECT_CLIENT_AUTHORITY_IMPORT_PATTERN.test(stripComments(input))
    || DIRECT_CLIENT_AUTHORITY_CALL_PATTERN.test(executableCodeOnly(input));
}

export function isBackendDeliveryPath(value, { source = "" } = {}) {
  const file = normalizePath(value);
  if (!file || file.includes("/__tests__/") || /(?:^|\/)test(?:s)?\//.test(file)) {
    return false;
  }
  if (["firestore.rules", "firestore.indexes.json"].includes(file)) return true;
  if (file.startsWith("functions/") && isRuntimeCodeFile(file)) return true;
  if (file.startsWith("src/") && isRuntimeCodeFile(file)) {
    // Client authority can appear in any future source folder, so default to
    // review and keep the exclusion surface intentionally presentation-only.
    if (CLIENT_PRESENTATION_EXCLUSIONS.has(file)) {
      return hasDirectClientAuthoritySignals(source);
    }
    if (CLIENT_PRESENTATION_PREFIXES.some((prefix) => file.startsWith(prefix))) return false;
    return true;
  }
  if (!file.startsWith("scripts/") || !isRuntimeCodeFile(file)) return false;
  return AUTHORITY_SCRIPT_PATTERN.test(path.posix.basename(file));
}

export function findBackendDeliveryPaths(
  changedFiles,
  {
    pathExists = (file) => fs.existsSync(path.join(ROOT, file)),
    readPath = (file) => fs.readFileSync(path.join(ROOT, file), "utf8")
  } = {}
) {
  return [...new Set((changedFiles || []).map(normalizePath).filter(Boolean))]
    .filter((file) => {
      let source = "";
      if (CLIENT_PRESENTATION_EXCLUSIONS.has(file) && pathExists(file)) {
        source = readPath(file);
      }
      return isBackendDeliveryPath(file, { source });
    });
}

function validRelativePath(value) {
  const file = normalizePath(value);
  return Boolean(file)
    && !path.isAbsolute(file)
    && file !== ".."
    && !file.startsWith("../")
    && !file.includes("/../");
}

function stringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map(normalizePath).filter(Boolean))]
    : [];
}

function contractMap(manifest) {
  return new Map(
    (Array.isArray(manifest?.contracts) ? manifest.contracts : [])
      .map((contract) => [String(contract?.id || "").trim(), contract])
      .filter(([id]) => Boolean(id))
  );
}

function revision(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

function contractChanged(current, previous) {
  if (!previous) return true;
  return JSON.stringify(current) !== JSON.stringify(previous);
}

function ensureReferencedPaths(
  contract,
  pathExists,
  errors,
  { enforceCurrentExportInventory = false, currentExports = new Set(), baseExports = new Set() } = {}
) {
  const pathFields = ["backendPaths", "frontendPaths", "testPaths", "documentationPaths"];
  for (const field of pathFields) {
    for (const file of stringList(contract?.[field])) {
      if (!validRelativePath(file)) {
        errors.push(`${contract.id}: ${field} contains an unsafe path (${file}).`);
      } else if (!pathExists(file) && !(field === "backendPaths" && contract.status === "retired")) {
        errors.push(`${contract.id}: ${field} references a missing path (${file}).`);
      }
    }
  }
  if (contract.status !== "retired") return;
  const backendExports = stringList(contract.backendExports);
  for (const file of stringList(contract.backendPaths).filter((candidate) => pathExists(candidate))) {
    const ownsRemovedExportFromPath = enforceCurrentExportInventory
      && backendExports.some((exportLocator) => (
        exportLocator.startsWith(`${file}#`)
        && baseExports.has(exportLocator)
        && !currentExports.has(exportLocator)
      ));
    if (!ownsRemovedExportFromPath) {
      errors.push(
        `${contract.id}: retired contracts may reference an existing backend path only to retain explicit ownership of an export removed from the base inventory (${file}).`
      );
    }
  }
}

function locatorList(value) {
  return Array.isArray(value) ? value : [];
}

function stripComments(source) {
  let output = "";
  let state = "code";
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (state === "line-comment") {
      if (character === "\n") {
        state = "code";
        output += character;
      } else {
        output += " ";
      }
      continue;
    }
    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        output += "  ";
        state = "code";
        index += 1;
      } else {
        output += character === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (["single", "double", "template"].includes(state)) {
      output += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (
        (state === "single" && character === "'")
        || (state === "double" && character === '"')
        || (state === "template" && character === "`")
      ) {
        state = "code";
      }
      continue;
    }
    if (character === "/" && next === "/") {
      output += "  ";
      state = "line-comment";
      index += 1;
    } else if (character === "/" && next === "*") {
      output += "  ";
      state = "block-comment";
      index += 1;
    } else {
      output += character;
      if (character === "'") state = "single";
      else if (character === '"') state = "double";
      else if (character === "`") state = "template";
    }
  }
  return output;
}

function executableCodeOnly(source) {
  const input = String(source || "");
  const regexPrefixKeywords = new Set([
    "await", "case", "delete", "in", "instanceof", "new", "of",
    "return", "throw", "typeof", "void", "yield"
  ]);
  let output = "";
  let state = "code";
  let escaped = false;
  let regexCharacterClass = false;
  let canStartRegex = true;

  const blank = (character) => (character === "\n" ? "\n" : " ");
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];

    if (state === "line-comment") {
      output += blank(character);
      if (character === "\n") state = "code";
      continue;
    }
    if (state === "block-comment") {
      output += blank(character);
      if (character === "*" && next === "/") {
        output += " ";
        state = "code";
        index += 1;
      }
      continue;
    }
    if (["single-quote", "double-quote", "template"].includes(state)) {
      output += blank(character);
      const terminator = state === "single-quote"
        ? "'"
        : state === "double-quote" ? '"' : "`";
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === terminator) {
        state = "code";
        canStartRegex = false;
      }
      continue;
    }
    if (state === "regex") {
      output += blank(character);
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "[") {
        regexCharacterClass = true;
      } else if (character === "]") {
        regexCharacterClass = false;
      } else if (character === "/" && !regexCharacterClass) {
        state = "code";
        while (/[A-Za-z]/.test(input[index + 1] || "")) {
          output += " ";
          index += 1;
        }
        canStartRegex = false;
      }
      continue;
    }

    if (/\s/.test(character)) {
      output += character;
      continue;
    }
    if (character === "/" && next === "/") {
      output += "  ";
      state = "line-comment";
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      output += "  ";
      state = "block-comment";
      index += 1;
      continue;
    }
    if (["'", '"', "`"].includes(character)) {
      output += " ";
      state = character === "'"
        ? "single-quote"
        : character === '"' ? "double-quote" : "template";
      escaped = false;
      continue;
    }
    if (character === "/" && canStartRegex) {
      output += " ";
      state = "regex";
      escaped = false;
      regexCharacterClass = false;
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      let end = index + 1;
      while (/[A-Za-z0-9_$]/.test(input[end] || "")) end += 1;
      const token = input.slice(index, end);
      output += token;
      index = end - 1;
      canStartRegex = regexPrefixKeywords.has(token);
      continue;
    }
    if (/[0-9]/.test(character)) {
      let end = index + 1;
      while (/[A-Za-z0-9_.]/.test(input[end] || "")) end += 1;
      output += input.slice(index, end);
      index = end - 1;
      canStartRegex = false;
      continue;
    }
    output += character;
    canStartRegex = ![".", "?", ")", "]", "}"].includes(character);
  }
  return output;
}

function decodeSimpleStringLiteral(value) {
  return String(value || "").replace(/\\(["'`\\])/g, "$1");
}

function countStringLiteralValueOccurrences(segment, expectedValue) {
  const stringPattern = /(["'`])((?:\\.|(?!\1)[^\\\r\n])*)\1/g;
  let count = 0;
  let match;
  while ((match = stringPattern.exec(segment)) !== null) {
    if (decodeSimpleStringLiteral(match[2]) === expectedValue) count += 1;
  }
  return count;
}

function countCanonicalStateAssertions(segment, assertionLocator) {
  const assertionPattern = /\bexpect\s*\([^;\n]*\)\s*\.\s*toContain\s*\(\s*(["'`])((?:\\.|(?!\1)[^\\\r\n])*)\1\s*\)/g;
  let count = 0;
  let match;
  while ((match = assertionPattern.exec(segment)) !== null) {
    const literalValue = decodeSimpleStringLiteral(match[2]);
    if (literalValue === assertionLocator) count += 1;
  }
  return count;
}

function executableTestSegment(content, locator) {
  const occurrence = content.indexOf(locator);
  if (occurrence < 0) return "";
  const lineStart = content.lastIndexOf("\n", occurrence) + 1;
  const lineEnd = content.indexOf("\n", occurrence);
  const line = content.slice(lineStart, lineEnd < 0 ? content.length : lineEnd);
  const locatorOffset = occurrence - lineStart;
  if (!/^[\t ]*(?:it|test)\s*\(\s*["'`][^"'`]*$/.test(line.slice(0, locatorOffset))) {
    return "";
  }
  const remaining = content.slice(lineStart);
  const firstLineEnd = remaining.indexOf("\n");
  if (firstLineEnd < 0) return remaining;
  const afterFirstLine = remaining.slice(firstLineEnd + 1);
  const nextTest = afterFirstLine.search(/^\s*(?:it|test)\s*\(/m);
  return nextTest < 0
    ? remaining
    : remaining.slice(0, firstLineEnd + 1 + nextTest);
}

function locatorDeclaresExecutableTest(content, locator) {
  const segment = executableTestSegment(content, locator);
  return Boolean(segment)
    && /\b(?:expect|assert[A-Za-z0-9_$]*)\s*(?:\.|\()/.test(stripComments(segment));
}

function validateLocators({
  contract,
  field,
  allowedPaths,
  pathExists,
  readPath,
  errors,
  extraAllowedFields = [],
  requireExecutableTest = false,
  requireAssertionLocator = false
}) {
  const locators = locatorList(contract?.[field]);
  for (const [index, entry] of locators.entries()) {
    const file = normalizePath(entry?.path);
    const locator = String(entry?.locator || "").trim();
    const assertionLocator = String(entry?.assertionLocator || "").trim();
    const keys = entry && typeof entry === "object" ? Object.keys(entry) : [];
    const allowedFields = new Set(["path", "locator", ...extraAllowedFields]);
    if (keys.some((key) => !allowedFields.has(key))) {
      errors.push(`${contract.id}: ${field}[${index}] contains unsupported fields.`);
    }
    if (!validRelativePath(file) || !allowedPaths.includes(file)) {
      errors.push(`${contract.id}: ${field}[${index}] must reference a listed repository path.`);
      continue;
    }
    if (locator.length < 8) {
      errors.push(`${contract.id}: ${field}[${index}] needs a stable locator of at least 8 characters.`);
      continue;
    }
    if (!pathExists(file)) continue;
    let content = "";
    try {
      content = readPath(file);
    } catch {
      errors.push(`${contract.id}: ${field}[${index}] could not read ${file}.`);
      continue;
    }
    const occurrences = content.split(locator).length - 1;
    if (occurrences === 0) {
      errors.push(`${contract.id}: ${field}[${index}] locator was not found in ${file}.`);
    } else if (occurrences !== 1) {
      errors.push(`${contract.id}: ${field}[${index}] locator must be unique in ${file}.`);
    } else if (requireExecutableTest && !locatorDeclaresExecutableTest(content, locator)) {
      errors.push(`${contract.id}: ${field}[${index}] must locate an executable test declaration with an assertion in ${file}.`);
    } else if (requireAssertionLocator) {
      const segment = stripComments(executableTestSegment(content, locator));
      const assertionOccurrences = countStringLiteralValueOccurrences(segment, assertionLocator);
      const canonicalAssertionCount = countCanonicalStateAssertions(segment, assertionLocator);
      if (
        assertionLocator.length < 12
        || assertionOccurrences !== 1
        || canonicalAssertionCount !== 1
      ) {
        errors.push(
          `${contract.id}: ${field}[${index}] assertionLocator must occur exactly once inside a real expect(...).toContain(...) assertion in its executable test.`
        );
      }
    }
  }
  return locators;
}

function requiredStatesForCapability(capabilityKind) {
  if (capabilityKind === "read_surface") return REQUIRED_READ_STATES;
  if (capabilityKind === "mutation_surface") return REQUIRED_MUTATION_STATES;
  if (capabilityKind === "mixed_surface") return REQUIRED_USER_STATES;
  return [];
}

function validateStateEvidence({ contract, testPaths, pathExists, readPath, errors }) {
  const requiredStates = requiredStatesForCapability(contract.capabilityKind);
  const requiredStateSet = new Set(requiredStates);
  const stateExceptions = contract?.stateExceptions && typeof contract.stateExceptions === "object"
    && !Array.isArray(contract.stateExceptions)
    ? contract.stateExceptions
    : {};
  const evidence = validateLocators({
    contract,
    field: "stateEvidence",
    allowedPaths: testPaths,
    pathExists,
    readPath,
    errors,
    extraAllowedFields: ["state", "assertionLocator"],
    requireExecutableTest: true,
    requireAssertionLocator: true
  });
  const evidenceByState = new Map();
  for (const [index, entry] of evidence.entries()) {
    const state = String(entry?.state || "").trim();
    if (!requiredStateSet.has(state)) {
      errors.push(`${contract.id}: stateEvidence[${index}] has an unsupported state for ${contract.capabilityKind} (${state || "missing"}).`);
      continue;
    }
    if (String(entry?.assertionLocator || "").trim() !== `data-capability-state="${state}"`) {
      errors.push(`${contract.id}: stateEvidence[${index}] must assert the canonical data-capability-state marker for ${state}.`);
    }
    if (!normalizePath(entry?.path).includes("/__tests__/")) {
      errors.push(`${contract.id}: stateEvidence[${index}] must use an always-on component/unit test path.`);
    }
    const existing = evidenceByState.get(state) || [];
    existing.push(entry);
    evidenceByState.set(state, existing);
  }
  for (const state of Object.keys(stateExceptions)) {
    if (!requiredStateSet.has(state)) {
      errors.push(`${contract.id}: stateExceptions contains an unsupported state for ${contract.capabilityKind} (${state}).`);
    }
  }
  for (const state of requiredStates) {
    const stateEvidence = evidenceByState.get(state) || [];
    const exception = stateExceptions[state];
    if (stateEvidence.length && exception) {
      errors.push(`${contract.id}: surface state ${state} cannot have both executable evidence and an exception.`);
      continue;
    }
    if (stateEvidence.length) continue;
    const reasonCode = String(exception?.reasonCode || "").trim();
    const justification = String(exception?.justification || "").trim();
    const exceptionFields = exception && typeof exception === "object" ? Object.keys(exception) : [];
    if (exceptionFields.some((field) => !["reasonCode", "justification"].includes(field))) {
      errors.push(`${contract.id}: surface state ${state} exception contains unsupported fields.`);
    }
    const exceptionAllowed = contract.capabilityKind === "read_surface" && state === "stale";
    if (!exceptionAllowed || !STATE_EXCEPTION_CODES.has(reasonCode) || justification.length < 30) {
      errors.push(`${contract.id}: surface state ${state} needs executable test evidence or a controlled reasoned exception.`);
    }
  }
}

function validateSharedFunctionImpacts(contract, errors) {
  if (contract.status !== "active") return;
  const backendPaths = stringList(contract.backendPaths);
  const directlyOwnedPaths = new Set(
    stringList(contract.backendExports)
      .map((locator) => normalizePath(locator.split("#", 1)[0]))
      .filter(Boolean)
  );
  const sharedFunctionPaths = backendPaths.filter((file) => (
    file.startsWith("functions/")
    && isRuntimeCodeFile(file)
    && !directlyOwnedPaths.has(file)
  ));
  if (sharedFunctionPaths.length && !stringList(contract.affectedBackendExports).length) {
    errors.push(
      `${contract.id}: shared Functions helper work requires affectedBackendExports (${sharedFunctionPaths.join(", ")}).`
    );
  }
}

function validateUserContract(contract, changedFiles, pathExists, readPath, errors, enforceDiff = true) {
  const frontendPaths = stringList(contract.frontendPaths);
  const testPaths = stringList(contract.testPaths);
  const documentationPaths = stringList(contract.documentationPaths);

  if (
    !Array.isArray(contract.audiences)
    || !contract.audiences.length
    || contract.audiences.some((audience) => typeof audience !== "string" || !audience.trim())
  ) {
    errors.push(`${contract.id}: user-relevant delivery requires at least one audience.`);
  }
  if (String(contract.safeOutcome || "").trim().length < 30) {
    errors.push(`${contract.id}: user-relevant delivery must describe its safe visible outcome.`);
  }
  if (!frontendPaths.length) {
    errors.push(`${contract.id}: user-relevant delivery requires a frontend surface.`);
  }
  if (!testPaths.length || !testPaths.some((file) => (
    file.startsWith("e2e/") || file.includes("/__tests__/")
  ))) {
    errors.push(`${contract.id}: user-relevant delivery requires component/browser test coverage.`);
  }
  for (const requiredDoc of REQUIRED_USER_DOCS) {
    if (!documentationPaths.includes(requiredDoc)) {
      errors.push(`${contract.id}: documentationPaths must include ${requiredDoc}.`);
    }
    if (enforceDiff && !changedFiles.has(requiredDoc)) {
      errors.push(`${contract.id}: backend delivery must update ${requiredDoc}.`);
    }
  }
  if (!SURFACE_REVIEWS.has(contract.surfaceReview)) {
    errors.push(`${contract.id}: surfaceReview must be changed or verified_existing.`);
  }
  const entryPointLocators = validateLocators({
    contract,
    field: "entryPointLocators",
    allowedPaths: frontendPaths,
    pathExists,
    readPath,
    errors
  });
  const testLocators = validateLocators({
    contract,
    field: "testLocators",
    allowedPaths: testPaths,
    pathExists,
    readPath,
    errors,
    requireExecutableTest: true
  });
  const documentationLocators = validateLocators({
    contract,
    field: "documentationLocators",
    allowedPaths: documentationPaths,
    pathExists,
    readPath,
    errors
  });
  if (!entryPointLocators.length) {
    errors.push(`${contract.id}: user-relevant delivery requires a discoverable entry-point locator.`);
  }
  if (!testLocators.length) {
    errors.push(`${contract.id}: user-relevant delivery requires an exact UI test locator.`);
  }
  for (const requiredDoc of REQUIRED_USER_DOCS) {
    if (!documentationLocators.some((entry) => normalizePath(entry?.path) === requiredDoc)) {
      errors.push(`${contract.id}: ${requiredDoc} requires an exact documentation locator.`);
    }
  }
  if (enforceDiff && contract.surfaceReview === "changed") {
    if (!frontendPaths.some((file) => changedFiles.has(file))) {
      errors.push(`${contract.id}: surfaceReview=changed requires a listed frontend path in the diff.`);
    }
    if (!testPaths.some((file) => changedFiles.has(file))) {
      errors.push(`${contract.id}: surfaceReview=changed requires a listed UI test path in the diff.`);
    }
  }
  if (String(contract.surfaceReviewNote || "").trim().length < 30) {
    errors.push(`${contract.id}: surface review requires a substantive surfaceReviewNote.`);
  }
  validateStateEvidence({ contract, testPaths, pathExists, readPath, errors });
}

function validateHeadlessContract(contract, changedFiles, pathExists, readPath, errors, enforceDiff = true) {
  const backendPaths = stringList(contract.backendPaths);
  const backendExports = stringList(contract.backendExports);
  const frontendPaths = stringList(contract.frontendPaths);
  const testPaths = stringList(contract.testPaths);
  const documentationPaths = stringList(contract.documentationPaths);
  if (String(contract.headlessReason || "").trim().length < 40) {
    errors.push(`${contract.id}: headless delivery requires a substantive headlessReason.`);
  }
  if (
    !Array.isArray(contract.audiences)
    || !contract.audiences.length
    || contract.audiences.some((audience) => typeof audience !== "string" || !audience.trim())
  ) {
    errors.push(`${contract.id}: headless delivery requires a string audience list.`);
  }
  if (String(contract.safeOutcome || "").trim().length < 30) {
    errors.push(`${contract.id}: headless delivery must describe its safe visible outcome.`);
  }
  if (!testPaths.length) {
    errors.push(`${contract.id}: headless delivery requires tests.`);
  }
  if (!documentationPaths.includes("docs/FEATURE_MATRIX.md")) {
    errors.push(`${contract.id}: headless delivery must be mapped in docs/FEATURE_MATRIX.md.`);
  }
  if (enforceDiff && !changedFiles.has("docs/FEATURE_MATRIX.md")) {
    errors.push(`${contract.id}: headless backend delivery must update docs/FEATURE_MATRIX.md.`);
  }
  const testLocators = validateLocators({
    contract,
    field: "testLocators",
    allowedPaths: testPaths,
    pathExists,
    readPath,
    errors,
    requireExecutableTest: true
  });
  const documentationLocators = validateLocators({
    contract,
    field: "documentationLocators",
    allowedPaths: documentationPaths,
    pathExists,
    readPath,
    errors
  });
  if (!testLocators.length || !documentationLocators.length) {
    errors.push(`${contract.id}: headless delivery requires exact test and documentation locators.`);
  }
  if (backendExports.length) {
    errors.push(`${contract.id}: callable export ownership requires a user_relevant read, mutation, or mixed surface contract.`);
  }
  if (contract.capabilityKind === "security_private" && frontendPaths.length) {
    errors.push(`${contract.id}: security_private contracts must not expose a frontend path.`);
  }
  if (contract.capabilityKind === "headless_operational") {
    const entryPointLocators = validateLocators({
      contract,
      field: "entryPointLocators",
      allowedPaths: frontendPaths,
      pathExists,
      readPath,
      errors
    });
    if (!frontendPaths.length || !entryPointLocators.length) {
      errors.push(`${contract.id}: headless operational work needs a safe UI outcome or Attention entry point.`);
    }
  }
  if (
    contract.capabilityKind === "developer_infrastructure"
    && !documentationPaths.some((file) => (
      file === "README.md" || /RUNBOOK|VERSION_CONTROL|DOC_SYSTEM/.test(file)
    ))
  ) {
    errors.push(`${contract.id}: developer infrastructure requires an operator/process documentation path.`);
  }
}

export function validateCapabilitySurfacing({
  changedFiles = [],
  manifest,
  baseManifest = { schemaVersion: 1, catalogVersion: 0, contracts: [] },
  pathExists = (file) => fs.existsSync(path.join(ROOT, file)),
  readPath = (file) => fs.readFileSync(path.join(ROOT, file), "utf8"),
  currentBackendExports,
  currentBackendExportSegments = new Map(),
  baseBackendExports = [],
  changedBackendExports = []
} = {}) {
  const errors = [];
  const changed = new Set(changedFiles.map(normalizePath).filter(Boolean));
  const backendChanges = findBackendDeliveryPaths([...changed], { pathExists, readPath });

  if (
    !manifest
    || manifest.schemaVersion !== 1
    || !revision(manifest.catalogVersion)
    || !Array.isArray(manifest.contracts)
  ) {
    return ["Capability surfacing manifest must use schemaVersion 1, a positive catalogVersion, and a contracts array."];
  }
  const manifestFields = Object.keys(manifest);
  const unknownManifestFields = manifestFields.filter((field) => (
    !["schemaVersion", "catalogVersion", "contracts"].includes(field)
  ));
  if (unknownManifestFields.length) {
    errors.push(`Capability surfacing manifest has unsupported fields (${unknownManifestFields.join(", ")}).`);
  }

  const ids = manifest.contracts.map((contract) => String(contract?.id || "").trim());
  const duplicateIds = ids.filter((id, index) => id && ids.indexOf(id) !== index);
  if (ids.some((id) => !/^[a-z0-9][a-z0-9-]{2,79}$/.test(id))) {
    errors.push("Every capability contract needs a stable lowercase kebab-case id.");
  }
  if (duplicateIds.length) {
    errors.push(`Capability contract ids must be unique (${[...new Set(duplicateIds)].join(", ")}).`);
  }

  const previousById = contractMap(baseManifest);
  const currentById = contractMap(manifest);
  for (const previousId of previousById.keys()) {
    if (!currentById.has(previousId)) {
      errors.push(`${previousId}: capability contracts cannot be removed; retain and retire them explicitly.`);
    }
  }
  const changedContracts = [];
  const exportOwners = new Map();
  const enforceCurrentExportInventory = Array.isArray(currentBackendExports);
  const currentExports = new Set((currentBackendExports || []).map(String));
  const baseExports = new Set(baseBackendExports.map(String));
  const currentExportSegments = currentBackendExportSegments instanceof Map
    ? currentBackendExportSegments
    : new Map(Object.entries(currentBackendExportSegments || {}));
  for (const contract of manifest.contracts) {
    const previous = previousById.get(String(contract?.id || "").trim());
    const currentRevision = revision(contract?.reviewRevision);
    const previousRevision = revision(previous?.reviewRevision);
    if (!currentRevision) {
      errors.push(`${contract.id || "unknown"}: reviewRevision must be a positive integer.`);
    }
    if (!["active", "retired"].includes(contract?.status)) {
      errors.push(`${contract.id}: status must be active or retired.`);
    }
    if (contract?.status === "retired" && String(contract?.retirementReason || "").trim().length < 30) {
      errors.push(`${contract.id}: retired contracts require a substantive retirementReason.`);
    }
    if (contractChanged(contract, previous)) {
      changedContracts.push(contract);
      if (previous && currentRevision <= previousRevision) {
        errors.push(`${contract.id}: changed contracts must increment reviewRevision.`);
      }
    }
    if (!USER_DELIVERY_TYPES.has(contract?.deliveryType)) {
      errors.push(`${contract.id}: deliveryType must be user_relevant or headless.`);
    }
    if (!CAPABILITY_KINDS.has(contract?.capabilityKind)) {
      errors.push(`${contract.id}: capabilityKind is not recognized.`);
    }
    if (contract?.deliveryType === "user_relevant" && HEADLESS_KINDS.has(contract?.capabilityKind)) {
      errors.push(`${contract.id}: headless capability kinds cannot be user_relevant.`);
    }
    if (contract?.deliveryType === "headless" && !HEADLESS_KINDS.has(contract?.capabilityKind)) {
      errors.push(`${contract.id}: headless delivery requires a narrowly defined headless capabilityKind.`);
    }
    const unknownFields = Object.keys(contract || {}).filter((field) => !ALLOWED_CONTRACT_FIELDS.has(field));
    if (unknownFields.length) {
      errors.push(`${contract.id}: unsupported contract fields (${unknownFields.join(", ")}).`);
    }
    if (!stringList(contract?.backendPaths).length) {
      errors.push(`${contract.id}: backendPaths cannot be empty.`);
    }
    if (String(contract?.summary || "").trim().length < 30) {
      errors.push(`${contract.id}: summary must describe the delivered capability.`);
    }
    ensureReferencedPaths(contract, pathExists, errors, {
      enforceCurrentExportInventory,
      currentExports,
      baseExports
    });
    for (const exportLocator of stringList(contract?.backendExports)) {
      const exportMatch = exportLocator.match(/^([^#]+)#([A-Za-z_$][A-Za-z0-9_$]*)$/);
      if (!exportMatch || !stringList(contract.backendPaths).includes(normalizePath(exportMatch?.[1]))) {
        errors.push(`${contract.id}: backendExports must use listed path#exportName locators (${exportLocator}).`);
      }
      const owners = exportOwners.get(exportLocator) || [];
      owners.push(contract.id);
      exportOwners.set(exportLocator, owners);
    }
    for (const affectedLocator of stringList(contract?.affectedBackendExports)) {
      const exportMatch = affectedLocator.match(/^([^#]+)#([A-Za-z_$][A-Za-z0-9_$]*)$/);
      if (!exportMatch || !stringList(contract.backendPaths).includes(normalizePath(exportMatch?.[1]))) {
        errors.push(`${contract.id}: affectedBackendExports must use listed path#exportName locators (${affectedLocator}).`);
      } else if (enforceCurrentExportInventory && !currentExports.has(affectedLocator)) {
        errors.push(`${contract.id}: affectedBackendExports references a missing current export (${affectedLocator}).`);
      }
    }
    validateSharedFunctionImpacts(contract, errors);
    if (contract.status === "active" && contract.deliveryType === "user_relevant") {
      for (const exportLocator of stringList(contract.backendExports)) {
        const exportName = exportLocator.split("#").at(-1) || "";
        const exportSegment = String(currentExportSegments.get(exportLocator) || "");
        const executableSegment = executableCodeOnly(exportSegment);
        const mutationLike = MUTATION_EXPORT_NAME_PATTERN.test(exportName)
          || MUTATION_SOURCE_WRITE_PATTERN.test(executableSegment);
        if (
          mutationLike
          && !["mutation_surface", "mixed_surface"].includes(contract.capabilityKind)
        ) {
          errors.push(
            `${contract.id}: mutation-like backend export requires mutation_surface or mixed_surface (${exportLocator}).`
          );
        }
      }
    }
  }

  for (const [exportLocator, owners] of exportOwners) {
    if (owners.length > 1) {
      errors.push(`Backend export must have exactly one capability owner: ${exportLocator} (${owners.join(", ")}).`);
    }
    const ownerContracts = owners.map((ownerId) => currentById.get(ownerId)).filter(Boolean);
    const hasActiveOwner = ownerContracts.some((contract) => contract.status === "active");
    if (enforceCurrentExportInventory && !currentExports.has(exportLocator) && hasActiveOwner) {
      errors.push(`Capability contract references a missing backend export: ${exportLocator}.`);
    }
    const activeOwners = owners.filter((ownerId) => currentById.get(ownerId)?.status === "active");
    if (currentExports.has(exportLocator) && activeOwners.length !== 1) {
      errors.push(`Current backend export needs exactly one active capability owner: ${exportLocator}.`);
    }
  }

  for (const contract of manifest.contracts.filter((candidate) => candidate.status === "active")) {
    if (contract.deliveryType === "user_relevant") {
      validateUserContract(contract, changed, pathExists, readPath, errors, false);
    } else if (contract.deliveryType === "headless") {
      validateHeadlessContract(contract, changed, pathExists, readPath, errors, false);
    }
  }

  if (!backendChanges.length) return [...new Set(errors)];
  if (!changed.has(MANIFEST_PATH)) {
    errors.push(`Backend delivery changed without updating ${MANIFEST_PATH}.`);
  }
  if (!changedContracts.length) {
    errors.push("Backend delivery changed without a new or reviewRevision-bumped capability contract.");
  }
  const baseCatalogVersion = revision(baseManifest?.catalogVersion);
  if (baseCatalogVersion && revision(manifest.catalogVersion) <= baseCatalogVersion) {
    errors.push("Backend delivery must increment the capability manifest catalogVersion.");
  }

  const reviewedBackendPaths = new Set(
    changedContracts
      .flatMap((contract) => stringList(contract.backendPaths))
  );
  for (const file of backendChanges) {
    if (!reviewedBackendPaths.has(file)) {
      errors.push(`Backend delivery path is not covered by a changed capability contract: ${file}.`);
    }
  }

  const changedExports = changedBackendExports.length
    ? [...new Set(changedBackendExports.map(String))]
    : [...new Set([...currentExports, ...baseExports])]
      .filter((locator) => currentExports.has(locator) !== baseExports.has(locator));
  for (const exportLocator of changedExports) {
    const owner = changedContracts.find((contract) => (
      stringList(contract.backendExports).includes(exportLocator)
    ));
    if (!owner) {
      errors.push(`Changed backend export is not owned by a changed capability contract: ${exportLocator}.`);
      continue;
    }
    const existsNow = currentExports.has(exportLocator);
    if (existsNow && owner.status !== "active") {
      errors.push(`Current changed backend export requires an active capability owner: ${exportLocator}.`);
    }
    if (!existsNow && owner.status !== "retired") {
      errors.push(`Removed backend export requires a retired capability owner: ${exportLocator}.`);
    }
    if (existsNow && owner.deliveryType === "headless") {
      errors.push(`New callable/export cannot use a headless capability contract: ${exportLocator}.`);
    }
  }

  for (const contract of changedContracts) {
    const coversCurrentBackend = stringList(contract.backendPaths)
      .some((file) => backendChanges.includes(file));
    if (!coversCurrentBackend) continue;
    if (contract.status === "retired") continue;
    if (contract.deliveryType === "user_relevant") {
      validateUserContract(contract, changed, pathExists, readPath, errors);
    } else if (contract.deliveryType === "headless") {
      validateHeadlessContract(contract, changed, pathExists, readPath, errors);
    }
  }

  return [...new Set(errors)];
}

function runGit(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch (error) {
    if (allowFailure) return "";
    throw error;
  }
}

export function parseFunctionExports(source, filename = "functions/index.js") {
  return [...parseFunctionExportSegments(source, filename).keys()].sort();
}

function hasTopLevelThisReference(executableSource) {
  let braceDepth = 0;
  for (let index = 0; index < executableSource.length; index += 1) {
    const character = executableSource[index];
    if (character === "{") {
      braceDepth += 1;
      continue;
    }
    if (character === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (
      braceDepth === 0
      && executableSource.slice(index, index + 4) === "this"
      && !/[A-Za-z0-9_$]/.test(executableSource[index - 1] || "")
      && !/[A-Za-z0-9_$]/.test(executableSource[index + 4] || "")
    ) {
      return true;
    }
  }
  return false;
}

function assertSupportedFunctionExportSyntax(source, filename) {
  const executableSource = executableCodeOnly(source);
  const supportedOffsets = new Set();
  const declarationPattern = new RegExp(FUNCTION_EXPORT_DECLARATION_PATTERN.source, "gm");
  let declaration;
  while ((declaration = declarationPattern.exec(executableSource)) !== null) {
    supportedOffsets.add(declaration.index + declaration[0].indexOf("exports"));
  }
  const exportReferences = [...executableSource.matchAll(/\bexports\b/g)]
    .map((match) => match.index)
    .filter((index) => !supportedOffsets.has(index));
  const unsupported = [];
  if (exportReferences.length) unsupported.push("non-canonical exports reference");
  if (/\bmodule\b/.test(executableSource)) {
    unsupported.push("non-canonical module export reference");
  }
  if (hasTopLevelThisReference(executableSource)) {
    unsupported.push("non-canonical top-level CommonJS this reference");
  }
  if (/^[\t ]*export\b/m.test(executableSource)) {
    unsupported.push("ECMAScript export declaration");
  }
  if (!unsupported.length) return;
  throw new Error(
    `${normalizePath(filename)} uses unsupported Function export syntax (${unsupported.join(", ")}). `
    + "Use one explicit exports.<name> assignment per callable so export inventory cannot be bypassed."
  );
}

function findExportAssignmentEnd(source, startIndex, endLimit) {
  const openingToClosing = { "(": ")", "[": "]", "{": "}" };
  const closing = new Set(Object.values(openingToClosing));
  const regexPrefixKeywords = new Set([
    "await", "case", "delete", "in", "instanceof", "new", "of",
    "return", "throw", "typeof", "void", "yield"
  ]);
  const stack = [];
  let state = "code";
  let escaped = false;
  let regexCharacterClass = false;
  let canStartRegex = true;

  for (let index = startIndex; index < endLimit; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (state === "line-comment") {
      if (character === "\n") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        state = "code";
        index += 1;
      }
      continue;
    }
    if (["single-quote", "double-quote", "template"].includes(state)) {
      const terminator = state === "single-quote"
        ? "'"
        : state === "double-quote" ? '"' : "`";
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === terminator) {
        state = "code";
        canStartRegex = false;
      }
      continue;
    }
    if (state === "regex") {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "[") {
        regexCharacterClass = true;
      } else if (character === "]") {
        regexCharacterClass = false;
      } else if (character === "/" && !regexCharacterClass) {
        state = "code";
        while (/[A-Za-z]/.test(source[index + 1] || "")) index += 1;
        canStartRegex = false;
      }
      continue;
    }

    if (/\s/.test(character)) continue;
    if (character === "/" && next === "/") {
      state = "line-comment";
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      state = "block-comment";
      index += 1;
      continue;
    }
    if (character === "'") {
      state = "single-quote";
      escaped = false;
      continue;
    }
    if (character === '"') {
      state = "double-quote";
      escaped = false;
      continue;
    }
    if (character === "`") {
      state = "template";
      escaped = false;
      continue;
    }
    if (character === "/" && canStartRegex) {
      state = "regex";
      escaped = false;
      regexCharacterClass = false;
      continue;
    }
    if (openingToClosing[character]) {
      stack.push(openingToClosing[character]);
      canStartRegex = true;
      continue;
    }
    if (closing.has(character)) {
      if (stack.at(-1) !== character) return -1;
      stack.pop();
      canStartRegex = false;
      continue;
    }
    if (character === ";") {
      if (!stack.length) return index + 1;
      canStartRegex = true;
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      let cursor = index + 1;
      while (/[A-Za-z0-9_$]/.test(source[cursor] || "")) cursor += 1;
      const token = source.slice(index, cursor);
      canStartRegex = regexPrefixKeywords.has(token);
      index = cursor - 1;
      continue;
    }
    if (/[0-9]/.test(character)) {
      let cursor = index + 1;
      while (/[A-Za-z0-9_.]/.test(source[cursor] || "")) cursor += 1;
      canStartRegex = false;
      index = cursor - 1;
      continue;
    }
    if ((character === "+" || character === "-") && next === character) {
      canStartRegex = false;
      index += 1;
      continue;
    }
    canStartRegex = ![".", "?", ")", "]", "}"].includes(character);
  }
  return -1;
}

export function parseFunctionExportSegments(source, filename = "functions/index.js") {
  const sourceText = String(source || "");
  assertSupportedFunctionExportSyntax(sourceText, filename);
  const executableSource = executableCodeOnly(sourceText);
  const declarations = [];
  const declarationPattern = new RegExp(FUNCTION_EXPORT_DECLARATION_PATTERN.source, "gm");
  let match;
  while ((match = declarationPattern.exec(executableSource)) !== null) {
    declarations.push({
      index: match.index,
      expressionStart: declarationPattern.lastIndex,
      name: match[1]
    });
  }

  const segments = new Map();
  declarations.forEach((declaration, declarationIndex) => {
    const locator = `${normalizePath(filename)}#${declaration.name}`;
    if (segments.has(locator)) {
      throw new Error(`Duplicate explicit backend export declaration: ${locator}.`);
    }
    const nextDeclaration = declarations[declarationIndex + 1];
    const endLimit = nextDeclaration?.index ?? sourceText.length;
    const endIndex = findExportAssignmentEnd(
      sourceText,
      declaration.expressionStart,
      endLimit
    );
    if (endIndex < 0) {
      throw new Error(`Could not isolate explicit backend export assignment: ${locator}.`);
    }
    const segment = sourceText.slice(declaration.index, endIndex).trimEnd();
    segments.set(locator, segment);
  });
  return segments;
}

function currentFunctionExportSegments() {
  const entrypoint = path.join(ROOT, FUNCTIONS_ENTRYPOINT_PATH);
  if (!fs.existsSync(entrypoint)) return new Map();
  return parseFunctionExportSegments(
    fs.readFileSync(entrypoint, "utf8"),
    FUNCTIONS_ENTRYPOINT_PATH
  );
}

function baseFunctionExportSegments(range) {
  const base = baseRevision(range);
  if (!base) return new Map();
  const objectType = runGit(
    ["cat-file", "-t", `${base}:${FUNCTIONS_ENTRYPOINT_PATH}`],
    { allowFailure: true }
  );
  if (!objectType) return new Map();
  if (objectType !== "blob") {
    throw new Error(`Base Functions entrypoint is not a file at ${base}.`);
  }
  return parseFunctionExportSegments(
    runGit(["show", `${base}:${FUNCTIONS_ENTRYPOINT_PATH}`]),
    FUNCTIONS_ENTRYPOINT_PATH
  );
}

function lines(value) {
  return String(value || "").split(/\r?\n/).map(normalizePath).filter(Boolean);
}

function parseDiffRange(range) {
  const normalized = String(range || "").trim();
  const match = normalized.match(/^([^\s]+?)(\.\.\.?)([^\s]+)$/);
  if (
    !match
    || match[1].startsWith("-")
    || match[3].startsWith("-")
  ) {
    throw new Error("Diff range must be an explicit <base>..<head> or <base>...<head> comparison.");
  }
  return {
    range: normalized,
    baseRef: match[1],
    separator: match[2],
    headRef: match[3]
  };
}

function resolveCommit(ref, runGitCommand = runGit) {
  const resolved = runGitCommand(
    ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
    { allowFailure: true }
  );
  if (!/^[0-9a-f]{40,64}$/i.test(resolved)) {
    throw new Error(`Git commit ref could not be resolved: ${ref}.`);
  }
  return resolved;
}

export function validateDiffRange(range, { runGitCommand = runGit } = {}) {
  const parsed = parseDiffRange(range);
  resolveCommit(parsed.baseRef, runGitCommand);
  resolveCommit(parsed.headRef, runGitCommand);
  runGitCommand([
    "diff",
    "--name-only",
    "--diff-filter=ACMRD",
    parsed.range,
    "--"
  ]);
  return parsed.range;
}

export function resolveDiffBaseRevision(range, { runGitCommand = runGit } = {}) {
  const parsed = parseDiffRange(range);
  const baseCommit = resolveCommit(parsed.baseRef, runGitCommand);
  const headCommit = resolveCommit(parsed.headRef, runGitCommand);
  if (parsed.separator === "..") return baseCommit;
  const mergeBase = runGitCommand(["merge-base", baseCommit, headCommit]);
  if (!/^[0-9a-f]{40,64}$/i.test(mergeBase)) {
    throw new Error(`Git merge-base could not be resolved for ${parsed.range}.`);
  }
  return mergeBase;
}

function readGitHubEventPayload(env, { pathExists, readFile }) {
  const eventPath = String(env.GITHUB_EVENT_PATH || "").trim();
  if (!eventPath) {
    throw new Error("GITHUB_EVENT_PATH is required for GitHub pull_request and push comparisons.");
  }
  if (!pathExists(eventPath)) {
    throw new Error(`GITHUB_EVENT_PATH does not exist: ${eventPath}.`);
  }
  try {
    const payload = JSON.parse(readFile(eventPath));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("event payload must be a JSON object");
    }
    return payload;
  } catch (error) {
    throw new Error(`GITHUB_EVENT_PATH could not be parsed: ${error?.message || error}`);
  }
}

export function resolveDiffRange({
  env = process.env,
  runGitCommand = runGit,
  pathExists = fs.existsSync,
  readFile = (filename) => fs.readFileSync(filename, "utf8")
} = {}) {
  const explicit = String(env.CAPABILITY_SURFACING_DIFF || "").trim();
  if (explicit) {
    try {
      return validateDiffRange(explicit, { runGitCommand });
    } catch (error) {
      throw new Error(`CAPABILITY_SURFACING_DIFF is invalid: ${error?.message || error}`);
    }
  }

  const eventName = String(env.GITHUB_EVENT_NAME || "").trim();
  if (["pull_request", "pull_request_target"].includes(eventName)) {
    const payload = readGitHubEventPayload(env, { pathExists, readFile });
    const baseSha = String(payload?.pull_request?.base?.sha || "").trim();
    const headSha = String(payload?.pull_request?.head?.sha || "").trim();
    if (!baseSha || !headSha) {
      throw new Error("GitHub pull_request payload must include pull_request.base.sha and pull_request.head.sha.");
    }
    return validateDiffRange(`${baseSha}...${headSha}`, { runGitCommand });
  }

  if (eventName === "push") {
    const payload = readGitHubEventPayload(env, { pathExists, readFile });
    const beforeSha = String(payload?.before || "").trim();
    const afterSha = String(payload?.after || "").trim();
    if (!beforeSha || /^0+$/.test(beforeSha) || !afterSha || /^0+$/.test(afterSha)) {
      throw new Error("GitHub push payload must include resolvable non-zero before and after commit SHAs.");
    }
    return validateDiffRange(`${beforeSha}..${afterSha}`, { runGitCommand });
  }

  const baseRef = String(env.GITHUB_BASE_REF || "").trim();
  if (baseRef) {
    return validateDiffRange(`origin/${baseRef}...HEAD`, { runGitCommand });
  }

  const upstream = runGitCommand(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    { allowFailure: true }
  );
  if (upstream) {
    const upstreamCommit = runGitCommand(
      ["rev-parse", "--verify", "--end-of-options", `${upstream}^{commit}`],
      { allowFailure: true }
    );
    const headCommit = runGitCommand(
      ["rev-parse", "--verify", "--end-of-options", "HEAD^{commit}"],
      { allowFailure: true }
    );
    if (upstreamCommit && headCommit && upstreamCommit !== headCommit) {
      return validateDiffRange(`${upstream}...HEAD`, { runGitCommand });
    }
  }

  const originMain = runGitCommand(
    ["rev-parse", "--verify", "--end-of-options", "origin/main^{commit}"],
    { allowFailure: true }
  );
  if (originMain) {
    return validateDiffRange("origin/main...HEAD", { runGitCommand });
  }
  throw new Error(
    "Capability surfacing diff could not be resolved. Set a valid CAPABILITY_SURFACING_DIFF or configure an upstream/origin/main ref."
  );
}

function getChangedFiles(range) {
  const committed = range
    ? lines(runGit(["diff", "--name-only", "--diff-filter=ACMRD", range, "--"]))
    : [];
  const working = [
    ...lines(runGit(["diff", "--name-only"])),
    ...lines(runGit(["diff", "--name-only", "--cached"])),
    ...lines(runGit(["ls-files", "--others", "--exclude-standard"]))
  ];
  return [...new Set([...committed, ...working])].sort();
}

function baseRevision(range) {
  if (!range) return "";
  return resolveDiffBaseRevision(range);
}

function readJsonFile(filename) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, filename), "utf8"));
}

function readBaseManifest(range) {
  const base = baseRevision(range);
  if (!base) return { schemaVersion: 1, catalogVersion: 0, contracts: [] };
  const objectType = runGit(
    ["cat-file", "-t", `${base}:${MANIFEST_PATH}`],
    { allowFailure: true }
  );
  if (!objectType) return { schemaVersion: 1, catalogVersion: 0, contracts: [] };
  if (objectType !== "blob") {
    throw new Error(`Base capability manifest is not a file at ${base}.`);
  }
  const raw = runGit(["show", `${base}:${MANIFEST_PATH}`]);
  return JSON.parse(raw);
}

export function checkCapabilitySurfacing() {
  const range = resolveDiffRange();
  const changedFiles = getChangedFiles(range);
  const manifest = readJsonFile(MANIFEST_PATH);
  const baseManifest = readBaseManifest(range);
  const currentExportSegments = currentFunctionExportSegments();
  const baseExportSegments = baseFunctionExportSegments(range);
  const currentBackendExports = [...currentExportSegments.keys()];
  const baseBackendExports = [...baseExportSegments.keys()];
  const changedBackendExports = [...new Set([
    ...currentBackendExports,
    ...baseBackendExports
  ])].filter((locator) => (
    baseExportSegments.get(locator) !== currentExportSegments.get(locator)
  ));
  const errors = validateCapabilitySurfacing({
    changedFiles,
    manifest,
    baseManifest,
    currentBackendExports,
    currentBackendExportSegments: currentExportSegments,
    baseBackendExports,
    changedBackendExports
  });

  console.log(`Capability surfacing diff: ${range || "working tree only"}`);
  console.log("Backend delivery paths:");
  const backendPaths = findBackendDeliveryPaths(changedFiles);
  if (!backendPaths.length) console.log("- none");
  backendPaths.forEach((file) => console.log(`- ${file}`));
  console.log("Changed backend exports:");
  if (!changedBackendExports.length) console.log("- none");
  changedBackendExports.forEach((locator) => console.log(`- ${locator}`));

  if (errors.length) {
    console.error("\nCapability surfacing gate failed:");
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }
  console.log("\nCapability surfacing gate passed.");
}

const isDirectExecution = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    checkCapabilitySurfacing();
  } catch (error) {
    console.error(`Capability surfacing gate failed: ${error?.message || error}`);
    process.exitCode = 1;
  }
}
