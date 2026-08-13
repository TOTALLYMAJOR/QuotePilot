#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROVIDER_CREDENTIAL_KEYS = [
  "FIREBASE_TOKEN",
  "VERCEL_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  "GOOGLE_CREDENTIALS"
];
const VERCEL_SOURCE_CONFIGURATION = Object.freeze({
  framework: "vite",
  git: Object.freeze({ deploymentEnabled: false }),
  buildCommand: "npm run check:env && npm run build",
  headers: Object.freeze([
    Object.freeze({
      source: "/(.*)",
      headers: Object.freeze([
        Object.freeze({ key: "X-Content-Type-Options", value: "nosniff" }),
        Object.freeze({ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" })
      ])
    })
  ]),
  rewrites: Object.freeze([
    Object.freeze({ source: "/(.*)", destination: "/index.html" })
  ])
});
const VERCEL_BUILD_OUTPUT_CONFIGURATION = Object.freeze({
  version: 3,
  routes: Object.freeze([
    Object.freeze({
      src: "/(.*)",
      headers: Object.freeze({
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin"
      }),
      continue: true
    }),
    Object.freeze({ handle: "filesystem" }),
    Object.freeze({ src: "/.*", dest: "/index.html" })
  ])
});
const VERCEL_PROJECT_CONFIGURATION = Object.freeze({
  projectId: "prj_epLi14LmBItwYkv25XZoAkWZf4Jk",
  orgId: "team_AW2QNNgYt5vESEO3eOTJXHp1",
  projectName: "quoteflow"
});
const FIREBASE_HOSTING_CONFIGURATION = Object.freeze({
  public: "dist",
  ignore: Object.freeze(["firebase.json", "**/.*", "**/node_modules/**"]),
  rewrites: Object.freeze([
    Object.freeze({ source: "**", destination: "/index.html" })
  ]),
  headers: Object.freeze([
    Object.freeze({
      source: "/index.html",
      headers: Object.freeze([
        Object.freeze({ key: "Cache-Control", value: "no-cache" })
      ])
    }),
    Object.freeze({
      source: "/assets/**",
      headers: Object.freeze([
        Object.freeze({ key: "Cache-Control", value: "public,max-age=31536000,immutable" })
      ])
    }),
    Object.freeze({
      source: "/brand/**",
      headers: Object.freeze([
        Object.freeze({ key: "Cache-Control", value: "public,max-age=86400" })
      ])
    }),
    Object.freeze({
      source: "/manifest.webmanifest",
      headers: Object.freeze([
        Object.freeze({ key: "Cache-Control", value: "public,max-age=3600" })
      ])
    }),
    Object.freeze({
      source: "/sw.js",
      headers: Object.freeze([
        Object.freeze({ key: "Cache-Control", value: "no-cache" })
      ])
    }),
    Object.freeze({
      source: "**",
      headers: Object.freeze([
        Object.freeze({ key: "X-Content-Type-Options", value: "nosniff" }),
        Object.freeze({ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" })
      ])
    })
  ])
});
const FIREBASE_FUNCTIONS_CONFIGURATION = Object.freeze({ source: "functions" });
const FIREBASE_SOURCE_FUNCTIONS_CONFIGURATION = Object.freeze([
  Object.freeze({ source: "functions", codebase: "default" }),
  Object.freeze({
    source: "functions-connect",
    codebase: "connect",
    ignore: Object.freeze([
      "node_modules",
      ".git",
      "firebase-debug.log",
      "firebase-debug.*.log"
    ])
  })
]);
const FIREBASE_FIRESTORE_CONFIGURATION = Object.freeze({
  rules: "firestore.rules",
  indexes: "firestore.indexes.json"
});
const FIREBASE_PROJECT_CONFIGURATION = Object.freeze({
  projects: Object.freeze({ default: "tonicatering" }),
  targets: Object.freeze({
    tonicatering: Object.freeze({
      hosting: Object.freeze({ app: Object.freeze(["tonicatering"]) })
    })
  })
});
const TARGETS = new Set([
  "firebase-hosting",
  "firebase-backend",
  "firebase-all",
  "vercel"
]);

function stageError(message) {
  return new Error(`Production payload staging rejected: ${message}`);
}

export function assertProviderCredentialsAbsent(env = process.env) {
  if (!env || (typeof env !== "object" && typeof env !== "function")) {
    throw stageError("the preparation environment is unavailable.");
  }
  const present = new Set(Object.keys(env).map((key) => String(key).toUpperCase()));
  const exposed = PROVIDER_CREDENTIAL_KEYS.filter((key) => present.has(key));
  if (exposed.length > 0) {
    throw stageError(`provider credentials must be absent (${exposed.join(", ")}).`);
  }
}

function assertSafeSourceEntry(source, relativePath) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    throw stageError(`symbolic links are not allowed (${relativePath}).`);
  }
  if (!stat.isDirectory() && !stat.isFile()) {
    throw stageError(`special filesystem entries are not allowed (${relativePath}).`);
  }
  const segments = relativePath.split("/");
  if (segments.some((segment) => /^\.env(?:\.|$)/i.test(segment))) {
    throw stageError(`runtime environment files are not allowed (${relativePath}).`);
  }
  if (segments.some((segment) => /(?:^|[._-])(?:id_rsa|private[-_]?key)(?:[._-]|$)/i.test(segment))) {
    throw stageError(`private-key-like files are not allowed (${relativePath}).`);
  }
  if (/\.(?:pem|p12|pfx|key)$/i.test(relativePath)) {
    throw stageError(`private-key-like files are not allowed (${relativePath}).`);
  }
  return stat;
}

function copyTree(source, destination, relativePath) {
  const stat = assertSafeSourceEntry(source, relativePath);
  if (stat.isFile()) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destination, stat.mode & 0o777);
    return;
  }

  fs.mkdirSync(destination, { recursive: true });
  const entries = fs.readdirSync(source, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    copyTree(
      path.join(source, entry.name),
      path.join(destination, entry.name),
      `${relativePath}/${entry.name}`
    );
  }
}

