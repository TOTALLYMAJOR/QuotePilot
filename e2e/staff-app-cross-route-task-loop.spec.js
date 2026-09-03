import { expect, test } from "@playwright/test";

const REQUIRED_GATES = [
  process.env.VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED,
  process.env.VITE_AMBIENT_UI_ENABLED,
  process.env.VITE_PILOT_NOW_ENABLED
].every((value) => ["1", "true", "yes", "on"].includes(
  String(value || "").trim().toLowerCase()
));

const ORGANIZATION_ID = "e2e-org";
const QUOTE_ID = "rivera-wedding";
const CLIENT_ID = "client-rivera";
const FOLLOW_UP_ID = `follow-up:${QUOTE_ID}`;
const QUOTES_KEY = "quoteWizard.quotes";
const HISTORY_KEY = "quoteWizard.quoteHistory";
const CATALOG_KEYS = ["quoteWizard.catalog", `quoteWizard.catalog.${ORGANIZATION_ID}`];
const TASK_STORAGE_PREFIX = "quotepilot.workspace-task-journey.v1:";
const WORKFLOW_FOCUS = Object.freeze({
  organizationId: ORGANIZATION_ID,
  destination: "workflow",
  quoteId: QUOTE_ID,
  attentionType: "follow_up",
  requestId: FOLLOW_UP_ID
});

const SOURCE_CASES = [
  {
    label: "Now",
    path: "/app",
    viewport: { width: 390, height: 844 },
    readySelector: ".ambient-now",
    actionSelector: `.ambient-now button[data-workspace-task-id="review-now-priority:${FOLLOW_UP_ID}"]`,
    taskId: `review-now-priority:${FOLLOW_UP_ID}`,
    origin: { routeId: "home", pathname: "/app" },
    continuity: true
  },
  {
    label: "Opportunities",
    path: "/app/quotes",
    viewport: { width: 768, height: 900 },
    readySelector: ".ambient-opportunities",
    actionSelector: `.ambient-opportunities button[data-workspace-task-id="review-opportunity-workflow:${QUOTE_ID}:${FOLLOW_UP_ID}"]`,
    taskId: `review-opportunity-workflow:${QUOTE_ID}:${FOLLOW_UP_ID}`,
    origin: { routeId: "quote-list", pathname: "/app/quotes" }
  },
  {
    label: "Client 360",
    path: `/app/customers/${CLIENT_ID}`,
    viewport: { width: 1440, height: 1000 },
    readySelector: `.ambient-client-overview[data-client-id="${CLIENT_ID}"]`,
    actionSelector: `.ambient-client-overview button[data-workspace-task-id="review-client-follow_up:${QUOTE_ID}:${FOLLOW_UP_ID}"]`,
    taskId: `review-client-follow_up:${QUOTE_ID}:${FOLLOW_UP_ID}`,
    origin: { routeId: "customer-detail", pathname: `/app/customers/${CLIENT_ID}` }
  }
];

