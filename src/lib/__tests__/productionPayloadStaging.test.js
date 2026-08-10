import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  assertProviderCredentialsAbsent,
  stageProductionPayload
} from "../../../scripts/stage-production-payload.mjs";

const tempDirectories = [];

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-payload-stage-"));
  tempDirectories.push(root);
  const files = {
    "firebase.json": fs.readFileSync(path.join(process.cwd(), "firebase.json"), "utf8"),
    "firestore.indexes.json": "{}\n",
    "firestore.rules": "rules_version = '2';\n",
    "functions/index.js": "export const handler = true;\n",
    "functions/helper.js": "export const helper = true;\n",
    "functions/package.json": "{}\n",
    "functions/package-lock.json": "{}\n",
    "functions/data/starterCatalogPacks.json": "{}\n",
    "functions/.env.example": "PLACEHOLDER=\n",
    "functions/.gitignore": ".env.*\n",
    "functions/node_modules/ignored/index.js": "ignored\n",
    "dist/index.html": "<!doctype html>\n",
    "dist/assets/app.js": "console.log('QuotePilot');\n",
    "vercel.json": `${JSON.stringify({
      framework: "vite",
      git: { deploymentEnabled: false },
      buildCommand: "npm run check:env && npm run build",
      headers: [{
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }
        ]
      }],
      rewrites: [{ source: "/(.*)", destination: "/index.html" }]
    }, null, 2)}\n`
  };
  for (const [relativePath, contents] of Object.entries(files)) {
    const file = path.join(root, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  return root;
}

function listFiles(root) {
  const files = [];
  function walk(directory, segments = []) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(directory, entry.name), [...segments, entry.name]);
      else files.push([...segments, entry.name].join("/"));
    }
  }
  walk(root);
  return files.sort();
}

afterEach(() => {
  while (tempDirectories.length) {
    fs.rmSync(tempDirectories.pop(), { recursive: true, force: true });
  }
});

