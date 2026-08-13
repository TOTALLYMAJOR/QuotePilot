import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  PRODUCTION_PROVIDER_IDENTIFIERS,
  assertProviderCredentialsAbsent,
  buildProductionArtifactManifest,
  calculateManifestDigest,
  canonicalJson,
  enumerateArtifactFiles,
  isSecretLikeArtifactPath,
  normalizeArtifactRelativePath,
  parseProductionArtifactArgs,
  prepareProductionArtifact,
  validateProductionArtifactManifest,
  validateVerifiedReleaseEvidence,
  writeManifestAtomically
} from "../../../scripts/prepare-production-artifact.mjs";

const RELEASE_SHA = "a".repeat(40);
const ROLLBACK_SHA = "b".repeat(40);
const CHECKLIST_DIGEST = "c".repeat(64);
const tempDirectories = [];

function makeTempDirectory(label) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `quotepilot-${label}-`));
  tempDirectories.push(directory);
  return directory;
}

function makeEvidence(target = "vercel", overrides = {}) {
  return {
    schema: "com.mbmapps.quotepilot.production-release-evidence/v5",
    approvalMode: "independent-review",
    releaseSha: RELEASE_SHA,
    releaseTag: "v1.2.3",
    rollbackSha: ROLLBACK_SHA,
    target,
    ciRunId: 101,
    uatRunId: 202,
    preparationRunId: 303,
    stagingId: "dpl_immutable-123",
    attesterId: 404,
    uatReviewerId: 405,
    uatReviewId: "DR_quotepilot-uat-review-1",
    operatorId: 406,
    productionReviewerId: 407,
    productionReviewId: "DR_quotepilot-production-review-1",
    checklistDigest: CHECKLIST_DIGEST,
    verifiedAt: "2026-08-04T12:00:00.000Z",
    ...overrides
  };
}

function writeArtifact(root, relativePath, contents, mode = 0o644) {
  const file = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, { mode });
  fs.chmodSync(file, mode);
}

function makeArtifactRoot(label = "artifact") {
  const root = makeTempDirectory(label);
  writeArtifact(root, "z-last.txt", "last\n");
  writeArtifact(root, "assets/app.js", "console.log('QuotePilot');\n");
  writeArtifact(root, "bin/verify.sh", "#!/bin/sh\nexit 0\n", 0o755);
  return root;
}

afterEach(() => {
  while (tempDirectories.length) {
    fs.rmSync(tempDirectories.pop(), { recursive: true, force: true });
  }
});

describe("prepare-only credential boundary", () => {
  test.each([
    "FIREBASE_TOKEN",
    "VERCEL_TOKEN",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    "GOOGLE_CREDENTIALS"
  ])(
    "rejects an even-empty %s before caller hooks or filesystem access",
    (credentialName) => {
      let hookCalled = false;
      let filesystemTouched = false;
      const fsImpl = new Proxy({}, {
        get() {
          filesystemTouched = true;
          throw new Error("filesystem must not be touched");
        }
      });

      expect(() => prepareProductionArtifact({
        evidence: makeEvidence(),
        artifactRoot: "/does/not/exist",
        repositoryRoot: "/also/absent"
      }, {
        env: { [credentialName.toLowerCase()]: "" },
        fsImpl,
        beforeArtifactRead() {
          hookCalled = true;
        }
      })).toThrow(new RegExp(`${credentialName} must be absent`, "i"));
      expect(hookCalled).toBe(false);
      expect(filesystemTouched).toBe(false);
    }
  );

  test("accepts an environment without provider deployment credentials", () => {
    expect(() => assertProviderCredentialsAbsent({ CI: "true" })).not.toThrow();
  });
});

