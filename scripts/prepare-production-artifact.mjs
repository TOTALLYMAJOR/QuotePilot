#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_SCHEMA = "com.mbmapps.quotepilot.production-release-evidence/v4";
const MANIFEST_SCHEMA = "com.mbmapps.quotepilot.production-artifact-manifest/v1";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;
const PROVIDER_CREDENTIAL_KEYS = Object.freeze([
  "FIREBASE_TOKEN",
  "VERCEL_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  "GOOGLE_CREDENTIALS"
]);
const EVIDENCE_FIELDS = Object.freeze([
  "schema",
  "releaseSha",
  "releaseTag",
  "rollbackSha",
  "target",
  "ciRunId",
  "uatRunId",
  "preparationRunId",
  "stagingId",
  "attesterId",
  "uatReviewerId",
  "uatReviewId",
  "operatorId",
  "productionReviewerId",
  "productionReviewId",
  "checklistDigest",
  "verifiedAt"
]);

export const PRODUCTION_ARTIFACT_LIMITS = Object.freeze({
  maximumFileCount: 20_000,
  maximumFileBytes: 100 * 1024 * 1024,
  maximumTotalBytes: 500 * 1024 * 1024
});

export const PRODUCTION_PROVIDER_IDENTIFIERS = Object.freeze({
  "firebase-hosting": Object.freeze({
    provider: "firebase",
    projectId: "tonicatering",
    deploymentSelector: "hosting:app",
    hostingTarget: "app",
    hostingSiteId: "tonicatering"
  }),
  "firebase-backend": Object.freeze({
    provider: "firebase",
    projectId: "tonicatering",
    deploymentSelector: "firestore,functions",
    functionsRegion: "us-central1"
  }),
  "firebase-all": Object.freeze({
    provider: "firebase",
    projectId: "tonicatering",
    deploymentSelector: "hosting:app,firestore,functions",
    hostingTarget: "app",
    hostingSiteId: "tonicatering",
    functionsRegion: "us-central1"
  }),
  vercel: Object.freeze({
    provider: "vercel",
    projectId: "prj_epLi14LmBItwYkv25XZoAkWZf4Jk",
    orgId: "team_AW2QNNgYt5vESEO3eOTJXHp1",
    projectName: "quoteflow",
    environment: "production",
    productionDomain: "quotepilot.mbmapps.com"
  })
});

function artifactError(message) {
  return new Error(`Production artifact preparation refused: ${message}`);
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactObjectFields(value, expectedFields, label) {
  if (!isPlainObject(value)) throw artifactError(`${label} must be a JSON object.`);
  const actual = Object.keys(value).sort(compareText);
  const expected = [...expectedFields].sort(compareText);
  if (
    actual.length !== expected.length
    || actual.some((field, index) => field !== expected[index])
  ) {
    throw artifactError(`${label} does not contain the exact required fields.`);
  }
}

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw artifactError(`${field} must be a positive safe integer.`);
  }
  return value;
}

function requireOpaqueId(value, field) {
  const normalized = String(value || "");
  if (
    normalized !== normalized.trim()
    || !normalized
    || normalized.length > 512
    || /\s/.test(normalized)
  ) {
    throw artifactError(`${field} is missing or invalid.`);
  }
  return normalized;
}

function cloneProviderIdentifiers(target) {
  const provider = PRODUCTION_PROVIDER_IDENTIFIERS[target];
  if (!provider) {
    throw artifactError(
      "target must be firebase-hosting, firebase-backend, firebase-all, or vercel."
    );
  }
  return Object.fromEntries(Object.entries(provider).map(([key, value]) => [key, value]));
}

export function assertProviderCredentialsAbsent(env = process.env) {
  if (!env || (typeof env !== "object" && typeof env !== "function")) {
    throw artifactError("the preparation environment is unavailable.");
  }
  const presentKeys = new Set(
    Object.keys(env).map((key) => String(key).toUpperCase())
  );
  const exposed = PROVIDER_CREDENTIAL_KEYS.find((key) => presentKeys.has(key));
  if (exposed) {
    throw artifactError(`${exposed} must be absent from the prepare-only environment.`);
  }
}