function validateTree(source, relativePath) {
  const stat = assertSafeSourceEntry(source, relativePath);
  if (!stat.isDirectory()) return;
  const entries = fs.readdirSync(source, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    validateTree(path.join(source, entry.name), `${relativePath}/${entry.name}`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateVercelSourceConfiguration(source) {
  let actual;
  try {
    actual = JSON.parse(fs.readFileSync(source, "utf8"));
  } catch {
    throw stageError("vercel.json must contain valid JSON.");
  }
  if (canonicalJson(actual) !== canonicalJson(VERCEL_SOURCE_CONFIGURATION)) {
    throw stageError("vercel.json no longer matches the reviewed Build Output translation policy.");
  }
}

function parseJsonFile(source, label) {
  try {
    const parsed = JSON.parse(fs.readFileSync(source, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed;
  } catch {
    throw stageError(`${label} must contain a JSON object.`);
  }
}

function validateFirebaseSourceConfiguration(source) {
  const actual = parseJsonFile(source, "firebase.json");
  const actualTopLevelFields = Object.keys(actual).sort();
  const expectedTopLevelFields = ["emulators", "firestore", "functions", "hosting"];
  if (canonicalJson(actualTopLevelFields) !== canonicalJson(expectedTopLevelFields)) {
    throw stageError("firebase.json contains an unreviewed top-level deployment field.");
  }
  if (canonicalJson(actual.functions) !== canonicalJson(FIREBASE_SOURCE_FUNCTIONS_CONFIGURATION)) {
    throw stageError("firebase.json Functions configuration no longer matches the reviewed policy.");
  }
  if (canonicalJson(actual.firestore) !== canonicalJson(FIREBASE_FIRESTORE_CONFIGURATION)) {
    throw stageError("firebase.json Firestore configuration no longer matches the reviewed policy.");
  }
  if (!Array.isArray(actual.hosting) || actual.hosting.length !== 2) {
    throw stageError("firebase.json must contain exactly the reviewed app and customer Hosting targets.");
  }
  const targets = new Map();
  for (const entry of actual.hosting) {
    const target = String(entry?.target || "");
    if (targets.has(target)) {
      throw stageError(`firebase.json contains a duplicate Hosting target (${target || "<blank>"}).`);
    }
    targets.set(target, entry);
  }
  for (const target of ["app", "customer"]) {
    const expected = { target, ...FIREBASE_HOSTING_CONFIGURATION };
    if (canonicalJson(targets.get(target)) !== canonicalJson(expected)) {
      throw stageError(`firebase.json ${target} Hosting configuration no longer matches the reviewed policy.`);
    }
  }
}

function firebaseDeploymentConfiguration(target) {
  const configuration = {};
  if (target === "firebase-backend" || target === "firebase-all") {
    configuration.functions = FIREBASE_FUNCTIONS_CONFIGURATION;
    configuration.firestore = FIREBASE_FIRESTORE_CONFIGURATION;
  }
  if (target === "firebase-hosting" || target === "firebase-all") {
    configuration.hosting = [{ target: "app", ...FIREBASE_HOSTING_CONFIGURATION }];
  }
  return configuration;
}

function writeGeneratedJson(destination, value) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o644,
    flag: "wx"
  });
}

function assertSafeOutputPath(root, output) {
  const rootStat = fs.lstatSync(root);
  if (
    !rootStat.isDirectory()
    || rootStat.isSymbolicLink()
    || fs.realpathSync(root) !== root
  ) {
    throw stageError("the repository root must be a real directory.");
  }
  const relativeOutput = path.relative(root, output);
  if (!relativeOutput || relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput)) {
    throw stageError("the payload output must remain inside the repository root.");
  }
  let cursor = root;
  for (const segment of relativeOutput.split(path.sep)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) continue;
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw stageError(`payload output ancestors must be real directories (${path.relative(root, cursor)}).`);
    }
  }
}

