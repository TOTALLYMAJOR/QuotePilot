import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CONTRACT_PATH = path.join("docs", "task-orchestration-contracts.json");
const RISK_ORDER = Object.freeze({ low: 0, medium: 1, high: 2 });

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function runGit(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

export function listWorkingTreeFiles(root = process.cwd()) {
  const outputs = [
    runGit(root, ["diff", "--name-only", "--diff-filter=ACMR"]),
    runGit(root, ["diff", "--name-only", "--cached", "--diff-filter=ACMR"]),
    runGit(root, ["ls-files", "--others", "--exclude-standard"])
  ];
  return unique(outputs.flatMap((output) => output.split(/\r?\n/).map(normalizePath))).sort();
}

export function loadTaskContract(root = process.cwd()) {
  return JSON.parse(fs.readFileSync(path.join(root, CONTRACT_PATH), "utf8"));
}

function hasTaskKeyword(task, keywords = []) {
  const normalized = String(task || "").toLowerCase();
  return keywords.some((keyword) => normalized.includes(String(keyword).toLowerCase()));
}

function hasPath(files, { exact = [], prefixes = [] } = {}) {
  return files.some((file) => exact.includes(file) || prefixes.some((prefix) => file.startsWith(prefix)));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findTaskSignals(task, keywords = []) {
  const normalized = String(task || "").toLowerCase();
  return keywords.filter((keyword) => {
    const signal = String(keyword || "").trim().toLowerCase();
    if (!signal) return false;
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(signal)}([^a-z0-9]|$)`, "i").test(normalized);
  });
}

function pathMatchesRule(file, { exactPaths = [], pathPrefixes = [], pathFragments = [] } = {}) {
  const normalized = normalizePath(file).toLowerCase();
  return exactPaths.some((candidate) => normalized === normalizePath(candidate).toLowerCase())
    || pathPrefixes.some((prefix) => normalized.startsWith(normalizePath(prefix).toLowerCase()))
    || pathFragments.some((fragment) => normalized.includes(String(fragment).toLowerCase()));
}

function emptyDomainClassification(routing, matchedSignals = {}) {
  return {
    applicable: false,
    contexts: [routing?.noneContext || "none"],
    matchedSignals: {
      executionProfile: matchedSignals.executionProfile || "",
      task: matchedSignals.task || [],
      paths: matchedSignals.paths || [],
      exclusions: matchedSignals.exclusions || []
    },
    authorityReads: [],
    referenceSlices: []
  };
}

export function classifyDomainContexts({ task, files = [], profile, contract }) {
  const routing = contract?.domainRouting;
  if (!routing?.skill || !routing?.contexts) {
    return emptyDomainClassification(routing, {
      executionProfile: profile,
      exclusions: ["domain-routing-contract-unavailable"]
    });
  }

  const mechanicalSignals = findTaskSignals(task, routing.mechanicalTaskKeywords);
  if (mechanicalSignals.length) {
    return emptyDomainClassification(routing, {
      executionProfile: profile,
      exclusions: mechanicalSignals.map((signal) => `mechanical:${signal}`)
    });
  }

  const eligibleFiles = files.filter((file) => !pathMatchesRule(file, {
    exactPaths: routing.excludedExactPaths,
    pathPrefixes: routing.excludedPathPrefixes,
    pathFragments: routing.excludedPathFragments
  }));
  if (files.length && !eligibleFiles.length) {
    return emptyDomainClassification(routing, {
      executionProfile: profile,
      exclusions: ["all-owned-paths-are-domain-routing-exclusions"]
    });
  }

  const contexts = [];
  const taskSignals = [];
  const pathSignals = [];
  const authorityReads = [];
  const referenceSlices = [...(routing.baseReferenceSlices || [])];

  for (const contextId of routing.contextOrder || Object.keys(routing.contexts)) {
    const context = routing.contexts[contextId];
    if (!context) continue;
    const matchedTaskKeywords = findTaskSignals(task, context.taskKeywords);
    const matchedPaths = eligibleFiles.filter((file) => pathMatchesRule(file, context));
    if (!matchedTaskKeywords.length && !matchedPaths.length) continue;

    contexts.push(contextId);
    taskSignals.push(...matchedTaskKeywords.map((signal) => `${contextId}:${signal}`));
    pathSignals.push(...matchedPaths.map((file) => `${contextId}:${file}`));
    authorityReads.push(...(context.authorityReads || []));
    referenceSlices.push(...(context.referenceSlices || []));
  }

  if (!contexts.length) {
    return emptyDomainClassification(routing, { executionProfile: profile });
  }

  const failureRule = routing.failureReferenceRule || {};
  const failureSignals = findTaskSignals(task, failureRule.taskKeywords);
  if (failureSignals.length) {
    taskSignals.push(...failureSignals.map((signal) => `failure_pattern:${signal}`));
    referenceSlices.push(...(failureRule.referenceSlices || []));
  }

  return {
    applicable: true,
    contexts: unique(contexts),
    matchedSignals: {
      executionProfile: profile,
      task: unique(taskSignals),
      paths: unique(pathSignals),
      exclusions: []
    },
    authorityReads: unique(authorityReads),
    referenceSlices: unique(referenceSlices)
  };
}

function inferProfile(task, files) {
  const lowerTask = String(task || "").toLowerCase();
  const allMarkdown = files.length > 0 && files.every((file) => file.toLowerCase().endsWith(".md"));
  const deploy = hasTaskKeyword(lowerTask, ["deploy", "production release", "release candidate"])
    || hasPath(files, {
      exact: ["firebase.json", "vercel.json", "Dockerfile", "docker-compose.yml"],
      prefixes: [".github/workflows/deploy-", "docker/"]
    });
  if (deploy) return "deploy";

  const authRules = hasTaskKeyword(lowerTask, ["auth", "authorization", "firestore rules", "role authority", "tenant isolation"])
    || hasPath(files, {
      exact: [
        "firestore.rules",
        "firestore.indexes.json",
        "src/lib/authClient.js",
        "src/lib/firebase.js",
        "src/hooks/useAuthSession.js"
      ]
    });
  if (authRules) return "auth_rules";

  const process = hasTaskKeyword(lowerTask, ["agent", "governance", "orchestration", "workflow", "model routing"])
    || hasPath(files, {
      exact: ["AGENTS.md", "CONTRIBUTING.md", "docs/AGENT_GOVERNANCE.md", "docs/VERSION_CONTROL.md"],
      prefixes: [".codex/skills/", ".github/", "scripts/"]
    });
  if (process) return "process";

  const ui = hasTaskKeyword(lowerTask, [
    "ui",
    "layout",
    "responsive",
    "off screen",
    "modal",
    "composer",
    "navigation",
    "dashboard",
    "workspace"
  ])
    || hasPath(files, { prefixes: ["src/components/", "src/styles/"] })
    || files.includes("src/styles.css");
  if (ui) return "ui";
  if (allMarkdown || (!files.length && hasTaskKeyword(lowerTask, ["docs", "documentation", "copy edit"]))) return "docs";
  return "core";
}

function mergeDocRequirements(base = [], extra = []) {
  const keyed = new Map();
  for (const requirement of [...base, ...extra]) {
    const normalized = {
      mode: requirement.mode,
      paths: unique(requirement.paths || []).sort()
    };
    keyed.set(`${normalized.mode}:${normalized.paths.join("|")}`, normalized);
  }
  return [...keyed.values()];
}

function buildTaskGraph(plan, { expertiseEvaluationRequired = false } = {}) {
  const graph = [
    {
      id: "discover",
      dependsOn: [],
      outputs: [
        "bounded file scope",
        "execution classification",
        "domain classification",
        "model recommendation"
      ]
    },
    {
      id: "form_provisional_action",
      dependsOn: ["discover"],
      outputs: [
        "reconstructed user objective",
        "provisional intended action from repository authority and current implementation"
      ]
    },
    {
      id: "domain_reconsideration",
      dependsOn: ["form_provisional_action"],
      outputs: plan.domainClassification.applicable
        ? [
          ...plan.domainClassification.referenceSlices,
          "RETAIN | REFINE | REPLACE | EXPAND | BOUND | NO_MATERIAL_EFFECT"
        ]
        : ["NO_MATERIAL_EFFECT"]
    },
    {
      id: "implement",
      dependsOn: ["domain_reconsideration"],
      outputs: plan.files.length ? plan.files : ["explicit owned paths before editing"]
    },
    {
      id: "governance",
      dependsOn: ["implement"],
      outputs: plan.dependencies.docRequirements.length
        ? plan.dependencies.docRequirements.map((requirement) => `${requirement.mode}: ${requirement.paths.join(", ")}`)
        : ["no additional canonical document required by this profile"]
    },
    {
      id: "verify",
      dependsOn: ["implement", "governance"],
      outputs: plan.dependencies.validations
    }
  ];
  if (expertiseEvaluationRequired) {
    graph.push({
      id: "expertise_eval",
      dependsOn: ["verify"],
      outputs: [
        "fresh-agent catering-domain reconsideration scorecard",
        "human acceptance recorded separately from deterministic proof"
      ]
    });
  }
  return graph;
}

export function buildTaskPlan({
  task,
  files = [],
  requestedRisk = "",
  phase = "plan",
  now = new Date(),
  contract,
  env = process.env
}) {
  if (!String(task || "").trim()) throw new Error("A non-empty task description is required.");
  const normalizedFiles = unique(files.map(normalizePath)).sort();
  const selectedContract = contract || loadTaskContract();
  const normalizedPhase = String(phase || "").toLowerCase();
  if (!selectedContract.lifecyclePhases?.includes(normalizedPhase)) {
    throw new Error(`Unsupported lifecycle phase: ${phase}`);
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error("A valid lifecycle timestamp is required.");
  }
  const profileId = inferProfile(task, normalizedFiles);
  const profile = selectedContract.profiles?.[profileId];
  if (!profile) throw new Error(`Task contract is missing profile: ${profileId}`);
  const domainClassification = classifyDomainContexts({
    task,
    files: normalizedFiles,
    profile: profileId,
    contract: selectedContract
  });

  const escalation = selectedContract.highRiskEscalation || {};
  const highRiskSignal = hasTaskKeyword(task, escalation.taskKeywords)
    || hasPath(normalizedFiles, {
      exact: escalation.exactPaths,
      prefixes: escalation.pathPrefixes
    });
  const explicitRisk = String(requestedRisk || "").toLowerCase();
  if (explicitRisk && !(explicitRisk in RISK_ORDER)) {
    throw new Error(`Unsupported risk level: ${requestedRisk}`);
  }
  const inferredRisk = highRiskSignal ? "high" : profile.riskLevel;
  const riskLevel = explicitRisk && RISK_ORDER[explicitRisk] > RISK_ORDER[inferredRisk]
    ? explicitRisk
    : inferredRisk;
  const modelTier = riskLevel === "high" ? "frontier" : profile.modelTier;
  const tier = selectedContract.modelTiers?.[modelTier];
  if (!tier) throw new Error(`Task contract is missing model tier: ${modelTier}`);
  const envKey = `TASK_MODEL_${modelTier.toUpperCase()}`;

  const capabilityDocs = highRiskSignal && hasPath(normalizedFiles, {
    prefixes: ["functions/", "functions-connect/"],
    exact: ["firestore.rules", "firestore.indexes.json", "src/lib/quoteStore.js"]
  })
    ? [{
      mode: "all",
      paths: [
        "CHANGELOG.md",
        "docs/capability-surfacing-contracts.json",
        "docs/FEATURE_MATRIX.md",
        "docs/USER_MANUAL.md"
      ]
    }]
    : [];

  const plan = {
    schemaVersion: selectedContract.schemaVersion,
    task: String(task).trim(),
    files: normalizedFiles,
    lifecycle: {
      phase: normalizedPhase,
      recordedAt: now.toISOString(),
      timestampFormat: selectedContract.timestampFormat
    },
    classification: {
      profile: profileId,
      riskLevel,
      highRiskSignal
    },
    domainClassification,
    modelRouting: {
      tier: modelTier,
      selectedModel: String(env[envKey] || tier.defaultModel),
      reasoningEffort: tier.reasoningEffort,
      switchAuthority: selectedContract.switchAuthority,
      environmentOverride: envKey,
      rationale: tier.purpose
    },
    dependencies: {
      requiredSkills: unique([
        ...(profile.requiredSkills || []),
        ...(domainClassification.applicable ? [selectedContract.domainRouting.skill] : [])
      ]),
      readFirst: unique([
        ...(profile.readFirst || []),
        ...domainClassification.authorityReads
      ]),
      docRequirements: mergeDocRequirements(profile.docRequirements, capabilityDocs),
      validations: unique(profile.validations)
    }
  };
  const expertiseEvaluationRequired = hasPath(normalizedFiles, {
    exact: selectedContract.domainRouting?.agentBehaviorExactPaths,
    prefixes: selectedContract.domainRouting?.agentBehaviorPathPrefixes
  });
  plan.taskGraph = buildTaskGraph(plan, { expertiseEvaluationRequired });
  return plan;
}

function parseArgs(argv) {
  const parsed = { task: "", files: [], requestedRisk: "", phase: "plan", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (["--task", "--file", "--files", "--risk", "--phase"].includes(token)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${token} requires a value.`);
      index += 1;
      if (token === "--task") parsed.task = value;
      else if (token === "--risk") parsed.requestedRisk = value;
      else if (token === "--phase") parsed.phase = value;
      else parsed.files.push(...value.split(","));
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return parsed;
}

function formatText(plan) {
  const docLines = plan.dependencies.docRequirements.length
    ? plan.dependencies.docRequirements.map((item) => `  - ${item.mode}: ${item.paths.join(", ")}`)
    : ["  - none"];
  return [
    "Task orchestration plan",
    `- phase: ${plan.lifecycle.phase}`,
    `- recorded_at: ${plan.lifecycle.recordedAt}`,
    `- profile: ${plan.classification.profile}`,
    `- risk: ${plan.classification.riskLevel}`,
    `- domain_applicable: ${plan.domainClassification.applicable}`,
    `- domain_contexts: ${plan.domainClassification.contexts.join(", ")}`,
    `- model: ${plan.modelRouting.selectedModel} (${plan.modelRouting.tier}, ${plan.modelRouting.reasoningEffort})`,
    `- switch_authority: ${plan.modelRouting.switchAuthority}`,
    `- files: ${plan.files.length ? plan.files.join(", ") : "working tree auto-detection"}`,
    "- required_skills:",
    ...(plan.dependencies.requiredSkills.length
      ? plan.dependencies.requiredSkills.map((item) => `  - ${item}`)
      : ["  - none"]),
    "- domain_reference_slices:",
    ...(plan.domainClassification.referenceSlices.length
      ? plan.domainClassification.referenceSlices.map((item) => `  - ${item}`)
      : ["  - none"]),
    "- read_first:",
    ...plan.dependencies.readFirst.map((item) => `  - ${item}`),
    "- required_docs:",
    ...docLines,
    "- validations:",
    ...plan.dependencies.validations.map((item) => `  - ${item}`)
  ].join("\n");
}

function main() {
  const root = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  const files = args.files.length ? args.files : listWorkingTreeFiles(root);
  const plan = buildTaskPlan({
    task: args.task,
    files,
    requestedRisk: args.requestedRisk,
    phase: args.phase,
    contract: loadTaskContract(root)
  });
  console.log(args.json ? JSON.stringify(plan, null, 2) : formatText(plan));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(`Task orchestration plan failed: ${error.message}`);
    process.exit(1);
  }
}