function dateOnlyDaysFromNow(days, now = new Date()) {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildRiveraQuote(now = new Date()) {
  return {
    organizationId: ORGANIZATION_ID,
    id: QUOTE_ID,
    customerId: CLIENT_ID,
    quoteNumber: "QP-RIVERA-250",
    status: "draft",
    activeVersionId: "v0003",
    latestVersionNumber: 3,
    createdAtISO: "2026-08-01T14:00:00.000Z",
    updatedAtISO: "2026-08-20T15:30:00.000Z",
    expiresAtISO: "2099-12-31T00:00:00.000Z",
    customer: {
      name: "Avery & Jordan Rivera",
      email: "rivera@example.test",
      phone: "205-555-0250",
      organization: "Rivera Family"
    },
    event: {
      name: "Rivera Wedding",
      date: dateOnlyDaysFromNow(45, now),
      time: "17:30",
      hours: 5,
      venue: "The Glass House",
      venueAddress: "250 Garden Lane",
      style: "Plated",
      guests: 96,
      servers: 6,
      chefs: 2,
      bartenders: 1
    },
    selection: {
      eventTypeId: "wedding",
      packageId: "premium",
      packageName: "Premium",
      menuItems: ["wedding__meats__roasted-chicken"],
      menuItemNames: ["Roasted Chicken"],
      addons: [],
      rentals: [],
      eventTemplateId: "custom"
    },
    totals: {
      base: 2304,
      addons: 0,
      rentals: 0,
      menu: 0,
      serverLabor: 750,
      chefLabor: 300,
      bartenderLabor: 175,
      labor: 1225,
      travel: 0,
      serviceFee: 705.8,
      tax: 423.48,
      total: 4658.28,
      deposit: 1397.48,
      serviceFeePctApplied: 0.2,
      taxRateApplied: 0.1
    },
    booking: { confirmationStatus: "pending" },
    payment: { depositStatus: "unpaid", finalBalance: { status: "unpaid" } },
    lifecycle: { draftAtISO: "2026-08-01T14:00:00.000Z" },
    workflow: {
      followUp: {
        completed: false,
        dueDate: dateOnlyDaysFromNow(-1, now),
        note: "Review final count with Avery and Jordan.",
        stage: "proposal_sent"
      }
    }
  };
}

async function seedWorkspace(page) {
  await page.addInitScript(({ quote, quotesKey, historyKey, seedMarker }) => {
    if (sessionStorage.getItem(seedMarker) === "true") return;
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("qp.workspaceSoundsEnabled", "false");
    localStorage.setItem(quotesKey, JSON.stringify([quote]));
    localStorage.setItem(historyKey, JSON.stringify([]));
    sessionStorage.setItem(seedMarker, "true");
  }, {
    quote: buildRiveraQuote(),
    quotesKey: QUOTES_KEY,
    historyKey: HISTORY_KEY,
    seedMarker: "quotepilot.e2e.task-loop-seeded"
  });
}

async function gotoWorkspace(page, path, readySelector) {
  await page.goto(path);
  const setupHeading = page.getByRole("heading", { name: "Bring Your Catalog to Life" });
  const workspaceHeader = page.locator(".site-header");
  await expect(setupHeading.or(workspaceHeader)).toBeVisible({ timeout: 30_000 });
  if (await setupHeading.isVisible()) {
    await page.getByRole("button", { name: "Explore the workspace" }).click();
  }
  const ready = page.locator(readySelector);
  await expect(ready).toBeVisible({ timeout: 30_000 });
  return ready;
}

async function readBusinessState(page) {
  return page.evaluate(({ quotesKey, historyKey, catalogKeys }) => ({
    quotes: localStorage.getItem(quotesKey),
    history: localStorage.getItem(historyKey),
    catalog: Object.fromEntries(catalogKeys.map((key) => [key, localStorage.getItem(key)]))
  }), {
    quotesKey: QUOTES_KEY,
    historyKey: HISTORY_KEY,
    catalogKeys: CATALOG_KEYS
  });
}

async function readTaskJourney(page) {
  return page.evaluate((prefix) => {
    const keys = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    keys.sort();
    if (keys.length !== 1) return { keys, serialized: null, journey: null };
    const serialized = sessionStorage.getItem(keys[0]);
    try {
      return { keys, serialized, journey: JSON.parse(serialized) };
    } catch {
      return { keys, serialized, journey: null };
    }
  }, TASK_STORAGE_PREFIX);
}

function expectExactInProgressJourney(stored, taskId, origin) {
  expect(stored.keys).toEqual([`${TASK_STORAGE_PREFIX}${encodeURIComponent(ORGANIZATION_ID)}`]);
  expect(stored.journey).toMatchObject({
    modelId: "workspace-task-journey-v1",
    authority: "presentation_only",
    persistence: "session_only",
    organizationId: WORKFLOW_FOCUS.organizationId,
    principal: { id: "e2e-admin", role: "admin" },
    taskId,
    phase: "in_progress",
    origin,
    destination: WORKFLOW_FOCUS.destination,
    object: { id: WORKFLOW_FOCUS.requestId, type: "workflow-item" },
    focus: {
      quoteId: WORKFLOW_FOCUS.quoteId,
      attentionType: WORKFLOW_FOCUS.attentionType,
      requestId: WORKFLOW_FOCUS.requestId
    },
    intentId: "review_follow_up",
    proof: null
  });
  expect(stored.journey.startedAtISO).toMatch(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
  );
  expect(Object.keys(stored.journey.focus).sort()).toEqual([
    "attentionType",
    "quoteId",
    "requestId"
  ]);
  expect(stored.serialized).not.toContain("rivera@example.test");
  expect(stored.serialized).not.toContain("Avery & Jordan Rivera");
  expect(stored.serialized).not.toContain("Review final count with Avery and Jordan.");
  expect(stored.serialized).not.toContain("The Glass House");
}

function observeUnexpectedMutatingRequests(page) {
  const requests = [];
  page.on("request", (request) => {
    const method = request.method().toUpperCase();
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return;
    requests.push({ method, url: request.url() });
  });
  return requests;
}

async function armTaskRailLatencyProbe(action, taskId) {
  await action.evaluate((button, expectedTaskId) => {
    window.__quotePilotTaskRailProbe = {
      expectedTaskId,
      startedAt: null,
      visibleAt: null
    };
    button.addEventListener("click", () => {
      const probe = window.__quotePilotTaskRailProbe;
      probe.startedAt = performance.now();
      const recordVisibleRail = () => {
        const rail = [...document.querySelectorAll(".workspace-task-journey")]
          .find((candidate) => (
            candidate.dataset.workspaceTaskId === expectedTaskId
            && candidate.getBoundingClientRect().width > 0
            && candidate.getBoundingClientRect().height > 0
          ));
        if (!rail || probe.visibleAt !== null) return;
        probe.visibleAt = performance.now();
        window.__quotePilotTaskRailObserver?.disconnect();
      };
      window.__quotePilotTaskRailObserver = new MutationObserver(recordVisibleRail);
      window.__quotePilotTaskRailObserver.observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true
      });
      recordVisibleRail();
      requestAnimationFrame(recordVisibleRail);
    }, { capture: true, once: true });
  }, taskId);
}

