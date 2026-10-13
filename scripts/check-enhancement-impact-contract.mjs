import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ENHANCEMENT_MANIFEST_PATH = path.join(
  "docs",
  "enhancement-impact-manifest.json"
);

const ALLOWED_CHANGE_TYPES = new Set([
  "authority",
  "performance",
  "presentation",
  "process",
  "workflow"
]);

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function requireString(value, field, errors) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${field} must be a non-empty string.`);
    return "";
  }
  return value.trim();
}

function requireStringArray(value, field, errors, { minItems = 0 } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array.`);
    return [];
  }
  const normalized = value.map((item, index) => requireString(item, `${field}[${index}]`, errors));
  if (normalized.length < minItems) {
    errors.push(`${field} must contain at least ${minItems} item${minItems === 1 ? "" : "s"}.`);
  }
  const duplicates = normalized.filter((item, index) => item && normalized.indexOf(item) !== index);
  if (duplicates.length) errors.push(`${field} contains duplicate values: ${[...new Set(duplicates)].join(", ")}.`);
  return normalized.filter(Boolean);
}

function pathMatchesBoundary(file, boundary) {
  const normalized = normalizePath(file);
  return (boundary.exactPaths || []).some((candidate) => normalizePath(candidate) === normalized)
    || (boundary.pathPrefixes || []).some((prefix) => normalized.startsWith(normalizePath(prefix)));
}

export function validateEnhancementManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Enhancement impact manifest must be an object.");
  }
  if (manifest.schemaVersion !== 1) errors.push("schemaVersion must be 1.");

  if (!Array.isArray(manifest.authorityBoundaries)) {
    errors.push("authorityBoundaries must be an array.");
  }
  if (!Array.isArray(manifest.enhancements)) {
    errors.push("enhancements must be an array.");
  }

  const boundaryIds = new Set();
  for (const [index, boundary] of (manifest.authorityBoundaries || []).entries()) {
    const prefix = `authorityBoundaries[${index}]`;
    const id = requireString(boundary?.id, `${prefix}.id`, errors);
    if (id && boundaryIds.has(id)) errors.push(`${prefix}.id duplicates ${id}.`);
    if (id) boundaryIds.add(id);
    const exactPaths = requireStringArray(boundary?.exactPaths || [], `${prefix}.exactPaths`, errors);
    const pathPrefixes = requireStringArray(boundary?.pathPrefixes || [], `${prefix}.pathPrefixes`, errors);
    if (!exactPaths.length && !pathPrefixes.length) {
      errors.push(`${prefix} must declare exactPaths or pathPrefixes.`);
    }
  }

  const enhancementIds = new Set();
  for (const [index, enhancement] of (manifest.enhancements || []).entries()) {
    const prefix = `enhancements[${index}]`;
    const id = requireString(enhancement?.id, `${prefix}.id`, errors);
    requireString(enhancement?.title, `${prefix}.title`, errors);
    const changeType = requireString(enhancement?.changeType, `${prefix}.changeType`, errors);
    if (changeType && !ALLOWED_CHANGE_TYPES.has(changeType)) {
      errors.push(`${prefix}.changeType must be one of ${[...ALLOWED_CHANGE_TYPES].join(", ")}.`);
    }
    if (id && enhancementIds.has(id)) errors.push(`${prefix}.id duplicates ${id}.`);
    if (id) enhancementIds.add(id);
    requireStringArray(enhancement?.routes, `${prefix}.routes`, errors);
    const authorities = requireStringArray(enhancement?.authorities, `${prefix}.authorities`, errors);
    requireStringArray(enhancement?.tests, `${prefix}.tests`, errors, { minItems: 1 });
    for (const authority of authorities) {
      if (!boundaryIds.has(authority)) {
        errors.push(`${prefix}.authorities references unknown authority ${authority}.`);
      }
    }
    if (changeType === "presentation" && authorities.length) {
      errors.push(`${prefix} is presentation-only and must declare authorities: [].`);
    }
    if (changeType === "authority" && !authorities.length) {
      errors.push(`${prefix} is authority work and must declare at least one authority.`);
    }
  }

  if (errors.length) {
    throw new Error(`Enhancement impact contract failed:\n- ${errors.join("\n- ")}`);
  }
  return manifest;
}

