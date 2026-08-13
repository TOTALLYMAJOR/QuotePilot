import fs from "node:fs";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../soundKit", () => ({
  playCue: vi.fn(() => true)
}));

import {
  StepMenu,
  StepMenuContent,
  StepServices,
  StepperNumberInput,
  runOneShotMotionClass
} from "../WizardSteps";
import { playCue } from "../soundKit";

const wizardSource = fs.readFileSync(new URL("../WizardSteps.jsx", import.meta.url), "utf8");
const motionCss = fs.readFileSync(new URL("../wizardMotion.css", import.meta.url), "utf8");

function collectElements(node, predicate, found = []) {
  if (!node) return found;
  if (Array.isArray(node)) {
    node.forEach((child) => collectElements(child, predicate, found));
    return found;
  }
  if (!isValidElement(node)) return found;
  if (predicate(node)) found.push(node);
  collectElements(node.props?.children, predicate, found);
  return found;
}

function fakeMotionElement() {
  const classes = new Set();
  const el = {
    reflowCount: 0,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
    }
  };
  Object.defineProperty(el, "offsetWidth", {
    get() {
      el.reflowCount += 1;
      return 240;
    }
  });
  return el;
}

function motionEvent(row, targetExtras = {}) {
  const target = {
    closest: (selector) => (selector === ".checkrow" ? row : null),
    ...targetExtras
  };
  return { target, currentTarget: target };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const menuSections = [
  {
    id: "mains",
    name: "Mains",
    items: [
      { id: "smoked-ribs", name: "Smoked Ribs", type: "per_person", price: 6 },
      { id: "slider-tray", name: "Slider Tray", type: "per_item", price: 48 }
    ]
  }
];

function menuForm(overrides = {}) {
  return {
    menuItems: [],
    menuItemQuantities: {},
    ...overrides
  };
}

const servicesCatalog = {
  packages: [{ id: "classic", name: "Classic", ppp: 18 }],
  addons: [
    { id: "dessert", name: "Dessert", type: "per_person", price: 4 },
    { id: "glassware", name: "Glassware", type: "per_item", price: 2 }
  ],
  rentals: [{ id: "linens", name: "Linens", price: 9 }],
  settings: {}
};

function servicesForm(overrides = {}) {
  return {
    pkg: "classic",
    milesRT: 0,
    guests: 50,
    addons: [],
    addonQuantities: {},
    rentals: [],
    rentalQuantities: {},
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runOneShotMotionClass", () => {
  test("applies the class, forces a reflow, and cleans it up afterwards", async () => {
    const el = fakeMotionElement();

    expect(runOneShotMotionClass(el, "selection-settle", 40)).toBe(true);
    expect(el.classList.contains("selection-settle")).toBe(true);
    expect(el.reflowCount).toBe(1);

    await sleep(120);
    expect(el.classList.contains("selection-settle")).toBe(false);
  });

  test("re-triggering restarts the animation and cancels the previous cleanup", async () => {
    const el = fakeMotionElement();

    runOneShotMotionClass(el, "selection-settle", 60);
    // Second trigger while the first is still active: remove -> reflow -> add.
    runOneShotMotionClass(el, "selection-settle", 100000);
    expect(el.classList.contains("selection-settle")).toBe(true);
    expect(el.reflowCount).toBe(2);

    // Well past the first 60ms deadline: the stale timer must have been
    // cleared, so the class from the second trigger is still on.
    await sleep(250);
    expect(el.classList.contains("selection-settle")).toBe(true);

    // Final short trigger clears the long-lived timer and cleans up.
    runOneShotMotionClass(el, "selection-settle", 20);
    await sleep(100);
    expect(el.classList.contains("selection-settle")).toBe(false);
  });

  test("skips all animation work under prefers-reduced-motion", () => {
    const el = fakeMotionElement();
    globalThis.window = {
      matchMedia: (query) => ({ matches: query === "(prefers-reduced-motion: reduce)" })
    };
    try {
      expect(runOneShotMotionClass(el, "selection-settle", 40)).toBe(false);
      expect(el.classList.contains("selection-settle")).toBe(false);
      expect(el.reflowCount).toBe(0);
    } finally {
      delete globalThis.window;
    }
  });

  test("tolerates missing elements without throwing", () => {
    expect(runOneShotMotionClass(null, "selection-settle", 40)).toBe(false);
    expect(runOneShotMotionClass(undefined, "qty-pulse", 40)).toBe(false);
  });
});

describe("StepMenu selection motion wiring", () => {
  test("explicit selection settles the card and plays the tick cue", () => {
    const setForm = vi.fn();
    const tree = StepMenuContent({ form: menuForm(), setForm, menuSections });
    const checkboxes = collectElements(
      tree,
      (el) => el.type === "input" && el.props.type === "checkbox"
    );
    expect(checkboxes).toHaveLength(2);

    const row = fakeMotionElement();
    checkboxes[0].props.onChange(motionEvent(row, { checked: true }));

    expect(row.classList.contains("selection-settle")).toBe(true);
    expect(playCue).toHaveBeenCalledTimes(1);
    expect(playCue).toHaveBeenCalledWith("tick");

    const next = setForm.mock.calls[0][0]({ menuItems: [], menuItemQuantities: {} });
    expect(next.menuItems).toEqual(["smoked-ribs"]);
  });

  test("deselection neither settles nor plays a cue", () => {
    const setForm = vi.fn();
    const tree = StepMenuContent({
      form: menuForm({ menuItems: ["smoked-ribs"] }),
      setForm,
      menuSections
    });
    const checkboxes = collectElements(
      tree,
      (el) => el.type === "input" && el.props.type === "checkbox"
    );

    const row = fakeMotionElement();
    checkboxes[0].props.onChange(motionEvent(row, { checked: false }));

    expect(row.classList.contains("selection-settle")).toBe(false);
    expect(playCue).not.toHaveBeenCalled();

    const next = setForm.mock.calls[0][0]({
      menuItems: ["smoked-ribs"],
      menuItemQuantities: {}
    });
    expect(next.menuItems).toEqual([]);
  });

  test("quantity edits pulse the row without playing a cue", () => {
    const setForm = vi.fn();
    const tree = StepMenuContent({
      form: menuForm({ menuItems: ["slider-tray"], menuItemQuantities: { "slider-tray": 2 } }),
      setForm,
      menuSections
    });
    const qtyInputs = collectElements(
      tree,
      (el) => el.type === "input" && el.props.className === "qty-input"
    );
    expect(qtyInputs).toHaveLength(1);

    const row = fakeMotionElement();
    qtyInputs[0].props.onChange(motionEvent(row, { value: "4" }));

    expect(row.classList.contains("qty-pulse")).toBe(true);
    expect(row.classList.contains("selection-settle")).toBe(false);
    expect(playCue).not.toHaveBeenCalled();

    const next = setForm.mock.calls[0][0]({ menuItemQuantities: {} });
    expect(next.menuItemQuantities["slider-tray"]).toBe(4);
  });
});

describe("StepServices selection motion wiring", () => {
  test("add-on and rental selection settle their cards and play the tick cue", () => {
    const setForm = vi.fn();
    const onAddonSelection = vi.fn();
    const tree = StepServices({
      form: servicesForm(),
      setForm,
      catalog: servicesCatalog,
      recommendations: [],
      onApplyRecommendation: () => {},
      onAddonSelection
    });
    const checkboxes = collectElements(
      tree,
      (el) => el.type === "input" && el.props.type === "checkbox"
    );
    expect(checkboxes).toHaveLength(3); // 2 add-ons + 1 rental

    const addonRow = fakeMotionElement();
    checkboxes[0].props.onChange(motionEvent(addonRow, { checked: true }));
    expect(addonRow.classList.contains("selection-settle")).toBe(true);
    expect(onAddonSelection).toHaveBeenCalledWith("dessert", true);

    const rentalRow = fakeMotionElement();
    checkboxes[2].props.onChange(motionEvent(rentalRow, { checked: true }));
    expect(rentalRow.classList.contains("selection-settle")).toBe(true);

    expect(playCue).toHaveBeenCalledTimes(2);
    expect(playCue).toHaveBeenNthCalledWith(1, "tick");
    expect(playCue).toHaveBeenNthCalledWith(2, "tick");

    const nextRentals = setForm.mock.calls[1][0]({ rentals: [], rentalQuantities: {} });
    expect(nextRentals.rentals).toEqual(["linens"]);
  });

  test("rental quantity edits pulse the row without playing a cue", () => {
    const setForm = vi.fn();
    const tree = StepServices({
      form: servicesForm({ rentals: ["linens"], rentalQuantities: { linens: 3 } }),
      setForm,
      catalog: servicesCatalog,
      recommendations: [],
      onApplyRecommendation: () => {}
    });
    const qtyInputs = collectElements(
      tree,
      (el) => el.type === "input" && el.props.className === "qty-input"
    );
    expect(qtyInputs).toHaveLength(1);

    const row = fakeMotionElement();
    qtyInputs[0].props.onChange(motionEvent(row, { value: "6" }));

    expect(row.classList.contains("qty-pulse")).toBe(true);
    expect(playCue).not.toHaveBeenCalled();

    const next = setForm.mock.calls[0][0]({ rentalQuantities: {} });
    expect(next.rentalQuantities.linens).toBe(6);
  });
});

describe("StepperNumberInput value-change pulse", () => {
  test("stepper buttons and direct edits pulse the control cluster", () => {
    const onChange = vi.fn();
    const tree = StepperNumberInput({ label: "Servers", min: 0, max: 10, value: 4, onChange });

    const buttons = collectElements(tree, (el) => el.type === "button");
    expect(buttons).toHaveLength(2);

    const stepper = fakeMotionElement();
    const clickEvent = {
      currentTarget: { closest: (selector) => (selector === ".stepper-input" ? stepper : null) }
    };
    buttons[1].props.onClick(clickEvent); // increment
    expect(onChange).toHaveBeenCalledWith(5);
    expect(stepper.classList.contains("qty-pulse")).toBe(true);

    buttons[0].props.onClick(clickEvent); // decrement
    expect(onChange).toHaveBeenCalledWith(3);

    const input = collectElements(tree, (el) => el.type === "input")[0];
    const inputStepper = fakeMotionElement();
    input.props.onChange({
      target: {
        value: "7",
        closest: (selector) => (selector === ".stepper-input" ? inputStepper : null)
      }
    });
    expect(onChange).toHaveBeenCalledWith(7);
    expect(inputStepper.classList.contains("qty-pulse")).toBe(true);
  });
});

describe("static markup stays free of one-shot motion classes", () => {
  test("StepMenu and StepServices render without settle/pulse classes", () => {
    const menuMarkup = renderToStaticMarkup(
      <StepMenu
        form={menuForm({ menuItems: ["slider-tray"] })}
        setForm={() => {}}
        menuSections={menuSections}
      />
    );
    expect(menuMarkup).toContain('class="checkrow checkrow-choice is-selected"');
    expect(menuMarkup).not.toContain("selection-settle");
    expect(menuMarkup).not.toContain("qty-pulse");

    const servicesMarkup = renderToStaticMarkup(
      <StepServices
        form={servicesForm({ rentals: ["linens"] })}
        setForm={() => {}}
        catalog={servicesCatalog}
        recommendations={[]}
        onApplyRecommendation={() => {}}
      />
    );
    expect(servicesMarkup).toContain('class="checkrow checkrow-choice is-selected"');
    expect(servicesMarkup).not.toContain("selection-settle");
    expect(servicesMarkup).not.toContain("qty-pulse");
  });
});

describe("wizard motion source contracts", () => {
  test("WizardSteps owns its motion css import, cue routing, and reduced-motion guard", () => {
    expect(wizardSource).toContain('import "./wizardMotion.css"');
    expect(wizardSource).toContain('import { playCue } from "./soundKit"');
    // Tick fires from exactly the two explicit selection handlers.
    expect(wizardSource.match(/playCue\("tick"\)/g)).toHaveLength(2);
    expect(wizardSource).not.toContain("shimmerChime");
    expect(wizardSource).toContain('typeof window === "undefined"');
    expect(wizardSource).toContain('window.matchMedia("(prefers-reduced-motion: reduce)")');
  });

  test("wizardMotion.css uses shared tokens and animates transform/opacity only", () => {
    expect(motionCss).toContain("var(--motion-base)");
    expect(motionCss).toContain("var(--ease-spring)");
    expect(motionCss).toContain("var(--ease-out-soft)");
    expect(motionCss).toContain("var(--tone-gold-2)");
    expect(motionCss).toContain(".selection-settle::after");
    expect(motionCss).toContain(".qty-pulse::before");
    expect(motionCss).toContain("@media (prefers-reduced-motion: reduce)");

    const keyframeBlocks = motionCss.match(/@keyframes[^{]+\{[\s\S]*?\n\}/g) || [];
    expect(keyframeBlocks).toHaveLength(3);
    for (const block of keyframeBlocks) {
      const body = block.replace(/@keyframes[^{]+\{/, "");
      const properties = [...body.matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]);
      expect(properties.length).toBeGreaterThan(0);
      for (const property of properties) {
        expect(["transform", "opacity"]).toContain(property);
      }
    }
  });
});
