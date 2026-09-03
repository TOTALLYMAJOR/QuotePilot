import { mkdirSync } from "node:fs";
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
const ACTION_ID = "complete-follow-up";
const QUOTES_KEY = "quoteWizard.quotes";
const HISTORY_KEY = "quoteWizard.quoteHistory";
const CATALOG_KEYS = ["quoteWizard.catalog", `quoteWizard.catalog.${ORGANIZATION_ID}`];
const TASK_STORAGE_PREFIX = "quotepilot.workspace-task-journey.v1:";
const SEED_MARKER = "quotepilot.e2e.action-feedback-seeded";
const PROOF_DIRECTORY = "output/playwright/staff-app-action-feedback";
const SAFE_REQUEST_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const WORKFLOW_FOCUS = Object.freeze({
  organizationId: ORGANIZATION_ID,
  destination: "workflow",
  quoteId: QUOTE_ID,
  attentionType: "follow_up",
  requestId: FOLLOW_UP_ID
});

const VIEWPORT_CASES = Object.freeze([
  Object.freeze({
    label: "mobile Now",
    slug: "mobile-now",
    viewport: Object.freeze({ width: 390, height: 844 }),
    path: "/app",
    readySelector: ".ambient-now",
    actionSelector: `.ambient-now button[data-workspace-task-id="review-now-priority:${FOLLOW_UP_ID}"]`,
    taskId: `review-now-priority:${FOLLOW_UP_ID}`,
    origin: Object.freeze({ routeId: "home", pathname: "/app" })
  }),
  Object.freeze({
    label: "tablet Opportunities",
    slug: "tablet-opportunities",
    viewport: Object.freeze({ width: 768, height: 900 }),
    path: "/app/quotes",
    readySelector: ".ambient-opportunities",
    actionSelector: `.ambient-opportunities button[data-workspace-task-id="review-opportunity-workflow:${QUOTE_ID}:${FOLLOW_UP_ID}"]`,
    taskId: `review-opportunity-workflow:${QUOTE_ID}:${FOLLOW_UP_ID}`,
    origin: Object.freeze({ routeId: "quote-list", pathname: "/app/quotes" })
  }),
  Object.freeze({
    label: "desktop Client 360",
    slug: "desktop-client-360",
    viewport: Object.freeze({ width: 1440, height: 1000 }),
    path: `/app/customers/${CLIENT_ID}`,
    readySelector: `.ambient-client-overview[data-client-id="${CLIENT_ID}"]`,
    actionSelector: `.ambient-client-overview button[data-workspace-task-id="review-client-follow_up:${QUOTE_ID}:${FOLLOW_UP_ID}"]`,
    taskId: `review-client-follow_up:${QUOTE_ID}:${FOLLOW_UP_ID}`,
    origin: Object.freeze({
      routeId: "customer-detail",
      pathname: `/app/customers/${CLIENT_ID}`
    })
  })
]);

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
      approvalRequests: [],
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
  await page.addInitScript(({ quote, quotesKey, historyKey, marker }) => {
    if (sessionStorage.getItem(marker) === "true") return;
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("qp.workspaceSoundsEnabled", "false");
    localStorage.setItem(quotesKey, JSON.stringify([quote]));
    localStorage.setItem(historyKey, JSON.stringify([]));
    sessionStorage.setItem(marker, "true");
  }, {
    quote: buildRiveraQuote(),
    quotesKey: QUOTES_KEY,
    historyKey: HISTORY_KEY,
    marker: SEED_MARKER
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

function observeUnexpectedMutatingRequests(page) {
  const requests = [];
  page.on("request", (request) => {
    const method = request.method().toUpperCase();
    if (SAFE_REQUEST_METHODS.has(method)) return;
    requests.push({ method, resourceType: request.resourceType(), url: request.url() });
  });
  return requests;
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

function expectExactTaskJourney(stored, source, phase) {
  expect(stored.keys).toEqual([`${TASK_STORAGE_PREFIX}${encodeURIComponent(ORGANIZATION_ID)}`]);
  expect(stored.journey).toMatchObject({
    modelId: "workspace-task-journey-v1",
    authority: "presentation_only",
    persistence: "session_only",
    organizationId: ORGANIZATION_ID,
    principal: { id: "e2e-admin", role: "admin" },
    taskId: source.taskId,
    phase,
    origin: source.origin,
    destination: WORKFLOW_FOCUS.destination,
    object: { id: FOLLOW_UP_ID, type: "workflow-item" },
    focus: {
      quoteId: QUOTE_ID,
      attentionType: "follow_up",
      requestId: FOLLOW_UP_ID
    },
    intentId: "review_follow_up",
    proof: null
  });
  expect(stored.serialized).not.toContain("rivera@example.test");
  expect(stored.serialized).not.toContain("Avery & Jordan Rivera");
  expect(stored.serialized).not.toContain("Review final count with Avery and Jordan.");
}

async function expectExactWorkflowArrival(page, source) {
  await expect(page).toHaveURL(exactWorkflowUrl);
  const arrival = page.locator('[data-arrival-surface="workflow"]');
  await expect(arrival).toHaveAttribute("data-arrival-state", "resolved");
  const exactAttention = page.locator(`[data-attention-id="${FOLLOW_UP_ID}"]`);
  await expect(exactAttention).toBeVisible();
  await expect(exactAttention).toBeFocused();
  await expect(page.locator("[data-attention-id][aria-current]")).toHaveCount(0);

  const taskRail = page.locator(
    `.workspace-task-journey[data-workspace-task-id="${source.taskId}"]`
  );
  await expect(taskRail).toBeVisible();
  await expect(taskRail).toHaveAttribute("data-workspace-task-state", "in_progress");
  expectExactTaskJourney(await readTaskJourney(page), source, "in_progress");
  return { exactAttention, taskRail };
}

async function beginTrackedFollowUp(page, source) {
  const action = page.locator(source.actionSelector);
  await expect(action).toHaveCount(1);
  await expect(action).toBeVisible();
  await expect(page.locator(".workspace-task-journey")).toHaveCount(0);
  await action.click();
  return expectExactWorkflowArrival(page, source);
}

async function armActionFeedbackProbe(saveButton) {
  await saveButton.evaluate((button) => {
    window.__quotePilotActionFeedbackProbe?.observer?.disconnect();
    const probe = {
      armedAt: performance.now(),
      clickAt: null,
      pendingAt: null,
      succeededSeen: false,
      confirmedSeen: false,
      transitions: [],
      observer: null
    };

    const inspect = () => {
      const feedback = document.querySelector('[data-testid="workspace-action-feedback"]');
      const phase = feedback?.getAttribute("data-action-feedback-phase") || "";
      const ariaBusy = feedback?.getAttribute("aria-busy") || "";
      if (phase) {
        const latest = probe.transitions[probe.transitions.length - 1];
        if (!latest || latest.phase !== phase || latest.ariaBusy !== ariaBusy) {
          probe.transitions.push({ phase, ariaBusy, at: performance.now() });
        }
      }
      if (
        probe.clickAt !== null
        && probe.pendingAt === null
        && phase === "pending"
        && ariaBusy === "true"
      ) {
        probe.pendingAt = performance.now();
      }
      if (phase === "succeeded") probe.succeededSeen = true;
      if (document.querySelector('[data-follow-up-confirmation-state="confirmed"]')) {
        probe.confirmedSeen = true;
      }
    };

    button.addEventListener("click", () => {
      probe.clickAt = performance.now();
      inspect();
      requestAnimationFrame(inspect);
    }, { capture: true, once: true });

    probe.observer = new MutationObserver(inspect);
    probe.observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true
    });
    window.__quotePilotActionFeedbackProbe = probe;
    inspect();
  });
}

async function readAndStopActionFeedbackProbe(page) {
  return page.evaluate(() => {
    const probe = window.__quotePilotActionFeedbackProbe;
    probe?.observer?.disconnect();
    if (!probe) return null;
    return {
      armedAt: probe.armedAt,
      clickAt: probe.clickAt,
      pendingAt: probe.pendingAt,
      succeededSeen: probe.succeededSeen,
      confirmedSeen: probe.confirmedSeen,
      transitions: probe.transitions
    };
  });
}

async function expectSharedAnnouncementContract(page) {
  const announcer = page.locator('[data-testid="workspace-action-feedback-announcer"]');
  await expect(announcer).toHaveCount(1);
  await expect(announcer).toHaveAttribute("role", "status");
  await expect(announcer).toHaveAttribute("aria-live", "polite");
  await expect(announcer).toHaveAttribute("aria-atomic", "true");
  await expect(announcer).not.toHaveAttribute("data-action-feedback-announcement-id", "");
  await expect(announcer).toContainText("Complete follow-up");

  const localFollowUpFeedback = page.locator('[data-follow-up-confirmation-state="uncertain"]');
  await expect(localFollowUpFeedback).toHaveCount(1);
  await expect(localFollowUpFeedback).not.toHaveAttribute("role", /^(?:alert|status)$/u);
  await expect(localFollowUpFeedback).not.toHaveAttribute("aria-live", /.+/u);
  await expect(localFollowUpFeedback).not.toHaveAttribute("aria-atomic", /.+/u);
}

async function expectFeedbackAndTaskGeometry(page, feedback, taskRail, viewport) {
  const stack = page.locator('[data-workspace-continuity-stack="true"]');
  await expect(stack).toBeVisible();
  await stack.evaluate((element) => {
    element.scrollIntoView({ block: "center", inline: "nearest" });
  });

  const geometry = await page.evaluate(() => {
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity || 1) > 0
        && box.width > 0
        && box.height > 0;
    };
    const box = (element) => {
      if (!visible(element)) return null;
      const rect = element.getBoundingClientRect();
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
    const stackElement = document.querySelector('[data-workspace-continuity-stack="true"]');
    const feedbackElement = document.querySelector('[data-testid="workspace-action-feedback"]');
    const taskElement = document.querySelector(".workspace-task-journey");
    const stackBox = box(stackElement);
    const feedbackBox = box(feedbackElement);
    const taskBox = box(taskElement);
    const chrome = {
      header: box(document.querySelector(".site-header")),
      newQuote: box(document.querySelector('[data-ambient-utility="new-quote"]')),
      mobileNavigation: box(document.querySelector(".ambient-primary-navigation"))
    };
    const controls = [...stackElement.querySelectorAll("button")]
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
      viewport: { width: window.innerWidth, height: window.innerHeight },
      stackPosition: getComputedStyle(stackElement).position,
      stackInsetTop: getComputedStyle(stackElement).top,
      stack: stackBox,
      feedback: feedbackBox,
      task: taskBox,
      childCollision: overlaps(feedbackBox, taskBox),
      chromeCollisions: Object.entries(chrome)
        .filter(([, chromeBox]) => (
          overlaps(feedbackBox, chromeBox) || overlaps(taskBox, chromeBox)
        ))
        .map(([name]) => name),
      overflow: {
        document: Math.max(
          0,
          document.documentElement.scrollWidth - document.documentElement.clientWidth
        ),
        stack: Math.max(0, stackElement.scrollWidth - stackElement.clientWidth),
        feedback: Math.max(0, feedbackElement.scrollWidth - feedbackElement.clientWidth),
        task: Math.max(0, taskElement.scrollWidth - taskElement.clientWidth)
      },
      controls
    };
  });

  expect(geometry.viewport).toEqual(viewport);
  expect(geometry.stackPosition).toBe(viewport.width <= 760 ? "relative" : "sticky");
  expect(geometry.stackInsetTop).toBe(viewport.width <= 760 ? "0px" : "12px");
  expect(geometry.stack.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.stack.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(geometry.feedback.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.feedback.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(geometry.task.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.task.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(geometry.childCollision).toBe(false);
  expect(geometry.chromeCollisions).toEqual([]);
  Object.values(geometry.overflow).forEach((overflowPx) => {
    expect(overflowPx).toBeLessThanOrEqual(1);
  });
  expect(geometry.controls.length).toBeGreaterThan(0);
  expect(geometry.controls.filter(({ width, height }) => (
    width < 44 || height < 44
  ))).toEqual([]);

  await expect(feedback).toBeVisible();
  await expect(taskRail).toBeVisible();
}

async function expectExactReturnedRecordVisibility(page, record) {
  await expect(record).toBeFocused();
  await expect.poll(async () => record.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const stack = document.querySelector('[data-workspace-continuity-stack="true"]');
    const stackRect = stack?.getBoundingClientRect();
    const stackStyle = stack ? getComputedStyle(stack) : null;
    const stickyClearance = stackRect && stackStyle?.position === "sticky"
      ? Math.max(0, stackRect.bottom + 8)
      : 0;
    const visibleTop = Math.max(rect.top, stickyClearance, 0);
    const visibleBottom = Math.min(rect.bottom, window.innerHeight);
    return document.activeElement === element
      && rect.top >= stickyClearance - 1
      && Math.max(0, visibleBottom - visibleTop) >= 44;
  })).toBe(true);
  const metrics = await record.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const stack = document.querySelector('[data-workspace-continuity-stack="true"]');
    const stackRect = stack?.getBoundingClientRect();
    const stackStyle = stack ? getComputedStyle(stack) : null;
    const focusStyle = getComputedStyle(element);
    const stickyClearance = stackRect && stackStyle?.position === "sticky"
      ? Math.max(0, stackRect.bottom + 8)
      : 0;
    const overlaps = (left, right) => Boolean(left && right)
      && Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1
      && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1;
    const occludedControls = stackRect && stackStyle?.position === "sticky"
      ? [...document.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')]
          .filter((control) => !stack.contains(control))
          .filter((control) => {
            const controlRect = control.getBoundingClientRect();
            return controlRect.bottom > 0
              && controlRect.top < window.innerHeight
              && overlaps(controlRect, stackRect);
          })
          .map((control) => control.getAttribute("aria-label") || control.textContent.trim() || control.tagName)
      : [];
    return {
      top: rect.top,
      bottom: rect.bottom,
      stickyClearance,
      viewportHeight: window.innerHeight,
      outlineStyle: focusStyle.outlineStyle,
      outlineWidth: Number.parseFloat(focusStyle.outlineWidth || "0"),
      occludedControls,
      visibleHeight: Math.max(
        0,
        Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, stickyClearance, 0)
      )
    };
  });
  expect(metrics.top).toBeGreaterThanOrEqual(metrics.stickyClearance - 1);
  expect(metrics.bottom).toBeGreaterThan(0);
  expect(metrics.top).toBeLessThan(metrics.viewportHeight);
  expect(metrics.visibleHeight).toBeGreaterThanOrEqual(44);
  expect(metrics.outlineStyle).not.toBe("none");
  expect(metrics.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(metrics.occludedControls).toEqual([]);
}