async function readTaskRailLatency(page) {
  await expect.poll(() => page.evaluate(() => (
    window.__quotePilotTaskRailProbe?.visibleAt ?? null
  )), { timeout: 1_500 }).not.toBeNull();
  return page.evaluate(() => {
    const probe = window.__quotePilotTaskRailProbe;
    return probe.visibleAt - probe.startedAt;
  });
}

function exactWorkflowUrl(url) {
  const parsed = new URL(url);
  return parsed.pathname === "/app/workflow"
    && JSON.stringify(Object.fromEntries(parsed.searchParams)) === JSON.stringify({
      quoteId: WORKFLOW_FOCUS.quoteId,
      attentionType: WORKFLOW_FOCUS.attentionType,
      requestId: WORKFLOW_FOCUS.requestId
    });
}

async function expectExactWorkflowArrival(page, source) {
  await expect(page).toHaveURL(exactWorkflowUrl);
  const arrival = page.locator('[data-arrival-surface="workflow"]');
  await expect(arrival).toHaveAttribute("data-arrival-state", "resolved");
  const exactAttention = page.locator(`[data-attention-id="${FOLLOW_UP_ID}"]`);
  await expect(exactAttention).toBeVisible();
  await expect(exactAttention).toBeFocused();
  await expect(page.locator("[data-attention-id][aria-current]")).toHaveCount(0);

  const rail = page.locator(
    `.workspace-task-journey[data-workspace-task-id="${source.taskId}"]`
  );
  await expect(rail).toBeVisible();
  const namedRail = page.getByRole("region", {
    name: "Current task: Follow-up, In progress",
    exact: true
  });
  await expect(namedRail).toHaveCount(1);
  await expect(namedRail).toHaveAttribute("data-workspace-task-id", source.taskId);
  await expect(rail).toHaveAttribute("data-workspace-task-state", "in_progress");
  await expect(rail).toHaveAttribute("data-workspace-task-context", "ready");
  await expect(rail).toContainText("Completion still requires authoritative confirmation.");
  await expect(rail).not.toContainText("Completed");

  const stored = await readTaskJourney(page);
  expectExactInProgressJourney(stored, source.taskId, source.origin);
  return { rail, stored };
}