export function validateVerifiedReleaseEvidence(value) {
  assertExactObjectFields(value, EVIDENCE_FIELDS, "release evidence");
  if (value.schema !== EVIDENCE_SCHEMA) {
    throw artifactError(`release evidence schema must be ${EVIDENCE_SCHEMA}.`);
  }
  if (!FULL_SHA_PATTERN.test(value.releaseSha)) {
    throw artifactError("releaseSha must be a lowercase full commit SHA.");
  }
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(value.releaseTag)) {
    throw artifactError("releaseTag must be an exact semantic vX.Y.Z tag.");
  }
  if (!FULL_SHA_PATTERN.test(value.rollbackSha)) {
    throw artifactError("rollbackSha must be a lowercase full commit SHA.");
  }
  if (value.releaseSha === value.rollbackSha) {
    throw artifactError("rollbackSha must differ from releaseSha.");
  }
  cloneProviderIdentifiers(value.target);
  requirePositiveInteger(value.ciRunId, "ciRunId");
  requirePositiveInteger(value.uatRunId, "uatRunId");
  requirePositiveInteger(value.preparationRunId, "preparationRunId");
  requirePositiveInteger(value.attesterId, "attesterId");
  requirePositiveInteger(value.uatReviewerId, "uatReviewerId");
  requirePositiveInteger(value.operatorId, "operatorId");
  requirePositiveInteger(value.productionReviewerId, "productionReviewerId");
  if (value.attesterId === value.uatReviewerId) {
    throw artifactError("the UAT reviewer must differ from the UAT attester.");
  }
  if (
    value.operatorId === value.productionReviewerId
    || value.attesterId === value.productionReviewerId
  ) {
    throw artifactError(
      "the production reviewer must differ from the preparation operator and UAT attester."
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,79}$/.test(value.stagingId)) {
    throw artifactError("stagingId is missing or invalid.");
  }
  requireOpaqueId(value.uatReviewId, "uatReviewId");
  requireOpaqueId(value.productionReviewId, "productionReviewId");
  if (!SHA256_PATTERN.test(value.checklistDigest)) {
    throw artifactError("checklistDigest must be a lowercase SHA-256 digest.");
  }
  const verifiedDate = new Date(value.verifiedAt);
  if (
    !Number.isFinite(verifiedDate.getTime())
    || verifiedDate.toISOString() !== value.verifiedAt
  ) {
    throw artifactError("verifiedAt must be a canonical ISO-8601 timestamp.");
  }

  return Object.freeze(Object.fromEntries(EVIDENCE_FIELDS.map((field) => [field, value[field]])));
}

export function normalizeArtifactRelativePath(value) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw artifactError("artifact paths must be non-empty and have no outer whitespace.");
  }
  if (/\0|[\u0001-\u001f\u007f]/.test(value)) {
    throw artifactError("artifact paths may not contain control characters.");
  }
  const normalizedSeparators = value.replace(/\\/g, "/");
  if (
    normalizedSeparators.startsWith("/")
    || /^[A-Za-z]:\//.test(normalizedSeparators)
  ) {
    throw artifactError("artifact paths must be relative.");
  }
  const segments = normalizedSeparators.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw artifactError("artifact paths may not traverse or contain empty segments.");
  }
  const normalized = segments.join("/");
  if (normalized.normalize("NFC") !== normalized) {
    throw artifactError("artifact paths must use NFC Unicode normalization.");
  }
  return normalized;
}

export function isSecretLikeArtifactPath(relativePath) {
  const normalized = normalizeArtifactRelativePath(relativePath);
  const segments = normalized.toLowerCase().split("/");
  const basename = segments.at(-1);
  if (segments.some((segment) => [".git", ".hg", ".svn", "node_modules"].includes(segment))) {
    return true;
  }
  if (
    basename === ".env"
    || basename.startsWith(".env.")
    || basename.startsWith(".env-")
    || basename.endsWith(".env")
    || [".npmrc", ".netrc", ".pypirc", ".git-credentials"].includes(basename)
  ) {
    return true;
  }
  if (
    /\.(?:pem|key|p12|pfx|jks|keystore|ppk)$/.test(basename)
    || /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\.|$)/.test(basename)
    || /^(?:service[-_]?account|firebase[-_]?adminsdk|credentials)(?:[._-]|$)/.test(basename)
    || /(?:^|[._-])private[-_]?key(?:[._-]|$)/.test(basename)
  ) {
    return true;
  }
  return false;
}