export function loadEnhancementManifest(root = process.cwd()) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, ENHANCEMENT_MANIFEST_PATH), "utf8")
  );
  return validateEnhancementManifest(manifest);
}

function expandIdToken(token) {
  const match = String(token).trim().match(/^#?(\d+)(?:\s*[-–—]\s*#?(\d+))?$/);
  if (!match) return [];
  const start = Number(match[1]);
  const end = Number(match[2] || match[1]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start > 500) {
    return [];
  }
  return Array.from({ length: end - start + 1 }, (_, index) => String(start + index));
}

export function extractEnhancementIds(task) {
  const ids = [];
  const pattern = /\b(?:enhancements?|items?)\s+((?:#?\d+(?:\s*[-–—]\s*#?\d+)?)(?:\s*(?:,|and)\s*#?\d+(?:\s*[-–—]\s*#?\d+)?)*)/gi;
  for (const match of String(task || "").matchAll(pattern)) {
    for (const token of match[1].split(/\s*(?:,|and)\s*/i)) ids.push(...expandIdToken(token));
  }
  return [...new Set(ids)];
}

export function resolveEnhancementImpact({ manifest, enhancementIds = [], files = [] }) {
  const validated = validateEnhancementManifest(manifest);
  const ids = [...new Set(enhancementIds.map((id) => String(id).replace(/^#/, "").trim()).filter(Boolean))];
  const byId = new Map(validated.enhancements.map((enhancement) => [enhancement.id, enhancement]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new Error(`Enhancement impact declarations missing for: ${missing.join(", ")}.`);
  }

  const declarations = ids.map((id) => byId.get(id));
  const normalizedFiles = [...new Set(files.map(normalizePath).filter(Boolean))];
  for (const declaration of declarations) {
    for (const boundary of validated.authorityBoundaries) {
      const matchedFiles = normalizedFiles.filter((file) => pathMatchesBoundary(file, boundary));
      if (!matchedFiles.length) continue;
      if (!declaration.authorities.includes(boundary.id)) {
        const presentation = declaration.changeType === "presentation"
          ? " Presentation-only work must keep authorities: [] and move authority changes to a separate enhancement."
          : "";
        throw new Error(
          `Enhancement ${declaration.id} does not declare authority ${boundary.id} for ${matchedFiles.join(", ")}.${presentation}`
        );
      }
    }
  }

  return declarations.map((declaration) => ({
    id: declaration.id,
    title: declaration.title,
    changeType: declaration.changeType,
    routes: [...declaration.routes],
    authorities: [...declaration.authorities],
    tests: [...declaration.tests]
  }));
}

function parseArgs(argv) {
  const parsed = { manifest: ENHANCEMENT_MANIFEST_PATH, enhancementIds: [], files: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!["--manifest", "--enhancement", "--file", "--files"].includes(token)) {
      throw new Error(`Unknown argument: ${token}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${token} requires a value.`);
    index += 1;
    if (token === "--manifest") parsed.manifest = value;
    else if (token === "--enhancement") parsed.enhancementIds.push(...value.split(","));
    else parsed.files.push(...value.split(","));
  }
  return parsed;
}

function main() {
  const root = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  const manifest = validateEnhancementManifest(
    JSON.parse(fs.readFileSync(path.resolve(root, args.manifest), "utf8"))
  );
  const declarations = args.enhancementIds.length
    ? resolveEnhancementImpact({ manifest, enhancementIds: args.enhancementIds, files: args.files })
    : manifest.enhancements;
  console.log(`Enhancement impact contract passed (${declarations.length} declaration${declarations.length === 1 ? "" : "s"}).`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