describe("target-scoped production payload staging", () => {
  test.each([
    ["firebase-hosting", [
      ".firebaserc",
      "dist/assets/app.js",
      "dist/index.html",
      "firebase.json"
    ]],
    ["firebase-backend", [
      ".firebaserc",
      "firebase.json",
      "firestore.indexes.json",
      "firestore.rules",
      "functions/data/starterCatalogPacks.json",
      "functions/helper.js",
      "functions/index.js",
      "functions/package-lock.json",
      "functions/package.json"
    ]],
    ["firebase-all", [
      ".firebaserc",
      "dist/assets/app.js",
      "dist/index.html",
      "firebase.json",
      "firestore.indexes.json",
      "firestore.rules",
      "functions/data/starterCatalogPacks.json",
      "functions/helper.js",
      "functions/index.js",
      "functions/package-lock.json",
      "functions/package.json"
    ]],
    ["vercel", [
      ".vercel/output/config.json",
      ".vercel/output/static/assets/app.js",
      ".vercel/output/static/index.html",
      ".vercel/project.json"
    ]]
  ])("stages only the approved %s surface", (target, expectedFiles) => {
    const root = makeRoot();
    const result = stageProductionPayload({ target, root }, { env: { CI: "true" } });

    expect(result.output).toBe(path.join(root, "artifacts", "release", "payload", target));
    expect(listFiles(result.output)).toEqual(expectedFiles);
  });

  test.each([
    "FIREBASE_TOKEN",
    "vercel_token",
    "google_application_credentials",
    "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    "GOOGLE_CREDENTIALS"
  ])(
    "rejects even an empty %s before touching an existing payload",
    (credential) => {
      const root = makeRoot();
      const output = path.join(root, "artifacts", "release", "payload", "vercel");
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, "sentinel.txt"), "preserve\n");

      expect(() => stageProductionPayload(
        { target: "vercel", root },
        { env: { [credential]: "" } }
      )).toThrow(/provider credentials must be absent/i);
      expect(fs.readFileSync(path.join(output, "sentinel.txt"), "utf8")).toBe("preserve\n");
    }
  );

  test("rejects a runtime Functions environment instead of packaging it", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "functions", ".env.tonicatering"), "SECRET=value\n");
    expect(() => stageProductionPayload(
      { target: "firebase-backend", root },
      { env: {} }
    )).toThrow(/runtime environment files are not allowed/i);
  });

  test("rejects symlinks and output path substitution", () => {
    const root = makeRoot();
    fs.symlinkSync("index.html", path.join(root, "dist", "alias.html"));
    expect(() => stageProductionPayload(
      { target: "vercel", root },
      { env: {} }
    )).toThrow(/symbolic links are not allowed/i);
    expect(() => stageProductionPayload({
      target: "firebase-hosting",
      root,
      output: "artifacts/release/payload/vercel"
    }, { env: {} })).toThrow(/must resolve to artifacts\/release\/payload\/firebase-hosting/i);
  });

  test("translates the reviewed Vercel SPA contract into a prebuilt output", () => {
    const root = makeRoot();
    const result = stageProductionPayload({ target: "vercel", root }, { env: {} });
    const config = JSON.parse(fs.readFileSync(
      path.join(result.output, ".vercel", "output", "config.json"),
      "utf8"
    ));

    expect(config).toEqual({
      version: 3,
      routes: [
        {
          src: "/(.*)",
          headers: {
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "strict-origin-when-cross-origin"
          },
          continue: true
        },
        { handle: "filesystem" },
        { src: "/.*", dest: "/index.html" }
      ]
    });
    expect(JSON.parse(fs.readFileSync(
      path.join(result.output, ".vercel", "project.json"),
      "utf8"
    ))).toEqual({
      projectId: "prj_epLi14LmBItwYkv25XZoAkWZf4Jk",
      orgId: "team_AW2QNNgYt5vESEO3eOTJXHp1",
      projectName: "quoteflow"
    });
  });

  test.each([
    ["firebase-hosting", {
      hosting: [{
        target: "app",
        public: "dist",
        ignore: ["firebase.json", "**/.*", "**/node_modules/**"],
        rewrites: [{ source: "**", destination: "/index.html" }],
        headers: JSON.parse(fs.readFileSync(path.join(process.cwd(), "firebase.json"), "utf8"))
          .hosting.find((entry) => entry.target === "app").headers
      }]
    }],
    ["firebase-backend", {
      functions: { source: "functions" },
      firestore: { rules: "firestore.rules", indexes: "firestore.indexes.json" }
    }],
    ["firebase-all", {
      functions: { source: "functions" },
      firestore: { rules: "firestore.rules", indexes: "firestore.indexes.json" },
      hosting: [{
        target: "app",
        public: "dist",
        ignore: ["firebase.json", "**/.*", "**/node_modules/**"],
        rewrites: [{ source: "**", destination: "/index.html" }],
        headers: JSON.parse(fs.readFileSync(path.join(process.cwd(), "firebase.json"), "utf8"))
          .hosting.find((entry) => entry.target === "app").headers
      }]
    }]
  ])("generates fixed project and target-scoped config for %s", (target, expectedConfig) => {
    const root = makeRoot();
    const result = stageProductionPayload({ target, root }, { env: {} });

    expect(JSON.parse(fs.readFileSync(path.join(result.output, ".firebaserc"), "utf8")))
      .toEqual({
        projects: { default: "tonicatering" },
        targets: { tonicatering: { hosting: { app: ["tonicatering"] } } }
      });
    expect(JSON.parse(fs.readFileSync(path.join(result.output, "firebase.json"), "utf8")))
      .toEqual(expectedConfig);
  });

  test("rejects unreviewed Firebase deployment hooks before replacing an existing payload", () => {
    const root = makeRoot();
    const configPath = path.join(root, "firebase.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.functions.predeploy = "node attacker.js";
    fs.writeFileSync(configPath, `${JSON.stringify(config)}\n`);
    const output = path.join(root, "artifacts", "release", "payload", "firebase-backend");
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, "sentinel.txt"), "preserve\n");

    expect(() => stageProductionPayload(
      { target: "firebase-backend", root },
      { env: {} }
    )).toThrow(/Functions configuration no longer matches/i);
    expect(fs.readFileSync(path.join(output, "sentinel.txt"), "utf8")).toBe("preserve\n");
  });

  test("fails closed when vercel.json drifts from the reviewed prebuilt translation", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "vercel.json"), "{}\n");
    expect(() => stageProductionPayload(
      { target: "vercel", root },
      { env: {} }
    )).toThrow(/reviewed Build Output translation policy/i);
  });

  test("preserves an existing payload when source preflight rejects a nested symlink", () => {
    const root = makeRoot();
    const output = path.join(root, "artifacts", "release", "payload", "vercel");
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, "sentinel.txt"), "preserve\n");
    fs.symlinkSync("app.js", path.join(root, "dist", "assets", "alias.js"));

    expect(() => stageProductionPayload(
      { target: "vercel", root },
      { env: {} }
    )).toThrow(/symbolic links are not allowed/i);
    expect(fs.readFileSync(path.join(output, "sentinel.txt"), "utf8")).toBe("preserve\n");
  });

  test("rejects a symlinked output ancestor before touching its target", () => {
    const root = makeRoot();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-payload-outside-"));
    tempDirectories.push(outside);
    fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
    fs.symlinkSync(outside, path.join(root, "artifacts", "release"));

    expect(() => stageProductionPayload(
      { target: "vercel", root },
      { env: {} }
    )).toThrow(/output ancestors must be real directories/i);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  test("rejects an unknown Functions input until the payload policy is reviewed", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "functions", "generated"));
    expect(() => stageProductionPayload(
      { target: "firebase-backend", root },
      { env: {} }
    )).toThrow(/unapproved Functions artifact input/i);
  });

  test("rejects an unreviewed nested Functions data artifact", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "functions", "data", "extra.json"), "{}\n");
    expect(() => stageProductionPayload(
      { target: "firebase-backend", root },
      { env: {} }
    )).toThrow(/unapproved Functions artifact input.*functions\/data\/extra\.json/i);
  });

  test("requires the versioned starter-pack manifest in backend artifacts", () => {
    const root = makeRoot();
    fs.rmSync(path.join(root, "functions", "data"), { recursive: true });
    expect(() => stageProductionPayload(
      { target: "firebase-backend", root },
      { env: {} }
    )).toThrow(/required artifact input.*functions\/data\/starterCatalogPacks\.json/i);
  });
});

describe("credential assertion", () => {
  test("accepts an environment without provider mutation credentials", () => {
    expect(() => assertProviderCredentialsAbsent({ CI: "true" })).not.toThrow();
  });
});