describe("verified evidence and target binding", () => {
  test.each(Object.keys(PRODUCTION_PROVIDER_IDENTIFIERS))(
    "binds exact v4 evidence and fixed identifiers for %s",
    (target) => {
      const artifactRoot = makeArtifactRoot(target);
      const manifest = buildProductionArtifactManifest({
        evidence: makeEvidence(target),
        artifactRoot
      });

      expect(manifest.evidence).toEqual(makeEvidence(target));
      expect(manifest.provider).toEqual(PRODUCTION_PROVIDER_IDENTIFIERS[target]);
      const { integrity, ...body } = manifest;
      expect(integrity).toEqual({
        algorithm: "sha256",
        canonicalization: "sorted-key-json-v1",
        scope: "manifest-without-integrity",
        value: calculateManifestDigest(body)
      });
    }
  );

  test.each([
    [{ schema: "v1" }, /schema/i],
    [{ releaseSha: RELEASE_SHA.toUpperCase() }, /lowercase full commit SHA/i],
    [{ releaseTag: "v01.2.3" }, /exact semantic vX.Y.Z tag/i],
    [{ rollbackSha: RELEASE_SHA }, /must differ/i],
    [{ target: "all" }, /target must be/i],
    [{ ciRunId: 0 }, /positive safe integer/i],
    [{ uatReviewerId: 404 }, /reviewer must differ/i],
    [{ uatReviewId: "review id" }, /uatReviewId is missing or invalid/i],
    [{ productionReviewerId: 406 }, /production reviewer must differ/i],
    [{ productionReviewerId: 404 }, /production reviewer must differ/i],
    [{ productionReviewId: "review id" }, /productionReviewId is missing or invalid/i],
    [{ checklistDigest: "not-a-digest" }, /checklistDigest/i],
    [{ verifiedAt: "2026-08-04" }, /canonical ISO-8601/i]
  ])("rejects malformed verified evidence %#", (overrides, expected) => {
    expect(() => validateVerifiedReleaseEvidence(makeEvidence("vercel", overrides))).toThrow(expected);
  });

  test("accepts an internally consistent solo-operator evidence receipt", () => {
    expect(() => validateVerifiedReleaseEvidence(makeEvidence("vercel", {
      approvalMode: "solo-operator",
      attesterId: 404,
      uatReviewerId: 404,
      uatReviewId: "solo-uat:202",
      operatorId: 404,
      productionReviewerId: 404,
      productionReviewId: "solo-cooldown-15m:303"
    }))).not.toThrow();
  });

  test("rejects solo evidence without the cooling-period identity", () => {
    expect(() => validateVerifiedReleaseEvidence(makeEvidence("vercel", {
      approvalMode: "solo-operator",
      attesterId: 404,
      uatReviewerId: 404,
      operatorId: 404,
      productionReviewerId: 404
    }))).toThrow(/cooling-period contract/i);
  });

  test("rejects missing or extra evidence fields", () => {
    const missing = makeEvidence();
    delete missing.operatorId;
    expect(() => validateVerifiedReleaseEvidence(missing)).toThrow(/exact required fields/i);
    expect(() => validateVerifiedReleaseEvidence({
      ...makeEvidence(),
      providerResult: "READY"
    })).toThrow(/exact required fields/i);
  });
});

describe("artifact enumeration", () => {
  test("hashes files in sorted POSIX order with size and permission mode", () => {
    const artifactRoot = makeArtifactRoot("sorted");
    const result = enumerateArtifactFiles(artifactRoot);

    expect(result.files.map((file) => file.path)).toEqual([
      "assets/app.js",
      "bin/verify.sh",
      "z-last.txt"
    ]);
    expect(result.files.find((file) => file.path === "bin/verify.sh")?.mode).toBe(0o755);
    for (const file of result.files) {
      const contents = fs.readFileSync(path.join(artifactRoot, ...file.path.split("/")));
      expect(file.sha256).toBe(crypto.createHash("sha256").update(contents).digest("hex"));
      expect(file.size).toBe(contents.length);
    }
    expect(result.totalBytes).toBe(result.files.reduce((sum, file) => sum + file.size, 0));
  });

  test("produces the same manifest for identical roots created in different order", () => {
    const first = makeTempDirectory("deterministic-first");
    const second = makeTempDirectory("deterministic-second");
    writeArtifact(first, "b.txt", "B\n");
    writeArtifact(first, "nested/a.txt", "A\n", 0o600);
    writeArtifact(second, "nested/a.txt", "A\n", 0o600);
    writeArtifact(second, "b.txt", "B\n");

    const firstManifest = buildProductionArtifactManifest({
      evidence: makeEvidence(),
      artifactRoot: first
    });
    const secondManifest = buildProductionArtifactManifest({
      evidence: makeEvidence(),
      artifactRoot: second
    });
    expect(canonicalJson(firstManifest)).toBe(canonicalJson(secondManifest));
  });

  test.each([
    "../escape",
    "nested/../../escape",
    "/absolute",
    "C:\\absolute",
    "nested//file",
    "./file",
    "file\nname"
  ])("rejects unsafe relative path %s", (candidate) => {
    expect(() => normalizeArtifactRelativePath(candidate)).toThrow(/artifact paths/i);
  });

  test.each([
    ".env",
    ".env.production",
    "config/local.env",
    "private/server.pem",
    "keys/id_ed25519",
    "config/service-account.json",
    ".git/config",
    "node_modules/pkg/index.js"
  ])("classifies secret-like path %s", (candidate) => {
    expect(isSecretLikeArtifactPath(candidate)).toBe(true);
  });

  test.each([".env.production", "server.key", "config/credentials.json"])(
    "rejects secret-like file %s",
    (relativePath) => {
      const artifactRoot = makeTempDirectory("secret-path");
      writeArtifact(artifactRoot, "safe.txt", "safe\n");
      writeArtifact(artifactRoot, relativePath, "not-even-a-secret\n");
      expect(() => enumerateArtifactFiles(artifactRoot)).toThrow(/secret-like artifact path/i);
    }
  );

  test("rejects private key material under a neutral filename", () => {
    const artifactRoot = makeTempDirectory("private-key-content");
    writeArtifact(
      artifactRoot,
      "config.json",
      ["-----BEGIN", "PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n"].join(" ")
    );
    expect(() => enumerateArtifactFiles(artifactRoot)).toThrow(/private key material/i);
  });

  test("rejects symlinks even when they point inside the artifact root", () => {
    const artifactRoot = makeTempDirectory("symlink");
    writeArtifact(artifactRoot, "target.txt", "safe\n");
    fs.symlinkSync("target.txt", path.join(artifactRoot, "alias.txt"));
    expect(() => enumerateArtifactFiles(artifactRoot)).toThrow(/symbolic links/i);
  });

  test("rejects empty artifact roots", () => {
    expect(() => enumerateArtifactFiles(makeTempDirectory("empty"))).toThrow(/contains no files/i);
  });
});

