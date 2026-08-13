import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const REQUIRED_GATES = [
  process.env.VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED,
  process.env.VITE_AMBIENT_UI_ENABLED,
  process.env.VITE_PILOT_COMMAND_ENABLED
].every((value) => ["1", "true", "yes", "on"].includes(
  String(value || "").trim().toLowerCase()
));
const CAPTURE_PROOF = ["1", "true", "yes", "on"].includes(
  String(process.env.CAPTURE_AMBIENT_BROWSER_PROOF || "").trim().toLowerCase()
);
const PROOF_DIRECTORY = "output/playwright/ambient-intelligence-current";
const QUOTE_ID = "pilot-voice-capture-proof";
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1440, height: 1000 }
];

const VOICE_QUOTE = {
  organizationId: "e2e-org",
  id: QUOTE_ID,
  customerId: "pilot-voice-customer",
  quoteNumber: "Q-VOICE-PROOF",
  status: "draft",
  activeVersionId: "v0004",
  latestVersionNumber: 4,
  createdAtISO: "2026-08-12T12:00:00.000Z",
  updatedAtISO: "2026-08-12T18:00:00.000Z",
  customer: {
    name: "Avery Bennett",
    email: "avery@example.test",
    phone: "205-555-0184",
    organization: "Bennett Foundation"
  },
  event: {
    name: "Autumn Benefit Dinner",
    date: "2026-09-19",
    time: "18:00",
    hours: 6,
    venue: "The Foundry Hall",
    venueAddress: "1200 East Fifth Street, Austin, TX",
    style: "Plated",
    guests: 120,
    servers: 8,
    chefs: 3,
    bartenders: 0
  },
  selection: {
    eventTypeId: "wedding",
    packageId: "classic",
    packageName: "Classic",
    menuItems: ["garden-salad", "herb-chicken"],
    menuItemNames: ["Garden Salad", "Herb Chicken"],
    menuItemQuantities: { "garden-salad": 120, "herb-chicken": 120 },
    addons: [],
    rentals: [],
    eventTemplateId: "custom"
  },
  totals: {
    total: 8400,
    deposit: 2520,
    serverLabor: 1056,
    chefLabor: 504,
    bartenderLabor: 0,
    serviceFeePctApplied: 0.2,
    taxRateApplied: 0.1
  },
  pricing: {
    authority: "server_authoritative",
    calculatedAt: "2026-08-12T18:00:00.000Z",
    inputs: { event: { guests: 120 } },
    lineItems: [
      { id: "classic", category: "package", total: 6000 },
      { id: "labor", category: "labor", total: 1560 }
    ],
    subtotal: 7560,
    grandTotal: 8400,
    deposit: { pct: 0.3, amount: 2520 },
    rulesSnapshot: { pricingSettingsVersion: 12 }
  },
  lifecycle: { draftAtISO: "2026-08-12T12:00:00.000Z" }
};

const LOCAL_CATALOG = {
  packages: [{
    id: "classic",
    name: "Classic",
    ppp: 50,
    active: true,
    includedMenuItemIds: ["garden-salad", "herb-chicken"]
  }],
  addons: [],
  rentals: [],
  settings: {
    catalogRevision: 12,
    pricingSetupConfirmed: true,
    pricingConfirmation: {
      actorUid: "voice-proof-admin",
      actorEmail: "voice-proof-admin@example.test",
      confirmedAtISO: "2026-08-12T18:00:00.000Z",
      confirmedCatalogRevision: 12
    },
    bartenderRate: 30,
    serverRate: 22,
    chefRate: 28,
    serviceFeePct: 0.2,
    taxRate: 0.1,
    depositPct: 0.3,
    eventTemplates: [{ id: "wedding", name: "Wedding" }],
    menuSections: [
      {
        id: "starters",
        name: "Starters",
        items: [{
          id: "garden-salad",
          name: "Garden Salad",
          pricingType: "per_person",
          price: 6,
          active: true
        }]
      },
      {
        id: "entrees",
        name: "Entrees",
        items: [{
          id: "herb-chicken",
          name: "Herb Chicken",
          pricingType: "per_person",
          price: 18,
          active: true
        }]
      }
    ]
  }
};