function containsPrivateKey(buffer) {
  return /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(
    buffer.toString("utf8")
  );
}

function pathIsInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function validateAbsoluteDirectoryPath(value, field) {
  if (typeof value !== "string" || !value || !path.isAbsolute(value)) {
    throw artifactError(`${field} must be an explicit absolute path.`);
  }
  return path.resolve(value);
}

export function enumerateArtifactFiles(
  artifactRoot,
  {
    fsImpl = fs,
    limits = PRODUCTION_ARTIFACT_LIMITS
  } = {}
) {
  const resolvedRoot = validateAbsoluteDirectoryPath(artifactRoot, "artifactRoot");
  const rootStat = fsImpl.lstatSync(resolvedRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw artifactError("artifactRoot must be a real directory, not a symlink.");
  }
  const realRoot = fsImpl.realpathSync(resolvedRoot);
  const files = [];
  const caseFoldedPaths = new Set();
  let totalBytes = 0;

  function walk(directory, segments) {
    const entries = fsImpl
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      if (
        typeof entry.name !== "string"
        || !entry.name
        || entry.name.includes("/")
        || entry.name.includes("\\")
      ) {
        throw artifactError("artifactRoot contains an invalid directory entry.");
      }
      const relativePath = normalizeArtifactRelativePath([...segments, entry.name].join("/"));
      if (isSecretLikeArtifactPath(relativePath)) {
        throw artifactError(`secret-like artifact path is not allowed: ${relativePath}.`);
      }
      const foldedPath = relativePath.toLocaleLowerCase("en-US");
      if (caseFoldedPaths.has(foldedPath)) {
        throw artifactError(`artifact paths collide by case: ${relativePath}.`);
      }
      const absolutePath = path.join(resolvedRoot, ...relativePath.split("/"));
      if (!pathIsInside(resolvedRoot, absolutePath)) {
        throw artifactError(`artifact path escapes artifactRoot: ${relativePath}.`);
      }
      const entryStat = fsImpl.lstatSync(absolutePath);
      if (entryStat.isSymbolicLink()) {
        throw artifactError(`symbolic links are not allowed: ${relativePath}.`);
      }
      const realEntry = fsImpl.realpathSync(absolutePath);
      if (!pathIsInside(realRoot, realEntry)) {
        throw artifactError(`artifact path resolves outside artifactRoot: ${relativePath}.`);
      }

      caseFoldedPaths.add(foldedPath);
      if (entryStat.isDirectory()) {
        walk(absolutePath, [...segments, entry.name]);
        continue;
      }
      if (!entryStat.isFile()) {
        throw artifactError(`only regular files are allowed: ${relativePath}.`);
      }
      if ((entryStat.mode & 0o7000) !== 0) {
        throw artifactError(`special permission bits are not allowed: ${relativePath}.`);
      }
      if (
        !Number.isSafeInteger(entryStat.size)
        || entryStat.size < 0
        || entryStat.size > limits.maximumFileBytes
      ) {
        throw artifactError(`artifact file exceeds the size limit: ${relativePath}.`);
      }
      if (files.length + 1 > limits.maximumFileCount) {
        throw artifactError("artifact file count exceeds the safety limit.");
      }
      totalBytes += entryStat.size;
      if (totalBytes > limits.maximumTotalBytes) {
        throw artifactError("artifact total size exceeds the safety limit.");
      }
      const contents = fsImpl.readFileSync(absolutePath);
      const buffer = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
      if (buffer.length !== entryStat.size) {
        throw artifactError(`artifact file changed while it was read: ${relativePath}.`);
      }
      if (containsPrivateKey(buffer)) {
        throw artifactError(`private key material is not allowed: ${relativePath}.`);
      }
      const finalStat = fsImpl.lstatSync(absolutePath);
      if (
        !finalStat.isFile()
        || finalStat.isSymbolicLink()
        || finalStat.dev !== entryStat.dev
        || finalStat.ino !== entryStat.ino
        || finalStat.size !== entryStat.size
        || finalStat.mtimeMs !== entryStat.mtimeMs
      ) {
        throw artifactError(`artifact file changed while it was hashed: ${relativePath}.`);
      }
      files.push(Object.freeze({
        path: relativePath,
        sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
        size: entryStat.size,
        mode: entryStat.mode & 0o777
      }));
    }
  }

  walk(resolvedRoot, []);
  if (files.length === 0) throw artifactError("artifactRoot contains no files.");
  files.sort((left, right) => compareText(left.path, right.path));
  return Object.freeze({
    root: ".",
    fileCount: files.length,
    totalBytes,
    files: Object.freeze(files)
  });
}

