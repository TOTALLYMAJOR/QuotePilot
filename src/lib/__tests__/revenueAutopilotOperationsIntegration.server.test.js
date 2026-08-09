import fs from "node:fs";
import { describe, expect, test } from "vitest";

const FUNCTIONS_SOURCE = fs.readFileSync(
  new URL("../../../functions/index.js", import.meta.url),
  "utf8"
);

function operationsCallableSource() {
  const startMarker = "exports.getRevenueAutopilotOperations =";
  const endMarker = "function projectRevenueAutopilotCustomerControls";
  const start = FUNCTIONS_SOURCE.indexOf(startMarker);
  const end = FUNCTIONS_SOURCE.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error("Unable to locate the Revenue Autopilot operations callable source contract.");
  }
  return FUNCTIONS_SOURCE.slice(start, end);
}

describe("Revenue Autopilot operations callable source ownership", () => {
  test("server-filters bounded Attention to open unread customer replies without narrowing job history", () => {
    const callable = operationsCallableSource();

    expect(callable).toContain("let jobsQuery = refs.jobsRef;");
    expect(callable).toContain([
      "let attentionQuery = refs.attentionRef",
      "      .where(\"type\", \"==\", \"unread_customer_reply\")",
      "      .where(\"state\", \"==\", \"open\");"
    ].join("\n"));
    expect(callable).toContain("jobsQuery.limit(jobLimit + 1).get()");
    expect(callable).toContain("attentionQuery.limit(attentionLimit + 1).get()");
    expect(callable).toContain("jobsQuery = jobsQuery.where(\"quoteId\", \"==\", quoteId);");
    expect(callable).toContain("attentionQuery = attentionQuery.where(\"quoteId\", \"==\", quoteId);");
    expect(callable).not.toContain("jobsQuery = jobsQuery.where(\"kind\"");
    expect(callable).not.toContain("jobsQuery = jobsQuery.where(\"type\"");
    expect(callable).not.toContain("jobsQuery = jobsQuery.where(\"state\"");
  });
});