async function seedVoiceCapture(page) {
  await page.addInitScript(({ catalog, quote }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("qp.workspaceSoundsEnabled", "false");
    localStorage.setItem("quoteWizard.quotes", JSON.stringify([quote]));
    localStorage.setItem("quoteWizard.catalog", JSON.stringify(catalog));
    localStorage.setItem("quoteWizard.catalog.e2e-org", JSON.stringify(catalog));

    const instances = [];
    class DeterministicSpeechRecognition {
      constructor() {
        this.started = false;
        this.stopped = false;
        this.aborted = false;
        this.ended = false;
        this.transcript = "add another bartender";
        instances.push(this);
      }

      start() {
        this.started = true;
      }

      stop() {
        if (this.stopped || this.aborted || this.ended) return;
        this.stopped = true;
        queueMicrotask(() => {
          if (this.aborted || this.ended) return;
          if (this.transcript) {
            this.onresult?.({
              results: [[{
                transcript: this.transcript,
                confidence: 0.99
              }]]
            });
          }
          this.ended = true;
          this.onend?.();
        });
      }

      abort() {
        if (this.aborted || this.ended) return;
        this.aborted = true;
        queueMicrotask(() => this.onend?.());
      }
    }

    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      writable: true,
      value: DeterministicSpeechRecognition
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      writable: true,
      value: DeterministicSpeechRecognition
    });

    const latest = () => instances[instances.length - 1] || null;
    globalThis.__quotePilotVoiceE2E = {
      confirmStart() {
        const recognition = latest();
        recognition?.onstart?.();
      },
      setTranscript(transcript) {
        const recognition = latest();
        if (recognition) recognition.transcript = String(transcript || "");
      },
      fail(error) {
        const recognition = latest();
        if (!recognition || recognition.ended) return;
        recognition.ended = true;
        recognition.onerror?.({ error: String(error || "error") });
        recognition.onend?.();
      },
      snapshot() {
        return instances.map((recognition) => ({
          started: recognition.started,
          stopped: recognition.stopped,
          aborted: recognition.aborted,
          ended: recognition.ended,
          transcript: recognition.transcript
        }));
      }
    };
  }, { catalog: LOCAL_CATALOG, quote: VOICE_QUOTE });
}

async function openVoiceEditor(page) {
  await page.goto(`/app/quotes/${QUOTE_ID}/edit`);
  const command = page.locator('[data-pilot-command="pilot-deterministic-command-v1"]');
  await expect(command).toBeVisible({ timeout: 30_000 });
  await expect(command).toHaveAttribute("data-pilot-voice-mode", "hold");
  await expect(command).toHaveAttribute("data-pilot-voice-state", "idle");
  return command;
}

async function readPersistedQuote(page) {
  return page.evaluate((quoteId) => {
    const quotes = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]");
    return quotes.find((quote) => quote.id === quoteId) || null;
  }, QUOTE_ID);
}

