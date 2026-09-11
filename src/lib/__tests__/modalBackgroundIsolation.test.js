// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { isolateModalBackground } from "../modalBackgroundIsolation";

const releases = [];
afterEach(() => {
  releases.reverse().forEach((release) => release());
  releases.length = 0;
  document.body.replaceChildren();
});
function acquire(root) {
  const release = isolateModalBackground(root);
  releases.push(release);
  return release;
}

describe("shared modal background isolation", () => {
  test("isolates siblings along an in-tree dialog path, never its ancestors", () => {
    document.body.innerHTML = '<header id="header"></header><main id="app"><button id="before">Before</button><section id="scrim"><article id="dialog" tabindex="-1"></article></section><footer id="after"></footer></main>';
    const release = acquire(document.getElementById("dialog"));
    for (const id of ["header", "before", "after"]) {
      expect(document.getElementById(id).hasAttribute("inert")).toBe(true);
      expect(document.getElementById(id).getAttribute("aria-hidden")).toBe("true");
    }
    for (const id of ["app", "scrim", "dialog"]) expect(document.getElementById(id).hasAttribute("inert")).toBe(false);
    release();
    expect(document.getElementById("before").hasAttribute("inert")).toBe(false);
  });

  test("restores exact attributes and supports nested scopes released out of order", () => {
    document.body.innerHTML = '<main id="app" aria-hidden="false" inert="preexisting"></main><section id="outer"></section><section id="inner"></section>';
    const app = document.getElementById("app");
    const outer = document.getElementById("outer");
    const inner = document.getElementById("inner");
    const releaseOuter = acquire(outer);
    const releaseInner = acquire(inner);
    expect(inner.hasAttribute("inert")).toBe(false);
    expect(outer.hasAttribute("inert")).toBe(true);
    releaseOuter();
    expect(app.getAttribute("aria-hidden")).toBe("true");
    releaseInner();
    releaseInner();
    expect(app.getAttribute("aria-hidden")).toBe("false");
    expect(app.getAttribute("inert")).toBe("preexisting");
    expect(outer.hasAttribute("aria-hidden")).toBe(false);
  });

  test("isolates late siblings and resumes the outer modal after inner dismissal", async () => {
    document.body.innerHTML = '<main id="app"></main><section id="outer"></section>';
    const outer = document.getElementById("outer");
    acquire(outer);
    const inner = document.createElement("section");
    document.body.appendChild(inner);
    await Promise.resolve();
    expect(inner.hasAttribute("inert")).toBe(true);
    const releaseInner = acquire(inner);
    expect(inner.hasAttribute("inert")).toBe(false);
    releaseInner();
    expect(outer.hasAttribute("inert")).toBe(false);
    expect(inner.hasAttribute("inert")).toBe(true);
  });

  test("does nothing for missing or disconnected targets", () => {
    expect(() => acquire(null)()).not.toThrow();
    expect(() => acquire(document.createElement("article"))()).not.toThrow();
    expect(document.body.hasAttribute("inert")).toBe(false);
  });
});