function requireRegularFile(root, relativePath) {
  const source = path.join(root, ...relativePath.split("/"));
  let stat;
  try {
    stat = assertSafeSourceEntry(source, relativePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw stageError(`required artifact input is missing (${relativePath}).`);
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw stageError(`required artifact input is not a file (${relativePath}).`);
  }
  return source;
}

function listFunctionsInputs(root) {
  const functionsRoot = path.join(root, "functions");
  if (!fs.existsSync(functionsRoot)) {
    throw stageError("required artifact input is missing (functions).");
  }
  const functionsStat = assertSafeSourceEntry(functionsRoot, "functions");
  if (!functionsStat.isDirectory()) {
    throw stageError("required artifact input is not a directory (functions).");
  }
  const inputs = [];
  for (const entry of fs.readdirSync(functionsRoot, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".gitignore" || entry.name === ".env.example") {
      continue;
    }
    if (/^\.env(?:\.|$)/i.test(entry.name)) {
      throw stageError(`runtime environment files are not allowed (functions/${entry.name}).`);
    }
    if (entry.name === "data" && entry.isDirectory()) {
      const dataRoot = path.join(functionsRoot, entry.name);
      const dataEntries = fs.readdirSync(dataRoot, { withFileTypes: true });
      for (const dataEntry of dataEntries) {
        const relativePath = `functions/data/${dataEntry.name}`;
        const source = path.join(dataRoot, dataEntry.name);
        const stat = assertSafeSourceEntry(source, relativePath);
        if (
          dataEntry.name !== "starterCatalogPacks.json"
          || !dataEntry.isFile()
          || !stat.isFile()
        ) {
          throw stageError(`unapproved Functions artifact input (${relativePath}).`);
        }
        inputs.push(relativePath);
      }
      if (!inputs.includes("functions/data/starterCatalogPacks.json")) {
        throw stageError("required artifact input is missing (functions/data/starterCatalogPacks.json).");
      }
      continue;
    }
    if (!entry.isFile() || (!entry.name.endsWith(".js") && !/^package(?:-lock)?\.json$/.test(entry.name))) {
      throw stageError(`unapproved Functions artifact input (functions/${entry.name}).`);
    }
    inputs.push(`functions/${entry.name}`);
  }
  for (const required of [
    "functions/index.js",
    "functions/package.json",
    "functions/package-lock.json",
    "functions/data/starterCatalogPacks.json"
  ]) {
    if (!inputs.includes(required)) {
      throw stageError(`required artifact input is missing (${required}).`);
    }
  }
  return inputs.sort();
}

function resolvePayloadOutput(root, target, outputValue) {
  const payloadRoot = path.join(root, "artifacts", "release", "payload");
  const expected = path.join(payloadRoot, target);
  const output = outputValue ? path.resolve(root, outputValue) : expected;
  if (output !== expected) {
    throw stageError(`--output must resolve to artifacts/release/payload/${target}.`);
  }
  return output;
}

export function stageProductionPayload(
  { target, root = ROOT, output: outputValue },
  { env = process.env } = {}
) {
  assertProviderCredentialsAbsent(env);
  if (!TARGETS.has(target)) {
    throw stageError("target must be firebase-hosting, firebase-backend, firebase-all, or vercel.");
  }
  const canonicalRoot = path.resolve(root);
  const output = resolvePayloadOutput(canonicalRoot, target, outputValue);
  assertSafeOutputPath(canonicalRoot, output);

  const inputs = [];
  if (target.startsWith("firebase-")) {
    inputs.push("firebase.json");
    if (target === "firebase-backend" || target === "firebase-all") {
      inputs.push("firestore.indexes.json", "firestore.rules", ...listFunctionsInputs(canonicalRoot));
    }
    if (target === "firebase-hosting" || target === "firebase-all") inputs.push("dist");
  } else {
    inputs.push("dist", "vercel.json");
  }

  const resolvedInputs = inputs.map((relativePath) => {
    const source = path.join(canonicalRoot, ...relativePath.split("/"));
    if (!fs.existsSync(source)) {
      throw stageError(`required artifact input is missing (${relativePath}).`);
    }
    if (relativePath !== "dist") requireRegularFile(canonicalRoot, relativePath);
    validateTree(source, relativePath);
    return { relativePath, source };
  });

  const distInput = resolvedInputs.find(({ relativePath }) => relativePath === "dist");
  if (distInput && !fs.lstatSync(distInput.source).isDirectory()) {
    throw stageError("required artifact input is not a directory (dist).");
  }
  if (target === "vercel") {
    validateVercelSourceConfiguration(requireRegularFile(canonicalRoot, "vercel.json"));
  } else {
    validateFirebaseSourceConfiguration(requireRegularFile(canonicalRoot, "firebase.json"));
  }

  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  for (const { relativePath, source } of resolvedInputs) {
    if (target === "vercel" && relativePath === "vercel.json") continue;
    if (target.startsWith("firebase-") && relativePath === "firebase.json") continue;
    const destinationPath = target === "vercel" && relativePath === "dist"
      ? ".vercel/output/static"
      : relativePath;
    copyTree(
      source,
      path.join(output, ...destinationPath.split("/")),
      relativePath
    );
  }
  if (target === "vercel") {
    const configurationPath = path.join(output, ".vercel", "output", "config.json");
    fs.mkdirSync(path.dirname(configurationPath), { recursive: true });
    writeGeneratedJson(configurationPath, VERCEL_BUILD_OUTPUT_CONFIGURATION);
    writeGeneratedJson(
      path.join(output, ".vercel", "project.json"),
      VERCEL_PROJECT_CONFIGURATION
    );
  } else {
    writeGeneratedJson(path.join(output, ".firebaserc"), FIREBASE_PROJECT_CONFIGURATION);
    writeGeneratedJson(path.join(output, "firebase.json"), firebaseDeploymentConfiguration(target));
  }

  return Object.freeze({
    target,
    output,
    inputs: Object.freeze([...inputs].sort())
  });
}

function parseCliArgs(argv) {
  const values = new Map();
  const allowed = new Set(["--target", "--output"]);
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name)) throw stageError(`unknown argument ${name || "<blank>"}.`);
    if (values.has(name)) throw stageError(`duplicate argument ${name}.`);
    if (!value || String(value).startsWith("--")) throw stageError(`${name} requires a value.`);
    values.set(name, String(value).trim());
  }
  if (!values.has("--target")) throw stageError("--target is required.");
  return {
    target: values.get("--target"),
    output: values.get("--output")
  };
}

const isDirectExecution = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  const result = stageProductionPayload(parseCliArgs(process.argv.slice(2)));
  process.stdout.write(`Production payload staged at ${result.output}.\n`);
}