describe("atomic manifest output", () => {
  test("writes an immutable deterministic JSON manifest under artifacts/release", () => {
    const repositoryRoot = makeTempDirectory("repository");
    const artifactRoot = makeArtifactRoot("output-payload");
    const input = {
      evidence: makeEvidence("firebase-hosting"),
      artifactRoot,
      repositoryRoot
    };
    const dependencies = {
      env: { CI: "true" },
      randomBytes: () => Buffer.alloc(12, 7)
    };
    const first = prepareProductionArtifact(input, dependencies);
    const second = prepareProductionArtifact(input, dependencies);

    expect(first.outputPath).toBe(second.outputPath);
    expect(first.outputPath).toMatch(
      new RegExp(`${path.sep}artifacts${path.sep}release${path.sep}firebase-hosting-${RELEASE_SHA}-[0-9a-f]{16}\\.manifest\\.json$`)
    );
    expect(fs.readFileSync(first.outputPath, "utf8")).toBe(first.json);
    expect(JSON.parse(first.json)).toEqual(first.manifest);
    expect(fs.readdirSync(path.dirname(first.outputPath))).toEqual([path.basename(first.outputPath)]);
  });

  test("rejects a manifest changed after its deterministic digest was computed", () => {
    const repositoryRoot = makeTempDirectory("tampered-manifest-output");
    const manifest = buildProductionArtifactManifest({
      evidence: makeEvidence(),
      artifactRoot: makeArtifactRoot("tampered-manifest-payload")
    });
    const tampered = JSON.parse(JSON.stringify(manifest));
    tampered.artifact.files[0].size += 1;
    expect(() => validateProductionArtifactManifest(tampered)).toThrow(/total size|integrity digest/i);
    expect(() => writeManifestAtomically(tampered, repositoryRoot)).toThrow(
      /total size|integrity digest/i
    );
    expect(fs.existsSync(path.join(repositoryRoot, "artifacts"))).toBe(false);
  });

  test("rejects an existing manifest symlink even when its contents match", () => {
    const repositoryRoot = makeTempDirectory("symlinked-manifest-output");
    const artifactRoot = makeArtifactRoot("symlinked-manifest-payload");
    const manifest = buildProductionArtifactManifest({
      evidence: makeEvidence(),
      artifactRoot
    });
    const validated = validateProductionArtifactManifest(manifest);
    const releaseDirectory = path.join(repositoryRoot, "artifacts", "release");
    fs.mkdirSync(releaseDirectory, { recursive: true });
    const fileName = `vercel-${RELEASE_SHA}-${validated.digest.slice(0, 16)}.manifest.json`;
    const outside = path.join(repositoryRoot, "matching.json");
    fs.writeFileSync(outside, `${JSON.stringify(JSON.parse(canonicalJson(manifest)), null, 2)}\n`);
    fs.symlinkSync(outside, path.join(releaseDirectory, fileName));

    expect(() => writeManifestAtomically(manifest, repositoryRoot)).toThrow(/not a regular file/i);
  });

  test("does not allow the output directory to become part of the artifact", () => {
    const repositoryRoot = makeTempDirectory("nested-output");
    writeArtifact(repositoryRoot, "safe.txt", "safe\n");
    expect(() => prepareProductionArtifact({
      evidence: makeEvidence(),
      artifactRoot: repositoryRoot,
      repositoryRoot
    }, { env: {} })).toThrow(/may not be inside artifactRoot/i);
  });

  test.each([
    [[], /evidence-file is required/i],
    [["--evidence-file", "/tmp/evidence.json", "--artifact-root", "relative"], /absolute paths/i],
    [["--unknown", "x", "--artifact-root", "/tmp/root"], /unknown argument/i]
  ])("fails closed for malformed CLI arguments %#", (argv, expected) => {
    expect(() => parseProductionArtifactArgs(argv)).toThrow(expected);
  });

  test("contains no process runner, provider CLI, or network client", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "scripts/prepare-production-artifact.mjs"),
      "utf8"
    );
    expect(source).not.toMatch(/node:child_process|firebase-tools|\bnpx\b|\bfetch\s*\(/);
  });
});