async function armIntentAcknowledgementProbe(command) {
  await command.evaluate((root) => {
    const control = root.querySelector(".pilot-command-voice");
    const probe = {
      intentAt: null,
      requestingAt: null,
      deltaMs: null
    };
    globalThis.__quotePilotVoiceAcknowledgement = probe;
    const recordIntent = (event) => {
      if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
      probe.intentAt = performance.now();
    };
    control.addEventListener("pointerdown", recordIntent, { capture: true, once: true });
    control.addEventListener("keydown", recordIntent, { capture: true, once: true });
    const observer = new MutationObserver(() => {
      if (
        probe.intentAt !== null
        && probe.requestingAt === null
        && root.getAttribute("data-pilot-voice-state") === "requesting"
      ) {
        probe.requestingAt = performance.now();
        probe.deltaMs = probe.requestingAt - probe.intentAt;
        observer.disconnect();
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-pilot-voice-state"] });
  });
}

async function expectFastAcknowledgement(page) {
  await expect.poll(() => page.evaluate(() => (
    globalThis.__quotePilotVoiceAcknowledgement?.deltaMs ?? null
  ))).not.toBeNull();
  const acknowledgementMs = await page.evaluate(() => (
    globalThis.__quotePilotVoiceAcknowledgement.deltaMs
  ));
  expect(acknowledgementMs).toBeGreaterThanOrEqual(0);
  expect(acknowledgementMs).toBeLessThanOrEqual(250);
}

async function startPointerCapture(page, command) {
  const voice = command.locator(".pilot-command-voice");
  await voice.scrollIntoViewIfNeeded();
  await armIntentAcknowledgementProbe(command);
  const box = await voice.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + (box.width / 2), box.y + (box.height / 2));
  await page.mouse.down();
  await expect(command).toHaveAttribute("data-pilot-voice-state", "requesting");
  await expect(command.locator("#pilot-command-voice-status"))
    .toContainText("Waiting for microphone access");
  await expectFastAcknowledgement(page);
  await page.evaluate(() => globalThis.__quotePilotVoiceE2E.confirmStart());
  await expect(command).toHaveAttribute("data-pilot-voice-state", "listening");
  await expect(command.locator("#pilot-command-voice-status"))
    .toContainText("Listening while you hold");
  return voice;
}

async function finishPointerCapture(page, command, transcript) {
  await page.evaluate((value) => globalThis.__quotePilotVoiceE2E.setTranscript(value), transcript);
  await page.mouse.up();
  await expect(command).toHaveAttribute("data-pilot-voice-state", "preview_ready");
  await expect(command.locator("#pilot-command-voice-status"))
    .toContainText("Voice captured. Review before applying.");
}

async function expectPilotGeometry(page, command) {
  const geometry = await command.evaluate((root) => {
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity || 1) > 0
        && rect.width > 0
        && rect.height > 0;
    };
    const label = (element) => String(
      element.getAttribute("aria-label") || element.textContent || element.tagName
    ).replace(/\s+/gu, " ").trim().slice(0, 90);
    const intersects = (first, second, tolerance = 1) => (
      first.left < second.right - tolerance
      && first.right > second.left + tolerance
      && first.top < second.bottom - tolerance
      && first.bottom > second.top + tolerance
    );
    const groups = [
      root,
      root.querySelector(".pilot-command-row"),
      root.querySelector(".pilot-command-preview"),
      root.querySelector(".pilot-command-proposal"),
      root.querySelector(".pilot-command-actions")
    ].filter(Boolean);
    const collisions = [];
    groups.forEach((group) => {
      const peers = [...group.children].filter(visible);
      peers.forEach((first, firstIndex) => {
        peers.slice(firstIndex + 1).forEach((second) => {
          if (intersects(first.getBoundingClientRect(), second.getBoundingClientRect())) {
            collisions.push({
              group: group.className || group.tagName,
              first: label(first),
              second: label(second)
            });
          }
        });
      });
    });
    const voiceRect = root.querySelector(".pilot-command-voice").getBoundingClientRect();
    return {
      documentOverflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      surfaceOverflowPx: root.scrollWidth - root.clientWidth,
      collisions,
      voiceControl: {
        width: voiceRect.width,
        height: voiceRect.height,
        left: voiceRect.left,
        right: voiceRect.right,
        viewportWidth: window.innerWidth
      }
    };
  });

  expect(geometry.documentOverflowPx).toBeLessThanOrEqual(1);
  expect(geometry.surfaceOverflowPx).toBeLessThanOrEqual(1);
  expect(geometry.collisions).toEqual([]);
  // Chromium can report a 44px CSS target a few ten-thousandths below 44
  // after device-pixel rounding, so keep a sub-pixel tolerance here.
  expect(geometry.voiceControl.width).toBeGreaterThanOrEqual(43.99);
  expect(geometry.voiceControl.height).toBeGreaterThanOrEqual(43.99);
  expect(geometry.voiceControl.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.voiceControl.right).toBeLessThanOrEqual(geometry.voiceControl.viewportWidth + 1);
}

async function captureVoiceProof(command, viewportWidth) {
  if (!CAPTURE_PROOF) return;
  mkdirSync(PROOF_DIRECTORY, { recursive: true });
  await command.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  await command.screenshot({
    path: `${PROOF_DIRECTORY}/pilot-voice-capture-${viewportWidth}.png`,
    animations: "disabled"
  });
}

