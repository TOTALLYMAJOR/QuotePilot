import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  useWorkspaceNavigation,
  WorkspaceNavigationProvider
} from "../WorkspaceNavigationContext";

function Probe() {
  const navigation = useWorkspaceNavigation();
  return (
    <output
      data-route={navigation.route.routeId}
      data-customer={navigation.route.params?.customerId || ""}
      data-href={navigation.createHref("/app/quotes")}
    />
  );
}

describe("WorkspaceNavigationProvider", () => {
  test("provides the parsed route and query-preserving href without an auth or organization key", () => {
    const windowObject = {
      location: {
        origin: "https://quotepilot.test",
        pathname: "/app/customers/customer-1",
        search: "?view=compact",
        hash: ""
      },
      history: { state: null }
    };

    const html = renderToStaticMarkup(
      <WorkspaceNavigationProvider windowObject={windowObject}>
        <Probe />
      </WorkspaceNavigationProvider>
    );

    expect(html).toContain('data-route="customer-detail"');
    expect(html).toContain('data-customer="customer-1"');
    expect(html).toContain('data-href="/app/quotes?view=compact"');
  });
});