function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw artifactError("canonical JSON cannot contain non-finite numbers.");
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (!isPlainObject(value)) throw artifactError("canonical JSON contains an unsupported value.");
  const result = {};
  for (const key of Object.keys(value).sort(compareText)) {
    if (value[key] === undefined) {
      throw artifactError("canonical JSON cannot contain undefined values.");
    }
    result[key] = canonicalize(value[key]);
  }
  return result;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function calculateManifestDigest(manifestWithoutIntegrity) {
  return crypto
    .createHash("sha256")
    .update(canonicalJson(manifestWithoutIntegrity), "utf8")
    .digest("hex");
}

export function buildProductionArtifactManifest(
  { evidence: evidenceValue, artifactRoot },
  dependencies = {}
) {
  const evidence = validateVerifiedReleaseEvidence(evidenceValue);
  const artifact = enumerateArtifactFiles(artifactRoot, dependencies);
  const provider = Object.freeze(cloneProviderIdentifiers(evidence.target));
  const body = {
    schema: MANIFEST_SCHEMA,
    evidence,
    provider,
    artifact
  };
  const integrity = {
    algorithm: "sha256",
    canonicalization: "sorted-key-json-v1",
    scope: "manifest-without-integrity",
    value: calculateManifestDigest(body)
  };
  return Object.freeze({ ...body, integrity: Object.freeze(integrity) });
}

export function validateProductionArtifactManifest(manifest) {
  assertExactObjectFields(
    manifest,
    ["schema", "evidence", "provider", "artifact", "integrity"],
    "artifact manifest"
  );
  if (manifest.schema !== MANIFEST_SCHEMA) {
    throw artifactError(`artifact manifest schema must be ${MANIFEST_SCHEMA}.`);
  }
  const evidence = validateVerifiedReleaseEvidence(manifest.evidence);
  const expectedProvider = cloneProviderIdentifiers(evidence.target);
  if (canonicalJson(manifest.provider) !== canonicalJson(expectedProvider)) {
    throw artifactError("artifact manifest provider identifiers are not the fixed target identifiers.");
  }
  assertExactObjectFields(
    manifest.artifact,
    ["root", "fileCount", "totalBytes", "files"],
    "artifact inventory"
  );
  if (manifest.artifact.root !== "." || !Array.isArray(manifest.artifact.files)) {
    throw artifactError("artifact inventory root or file list is invalid.");
  }
  if (
    !Number.isSafeInteger(manifest.artifact.fileCount)
    || manifest.artifact.fileCount <= 0
    || manifest.artifact.fileCount !== manifest.artifact.files.length
  ) {
    throw artifactError("artifact inventory file count is invalid.");
  }
  let totalBytes = 0;
  let previousPath = "";
  const foldedPaths = new Set();
  for (const file of manifest.artifact.files) {
    assertExactObjectFields(file, ["path", "sha256", "size", "mode"], "artifact file");
    const normalizedPath = normalizeArtifactRelativePath(file.path);
    if (normalizedPath !== file.path || isSecretLikeArtifactPath(normalizedPath)) {
      throw artifactError(`artifact manifest contains a disallowed path: ${normalizedPath}.`);
    }
    if (previousPath && compareText(previousPath, normalizedPath) >= 0) {
      throw artifactError("artifact manifest file paths are not strictly sorted.");
    }
    previousPath = normalizedPath;
    const foldedPath = normalizedPath.toLocaleLowerCase("en-US");
    if (foldedPaths.has(foldedPath)) {
      throw artifactError(`artifact manifest paths collide by case: ${normalizedPath}.`);
    }
    foldedPaths.add(foldedPath);
    if (!SHA256_PATTERN.test(file.sha256)) {
      throw artifactError(`artifact file has an invalid digest: ${normalizedPath}.`);
    }
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      throw artifactError(`artifact file has an invalid size: ${normalizedPath}.`);
    }
    if (!Number.isSafeInteger(file.mode) || file.mode < 0 || file.mode > 0o777) {
      throw artifactError(`artifact file has an invalid mode: ${normalizedPath}.`);
    }
    totalBytes += file.size;
    if (!Number.isSafeInteger(totalBytes)) {
      throw artifactError("artifact inventory total size is invalid.");
    }
  }
  if (
    !Number.isSafeInteger(manifest.artifact.totalBytes)
    || manifest.artifact.totalBytes !== totalBytes
  ) {
    throw artifactError("artifact inventory total size does not match its files.");
  }
  assertExactObjectFields(
    manifest.integrity,
    ["algorithm", "canonicalization", "scope", "value"],
    "manifest integrity"
  );
  if (
    manifest.integrity.algorithm !== "sha256"
    || manifest.integrity.canonicalization !== "sorted-key-json-v1"
    || manifest.integrity.scope !== "manifest-without-integrity"
    || !SHA256_PATTERN.test(manifest.integrity.value)
  ) {
    throw artifactError("manifest integrity metadata is invalid.");
  }
  const { integrity: _integrity, ...body } = manifest;
  if (calculateManifestDigest(body) !== manifest.integrity.value) {
    throw artifactError("manifest integrity digest does not match its content.");
  }
  return Object.freeze({ evidence, digest: manifest.integrity.value });
}

