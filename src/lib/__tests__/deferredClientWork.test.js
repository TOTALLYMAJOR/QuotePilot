import { describe, expect, test, vi } from "vitest";
import {
  DEFERRED_CLIENT_WORK_TIMEOUT_MS,
  scheduleDeferredClientWork
} from "../deferredClientWork";

describe("scheduleDeferredClientWork", () => {
  test("yields secondary work to requestIdleCallback when available", () => {
    let idleCallback = null;
    const cancelIdleCallback = vi.fn();
    const windowObject = {
      requestIdleCallback: vi.fn((callback, options) => {
        idleCallback = callback;
        expect(options).toEqual({ timeout: DEFERRED_CLIENT_WORK_TIMEOUT_MS });
        return 42;
      }),
      cancelIdleCallback
    };
    const work = vi.fn();

    const cancel = scheduleDeferredClientWork(work, { windowObject });

    expect(work).not.toHaveBeenCalled();
    expect(windowObject.requestIdleCallback).toHaveBeenCalledOnce();
    idleCallback();
    expect(work).toHaveBeenCalledOnce();

    cancel();
    expect(cancelIdleCallback).not.toHaveBeenCalled();
  });

  test("cancels stale deferred work before it starts", () => {
    let idleCallback = null;
    const cancelIdleCallback = vi.fn();
    const windowObject = {
      requestIdleCallback: vi.fn((callback) => {
        idleCallback = callback;
        return 7;
      }),
      cancelIdleCallback
    };
    const work = vi.fn();

    const cancel = scheduleDeferredClientWork(work, { windowObject });
    cancel();
    idleCallback();

    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
    expect(work).not.toHaveBeenCalled();
  });

  test("preserves eager behavior when idle scheduling is unavailable", () => {
    const work = vi.fn();

    scheduleDeferredClientWork(work, { windowObject: {} });

    expect(work).toHaveBeenCalledOnce();
  });
});