test.describe("Pilot hold-to-capture voice proof", () => {
  test.skip(
    !REQUIRED_GATES,
    "Pilot voice proof requires the customer-centered, Ambient, and Pilot command gates."
  );

  test.beforeEach(async ({ page }) => {
    await seedVoiceCapture(page);
  });

  for (const viewport of VIEWPORTS) {
    test(`holds, releases to preview, and remains explicit at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const command = await openVoiceEditor(page);
      const persistedBefore = await readPersistedQuote(page);
      const bartenders = page.getByRole("spinbutton", { name: "Bartenders" });
      await expect(bartenders).toHaveValue("0");

      const voice = await startPointerCapture(page, command);
      const voiceBox = await voice.boundingBox();
      expect(voiceBox.height).toBeGreaterThanOrEqual(43.99);
      expect(voiceBox.width).toBeGreaterThanOrEqual(43.99);

      await finishPointerCapture(page, command, "add another bartender");
      await expect(command.locator(".pilot-command-input")).toHaveValue("add another bartender");
      await expect(command.locator('[data-pilot-command-class="draft_mutation"]'))
        .toContainText("Add 1 bartender");
      const proposal = command.locator('[data-pilot-command-class="draft_mutation"]');
      const apply = proposal.locator("button");
      await expect(apply).toHaveText("Apply to draft");
      await expect(apply).toBeVisible();
      await expect(bartenders).toHaveValue("0");
      expect(await readPersistedQuote(page)).toEqual(persistedBefore);

      await expectPilotGeometry(page, command);
      await captureVoiceProof(command, viewport.width);

      await apply.click();
      await expect(bartenders).toHaveValue("1");
      await expect(apply).toHaveText("Applied to draft");
      await expect(apply).toBeDisabled();
      expect(await readPersistedQuote(page)).toEqual(persistedBefore);
    });
  }

  test("gives keyboard hold the same preview-confirm boundary", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    const command = await openVoiceEditor(page);
    const voice = command.locator(".pilot-command-voice");
    const persistedBefore = await readPersistedQuote(page);
    await voice.focus();
    await armIntentAcknowledgementProbe(command);

    await page.keyboard.down("Space");
    await expect(command).toHaveAttribute("data-pilot-voice-state", "requesting");
    await expectFastAcknowledgement(page);
    await page.evaluate(() => {
      globalThis.__quotePilotVoiceE2E.setTranscript("switch to buffet");
      globalThis.__quotePilotVoiceE2E.confirmStart();
    });
    await expect(command).toHaveAttribute("data-pilot-voice-state", "listening");
    await page.keyboard.up("Space");

    await expect(command).toHaveAttribute("data-pilot-voice-state", "preview_ready");
    await expect(command.locator('[data-pilot-command-class="draft_mutation"]'))
      .toContainText("Service style → Buffet");
    await expect(command.getByRole("button", { name: "Apply to draft", exact: true })).toBeVisible();
    expect(await readPersistedQuote(page)).toEqual(persistedBefore);
    expect(await page.evaluate(() => globalThis.__quotePilotVoiceE2E.snapshot())).toHaveLength(1);
    await expectPilotGeometry(page, command);
  });

  test("cancels cleanly and explains blocked microphone recovery", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const command = await openVoiceEditor(page);
    const voice = command.locator(".pilot-command-voice");
    const persistedBefore = await readPersistedQuote(page);
    await voice.focus();

    await page.keyboard.down("Space");
    await page.evaluate(() => globalThis.__quotePilotVoiceE2E.confirmStart());
    await expect(command).toHaveAttribute("data-pilot-voice-state", "listening");
    await page.keyboard.press("Escape");
    await page.keyboard.up("Space");
    await expect(command).toHaveAttribute("data-pilot-voice-state", "canceled");
    await expect(command.locator("#pilot-command-voice-status"))
      .toContainText("Voice capture canceled. Your draft is unchanged.");
    await expect(command.locator(".pilot-command-preview")).toHaveCount(0);

    await page.keyboard.down("Space");
    await expect(command).toHaveAttribute("data-pilot-voice-state", "requesting");
    await page.evaluate(() => globalThis.__quotePilotVoiceE2E.fail("not-allowed"));
    await page.keyboard.up("Space");
    await expect(command).toHaveAttribute("data-pilot-voice-state", "permission_blocked");
    await expect(command.locator("#pilot-command-voice-status"))
      .toContainText("Allow it in your browser or type your request");
    await expect(command.locator(".pilot-command-preview")).toHaveCount(0);
    expect(await readPersistedQuote(page)).toEqual(persistedBefore);
    await expectPilotGeometry(page, command);
  });
});