async function expectTaskRailGeometry(page, rail, viewportWidth) {
  const geometry = await rail.evaluate((element) => {
    const visible = (candidate) => {
      if (!candidate) return false;
      const style = getComputedStyle(candidate);
      const rect = candidate.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity || 1) > 0
        && rect.width > 0
        && rect.height > 0;
    };
    const box = (candidate) => {
      if (!visible(candidate)) return null;
      const rect = candidate.getBoundingClientRect();
      return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height
      };
    };
    const overlaps = (left, right) => Boolean(left && right)
      && Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1
      && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1;
    const carrier = element.closest(".workspace-continuity-stack") || element;
    const railBox = box(element);
    const chrome = {
      header: box(document.querySelector(".site-header")),
      newQuote: box(document.querySelector('[data-ambient-utility="new-quote"]')),
      primaryNavigation: box(document.querySelector(".ambient-primary-navigation"))
    };
    const controls = [...element.querySelectorAll("button")]
      .filter(visible)
      .map((control) => {
        const rect = control.getBoundingClientRect();
        return {
          label: control.getAttribute("aria-label") || control.textContent.trim(),
          width: rect.width,
          height: rect.height
        };
      });
    return {
      position: getComputedStyle(element).position,
      carrierPosition: getComputedStyle(carrier).position,
      rail: railBox,
      railOverflowPx: Math.max(0, element.scrollWidth - element.clientWidth),
      documentOverflowPx: Math.max(
        0,
        document.documentElement.scrollWidth - document.documentElement.clientWidth
      ),
      collisions: Object.entries(chrome)
        .filter(([, chromeBox]) => overlaps(railBox, chromeBox))
        .map(([name]) => name),
      controls,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    };
  });

  expect(geometry.viewport.width).toBe(viewportWidth);
  expect(geometry.position).toBe("relative");
  expect(geometry.carrierPosition).toBe(viewportWidth <= 760 ? "relative" : "sticky");
  expect(geometry.rail.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.rail.right).toBeLessThanOrEqual(geometry.viewport.width + 1);
  expect(geometry.railOverflowPx).toBeLessThanOrEqual(1);
  expect(geometry.documentOverflowPx).toBeLessThanOrEqual(1);
  expect(geometry.collisions).toEqual([]);
  expect(geometry.controls.length).toBeGreaterThan(0);
  expect(geometry.controls.filter(({ width, height }) => width < 44 || height < 44)).toEqual([]);
}

async function startSourceJourney(page, source) {
  const action = page.locator(source.actionSelector);
  await expect(action).toBeVisible();
  await expect(action).toHaveCount(1);
  await expect(page.locator(".workspace-task-journey")).toHaveCount(0);
  await armTaskRailLatencyProbe(action, source.taskId);
  await action.click();
  const latencyMs = await readTaskRailLatency(page);
  expect(latencyMs).toBeLessThanOrEqual(250);
  return expectExactWorkflowArrival(page, source);
}

