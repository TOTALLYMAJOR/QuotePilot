// @vitest-environment node
import { createRequire } from "node:module";
import { transform } from "esbuild";
import { resolveConfig } from "vite";
import { beforeAll, describe, expect, test, vi } from "vitest";
import createViteConfig from "../../../vite.config.js";

const require = createRequire(import.meta.url);
const React = require("react");

function Widget() {}
Widget.defaultProps = { label: "default label", children: "default child" };

async function resolveJsxConfig(command, mode) {
  const config = createViteConfig({ command, mode });
  return resolveConfig({ ...config, configFile: false }, command, mode);
}

function elementSnapshot(value) {
  if (Array.isArray(value)) return value.map(elementSnapshot);
  if (!React.isValidElement(value)) return value;
  return {
    type: value.type,
    key: value.key,
    ref: value.ref,
    props: Object.fromEntries(
      Object.entries(value.props).map(([key, child]) => [key, elementSnapshot(child)])
    )
  };
}

async function evaluateJsx(jsx, config, ref) {
  const { jsxInject = "", jsx: runtime, jsxFactory, jsxFragment, jsxImportSource } = config.esbuild;
  const compiled = await transform(`${jsxInject}\nmodule.exports = (${jsx});`, {
    loader: "jsx",
    format: "cjs",
    jsx: runtime,
    jsxFactory,
    jsxFragment,
    jsxImportSource
  });
  const calls = [];
  const spread = {
    get label() {
      calls.push("getter");
      return "spread label";
    }
  };
  const mark = (value) => {
    calls.push(value);
    return value;
  };
  const module = { exports: {} };
  // Execute the emitted code, including Vite's injected factory bindings.
  new Function("require", "module", "Widget", "ref", "spread", "mark", compiled.code)(
    require, module, Widget, ref, spread, mark
  );
  return { element: elementSnapshot(module.exports), calls };
}

const JSX_CASES = [
  ["no children", "<div />"],
  ["one child", "<div>one</div>"],
  ["multiple and empty children", "<div>one<span>two</span>{false}{0}{null}</div>"],
  ["fragment and keyed children", '<><span key="a"/><span key="b"/></>'],
  ["default props", "<Widget label={undefined} />"],
  ["children prop", '<Widget children="prop child" />'],
  ["nested children override prop", '<Widget children="prop child">nested</Widget>'],
  ["spread key and ref", '<Widget {...{key:"spread",ref,label:"x"}} />'],
  ["spread key overrides earlier key", '<Widget key="first" {...{key:"spread",label:"x"}} />'],
  ["later key overrides spread", '<Widget {...{key:"spread",label:"x"}} key="last" />'],
  ["dynamic children array", '<div>{[<span key="a"/>, <span key="b"/>]}</div>'],
  ["getter before explicit prop", '<Widget {...spread} label={mark("after")} />', ["getter", "after"]],
  ["getter after explicit prop", '<Widget label={mark("before")} {...spread} />', ["before", "getter"]]
];

describe("production JSX transform", () => {
  let production;
  let development;

  beforeAll(async () => {
    production = await resolveJsxConfig("build", "production");
    development = await resolveJsxConfig("serve", "development");
  });

  test("uses the classic production transform with injected React bindings", () => {
    expect(production.esbuild.jsx).toBe("transform");
    expect(production.esbuild.jsxFactory).toBeTruthy();
    expect(production.esbuild.jsxFragment).toBeTruthy();
    expect(production.esbuild.jsxInject).toBeTruthy();
    expect(production.plugins.some((plugin) => plugin.name === "vite:react-babel")).toBe(true);
  });

  test.each([
    ["serve", "development"],
    ["serve", "production"],
    ["build", "test"]
  ])("retains the automatic runtime for %s / %s", async (command, mode) => {
    const config = await resolveJsxConfig(command, mode);
    expect(config.esbuild.jsx).toBe("automatic");
    expect(config.esbuild.jsxInject).toBeUndefined();
    expect(config.plugins.some((plugin) => plugin.name === "vite:react-babel")).toBe(true);
  });

  test.each(JSX_CASES)("preserves %s", async (_name, jsx, expectedCalls = []) => {
    const ref = React.createRef();
    const warnings = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const automatic = await evaluateJsx(jsx, development, ref);
      const classic = await evaluateJsx(jsx, production, ref);
      expect(classic).toEqual(automatic);
      expect(classic.calls).toEqual(expectedCalls);
      expect(classic.element).toHaveProperty("type");
      // React's automatic development runtime additionally warns on spread keys.
      for (const [message] of warnings.mock.calls) {
        expect(message).toContain('A props object containing a "key" prop');
      }
    } finally {
      warnings.mockRestore();
    }
  });
});
