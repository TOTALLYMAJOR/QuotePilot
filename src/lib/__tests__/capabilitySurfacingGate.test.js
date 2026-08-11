import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  MANIFEST_PATH,
  REQUIRED_MUTATION_STATES,
  REQUIRED_READ_STATES,
  REQUIRED_USER_STATES,
  findBackendDeliveryPaths,
  hasDirectClientAuthoritySignals,
  isBackendDeliveryPath,
  parseFunctionExports,
  parseFunctionExportSegments,
  resolveDiffBaseRevision,
  resolveDiffRange,
  validateDiffRange,
  validateCapabilitySurfacing
} from "../../../scripts/check-capability-surfacing.mjs";

const backendPath = "functions/exampleCapability.js";
const frontendPath = "src/components/ExampleCapabilityView.jsx";
const testPath = "src/components/__tests__/exampleCapability.test.jsx";
const packageJson = JSON.parse(
  fs.readFileSync(new URL("../../../package.json", import.meta.url), "utf8")
);
const laneSource = fs.readFileSync(
  new URL("../../../scripts/orchestration-lanes.sh", import.meta.url),
  "utf8"
);
const secretGateSource = fs.readFileSync(
  new URL("../../../scripts/check-secret-assets.mjs", import.meta.url),
  "utf8"
);
const functionsEntrypointSource = fs.readFileSync(
  new URL("../../../functions/index.js", import.meta.url),
  "utf8"
);

function fakeGit({ refs = {}, diffError = null, mergeBase = "" } = {}) {
  const calls = [];
  const runGitCommand = (args, { allowFailure = false } = {}) => {
    calls.push([...args]);
    if (args[0] === "rev-parse" && args.includes("--verify")) {
      const requested = String(args.at(-1) || "").replace(/\^\{commit\}$/, "");
      const resolved = refs[requested]
        || (/^[0-9a-f]{40,64}$/i.test(requested) ? requested : "");
      if (resolved) return resolved;
      if (allowFailure) return "";
      throw new Error(`unknown ref ${requested}`);
    }
    if (
      args[0] === "rev-parse"
      && args.includes("--abbrev-ref")
      && args.includes("@{upstream}")
    ) {
      return refs["@{upstream}"] || "";
    }
    if (args[0] === "diff") {
      if (diffError) throw diffError;
      return "";
    }
    if (args[0] === "merge-base") {
      if (mergeBase) return mergeBase;
      throw new Error("merge base unavailable");
    }
    throw new Error(`unexpected git command: ${args.join(" ")}`);
  };
  return { calls, runGitCommand };
}