test.describe("Staff cross-route task journey", () => {
  test.skip(
    !REQUIRED_GATES,
    "The task-loop gate requires the customer-centered, Ambient, and Pilot Now feature flags."
  );

  test.beforeEach(async ({ page }) => {
    await seedWorkspace(page);
  });

  for (const source of SOURCE_CASES) {
    test(`${source.label} preserves exact task identity and focus at ${source.viewport.width}px`, async ({ page }) => {
      test.info().annotations.push({
        type: "evidence-boundary",
        description: "The task rail is presentation-only session state. Arrival never proves task completion or mutates a business record."
      });
      await page.setViewportSize(source.viewport);
      await gotoWorkspace(page, source.path, source.readySelector);
      const businessBefore = await readBusinessState(page);
      const mutatingRequests = observeUnexpectedMutatingRequests(page);

      const { rail, stored } = await startSourceJourney(page, source);
      await expectTaskRailGeometry(page, rail, source.viewport.width);
      expect(await readBusinessState(page)).toEqual(businessBefore);
      expect(mutatingRequests).toEqual([]);

      if (source.continuity) {
        await page.reload();
        const reloaded = await expectExactWorkflowArrival(page, source);
        expect(reloaded.stored.serialized).toBe(stored.serialized);

        await page.goBack();
        await expect(page).toHaveURL(/\/app$/u);
        await expect(page.locator(source.readySelector)).toBeVisible({ timeout: 30_000 });
        const originRail = page.locator(
          `.workspace-task-journey[data-workspace-task-id="${source.taskId}"]`
        );
        await expect(originRail).toHaveAttribute("data-workspace-task-state", "in_progress");
        await expect(originRail.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
        expectExactInProgressJourney(await readTaskJourney(page), source.taskId, source.origin);

        await page.goForward();
        const forwardArrival = await expectExactWorkflowArrival(page, source);
        expect(await readBusinessState(page)).toEqual(businessBefore);
        expect(mutatingRequests).toEqual([]);

        await forwardArrival.rail.getByRole("button", { name: "Stop tracking", exact: true }).click();
        await expect(page.locator(".workspace-task-journey")).toHaveCount(0);
        expect(await readTaskJourney(page)).toEqual({
          keys: [],
          serialized: null,
          journey: null
        });
        expect(await readBusinessState(page)).toEqual(businessBefore);
        expect(mutatingRequests).toEqual([]);
      }
    });
  }

  test("dirty Quick Updates blocks Continue without changing the stored task until dismissal", async ({ page }) => {
    test.setTimeout(90_000);
    test.info().annotations.push({
      type: "evidence-boundary",
      description: "Discarding a local Quick Updates draft resumes exact presentation context only; it does not resolve the follow-up."
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const nowSource = SOURCE_CASES[0];
    await gotoWorkspace(page, nowSource.path, nowSource.readySelector);
    const businessBefore = await readBusinessState(page);
    const mutatingRequests = observeUnexpectedMutatingRequests(page);
    await startSourceJourney(page, nowSource);

    await gotoWorkspace(
      page,
      `/app/quotes/${QUOTE_ID}`,
      `.ambient-living-opportunity[data-quote-id="${QUOTE_ID}"]`
    );
    const rail = page.locator(
      `.workspace-task-journey[data-workspace-task-id="${nowSource.taskId}"]`
    );
    const continueTask = rail.locator("button").filter({ hasText: /^Continue$/u });
    await expect(continueTask).toBeVisible();

    const quickUpdatesTrigger = page.locator(
      'button[data-ambient-action-id="open-quick-updates"]:visible'
    );
    await expect(quickUpdatesTrigger).toHaveCount(1);
    await quickUpdatesTrigger.click();
    const panel = page.locator('[data-testid="quick-updates-panel"]');
    await expect(panel).toHaveAttribute("data-quick-updates-phase", "clean");
    const serviceStyle = panel.getByRole("combobox", { name: "Service style" });
    await expect(serviceStyle).toHaveValue("Plated");
    await serviceStyle.selectOption("Buffet");
    await expect(panel).toHaveAttribute("data-quick-updates-phase", "dirty");

    const routeBeforeAttempt = page.url();
    const taskBeforeAttempt = await readTaskJourney(page);
    await continueTask.evaluate((button) => button.click());
    const guard = page.getByRole("alertdialog", { name: "Discard unsaved Quick Updates?" });
    await expect(guard).toBeVisible();
    expect(page.url()).toBe(routeBeforeAttempt);
    expect(await readTaskJourney(page)).toEqual(taskBeforeAttempt);
    expect(await readBusinessState(page)).toEqual(businessBefore);

    await guard.getByRole("button", { name: "Keep editing" }).click();
    await expect(guard).toBeHidden();
    await expect(panel).toHaveAttribute("data-quick-updates-phase", "dirty");
    expect(await readTaskJourney(page)).toEqual(taskBeforeAttempt);

    await continueTask.evaluate((button) => button.click());
    await expect(guard).toBeVisible();
    expect(await readTaskJourney(page)).toEqual(taskBeforeAttempt);
    await guard.getByRole("button", { name: "Discard draft" }).click();

    await expect(panel).toBeHidden();
    await expectExactWorkflowArrival(page, nowSource);
    expect(await readBusinessState(page)).toEqual(businessBefore);
    expect(mutatingRequests).toEqual([]);
  });

  test("browser-local follow-up completion stays Needs confirmation without authoritative readback", async ({ page }) => {
    test.setTimeout(90_000);
    test.info().annotations.push({
      type: "evidence-boundary",
      description: "This proves a named browser-local save fails closed into uncertainty. It is not Firebase, provider, or authoritative completion evidence."
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const nowSource = SOURCE_CASES[0];
    await gotoWorkspace(page, nowSource.path, nowSource.readySelector);
    const businessBefore = await readBusinessState(page);
    const mutatingRequests = observeUnexpectedMutatingRequests(page);
    await startSourceJourney(page, nowSource);

    await page.getByRole("button", {
      name: "Review follow-up for QP-RIVERA-250",
      exact: true
    }).click();
    await page.getByLabel("Follow-up complete", { exact: true }).check();
    await page.getByRole("button", { name: "Save Follow-up", exact: true }).click();

    const uncertainRail = page.getByRole("region", {
      name: "Current task: Follow-up, Needs confirmation",
      exact: true
    });
    await expect(uncertainRail).toBeVisible();
    await expect(uncertainRail).toHaveAttribute("data-workspace-task-id", nowSource.taskId);
    await expect(uncertainRail).toHaveAttribute("data-workspace-task-state", "uncertain");
    await expect(uncertainRail).toContainText("Outcome not confirmed");
    await expect(uncertainRail).not.toContainText("Completed");
    await expect(uncertainRail.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
    await expect(uncertainRail.getByRole("button", { name: "Stop tracking", exact: true })).toBeVisible();

    const confirmation = page.locator('[data-follow-up-confirmation-state="uncertain"]');
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText("saved in browser-local data");
    await expect(confirmation).toContainText("The task remains open");
    await expect(confirmation.getByRole("button", { name: "Retry confirmation" })).toBeVisible();

    const stored = await readTaskJourney(page);
    expect(stored.journey).toMatchObject({
      organizationId: ORGANIZATION_ID,
      principal: { id: "e2e-admin", role: "admin" },
      taskId: nowSource.taskId,
      phase: "uncertain",
      origin: nowSource.origin,
      destination: "workflow",
      object: { id: FOLLOW_UP_ID, type: "workflow-item" },
      focus: {
        quoteId: QUOTE_ID,
        attentionType: "follow_up",
        requestId: FOLLOW_UP_ID
      },
      intentId: "review_follow_up",
      proof: null
    });

    const businessAfterSave = await readBusinessState(page);
    const beforeQuotes = JSON.parse(businessBefore.quotes);
    const afterQuotes = JSON.parse(businessAfterSave.quotes);
    const historyAfterSave = JSON.parse(businessAfterSave.history);
    expect(beforeQuotes).toHaveLength(1);
    expect(afterQuotes).toHaveLength(1);
    const beforeQuote = beforeQuotes[0];
    const afterQuote = afterQuotes[0];
    expect(afterQuote.id).toBe(beforeQuote.id);
    expect(afterQuote.organizationId).toBe(beforeQuote.organizationId);
    expect(afterQuote.activeVersionId).toBe(beforeQuote.activeVersionId);
    expect(afterQuote.latestVersionNumber).toBe(beforeQuote.latestVersionNumber + 1);
    expect(afterQuote.versionMeta).toMatchObject({
      versionId: "v0004",
      versionNumber: 4,
      reason: "snapshot"
    });
    expect(afterQuote.workflow.followUp).toMatchObject({
      stage: beforeQuote.workflow.followUp.stage,
      dueDate: beforeQuote.workflow.followUp.dueDate,
      note: beforeQuote.workflow.followUp.note,
      completed: true,
      updatedByEmail: "e2e-admin@local.test"
    });
    expect(afterQuote.workflow.followUp.completedAtISO).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(afterQuote.workflow.followUp.updatedAtISO).toBe(
      afterQuote.workflow.followUp.completedAtISO
    );
    expect(afterQuote.updatedAtISO).toBe(afterQuote.workflow.followUp.updatedAtISO);
    expect(afterQuote.workflow.approvalRequests).toEqual([]);
    expect(historyAfterSave).toHaveLength(1);
    expect(historyAfterSave[0]).toMatchObject({
      quoteId: QUOTE_ID,
      organizationId: ORGANIZATION_ID,
      versionId: "v0004",
      versionNumber: 4,
      reason: "snapshot"
    });
    expect(historyAfterSave[0].snapshot.workflow.followUp.completed).toBe(false);
    expect(businessAfterSave.catalog).toEqual(businessBefore.catalog);
    expect(mutatingRequests).toEqual([]);

    await uncertainRail.getByRole("button", { name: "Stop tracking", exact: true }).click();
    await expect(page.locator(".workspace-task-journey")).toHaveCount(0);
    expect(await readTaskJourney(page)).toEqual({
      keys: [],
      serialized: null,
      journey: null
    });
    expect(await readBusinessState(page)).toEqual(businessAfterSave);
    expect(mutatingRequests).toEqual([]);
  });
});