function ensureRealDirectory(directory, fsImpl) {
  if (!fsImpl.existsSync(directory)) {
    fsImpl.mkdirSync(directory, { mode: 0o700 });
    return;
  }
  const stat = fsImpl.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw artifactError(`output directory is not a real directory: ${directory}.`);
  }
}

export function writeManifestAtomically(
  manifest,
  repositoryRoot,
  {
    fsImpl = fs,
    randomBytes = crypto.randomBytes
  } = {}
) {
  const validatedManifest = validateProductionArtifactManifest(manifest);
  const resolvedRepositoryRoot = validateAbsoluteDirectoryPath(repositoryRoot, "repositoryRoot");
  const repositoryStat = fsImpl.lstatSync(resolvedRepositoryRoot);
  if (
    repositoryStat.isSymbolicLink()
    || !repositoryStat.isDirectory()
    || fsImpl.realpathSync(resolvedRepositoryRoot) !== resolvedRepositoryRoot
  ) {
    throw artifactError("repositoryRoot must be a real directory, not a symlink.");
  }
  const artifactsDirectory = path.join(resolvedRepositoryRoot, "artifacts");
  const releaseDirectory = path.join(artifactsDirectory, "release");
  ensureRealDirectory(artifactsDirectory, fsImpl);
  ensureRealDirectory(releaseDirectory, fsImpl);

  const digest = validatedManifest.digest;
  const evidence = validatedManifest.evidence;
  const fileName = `${evidence.target}-${evidence.releaseSha}-${digest.slice(0, 16)}.manifest.json`;
  const outputPath = path.join(releaseDirectory, fileName);
  const json = `${JSON.stringify(canonicalize(manifest), null, 2)}\n`;
  if (fsImpl.existsSync(outputPath)) {
    const outputStat = fsImpl.lstatSync(outputPath);
    if (outputStat.isSymbolicLink() || !outputStat.isFile()) {
      throw artifactError("an immutable manifest path is not a regular file.");
    }
    if (fsImpl.readFileSync(outputPath, "utf8") !== json) {
      throw artifactError("an immutable manifest path already contains different content.");
    }
    return Object.freeze({ outputPath, json });
  }

  const randomValue = randomBytes(12);
  if (!Buffer.isBuffer(randomValue) || randomValue.length !== 12) {
    throw artifactError("the atomic-write random source returned an invalid value.");
  }
  const randomSuffix = randomValue.toString("hex");
  const temporaryPath = path.join(releaseDirectory, `.${fileName}.${process.pid}.${randomSuffix}.tmp`);
  let descriptor;
  try {
    descriptor = fsImpl.openSync(temporaryPath, "wx", 0o600);
    fsImpl.writeFileSync(descriptor, json, "utf8");
    fsImpl.fsyncSync(descriptor);
    fsImpl.closeSync(descriptor);
    descriptor = undefined;
    fsImpl.linkSync(temporaryPath, outputPath);
    fsImpl.unlinkSync(temporaryPath);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fsImpl.closeSync(descriptor);
      } catch {
        // Preserve the primary failure.
      }
    }
    try {
      if (fsImpl.existsSync(temporaryPath)) fsImpl.unlinkSync(temporaryPath);
    } catch {
      // Preserve the primary failure.
    }
    throw error;
  }
  return Object.freeze({ outputPath, json });
}

