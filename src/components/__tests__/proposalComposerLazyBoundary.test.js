import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const APP_SOURCE = readFileSync("src/App.jsx", "utf8");
const LEGACY_APP_SOURCE = readFileSync("src/LegacyApp.jsx", "utf8");
const FACADE_SOURCE = readFileSync("src/components/ProposalComposer.jsx", "utf8");
const IMPLEMENTATION_SOURCE = readFileSync("src/components/ProposalComposerImpl.jsx", "utf8");
const VITE_SOURCE = readFileSync("vite.config.js", "utf8");

describe("Proposal Composer quote-acceleration boundary", () => {
  test("keeps App graphs on the small facade and loads the implementation dynamically", () => {
    expect(APP_SOURCE).toContain('from "./components/ProposalComposer"');
    expect(LEGACY_APP_SOURCE).toContain('from "./components/ProposalComposer"');
    expect(APP_SOURCE).not.toContain('from "./components/ProposalComposerImpl"');
    expect(LEGACY_APP_SOURCE).not.toContain('from "./components/ProposalComposerImpl"');

    expect(FACADE_SOURCE).toContain('import("./ProposalComposerImpl")');
    expect(FACADE_SOURCE).not.toMatch(/from\s+["']\.\/ProposalComposerImpl["']/u);
    expect(FACADE_SOURCE).toContain("quotepilot:locationchange");
    expect(FACADE_SOURCE).toContain("/app\\/quotes\\/");
    expect(IMPLEMENTATION_SOURCE).toContain("export default function ProposalComposer");
  });

  test("assigns the heavy implementation, not the facade, to the quote-builder chunk", () => {
    expect(VITE_SOURCE).toContain('normalizedId.endsWith("/src/components/ProposalComposerImpl.jsx")');
    expect(VITE_SOURCE).not.toContain('normalizedId.endsWith("/src/components/ProposalComposer.jsx")');
  });
});
