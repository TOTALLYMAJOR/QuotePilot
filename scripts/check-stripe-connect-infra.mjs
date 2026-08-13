#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INFRA = path.join(ROOT, "infra", "stripe-connect");

function fail(message) {
  throw new Error(`Stripe Connect infrastructure check failed: ${message}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function requireText(source, snippet, label) {
  if (!source.includes(snippet)) fail(`${label} is missing ${JSON.stringify(snippet)}.`);
}

function rejectText(source, pattern, label) {
  if (pattern.test(source)) fail(`${label} contains prohibited material matching ${pattern}.`);
}

const requiredFiles = [
  "infra/stripe-connect/README.md",
  "infra/stripe-connect/bootstrap/staging/main.tf",
  "infra/stripe-connect/environments/staging/main.tf",
  "infra/stripe-connect/environments/staging/staging.tfbackend",
  "infra/stripe-connect/modules/foundation/main.tf",
  "infra/stripe-connect/modules/foundation/iam.tf",
  "infra/stripe-connect/modules/foundation/network.tf",
  "infra/stripe-connect/modules/foundation/secrets.tf",
  "firebase.connect.staging.json",
  "firestore.connect-control.rules",
  "firestore.connect-control.indexes.json"
];

for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(ROOT, relativePath))) fail(`${relativePath} is required.`);
}

const terraformFiles = fs.readdirSync(INFRA, { recursive: true })
  .filter((entry) => String(entry).endsWith(".tf"))
  .map((entry) => path.join(INFRA, String(entry)));
if (terraformFiles.length < 10) fail("the staging module/root/bootstrap inventory is incomplete.");

const terraformSource = terraformFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
const rootVariables = read("infra/stripe-connect/environments/staging/variables.tf");
const stagingValues = read("infra/stripe-connect/environments/staging/staging.auto.tfvars.json");
const iam = read("infra/stripe-connect/modules/foundation/iam.tf");
const network = read("infra/stripe-connect/modules/foundation/network.tf");
const secrets = read("infra/stripe-connect/modules/foundation/secrets.tf");
const database = read("infra/stripe-connect/modules/foundation/main.tf");

for (const exact of [
  'required_version = "= 1.15.8"',
  'version = "= 7.41.0"',
  'var.project_id == "quotepilot-staging-20260804"',
  'var.project_number == "844470813106"',
  'var.github_repository_id == "1167899098"',
  'var.github_repository_owner_id == "7169661"',
  'var.app_check_registration_enabled == false'
]) requireText(`${terraformSource}\n${rootVariables}`, exact, "Terraform staging contract");

requireText(stagingValues, '"app_check_registration_enabled": false', "staging values");
requireText(database, 'name                              = var.database_id', "named database");
requireText(database, 'delete_protection_state           = "DELETE_PROTECTION_ENABLED"', "database protection");
requireText(database, 'prevent_destroy = true', "database protection");
requireText(iam, 'expression  = "resource.name == \'${local.database_resource_name}\'"', "per-database IAM");
requireText(iam, "assertion.repository_id ==", "GitHub OIDC condition");
requireText(iam, "assertion.repository_owner_id ==", "GitHub OIDC condition");
requireText(iam, "assertion.environment ==", "GitHub OIDC condition");
requireText(iam, 'roles/firebaseappcheck.tokenVerifier', "App Check verifier grant");
requireText(network, 'nat_ip_allocate_option             = "MANUAL_ONLY"', "fixed egress");
requireText(network, 'source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"', "fixed egress");
requireText(secrets, 'resource "google_secret_manager_secret" "connect"', "secret containers");
requireText(secrets, 'roles/secretmanager.secretAccessor', "secret access policy");

rejectText(terraformSource, /google_secret_manager_secret_version/, "Terraform source");
rejectText(terraformSource, /(?:sk_live_|sk_test_|rk_live_|rk_test_|whsec_)/, "Terraform source");
rejectText(terraformSource, /tonicatering/, "staging Terraform source");
if (fs.existsSync(path.join(INFRA, "environments", "production"))) {
  fail("production infrastructure must remain absent until separately authorized.");
}

const firebase = JSON.parse(read("firebase.connect.staging.json"));
if (firebase.functions?.length !== 1 || firebase.functions[0]?.codebase !== "connect") {
  fail("the staging Firebase config may deploy only the connect codebase.");
}
if (firebase.firestore?.length !== 1 || firebase.firestore[0]?.database !== "connect-control") {
  fail("the staging Firebase config may target only connect-control rules.");
}
if (firebase.emulators?.firestore?.port !== 8280) {
  fail("the isolated Connect rules emulator must retain its dedicated port.");
}
if (firebase.hosting || JSON.stringify(firebase).includes("functions:default")) {
  fail("the staging Connect config must not select hosting or the default Functions codebase.");
}

const denyRules = read("firestore.connect-control.rules");
requireText(denyRules, "allow read, write: if false;", "client-deny rules");

const dependabot = read(".github/dependabot.yml");
for (const dependencyRoot of [
  'directory: "/functions"',
  'directory: "/functions-connect"',
  'directory: "/infra/stripe-connect/bootstrap/staging"',
  'directory: "/infra/stripe-connect/environments/staging"'
]) requireText(dependabot, dependencyRoot, "dependency inventory");

const workflow = read(".github/workflows/stripe-connect-infra-validation.yml");
requireText(workflow, "terraform fmt -check -recursive infra/stripe-connect", "infra validation workflow");
requireText(workflow, "init -backend=false", "infra validation workflow");
rejectText(workflow, /terraform\s+apply/, "infra validation workflow");
rejectText(workflow, /id-token:\s*write/, "infra validation workflow");

console.log("Stripe Connect staging infrastructure source is isolated, secret-free, keyless, and apply-disabled.");
