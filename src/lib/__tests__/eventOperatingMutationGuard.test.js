import { beforeEach, expect, test, vi } from "vitest";
let guard;
const scope = { principalId: "admin-a", organizationId: "org-a", quoteId: "quote-a" };
const command = { requestId: "request-a", note: "original" };
beforeEach(async () => { vi.resetModules(); guard = await import("../eventOperatingMutationGuard"); });

test("uncertain phase and work locks survive remount and permit only original owner replay", () => {
  guard.beginEventOperatingMutation(scope, "phase", command);
  guard.failEventOperatingMutation(scope, "phase", command.requestId, false);
  expect(guard.readEventOperatingMutationGuard({ ...scope })).toEqual({ owner: "phase", requestId: "request-a", status: "uncertain" });
  expect(() => guard.beginEventOperatingMutation(scope, "work", { requestId: "work-a" })).toThrow("existing event request");
  expect(() => guard.beginEventOperatingMutation(scope, "phase", { ...command, note: "changed" })).toThrow("existing event request");
  expect(guard.beginEventOperatingMutation(scope, "phase", { ...command }).status).toBe("reconciliation");
  guard.failEventOperatingMutation(scope, "phase", command.requestId, true);
  expect(guard.releaseEventOperatingMutation(scope, "phase", command.requestId, { reviewedReset: true })).toBe(false);
  expect(guard.releaseEventOperatingMutation(scope, "phase", command.requestId)).toBe(true);
  guard.beginEventOperatingMutation(scope, "work", command);
  guard.failEventOperatingMutation(scope, "work", command.requestId, false);
  expect(() => guard.beginEventOperatingMutation(scope, "phase", { requestId: "next" })).toThrow("existing event request");
});

test("guard scopes principals and notifies only exact listeners", () => {
  const listener = vi.fn(); const unsubscribe = guard.subscribeEventOperatingMutations(scope, listener);
  guard.beginEventOperatingMutation({ ...scope, principalId: "another" }, "work", command);
  expect(listener).not.toHaveBeenCalled();
  guard.beginEventOperatingMutation(scope, "work", command); expect(listener).toHaveBeenCalledTimes(1);
  guard.failEventOperatingMutation(scope, "work", command.requestId, true);
  expect(guard.readEventOperatingMutationGuard(scope).status).toBe("rejected");
  expect(guard.releaseEventOperatingMutation(scope, "phase", command.requestId)).toBe(false);
  expect(guard.releaseEventOperatingMutation(scope, "work", command.requestId, { reviewedReset: true })).toBe(true);
  unsubscribe(); expect(guard.readEventOperatingMutationGuard(scope)).toBeNull();
});

test("phase work and actuals uncertainty exclude all sibling commands across remount", () => {
  for (const owner of ["phase", "work", "actuals"]) {
    guard.beginEventOperatingMutation(scope, owner, command); guard.failEventOperatingMutation(scope, owner, command.requestId, false);
    expect(guard.readEventOperatingMutationGuard({ ...scope }).owner).toBe(owner);
    for (const sibling of ["phase", "work", "actuals"].filter((item) => item !== owner)) expect(() => guard.beginEventOperatingMutation(scope, sibling, { requestId: `new-${sibling}` })).toThrow("existing event request");
    expect(guard.beginEventOperatingMutation(scope, owner, { ...command }).status).toBe("reconciliation"); guard.failEventOperatingMutation(scope, owner, command.requestId, true);
    expect(guard.releaseEventOperatingMutation(scope, owner, command.requestId, { reviewedReset: true })).toBe(false);
    expect(guard.releaseEventOperatingMutation(scope, owner, command.requestId)).toBe(true);
  }
});

test("workflow and operational uncertainty exclude all four channels across remount", () => {
  for (const owner of ["phase", "work", "actuals", "workflow"]) {
    guard.beginEventOperatingMutation(scope, owner, command); guard.failEventOperatingMutation(scope, owner, command.requestId, false);
    for (const sibling of ["phase", "work", "actuals", "workflow"].filter((item) => item !== owner)) expect(() => guard.beginEventOperatingMutation({ ...scope }, sibling, { requestId: "new" })).toThrow();
    expect(guard.beginEventOperatingMutation(scope, owner, { ...command }).status).toBe("reconciliation"); guard.failEventOperatingMutation(scope, owner, command.requestId, true); expect(guard.releaseEventOperatingMutation(scope, owner, command.requestId, { reviewedReset: true })).toBe(false); guard.releaseEventOperatingMutation(scope, owner, command.requestId);
  }
});
