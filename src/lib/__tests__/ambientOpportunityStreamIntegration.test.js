import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const quoteHistorySource = readFileSync(
  fileURLToPath(new URL("../../components/QuoteHistoryModal.jsx", import.meta.url)),
  "utf8"
);

function sourceBetween(source, startMarker, endMarker, fromIndex = 0) {
  const start = source.indexOf(startMarker, fromIndex);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start, `Missing start marker: ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `Missing end marker after: ${startMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("Ambient Opportunities host integration", () => {
  test("lazy-loads the stream only behind the exact Ambient presentation flag", () => {
    const gateSource = sourceBetween(
      quoteHistorySource,
      "const AMBIENT_UI_ENABLED =",
      "function QuoteAdministrationBoundary"
    );

    expect(gateSource).toContain(
      'import.meta.env.VITE_AMBIENT_UI_ENABLED === "1"'
    );
    expect(gateSource).toContain(
      '|| import.meta.env.VITE_AMBIENT_UI_ENABLED === "true"'
    );
    expect(gateSource).toContain(
      '|| import.meta.env.VITE_AMBIENT_UI_ENABLED === "yes"'
    );
    expect(gateSource).toContain(
      '|| import.meta.env.VITE_AMBIENT_UI_ENABLED === "on"'
    );
    expect(gateSource).toContain(
      'const AmbientOpportunitiesStream = AMBIENT_UI_ENABLED\n  ? lazy(() => import("./AmbientOpportunitiesStream"))\n  : null;'
    );
    expect(quoteHistorySource).not.toMatch(
      /import\s+AmbientOpportunitiesStream\s+from\s+["']\.\/AmbientOpportunitiesStream["']/u
    );
  });

  test("renders the Ambient stream in list mode and keeps legacy controls inside Quote administration", () => {
    const detailBranch = quoteHistorySource.indexOf("if (detailMode) {");
    const listReturn = quoteHistorySource.indexOf("\n  return (", detailBranch);
    const listSource = quoteHistorySource.slice(listReturn);
    const streamIndex = listSource.indexOf(
      "{AMBIENT_UI_ENABLED && !administrationFocusActive && AmbientOpportunitiesStream && ("
    );
    const administrationIndex = listSource.indexOf(
      "<QuoteAdministrationBoundary"
    );
    const controlsIndex = listSource.indexOf('className="history-controls"');
    const tableIndex = listSource.indexOf("<table>");
    const administrationEnd = listSource.indexOf("</QuoteAdministrationBoundary>");
    const boundarySource = sourceBetween(
      quoteHistorySource,
      "function QuoteAdministrationBoundary",
      "const RESUMABLE_PAYMENT_APPROVAL_ACTIONS"
    );

    expect(detailBranch).toBeGreaterThan(-1);
    expect(listReturn).toBeGreaterThan(detailBranch);
    expect(streamIndex).toBeGreaterThan(-1);
    expect(administrationIndex).toBeGreaterThan(streamIndex);
    expect(controlsIndex).toBeGreaterThan(administrationIndex);
    expect(tableIndex).toBeGreaterThan(controlsIndex);
    expect(administrationEnd).toBeGreaterThan(tableIndex);
    expect(boundarySource).toContain("<summary>Quote administration</summary>");
    expect(boundarySource).toContain("{open ? children() : null}");
    expect(listSource).toContain("quotes={state.quotes}");
    expect(listSource).toContain("readBoundary={ambientOpportunityReadBoundary}");
    expect(listSource).toContain("initiallyOpen={administrationFocusActive}");
  });

  test("clears cross-organization quote and read evidence before starting the requested read", () => {
    const loadSource = sourceBetween(
      quoteHistorySource,
      "const load = async () => {",
      "useEffect(() => {\n    if (!open) return;\n    let alive = true;"
    );
    const resetIndex = loadSource.indexOf("setState((prev) => (");
    const readIndex = loadSource.indexOf("await getQuoteHistory({");
    const crossOrganizationReset = sourceBetween(
      loadSource,
      ": {\n            loading: true,",
      "\n          }\n    ));"
    );

    expect(resetIndex).toBeGreaterThan(-1);
    expect(readIndex).toBeGreaterThan(resetIndex);
    expect(loadSource).toContain(
      "prev.organizationId === requestedOrganizationId"
    );
    expect(crossOrganizationReset).toContain('source: ""');
    expect(crossOrganizationReset).toContain("quotes: []");
    expect(crossOrganizationReset).toContain("truncated: false");
    expect(crossOrganizationReset).toContain("readComplete: false");
    expect(crossOrganizationReset).toContain('loadedAtISO: ""');
    expect(crossOrganizationReset).toContain(
      "organizationId: requestedOrganizationId"
    );
  });
});