async function expectResolutionActionVisibility(page, action) {
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeVisible();
  const geometry = await action.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const mobileNavigation = document.querySelector(".ambient-primary-navigation");
    const mobileNavigationRect = mobileNavigation?.getBoundingClientRect();
    const mobileNavigationStyle = mobileNavigation ? getComputedStyle(mobileNavigation) : null;
    const visibleMobileNavigation = Boolean(
      window.innerWidth <= 760
      && mobileNavigationRect
      && mobileNavigationStyle?.display !== "none"
      && mobileNavigationStyle?.visibility !== "hidden"
      && mobileNavigationStyle?.position === "fixed"
      && mobileNavigationRect.top < window.innerHeight
      && mobileNavigationRect.bottom > 0
      && mobileNavigationRect.height > 0
    );
    return {
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      mobileNavigationTop: visibleMobileNavigation
        ? mobileNavigationRect.top
        : window.innerHeight
    };
  });
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(
    Math.min(geometry.viewportHeight, geometry.mobileNavigationTop) + 1
  );
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
}

function expectOnlyDeliberateFollowUpSave(beforeState, afterState) {
  const beforeQuotes = JSON.parse(beforeState.quotes);
  const afterQuotes = JSON.parse(afterState.quotes);
  const beforeHistory = JSON.parse(beforeState.history);
  const afterHistory = JSON.parse(afterState.history);
  expect(beforeQuotes).toHaveLength(1);
  expect(afterQuotes).toHaveLength(1);
  expect(beforeHistory).toEqual([]);
  expect(afterHistory).toHaveLength(1);

  const beforeQuote = beforeQuotes[0];
  const afterQuote = afterQuotes[0];
  const {
    updatedAtISO: beforeUpdatedAtISO,
    latestVersionNumber: beforeVersionNumber,
    versionMeta: _beforeVersionMeta,
    workflow: beforeWorkflow,
    ...beforeStableQuote
  } = beforeQuote;
  const {
    updatedAtISO: afterUpdatedAtISO,
    latestVersionNumber: afterVersionNumber,
    versionMeta: afterVersionMeta,
    workflow: afterWorkflow,
    ...afterStableQuote
  } = afterQuote;
  expect(afterStableQuote).toEqual(beforeStableQuote);
  expect(afterVersionNumber).toBe(beforeVersionNumber + 1);
  expect(afterVersionMeta).toMatchObject({
    versionId: "v0004",
    versionNumber: 4,
    reason: "snapshot"
  });
  expect(afterUpdatedAtISO).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  expect(afterUpdatedAtISO).not.toBe(beforeUpdatedAtISO);

  const { followUp: beforeFollowUp, ...beforeStableWorkflow } = beforeWorkflow;
  const { followUp: afterFollowUp, ...afterStableWorkflow } = afterWorkflow;
  expect(afterStableWorkflow).toEqual(beforeStableWorkflow);
  expect(afterFollowUp).toMatchObject({
    stage: beforeFollowUp.stage,
    dueDate: beforeFollowUp.dueDate,
    note: beforeFollowUp.note,
    completed: true,
    updatedByEmail: "e2e-admin@local.test"
  });
  expect(afterFollowUp.completedAtISO).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  expect(afterFollowUp.updatedAtISO).toBe(afterFollowUp.completedAtISO);
  expect(afterUpdatedAtISO).toBe(afterFollowUp.updatedAtISO);

  expect(afterHistory[0]).toMatchObject({
    quoteId: QUOTE_ID,
    organizationId: ORGANIZATION_ID,
    versionId: "v0004",
    versionNumber: 4,
    reason: "snapshot"
  });
  // The version writer hydrates legacy-safe defaults before recording the
  // snapshot. Every seeded business value must still match, and the snapshot
  // must prove it captured the pre-write incomplete follow-up.
  expect(afterHistory[0].snapshot).toMatchObject(beforeQuote);
  expect(afterHistory[0].snapshot.workflow.followUp.completed).toBe(false);
  expect(afterState.catalog).toEqual(beforeState.catalog);
}