export function prepareProductionArtifact(
  {
    evidence,
    artifactRoot,
    repositoryRoot = ROOT
  },
  {
    env = process.env,
    fsImpl = fs,
    limits = PRODUCTION_ARTIFACT_LIMITS,
    randomBytes = crypto.randomBytes,
    beforeArtifactRead
  } = {}
) {
  // This must remain the first operation: no caller hook or filesystem access
  // is allowed while a provider credential is present.
  assertProviderCredentialsAbsent(env);
  const verifiedEvidence = validateVerifiedReleaseEvidence(evidence);
  if (beforeArtifactRead !== undefined) {
    if (typeof beforeArtifactRead !== "function") {
      throw artifactError("beforeArtifactRead must be a function when supplied.");
    }
    beforeArtifactRead();
  }
  const manifest = buildProductionArtifactManifest(
    { evidence: verifiedEvidence, artifactRoot },
    { fsImpl, limits }
  );
  const resolvedArtifactRoot = validateAbsoluteDirectoryPath(artifactRoot, "artifactRoot");
  const resolvedRepositoryRoot = validateAbsoluteDirectoryPath(repositoryRoot, "repositoryRoot");
  const prospectiveOutput = path.join(resolvedRepositoryRoot, "artifacts", "release");
  if (prospectiveOutput === resolvedArtifactRoot || pathIsInside(resolvedArtifactRoot, prospectiveOutput)) {
    throw artifactError("artifacts/release may not be inside artifactRoot.");
  }
  const written = writeManifestAtomically(manifest, resolvedRepositoryRoot, {
    fsImpl,
    randomBytes
  });
  return Object.freeze({ manifest, ...written });
}

export function parseProductionArtifactArgs(argv) {
  const allowed = new Set(["--evidence-file", "--artifact-root"]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name)) throw artifactError(`unknown argument ${name || "<blank>"}.`);
    if (values.has(name)) throw artifactError(`duplicate argument ${name}.`);
    if (!value || String(value).startsWith("--")) {
      throw artifactError(`${name} requires a value.`);
    }
    values.set(name, String(value));
  }
  for (const name of allowed) {
    if (!values.has(name)) throw artifactError(`${name} is required.`);
  }
  const evidenceFile = values.get("--evidence-file");
  const artifactRoot = values.get("--artifact-root");
  if (!path.isAbsolute(evidenceFile) || !path.isAbsolute(artifactRoot)) {
    throw artifactError("--evidence-file and --artifact-root must be absolute paths.");
  }
  return Object.freeze({ evidenceFile, artifactRoot });
}

async function main() {
  const args = parseProductionArtifactArgs(process.argv.slice(2));
  // Assert before reading even the caller-supplied evidence file.
  assertProviderCredentialsAbsent(process.env);
  let evidence;
  try {
    evidence = JSON.parse(fs.readFileSync(args.evidenceFile, "utf8"));
  } catch {
    throw artifactError("--evidence-file must contain valid JSON.");
  }
  const result = prepareProductionArtifact({
    evidence,
    artifactRoot: args.artifactRoot,
    repositoryRoot: ROOT
  });
  process.stdout.write(
    `Prepared ${result.manifest.evidence.target} artifact manifest ${result.manifest.integrity.value} at ${result.outputPath}.\n`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