function withGitHubEvent(payload, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "capability-surfacing-"));
  const eventPath = path.join(directory, "event.json");
  fs.writeFileSync(eventPath, JSON.stringify(payload));
  try {
    return callback(eventPath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function userContract(overrides = {}) {
  const capabilityKind = overrides.capabilityKind || "read_surface";
  const requiredStates = capabilityKind === "mutation_surface"
    ? REQUIRED_MUTATION_STATES
    : capabilityKind === "mixed_surface" ? REQUIRED_USER_STATES : REQUIRED_READ_STATES;
  return {
    id: "example-capability",
    reviewRevision: 2,
    status: "active",
    deliveryType: "user_relevant",
    capabilityKind,
    audiences: ["staff"],
    summary: "A user-facing example capability with a discoverable and tested staff surface.",
    backendPaths: [backendPath],
    backendExports: ["functions/exampleCapability.js#getExampleCapability"],
    frontendPaths: [frontendPath],
    entryPointLocators: [{ path: frontendPath, locator: "Example capability route" }],
    testPaths: [testPath],
    testLocators: [{ path: testPath, locator: "opens the example capability" }],
    documentationPaths: ["docs/FEATURE_MATRIX.md", "docs/USER_MANUAL.md"],
    documentationLocators: [
      { path: "docs/FEATURE_MATRIX.md", locator: "Example capability matrix row" },
      { path: "docs/USER_MANUAL.md", locator: "## Example capability" }
    ],
    surfaceReview: "changed",
    surfaceReviewNote: "The frontend and browser path were reviewed with the backend delivery.",
    stateEvidence: requiredStates.map((state) => ({
      state,
      path: testPath,
      locator: `renders the example ${state} state`,
      assertionLocator: `data-capability-state="${state}"`
    })),
    stateExceptions: {},
    safeOutcome: "Staff receive the safe operational result without private provider data.",
    ...overrides
  };
}

function readFixturePath() {
  return [
    "Example capability route",
    'test("opens the example capability", () => { expect(true).toBe(true); });',
    ...REQUIRED_USER_STATES.map((state) => (
      `test("renders the example ${state} state", () => { expect(markup).toContain('data-capability-state="${state}"'); });`
    )),
    "Example capability matrix row",
    "## Example capability",
    'test("denies private claim projection", () => { expect(true).toBe(true); });',
    "Private claim integrity"
  ].join("\n");
}

function manifest(contract = userContract(), catalogVersion = 2) {
  return { schemaVersion: 1, catalogVersion, contracts: [contract] };
}

function changedFiles(extra = []) {
  return [
    backendPath,
    MANIFEST_PATH,
    frontendPath,
    testPath,
    "docs/FEATURE_MATRIX.md",
    "docs/USER_MANUAL.md",
    ...extra
  ];
}

describe("capability surfacing delivery gate", () => {
  test("is mechanically required by lane:core", () => {
    expect(packageJson.scripts["check:capability-surfaces"]).toBe(
      "node ./scripts/check-capability-surfacing.mjs"
    );
    const coreLane = laneSource.slice(
      laneSource.indexOf("  lane:core)"),
      laneSource.indexOf("  lane:firebase-auth-rules)")
    );
    expect(coreLane).toContain("npm run check:capability-surfaces");
    expect(secretGateSource).toContain("docs/capability-surfacing-contracts.json");
  });

  test("recognizes backend authority and data paths without treating tests as delivery", () => {
    expect(isBackendDeliveryPath("functions/index.js")).toBe(true);
    expect(isBackendDeliveryPath("firestore.rules")).toBe(true);
    expect(isBackendDeliveryPath("src/lib/quoteStore.js")).toBe(true);
    expect(isBackendDeliveryPath("scripts/backfill-customer-ids.mjs")).toBe(true);
    expect(isBackendDeliveryPath("scripts/reconcile-payments.mjs")).toBe(true);
    expect(isBackendDeliveryPath("src/hooks/useCatalogData.js")).toBe(true);
    expect(isBackendDeliveryPath("src/context/OrganizationContext.jsx")).toBe(true);
    expect(isBackendDeliveryPath("src/hooks/useFutureCustomerMutation.js")).toBe(true);
    expect(isBackendDeliveryPath("src/context/FutureAuthorityContext.tsx")).toBe(true);
    expect(isBackendDeliveryPath("src/services/futureAuthorityClient.ts")).toBe(true);
    expect(isBackendDeliveryPath("src/future-data/futureAuthorityGateway.ts")).toBe(true);
    expect(isBackendDeliveryPath("src/data/futureCommercialPolicy.js")).toBe(true);
    expect(isBackendDeliveryPath("src/context/WorkspaceNavigationContext.jsx")).toBe(false);
    expect(isBackendDeliveryPath("src/hooks/useBrowserLocation.js")).toBe(false);
    expect(isBackendDeliveryPath("src/hooks/useCommercialWorkspaceSnapshot.js")).toBe(false);
    expect(isBackendDeliveryPath("src/hooks/useWorkspaceRouteHeadingFocus.js")).toBe(false);
    expect(isBackendDeliveryPath("src/lib/__tests__/quoteStore.test.js")).toBe(false);
    expect(isBackendDeliveryPath("src/lib/workspacePresentation.js")).toBe(false);
    expect(isBackendDeliveryPath("src/lib/workspaceRoutes.js")).toBe(false);
    expect(isBackendDeliveryPath("src/lib/statusSemantics.js")).toBe(false);
    expect(isBackendDeliveryPath("functions/package.json")).toBe(false);
    expect(isBackendDeliveryPath("src/components/QuoteHistoryModal.jsx")).toBe(false);
    expect(parseFunctionExports(
      "exports.first = onCall(() => {});\nexports.second = onRequest(() => {});",
      "functions/index.js"
    )).toEqual([
      "functions/index.js#first",
      "functions/index.js#second"
    ]);
  });

  test("discovers client authority in future source folders while excluding presentation surfaces", () => {
    expect(findBackendDeliveryPaths([
      "src/components/FutureCard.jsx",
      "src/new-runtime/FutureAuthority.js",
      "src/future-data/FutureRepository.ts",
      "src/hooks/useWorkspaceRouteHeadingFocus.js",
      "src/lib/workspacePresentation.js"
    ])).toEqual([
      "src/new-runtime/FutureAuthority.js",
      "src/future-data/FutureRepository.ts"
    ]);
  });

  test("does not let a reviewed presentation exclusion hide newly introduced direct authority", () => {
    const directAuthority = [
      'import { doc, updateDoc } from "firebase/firestore";',
      "export async function focusAndWrite(db, quoteId) {",
      "  await updateDoc(doc(db, 'quotes', quoteId), { focused: true });",
      "}"
    ].join("\n");
    const commentsAndStrings = [
      '// import { updateDoc } from "firebase/firestore";',
      'const example = "updateDoc(doc(db, id), payload)";',
      "export function focusOnly() { return true; }"
    ].join("\n");

    expect(hasDirectClientAuthoritySignals(directAuthority)).toBe(true);
    expect(hasDirectClientAuthoritySignals(commentsAndStrings)).toBe(false);
    expect(findBackendDeliveryPaths([
      "src/hooks/useWorkspaceRouteHeadingFocus.js",
      "src/lib/workspacePresentation.js"
    ], {
      pathExists: () => true,
      readPath: (file) => file.includes("HeadingFocus") ? directAuthority : commentsAndStrings
    })).toEqual(["src/hooks/useWorkspaceRouteHeadingFocus.js"]);
  });

  test("inventories every explicit Functions export without swallowing later declarations", () => {
    expect(parseFunctionExports(functionsEntrypointSource)).toHaveLength(75);

    const source = [
      "exports.first = onCall(async () => {",
      "  return 'first';",
      "}); // deliberately does not match the old line-shaped terminator",
      "exports.second = onCall(async () => {",
      "  return 'second-v1';",
      "});",
      "exports.third = onRequest(() => {});"
    ].join("\n");
    const original = parseFunctionExportSegments(source);
    const changed = parseFunctionExportSegments(source.replace("second-v1", "second-v2"));

    expect([...original.keys()]).toEqual([
      "functions/index.js#first",
      "functions/index.js#second",
      "functions/index.js#third"
    ]);
    expect(original.get("functions/index.js#first")).not.toContain("exports.second");
    expect(changed.get("functions/index.js#first")).toBe(
      original.get("functions/index.js#first")
    );
    expect(changed.get("functions/index.js#second")).not.toBe(
      original.get("functions/index.js#second")
    );
  });

  test.each([
    ["computed exports property", 'exports["hiddenCallable"] = onCall(() => {});'],
    ["module.exports property", "module.exports.hiddenCallable = onCall(() => {});"],
    ["computed module.exports property", 'module["exports"].hiddenCallable = onCall(() => {});'],
    ["module.exports replacement", "module.exports = { hiddenCallable: onCall(() => {}) };"],
    [
      "Object.defineProperty",
      'Object.defineProperty(exports, "hiddenCallable", { value: onCall(() => {}) });'
    ],
    ["Object.assign", "Object.assign(exports, { hiddenCallable: onCall(() => {}) });"],
    ["exports alias", "const callableExports = exports; callableExports.hiddenCallable = onCall(() => {});"],
    ["module exports destructuring alias", "const { exports: callableExports } = module; callableExports.hiddenCallable = onCall(() => {});"],
    ["Reflect.set", 'Reflect.set(exports, "hiddenCallable", onCall(() => {}));'],
    ["logical OR assignment", "exports.hiddenCallable ||= onCall(() => {});"],
    ["logical AND assignment", "exports.hiddenCallable &&= onCall(() => {});"],
    ["nullish assignment", "exports.hiddenCallable ??= onCall(() => {});"],
    ["top-level CommonJS this property", "this.hiddenCallable = onCall(() => {});"],
    ["ECMAScript async function export", "export async function hiddenCallable() {}"],
    ["ECMAScript let export", "export let hiddenCallable = onCall(() => {});"],
    ["ECMAScript star re-export", "export * from './hidden-callable.js';"]
  ])("fails closed on unsupported Function export syntax: %s", (_label, source) => {
    expect(() => parseFunctionExports(source, "functions/index.js")).toThrow(
      /unsupported Function export syntax.*exports\.<name>/i
    );
  });

  test("ignores export-like text in comments, strings, templates, and regular expressions", () => {
    const source = [
      '// exports["commented"] = onCall(() => {});',
      'const message = "Reflect.set(exports, \'stringOnly\', value)";',
      "const template = `module.exports.templateOnly = value`;",
      "const matcher = /exports\\.regexOnly/;",
      "exports.realCallable = onCall(() => ({ ok: true }));"
    ].join("\n");
    expect(parseFunctionExports(source)).toEqual(["functions/index.js#realCallable"]);
  });

  test("resolves pull request and push comparisons from the GitHub event payload", () => {
    const baseSha = "1".repeat(40);
    const headSha = "2".repeat(40);
    withGitHubEvent({
      pull_request: {
        base: { sha: baseSha },
        head: { sha: headSha }
      }
    }, (eventPath) => {
      const git = fakeGit();
      expect(resolveDiffRange({
        env: {
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_EVENT_PATH: eventPath
        },
        runGitCommand: git.runGitCommand
      })).toBe(`${baseSha}...${headSha}`);
      expect(git.calls.some((args) => args.includes(`${baseSha}...${headSha}`))).toBe(true);
      expect(git.calls.some((args) => args.includes("--diff-filter=ACMRD"))).toBe(true);
    });

    withGitHubEvent({ before: baseSha, after: headSha }, (eventPath) => {
      const git = fakeGit({ refs: { "HEAD^": "3".repeat(40) } });
      expect(resolveDiffRange({
        env: {
          GITHUB_EVENT_NAME: "push",
          GITHUB_EVENT_PATH: eventPath
        },
        runGitCommand: git.runGitCommand
      })).toBe(`${baseSha}..${headSha}`);
      expect(git.calls.some((args) => args.includes(`${baseSha}..${headSha}`))).toBe(true);
      expect(git.calls.flat()).not.toContain("HEAD^");
    });
  });

  test("fails closed for invalid explicit ranges, push ancestry, refs, and diffs", () => {
    const headSha = "2".repeat(40);
    const invalidExplicitGit = fakeGit({ refs: { HEAD: headSha } });
    expect(() => resolveDiffRange({
      env: { CAPABILITY_SURFACING_DIFF: "missing-ref...HEAD" },
      runGitCommand: invalidExplicitGit.runGitCommand
    })).toThrow(/CAPABILITY_SURFACING_DIFF is invalid.*could not be resolved/i);

    withGitHubEvent({ before: "0".repeat(40), after: headSha }, (eventPath) => {
      const git = fakeGit({ refs: { "HEAD^": "3".repeat(40) } });
      expect(() => resolveDiffRange({
        env: {
          GITHUB_EVENT_NAME: "push",
          GITHUB_EVENT_PATH: eventPath
        },
        runGitCommand: git.runGitCommand
      })).toThrow(/non-zero before and after/i);
      expect(git.calls.flat()).not.toContain("HEAD^");
    });

    const invalidRefGit = fakeGit({ refs: { HEAD: headSha } });
    expect(() => validateDiffRange("missing-ref...HEAD", {
      runGitCommand: invalidRefGit.runGitCommand
    })).toThrow(/could not be resolved/i);

    const diffFailureGit = fakeGit({
      refs: { HEAD: headSha, base: "4".repeat(40) },
      diffError: new Error("diff resolution failed")
    });
    expect(() => validateDiffRange("base...HEAD", {
      runGitCommand: diffFailureGit.runGitCommand
    })).toThrow(/diff resolution failed/i);

    const noFallbackGit = fakeGit();
    expect(() => resolveDiffRange({
      env: {},
      runGitCommand: noFallbackGit.runGitCommand
    })).toThrow(/diff could not be resolved/i);
    expect(noFallbackGit.calls.flat()).not.toContain("HEAD^");
  });

  test("uses the merge base as the baseline for triple-dot comparisons", () => {
    const baseSha = "1".repeat(40);
    const headSha = "2".repeat(40);
    const mergeBaseSha = "3".repeat(40);
    const tripleDotGit = fakeGit({ mergeBase: mergeBaseSha });
    expect(resolveDiffBaseRevision(`${baseSha}...${headSha}`, {
      runGitCommand: tripleDotGit.runGitCommand
    })).toBe(mergeBaseSha);
    expect(tripleDotGit.calls).toContainEqual([
      "merge-base",
      baseSha,
      headSha
    ]);

    const twoDotGit = fakeGit({ mergeBase: mergeBaseSha });
    expect(resolveDiffBaseRevision(`${baseSha}..${headSha}`, {
      runGitCommand: twoDotGit.runGitCommand
    })).toBe(baseSha);
    expect(twoDotGit.calls.some((args) => args[0] === "merge-base")).toBe(false);
  });

  test("falls back to origin/main when the local upstream already equals HEAD", () => {
    const headSha = "2".repeat(40);
    const mainSha = "1".repeat(40);
    const git = fakeGit({
      refs: {
        "@{upstream}": "origin/feature",
        "origin/feature": headSha,
        HEAD: headSha,
        "origin/main": mainSha
      }
    });

    expect(resolveDiffRange({ env: {}, runGitCommand: git.runGitCommand }))
      .toBe("origin/main...HEAD");
    expect(git.calls.some((args) => args.includes("origin/feature...HEAD"))).toBe(false);
    expect(git.calls.some((args) => args.includes("origin/main...HEAD"))).toBe(true);
  });

  test("accepts a revision-bumped backend delivery with frontend, UI tests, docs, and states", () => {
    const errors = validateCapabilitySurfacing({
      changedFiles: changedFiles(),
      manifest: manifest(),
      baseManifest: manifest(userContract({ reviewRevision: 1 }), 1),
      pathExists: () => true,
      readPath: readFixturePath,
      currentBackendExports: ["functions/exampleCapability.js#getExampleCapability"],
      baseBackendExports: ["functions/exampleCapability.js#getExampleCapability"]
    });
    expect(errors).toEqual([]);
  });

  test("blocks backend delivery when the manifest was not changed", () => {
    const errors = validateCapabilitySurfacing({
      changedFiles: changedFiles().filter((file) => file !== MANIFEST_PATH),
      manifest: manifest(userContract({ reviewRevision: 1 }), 1),
      baseManifest: manifest(userContract({ reviewRevision: 1 }), 1),
      pathExists: () => true,
      readPath: readFixturePath
    });
    expect(errors.join("\n")).toMatch(/without updating .*capability-surfacing-contracts/i);
    expect(errors.join("\n")).toMatch(/reviewRevision-bumped/i);
  });

  test("blocks unmapped backend files and incomplete UI state contracts", () => {
    const contract = userContract({
      stateEvidence: [
        {
          state: "loading",
          path: testPath,
          locator: "renders the example loading state",
          assertionLocator: 'data-capability-state="loading"'
        },
        {
          state: "success",
          path: testPath,
          locator: "renders the example success state",
          assertionLocator: 'data-capability-state="success"'
        }
      ],
      stateExceptions: {}
    });
    const errors = validateCapabilitySurfacing({
      changedFiles: changedFiles(["functions/unmapped.js"]),
      manifest: manifest(contract),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: readFixturePath
    });
    expect(errors.join("\n")).toMatch(/not covered.*functions\/unmapped\.js/i);
    expect(errors.join("\n")).toMatch(/surface state empty.*executable test evidence/i);
    expect(errors.join("\n")).toMatch(/surface state recovery.*executable test evidence/i);
  });

  test("requires every claimed state to map to an executable test declaration", () => {
    const contract = userContract({
      stateEvidence: REQUIRED_READ_STATES.map((state) => ({
        state,
        path: testPath,
        locator: state === "partial"
          ? "mentions the partial state without executing it"
          : `renders the example ${state} state`,
        assertionLocator: `data-capability-state="${state}"`
      }))
    });
    const errors = validateCapabilitySurfacing({
      changedFiles: changedFiles(),
      manifest: manifest(contract),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: () => [
        readFixturePath(),
        "mentions the partial state without executing it"
      ].join("\n")
    });
    expect(errors.join("\n")).toMatch(/stateEvidence.*executable test declaration/i);
  });

  test("rejects commented, assertion-free, and state-unbound test evidence", () => {
    const commented = userContract();
    const commentedErrors = validateCapabilitySurfacing({
      changedFiles: changedFiles(),
      manifest: manifest(commented),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: () => readFixturePath().replace(
        'test("renders the example partial state",',
        '// test("renders the example partial state",'
      )
    });
    expect(commentedErrors.join("\n")).toMatch(/stateEvidence.*executable test declaration with an assertion/i);

    const noAssertionErrors = validateCapabilitySurfacing({
      changedFiles: changedFiles(),
      manifest: manifest(userContract()),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: () => readFixturePath().replace(
        /test\("renders the example error state"[^\n]+/,
        'test("renders the example error state", () => {});'
      )
    });
    expect(noAssertionErrors.join("\n")).toMatch(/stateEvidence.*executable test declaration with an assertion/i);

    const unusedMarkerErrors = validateCapabilitySurfacing({
      changedFiles: changedFiles(),
      manifest: manifest(userContract()),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: () => readFixturePath().replace(
        /test\("renders the example error state"[^\n]+/,
        'test("renders the example error state", () => { const marker = \'data-capability-state="error"\'; expect(true).toBe(true); });'
      )
    });
    expect(unusedMarkerErrors.join("\n")).toMatch(/real expect\(\.\.\.\)\.toContain/i);

    const doubleQuotedAssertionErrors = validateCapabilitySurfacing({
      changedFiles: changedFiles(),
      manifest: manifest(userContract()),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: () => readFixturePath().replace(
        `expect(markup).toContain('data-capability-state="error"')`,
        'expect(markup).toContain("data-capability-state=\\"error\\"")'
      )
    });
    expect(doubleQuotedAssertionErrors).toEqual([]);

    const unbound = userContract({
      stateEvidence: REQUIRED_READ_STATES.map((state) => ({
        state,
        path: testPath,
        locator: `renders the example ${state} state`,
        assertionLocator: state === "partial"
          ? 'data-capability-state="success"'
          : `data-capability-state="${state}"`
      }))
    });
    const unboundErrors = validateCapabilitySurfacing({
      changedFiles: changedFiles(),
      manifest: manifest(unbound),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: readFixturePath
    });
    expect(unboundErrors.join("\n")).toMatch(/canonical data-capability-state marker for partial/i);
  });

  test("rejects malformed revision and audience types", () => {
    expect(validateCapabilitySurfacing({
      changedFiles: changedFiles(),
      manifest: manifest(userContract({ reviewRevision: "2", audiences: { staff: true } }), "2"),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: readFixturePath
    }).join("\n")).toMatch(/positive catalogVersion/i);

    const errors = validateCapabilitySurfacing({
      changedFiles: changedFiles(),
      manifest: manifest(userContract({ reviewRevision: "2", audiences: { staff: true } }), 2),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: readFixturePath
    });
    expect(errors.join("\n")).toMatch(/reviewRevision must be a positive integer/i);
    expect(errors.join("\n")).toMatch(/requires at least one audience/i);
  });

  test("uses mutation-specific uncertain, reconciliation, and receipt profiles", () => {
    const contract = userContract({
      capabilityKind: "mutation_surface",
      stateEvidence: REQUIRED_MUTATION_STATES
        .filter((state) => !["uncertain", "reconciliation", "receipt"].includes(state))
        .map((state) => ({
          state,
          path: testPath,
          locator: `renders the example ${state} state`,
          assertionLocator: `data-capability-state="${state}"`
        }))
    });
    const errors = validateCapabilitySurfacing({
      changedFiles: changedFiles(),
      manifest: manifest(contract),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: readFixturePath
    });
    expect(errors.join("\n")).toMatch(/surface state uncertain/i);
    expect(errors.join("\n")).toMatch(/surface state reconciliation/i);
    expect(errors.join("\n")).toMatch(/surface state receipt/i);
  });

  test("requires mutation or mixed surfaces for mutation-like direct exports", () => {
    const conversionExport = `${backendPath}#convertExampleCapability`;
    const readContract = userContract({ backendExports: [conversionExport] });
    const nameErrors = validateCapabilitySurfacing({
      changedFiles: changedFiles(),
      manifest: manifest(readContract),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: readFixturePath,
      currentBackendExports: [conversionExport],
      baseBackendExports: [conversionExport]
    });
    expect(nameErrors.join("\n")).toMatch(
      /mutation-like backend export requires mutation_surface or mixed_surface.*convertExampleCapability/i
    );

    const readNamedExport = `${backendPath}#getExampleCapability`;
    const sourceErrors = validateCapabilitySurfacing({
      changedFiles: changedFiles(),
      manifest: manifest(userContract()),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: readFixturePath,
      currentBackendExports: [readNamedExport],
      currentBackendExportSegments: new Map([[
        readNamedExport,
        "exports.getExampleCapability = onCall(async () => { tx.update(targetRef, { active: true }); });"
      ]]),
      baseBackendExports: [readNamedExport]
    });
    expect(sourceErrors.join("\n")).toMatch(
      /mutation-like backend export requires mutation_surface or mixed_surface.*getExampleCapability/i
    );

    for (const mutationSource of [
      "exports.getExampleCapability = onCall(async () => { await db.collection('quotes').doc('quote-1').set({ active: true }); });",
      "exports.getExampleCapability = onCall(async () => { await snapshot.ref.update({ active: true }); });",
      [
        "exports.getExampleCapability = onCall(async () => {",
        "  await admin.firestore()",
        "    .collection('quotes')",
        "    .doc('quote-1')",
        "    .set({ active: true });",
        "});"
      ].join("\n"),
      "exports.getExampleCapability = onCall(async () => { await setDoc(doc(db, 'quotes', 'quote-1'), { active: true }); });",
      "exports.getExampleCapability = onCall(async () => { const batch = writeBatch(db); batch.update(targetRef, { active: true }); await batch.commit(); });"
    ]) {
      const chainedWriteErrors = validateCapabilitySurfacing({
        changedFiles: changedFiles(),
        manifest: manifest(userContract()),
        baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
        pathExists: () => true,
        readPath: readFixturePath,
        currentBackendExports: [readNamedExport],
        currentBackendExportSegments: new Map([[readNamedExport, mutationSource]]),
        baseBackendExports: [readNamedExport]
      });
      expect(chainedWriteErrors.join("\n")).toMatch(
        /mutation-like backend export requires mutation_surface or mixed_surface.*getExampleCapability/i
      );
    }

    const nonExecutableWriteWords = validateCapabilitySurfacing({
      changedFiles: changedFiles(),
      manifest: manifest(userContract()),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: readFixturePath,
      currentBackendExports: [readNamedExport],
      currentBackendExportSegments: new Map([[
        readNamedExport,
        [
          "exports.getExampleCapability = onCall(async () => {",
          "  const note = 'tx.update(targetRef, payload)';",
          "  // tx.set(targetRef, payload);",
          "  return { ok: true };",
          "});"
        ].join("\n")
      ]]),
      baseBackendExports: [readNamedExport]
    });
    expect(nonExecutableWriteWords).toEqual([]);

    const readOnlyTransaction = validateCapabilitySurfacing({
      changedFiles: changedFiles(),
      manifest: manifest(userContract()),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: readFixturePath,
      currentBackendExports: [readNamedExport],
      currentBackendExportSegments: new Map([[
        readNamedExport,
        [
          "exports.getExampleCapability = onCall(async () => {",
          "  return db.runTransaction(async (tx) => tx.get(targetRef));",
          "});"
        ].join("\n")
      ]]),
      baseBackendExports: [readNamedExport]
    });
    expect(readOnlyTransaction).toEqual([]);

    const transactionWrite = validateCapabilitySurfacing({
      changedFiles: changedFiles(),
      manifest: manifest(userContract()),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: readFixturePath,
      currentBackendExports: [readNamedExport],
      currentBackendExportSegments: new Map([[
        readNamedExport,
        [
          "exports.getExampleCapability = onCall(async () => {",
          "  return db.runTransaction(async (tx) => tx.update(targetRef, { active: true }));",
          "});"
        ].join("\n")
      ]]),
      baseBackendExports: [readNamedExport]
    });
    expect(transactionWrite.join("\n")).toMatch(
      /mutation-like backend export requires mutation_surface or mixed_surface.*getExampleCapability/i
    );

    for (const capabilityKind of ["mutation_surface", "mixed_surface"]) {
      const allowed = validateCapabilitySurfacing({
        changedFiles: changedFiles(),
        manifest: manifest(userContract({
          capabilityKind,
          backendExports: [conversionExport]
        })),
        baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
        pathExists: () => true,
        readPath: readFixturePath,
        currentBackendExports: [conversionExport],
        baseBackendExports: [conversionExport]
      });
      expect(allowed).toEqual([]);
    }
  });

  test("blocks a newly exported Function that has no exact capability owner", () => {
    const errors = validateCapabilitySurfacing({
      changedFiles: changedFiles(),
      manifest: manifest(),
      baseManifest: manifest(userContract({ reviewRevision: 1 }), 1),
      pathExists: () => true,
      readPath: readFixturePath,
      currentBackendExports: [
        "functions/exampleCapability.js#getExampleCapability",
        "functions/exampleCapability.js#forgottenCapability"
      ],
      baseBackendExports: ["functions/exampleCapability.js#getExampleCapability"]
    });
    expect(errors.join("\n")).toMatch(/changed backend export.*forgottenCapability/i);
  });

  test("fails closed when the deployed entrypoint inventory is provided but empty", () => {
    const errors = validateCapabilitySurfacing({
      changedFiles: changedFiles(),
      manifest: manifest(),
      baseManifest: manifest(userContract({ reviewRevision: 1 }), 1),
      pathExists: () => true,
      readPath: readFixturePath,
      currentBackendExports: [],
      baseBackendExports: ["functions/exampleCapability.js#getExampleCapability"]
    });
    expect(errors.join("\n")).toMatch(/missing backend export.*getExampleCapability/i);
  });

  test("requires deleted backend paths to remain as explicitly retired contracts", () => {
    const previous = userContract({ reviewRevision: 1 });
    const retired = userContract({
      reviewRevision: 2,
      status: "retired",
      retirementReason: "The backend capability was removed together with its user-facing contract and documentation update."
    });
    const errors = validateCapabilitySurfacing({
      changedFiles: [backendPath, MANIFEST_PATH, "docs/FEATURE_MATRIX.md"],
      manifest: manifest(retired, 2),
      baseManifest: manifest(previous, 1),
      pathExists: (file) => file !== backendPath,
      readPath: readFixturePath,
      currentBackendExports: [],
      baseBackendExports: []
    });
    expect(errors).toEqual([]);

    const stillPresentErrors = validateCapabilitySurfacing({
      changedFiles: [backendPath, MANIFEST_PATH, "docs/FEATURE_MATRIX.md"],
      manifest: manifest(retired, 2),
      baseManifest: manifest(previous, 1),
      pathExists: () => true,
      readPath: readFixturePath,
      currentBackendExports: [],
      baseBackendExports: []
    });
    expect(stillPresentErrors.join("\n")).toMatch(
      /retired contracts may reference an existing backend path only.*explicit ownership/i
    );
  });

  test("retains explicit retired ownership when an export is removed from a shared entrypoint", () => {
    const sharedBackendPath = "functions/index.js";
    const removedExport = `${sharedBackendPath}#removedCallable`;
    const survivingExport = `${sharedBackendPath}#survivingCallable`;
    const previous = userContract({
      reviewRevision: 1,
      backendPaths: [sharedBackendPath],
      backendExports: [removedExport]
    });
    const retired = userContract({
      reviewRevision: 2,
      status: "retired",
      retirementReason: "The callable was removed while its shared Functions entrypoint remains active for other capabilities.",
      backendPaths: [sharedBackendPath],
      backendExports: [removedExport]
    });
    const surviving = userContract({
      id: "surviving-capability",
      reviewRevision: 1,
      backendPaths: [sharedBackendPath],
      backendExports: [survivingExport]
    });
    const errors = validateCapabilitySurfacing({
      changedFiles: [sharedBackendPath, MANIFEST_PATH],
      manifest: {
        schemaVersion: 1,
        catalogVersion: 2,
        contracts: [retired, surviving]
      },
      baseManifest: {
        schemaVersion: 1,
        catalogVersion: 1,
        contracts: [previous, surviving]
      },
      pathExists: () => true,
      readPath: readFixturePath,
      currentBackendExports: [survivingExport],
      baseBackendExports: [removedExport, survivingExport],
      changedBackendExports: [removedExport]
    });
    expect(errors).toEqual([]);

    const missingOwnershipErrors = validateCapabilitySurfacing({
      changedFiles: [sharedBackendPath, MANIFEST_PATH],
      manifest: {
        schemaVersion: 1,
        catalogVersion: 2,
        contracts: [
          { ...retired, backendExports: [] },
          surviving
        ]
      },
      baseManifest: {
        schemaVersion: 1,
        catalogVersion: 1,
        contracts: [previous, surviving]
      },
      pathExists: () => true,
      readPath: readFixturePath,
      currentBackendExports: [survivingExport],
      baseBackendExports: [removedExport, survivingExport],
      changedBackendExports: [removedExport]
    });
    expect(missingOwnershipErrors.join("\n")).toMatch(/retain explicit ownership/i);
    expect(missingOwnershipErrors.join("\n")).toMatch(/changed backend export is not owned/i);
  });

  test("allows an explicitly reviewed headless security contract without exposing internals", () => {
    const contract = {
      id: "private-claim-integrity",
      reviewRevision: 1,
      status: "active",
      deliveryType: "headless",
      capabilityKind: "security_private",
      audiences: ["internal"],
      summary: "A private claim integrity guard that must remain inaccessible to browser users.",
      backendPaths: [backendPath],
      backendExports: [],
      affectedBackendExports: [`${backendPath}#getExampleCapability`],
      frontendPaths: [],
      entryPointLocators: [],
      testPaths: ["src/rules/__tests__/firestore.rules.test.js"],
      testLocators: [
        {
          path: "src/rules/__tests__/firestore.rules.test.js",
          locator: "denies private claim projection"
        }
      ],
      documentationPaths: ["docs/FEATURE_MATRIX.md"],
      documentationLocators: [
        {
          path: "docs/FEATURE_MATRIX.md",
          locator: "Private claim integrity"
        }
      ],
      headlessReason: "The claim is a server-only transaction primitive and exposing it would weaken tenant authority.",
      safeOutcome: "Staff see collision-safe customer behavior and an actionable sanitized error when repair is required."
    };
    const errors = validateCapabilitySurfacing({
      changedFiles: [
        backendPath,
        MANIFEST_PATH,
        "src/rules/__tests__/firestore.rules.test.js",
        "docs/FEATURE_MATRIX.md"
      ],
      manifest: manifest(contract),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: readFixturePath
    });
    expect(errors).toEqual([]);
  });

  test("requires headless helper impacts to declare real affected exports without owning callables", () => {
    const affectedExport = "functions/exampleCapability.js#createExampleCapability";
    const headless = {
      id: "helper-impact",
      reviewRevision: 1,
      status: "active",
      deliveryType: "headless",
      capabilityKind: "headless_operational",
      audiences: ["staff"],
      summary: "A trusted helper change affects an existing callable and reviewed staff outcome.",
      backendPaths: [backendPath],
      backendExports: [],
      affectedBackendExports: [affectedExport],
      frontendPaths: [frontendPath],
      entryPointLocators: [{ path: frontendPath, locator: "Example capability route" }],
      testPaths: [testPath],
      testLocators: [{ path: testPath, locator: "opens the example capability" }],
      documentationPaths: ["docs/FEATURE_MATRIX.md"],
      documentationLocators: [
        { path: "docs/FEATURE_MATRIX.md", locator: "Example capability matrix row" }
      ],
      headlessReason: "The field is projected by trusted server code and is not a separate browser-controlled mutation.",
      safeOutcome: "Staff see the reviewed field through the existing safe product surface."
    };
    expect(validateCapabilitySurfacing({
      changedFiles: [backendPath, MANIFEST_PATH, "docs/FEATURE_MATRIX.md"],
      manifest: manifest(headless),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: readFixturePath,
      currentBackendExports: [affectedExport],
      baseBackendExports: [affectedExport]
    })).toEqual([]);

    const omittedImpacts = validateCapabilitySurfacing({
      changedFiles: [backendPath, MANIFEST_PATH, "docs/FEATURE_MATRIX.md"],
      manifest: manifest({ ...headless, affectedBackendExports: [] }),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: readFixturePath,
      currentBackendExports: [affectedExport],
      baseBackendExports: [affectedExport]
    });
    expect(omittedImpacts.join("\n")).toMatch(
      /shared Functions helper work requires affectedBackendExports/i
    );

    for (const capabilityKind of ["security_private", "developer_infrastructure"]) {
      const infrastructure = capabilityKind === "developer_infrastructure";
      const classifiedHelper = {
        ...headless,
        id: `${capabilityKind.replace(/_/g, "-")}-helper-impact`,
        capabilityKind,
        frontendPaths: [],
        entryPointLocators: [],
        documentationPaths: infrastructure
          ? ["docs/FEATURE_MATRIX.md", "README.md"]
          : ["docs/FEATURE_MATRIX.md"],
        documentationLocators: infrastructure
          ? [
            { path: "docs/FEATURE_MATRIX.md", locator: "Example capability matrix row" },
            { path: "README.md", locator: "Internal helper operator notes" }
          ]
          : [{ path: "docs/FEATURE_MATRIX.md", locator: "Example capability matrix row" }]
      };
      const classifiedChangedFiles = [
        backendPath,
        MANIFEST_PATH,
        "docs/FEATURE_MATRIX.md",
        ...(infrastructure ? ["README.md"] : [])
      ];
      const classifiedReadPath = () => `${readFixturePath()}\nInternal helper operator notes`;
      expect(validateCapabilitySurfacing({
        changedFiles: classifiedChangedFiles,
        manifest: manifest(classifiedHelper),
        baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
        pathExists: () => true,
        readPath: classifiedReadPath,
        currentBackendExports: [affectedExport],
        baseBackendExports: [affectedExport]
      })).toEqual([]);

      const classifiedMissingImpacts = validateCapabilitySurfacing({
        changedFiles: classifiedChangedFiles,
        manifest: manifest({ ...classifiedHelper, affectedBackendExports: [] }),
        baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
        pathExists: () => true,
        readPath: classifiedReadPath,
        currentBackendExports: [affectedExport],
        baseBackendExports: [affectedExport]
      });
      expect(classifiedMissingImpacts.join("\n")).toMatch(
        /shared Functions helper work requires affectedBackendExports/i
      );
    }

    const sharedHelperPath = "functions/exampleSharedHelper.js";
    const userRelevantExport = `${backendPath}#getExampleCapability`;
    for (const capabilityKind of ["read_surface", "mutation_surface", "mixed_surface"]) {
      const userRelevantWithHelper = userContract({
        capabilityKind,
        backendPaths: [backendPath, sharedHelperPath],
        affectedBackendExports: [userRelevantExport]
      });
      expect(validateCapabilitySurfacing({
        changedFiles: changedFiles([sharedHelperPath]),
        manifest: manifest(userRelevantWithHelper),
        baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
        pathExists: () => true,
        readPath: readFixturePath,
        currentBackendExports: [userRelevantExport],
        baseBackendExports: [userRelevantExport]
      })).toEqual([]);

      const userRelevantMissingImpacts = validateCapabilitySurfacing({
        changedFiles: changedFiles([sharedHelperPath]),
        manifest: manifest({ ...userRelevantWithHelper, affectedBackendExports: [] }),
        baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
        pathExists: () => true,
        readPath: readFixturePath,
        currentBackendExports: [userRelevantExport],
        baseBackendExports: [userRelevantExport]
      });
      expect(userRelevantMissingImpacts.join("\n")).toMatch(
        /shared Functions helper work requires affectedBackendExports/i
      );
    }

    const nonFunctionsBackendPath = "src/lib/exampleCapability.js";
    const nonFunctionsOperational = {
      ...headless,
      backendPaths: [nonFunctionsBackendPath],
      affectedBackendExports: []
    };
    expect(validateCapabilitySurfacing({
      changedFiles: [nonFunctionsBackendPath, MANIFEST_PATH, "docs/FEATURE_MATRIX.md"],
      manifest: manifest(nonFunctionsOperational),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: readFixturePath,
      currentBackendExports: [],
      baseBackendExports: []
    })).toEqual([]);

    const missing = validateCapabilitySurfacing({
      changedFiles: [backendPath, MANIFEST_PATH, "docs/FEATURE_MATRIX.md"],
      manifest: manifest({
        ...headless,
        affectedBackendExports: ["functions/exampleCapability.js#missingCallable"]
      }),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: readFixturePath,
      currentBackendExports: [affectedExport],
      baseBackendExports: [affectedExport]
    });
    expect(missing.join("\n")).toMatch(/affectedBackendExports references a missing current export/i);

    const ownsCallable = validateCapabilitySurfacing({
      changedFiles: [backendPath, MANIFEST_PATH, "docs/FEATURE_MATRIX.md"],
      manifest: manifest({
        ...headless,
        backendExports: [affectedExport],
        affectedBackendExports: []
      }),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: readFixturePath,
      currentBackendExports: [affectedExport],
      baseBackendExports: [affectedExport]
    });
    expect(ownsCallable.join("\n")).toMatch(/callable export ownership requires a user_relevant/i);

    const securityOwnsCallable = validateCapabilitySurfacing({
      changedFiles: [backendPath, MANIFEST_PATH, "docs/FEATURE_MATRIX.md"],
      manifest: manifest({
        ...headless,
        capabilityKind: "security_private",
        backendExports: [affectedExport],
        affectedBackendExports: [],
        frontendPaths: [],
        entryPointLocators: []
      }),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: readFixturePath,
      currentBackendExports: [affectedExport],
      baseBackendExports: [affectedExport]
    });
    expect(securityOwnsCallable.join("\n")).toMatch(
      /callable export ownership requires a user_relevant/i
    );

    const developerOwnsCallable = validateCapabilitySurfacing({
      changedFiles: [
        backendPath,
        MANIFEST_PATH,
        "docs/FEATURE_MATRIX.md",
        "README.md"
      ],
      manifest: manifest({
        ...headless,
        capabilityKind: "developer_infrastructure",
        backendExports: [affectedExport],
        affectedBackendExports: [],
        frontendPaths: [],
        entryPointLocators: [],
        documentationPaths: ["docs/FEATURE_MATRIX.md", "README.md"],
        documentationLocators: [
          { path: "docs/FEATURE_MATRIX.md", locator: "Example capability matrix row" },
          { path: "README.md", locator: "Internal helper operator notes" }
        ]
      }),
      baseManifest: { schemaVersion: 1, catalogVersion: 0, contracts: [] },
      pathExists: () => true,
      readPath: () => `${readFixturePath()}\nInternal helper operator notes`,
      currentBackendExports: [affectedExport],
      baseBackendExports: [affectedExport]
    });
    expect(developerOwnsCallable.join("\n")).toMatch(
      /callable export ownership requires a user_relevant/i
    );
  });
});