async function capture(page, name) {
  mkdirSync(PROOF_DIRECTORY, { recursive: true });
  await page.screenshot({
    path: `${PROOF_DIRECTORY}/${name}.png`,
    animations: "disabled",
    fullPage: false
  });
}

async function alignContinuityProofFrame(page, expectedScrollY = null) {
  const stack = page.locator('[data-workspace-continuity-stack="true"]');
  await expect(stack).toBeVisible();
  const scrollY = await stack.evaluate((element, requestedScrollY) => {
    if (Number.isFinite(requestedScrollY)) {
      window.scrollTo({ top: requestedScrollY, behavior: "instant" });
    } else {
      element.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
    }
    return window.scrollY;
  }, expectedScrollY);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  if (Number.isFinite(expectedScrollY)) {
    expect(Math.abs(scrollY - expectedScrollY)).toBeLessThanOrEqual(1);
  }
  return scrollY;
}

test.describe("Staff action feedback foundation", () => {
  test.skip(
    !REQUIRED_GATES,
    "Action-feedback acceptance requires the customer-centered, Ambient, and Pilot Now gates."
  );

  test.beforeEach(async ({ page }) => {
    await seedWorkspace(page);
  });

  for (const source of VIEWPORT_CASES) {
    test(`${source.label} keeps an exact uncertain follow-up outcome durable at ${source.viewport.width}px`, async ({ page }) => {
      test.setTimeout(120_000);
      test.info().annotations.push({
        type: "evidence-boundary",
        description: "This is local Chromium evidence for runtime action feedback and a browser-local quote write. It is not connected, hosted, provider, or production confirmation."
      });

      await page.setViewportSize(source.viewport);
      const mutatingRequests = observeUnexpectedMutatingRequests(page);
      await gotoWorkspace(page, source.path, source.readySelector);
      const businessBeforeJourney = await readBusinessState(page);

      const { taskRail } = await beginTrackedFollowUp(page, source);
      expect(await readBusinessState(page)).toEqual(businessBeforeJourney);
      expect(mutatingRequests).toEqual([]);

      await page.getByRole("button", {
        name: "Review follow-up for QP-RIVERA-250",
        exact: true
      }).click();
      await page.getByLabel("Follow-up complete", { exact: true }).check();
      const saveButton = page.getByRole("button", { name: "Save Follow-up", exact: true });
      await expect(saveButton).toBeVisible();
      await expect(page.locator('[data-testid="workspace-action-feedback"]')).toHaveCount(0);
      const idleAnnouncer = page.locator('[data-testid="workspace-action-feedback-announcer"]');
      await expect(idleAnnouncer).toHaveCount(1);
      await expect(idleAnnouncer).toHaveAttribute("aria-atomic", "true");
      await expect(idleAnnouncer).toHaveText("");
      expect(await readBusinessState(page)).toEqual(businessBeforeJourney);

      const proofScrollY = await alignContinuityProofFrame(page);
      await capture(page, `${source.viewport.width}-${source.slug}-before-save`);
      await armActionFeedbackProbe(saveButton);
      await saveButton.click();

      const feedback = page.locator('[data-testid="workspace-action-feedback"]');
      await expect(feedback).toHaveCount(1);
      await expect(feedback).toHaveAttribute("data-action-feedback-phase", "uncertain");
      await expect(feedback).toHaveAttribute("data-action-feedback-action-id", ACTION_ID);
      await expect(feedback).toHaveAttribute("data-action-feedback-object-kind", "workflow-item");
      await expect(feedback).toHaveAttribute("data-action-feedback-object-id", FOLLOW_UP_ID);
      await expect(feedback).not.toHaveAttribute("aria-busy", "true");
      await expect(feedback).toContainText("Needs confirmation");
      await expect(feedback).toContainText("Browser-local follow-up changed");
      await expect(feedback).toContainText("Current task remains open");
      await expect(feedback).not.toContainText("Succeeded");

      const safeAction = feedback.getByRole("button", {
        name: "Review exact follow-up",
        exact: true
      });
      await expect(feedback.getByRole("button")).toHaveCount(0);
      const boundedFeedbackMarkup = await feedback.evaluate((element) => element.outerHTML);
      const boundedAnnouncement = await page
        .locator('[data-testid="workspace-action-feedback-announcer"]')
        .textContent();
      for (const forbiddenValue of [
        "Review final count with Avery and Jordan.",
        "rivera@example.test",
        "e2e-admin@local.test",
        "Connection closed after dispatch.",
        "Bearer acceptance-token"
      ]) {
        expect(boundedFeedbackMarkup).not.toContain(forbiddenValue);
        expect(boundedAnnouncement).not.toContain(forbiddenValue);
      }

      await expect(taskRail).toHaveAttribute("data-workspace-task-state", "uncertain");
      await expect(taskRail).toContainText("Outcome not confirmed");
      await expect(taskRail).not.toContainText("Completed");
      const localUncertain = page.locator('[data-follow-up-confirmation-state="uncertain"]');
      await expect(localUncertain).toBeVisible();
      await expect(localUncertain).toContainText("saved in browser-local data");
      await expect(page.getByRole("button", {
        name: "Retry confirmation",
        exact: true
      })).toBeVisible();
      await expect(page.locator('[data-follow-up-confirmation-state="confirmed"]')).toHaveCount(0);
      await expectSharedAnnouncementContract(page);

      const probe = await readAndStopActionFeedbackProbe(page);
      expect(probe).not.toBeNull();
      expect(probe.clickAt).toEqual(expect.any(Number));
      expect(probe.pendingAt).toEqual(expect.any(Number));
      expect(probe.pendingAt - probe.clickAt).toBeGreaterThanOrEqual(0);
      expect(probe.pendingAt - probe.clickAt).toBeLessThanOrEqual(250);
      expect(probe.transitions).toEqual(expect.arrayContaining([
        expect.objectContaining({ phase: "pending", ariaBusy: "true" }),
        expect.objectContaining({ phase: "uncertain" })
      ]));
      expect(probe.transitions.map(({ phase }) => phase)).not.toContain("succeeded");
      expect(probe.succeededSeen).toBe(false);
      expect(probe.confirmedSeen).toBe(false);

      const businessAfterSave = await readBusinessState(page);
      expectOnlyDeliberateFollowUpSave(businessBeforeJourney, businessAfterSave);
      expectExactTaskJourney(await readTaskJourney(page), source, "uncertain");
      expect(mutatingRequests).toEqual([]);
      await expectFeedbackAndTaskGeometry(page, feedback, taskRail, source.viewport);
      await alignContinuityProofFrame(page, proofScrollY);
      await capture(page, `${source.viewport.width}-${source.slug}-after-uncertain`);

      const exactAttemptId = await feedback.getAttribute("data-action-feedback-attempt-id");
      expect(exactAttemptId).toMatch(/^qpa_[A-Za-z0-9_]+$/u);
      await expect(feedback).toHaveAttribute(
        "data-action-feedback-generation",
        `${source.taskId}:${(await readTaskJourney(page)).journey.startedAtISO}`
      );
      const stopTrackingBeforeReturn = source.viewport.width === 768;
      if (stopTrackingBeforeReturn) {
        await taskRail.getByRole("button", { name: "Stop tracking", exact: true }).click();
        await expect(taskRail).toHaveCount(0);
        expect(await readTaskJourney(page)).toEqual({ keys: [], serialized: null, journey: null });
        await expect(feedback).toHaveAttribute("data-action-feedback-phase", "uncertain");
        expect(await readBusinessState(page)).toEqual(businessAfterSave);
      }
      const taskBeforeRouteChange = await readTaskJourney(page);

      await page.locator('button[data-ambient-orientation="opportunities"]').click();
      await expect(page).toHaveURL(/\/app\/quotes$/u);
      await expect(page.locator(".ambient-opportunities")).toBeVisible({ timeout: 30_000 });
      await expect(feedback).toHaveAttribute("data-action-feedback-attempt-id", exactAttemptId);
      await expect(feedback).toHaveAttribute("data-action-feedback-phase", "uncertain");
      await expect(feedback).toHaveAttribute("data-action-feedback-object-id", FOLLOW_UP_ID);
      await expect(feedback.getByRole("button")).toHaveCount(1);
      await expect(safeAction).toBeVisible();
      expect(await readBusinessState(page)).toEqual(businessAfterSave);
      expect(await readTaskJourney(page)).toEqual(taskBeforeRouteChange);
      expect(mutatingRequests).toEqual([]);

      await feedback.getByRole("button", {
        name: "Review exact follow-up",
        exact: true
      }).click();
      await expect(page).toHaveURL(exactWorkflowUrl);
      const returnedRecord = page.locator(`[data-follow-up-record-id="${FOLLOW_UP_ID}"]`);
      await expect(returnedRecord).toBeVisible();
      await expectExactReturnedRecordVisibility(page, returnedRecord);
      await expect(page.locator("#workflow-tab-followups")).toHaveAttribute(
        "aria-selected",
        "true"
      );
      await expect(page.locator(`[data-attention-id="${FOLLOW_UP_ID}"]`)).toHaveCount(0);
      await expect(feedback).toHaveCount(1);
      await expect(feedback).toHaveAttribute("data-action-feedback-phase", "uncertain");
      await expect(feedback).toHaveAttribute("data-action-feedback-attempt-id", exactAttemptId);
      await expect(feedback.getByRole("button")).toHaveCount(0);
      expect(await readBusinessState(page)).toEqual(businessAfterSave);
      expect(mutatingRequests).toEqual([]);
      await capture(page, `${source.viewport.width}-${source.slug}-after-return-focus`);

      const retryConfirmation = page.getByRole("button", {
        name: "Retry confirmation",
        exact: true
      });
      await expectResolutionActionVisibility(page, retryConfirmation);
      await capture(page, `${source.viewport.width}-${source.slug}-after-return-resolution`);

      const beforeReconciliationClick = await readBusinessState(page);
      await retryConfirmation.click();
      await expect(page.locator('[data-follow-up-confirmation-state="uncertain"]')).toBeVisible();
      await expect(page.getByRole("button", { name: "Retry confirmation", exact: true })).toBeEnabled();
      await expect(feedback).toHaveAttribute("data-action-feedback-phase", "uncertain");
      await expect(feedback).toHaveAttribute("data-action-feedback-attempt-id", exactAttemptId);
      await expect(feedback.getByRole("button")).toHaveCount(0);
      expect(await readBusinessState(page)).toEqual(beforeReconciliationClick);
      expect(mutatingRequests).toEqual([]);

      const taskAfterReconciliation = await readTaskJourney(page);
      await page.locator('button[data-ambient-orientation="opportunities"]').click();
      await expect(page).toHaveURL(/\/app\/quotes$/u);
      await expect(page.locator(".ambient-opportunities")).toBeVisible({ timeout: 30_000 });
      await expect(feedback).toHaveAttribute("data-action-feedback-phase", "uncertain");
      await expect(feedback).toHaveAttribute("data-action-feedback-attempt-id", exactAttemptId);
      await expect(safeAction).toBeVisible();
      expect(await readBusinessState(page)).toEqual(beforeReconciliationClick);
      expect(await readTaskJourney(page)).toEqual(taskAfterReconciliation);
      expect(mutatingRequests).toEqual([]);

      await safeAction.click();
      await expect(page).toHaveURL(exactWorkflowUrl);
      await expect(returnedRecord).toBeVisible();
      await expectExactReturnedRecordVisibility(page, returnedRecord);
      await expect(feedback).toHaveAttribute("data-action-feedback-phase", "uncertain");
      await expect(feedback).toHaveAttribute("data-action-feedback-attempt-id", exactAttemptId);
      await expect(feedback.getByRole("button")).toHaveCount(0);
      expect(await readBusinessState(page)).toEqual(beforeReconciliationClick);
      expect(await readTaskJourney(page)).toEqual(taskAfterReconciliation);
      expect(mutatingRequests).toEqual([]);

      const taskBeforeReload = await readTaskJourney(page);
      if (stopTrackingBeforeReturn) {
        expect(taskBeforeReload).toEqual({ keys: [], serialized: null, journey: null });
      } else {
        expectExactTaskJourney(taskBeforeReload, source, "uncertain");
      }
      await page.reload();
      await expect(page.getByRole("heading", { name: "Workflow", exact: true })).toBeVisible({
        timeout: 30_000
      });
      await expect(page.locator('[data-testid="workspace-action-feedback"]')).toHaveCount(0);
      await expect(idleAnnouncer).toHaveCount(1);
      await expect(idleAnnouncer).toHaveAttribute("data-action-feedback-announcement-id", "");
      await expect(idleAnnouncer).toHaveText("");
      if (!stopTrackingBeforeReturn) {
        await expect(returnedRecord).toBeVisible();
        await expectExactReturnedRecordVisibility(page, returnedRecord);
        await expect(page.locator(`[data-attention-id="${FOLLOW_UP_ID}"]`)).toHaveCount(0);
      }

      const taskAfterReload = await readTaskJourney(page);
      if (stopTrackingBeforeReturn) {
        expect(taskAfterReload).toEqual({ keys: [], serialized: null, journey: null });
      } else {
        expectExactTaskJourney(taskAfterReload, source, "uncertain");
      }
      expect(await readBusinessState(page)).toEqual(businessAfterSave);
      expect(mutatingRequests).toEqual([]);
    });
  }
});
