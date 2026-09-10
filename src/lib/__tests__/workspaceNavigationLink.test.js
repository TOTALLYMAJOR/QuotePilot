import { describe, expect, test } from "vitest";
import { shouldHandleWorkspaceLink } from "../workspaceNavigationLink";

function event(overrides = {}, attributes = {}) {
  return {
    defaultPrevented: false, button: 0,
    currentTarget: {
      hasAttribute: (key) => Object.hasOwn(attributes, key),
      getAttribute: (key) => attributes[key] ?? null
    },
    ...overrides
  };
}
describe("native workspace link activation", () => {
  test("keeps normal activation on the existing guarded callback", () => {
    expect(shouldHandleWorkspaceLink(event())).toBe(true);
    expect(shouldHandleWorkspaceLink(event({}, { target: "_self" }))).toBe(true);
  });
  test.each(["ctrlKey", "metaKey", "shiftKey", "altKey"])("preserves native %s activation", (key) => {
    expect(shouldHandleWorkspaceLink(event({ [key]: true }))).toBe(false);
  });
  test("preserves auxiliary, pre-cancelled, download, and targeted navigation", () => {
    expect(shouldHandleWorkspaceLink(event({ button: 1 }))).toBe(false);
    expect(shouldHandleWorkspaceLink(event({ defaultPrevented: true }))).toBe(false);
    expect(shouldHandleWorkspaceLink(event({}, { download: "" }))).toBe(false);
    expect(shouldHandleWorkspaceLink(event({}, { target: "_blank" }))).toBe(false);
    expect(shouldHandleWorkspaceLink(null)).toBe(false);
  });
});
