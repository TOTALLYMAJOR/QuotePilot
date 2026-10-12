import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const HOOK = path.join(ROOT, ".codex/hooks/codebase_memory_guard.py");

function invoke(event, stateDir) {
  const inputPath = path.join(stateDir, "event.json");
  fs.writeFileSync(inputPath, JSON.stringify({
    session_id: "test-session",
    cwd: ROOT,
    permission_mode: "default",
    ...event
  }));
  const input = fs.openSync(inputPath, "r");
  const run = spawnSync("python3", [HOOK], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, CODEBASE_MEMORY_GUARD_STATE_DIR: stateDir },
    stdio: [input, "pipe", "pipe"]
  });
  fs.closeSync(input);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return run.stdout.trim() ? JSON.parse(run.stdout) : null;
}

test("blocks repository reads and edits until the ordered graph preflight completes", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-cbm-hook-"));
  try {
    invoke({ hook_event_name: "SessionStart", source: "startup" }, stateDir);

    const blockedRead = invoke({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "rg -n pricing src" }
    }, stateDir);
    assert.equal(blockedRead.hookSpecificOutput.permissionDecision, "deny");

    const blockedEdit = invoke({
      hook_event_name: "PreToolUse",
      tool_name: "apply_patch",
      tool_input: { command: "*** Begin Patch" }
    }, stateDir);
    assert.equal(blockedEdit.hookSpecificOutput.permissionDecision, "deny");

    invoke({
      hook_event_name: "PostToolUse",
      tool_name: "mcp__codebase_memory_mcp__list_projects",
      tool_input: {},
      tool_response: { isError: false }
    }, stateDir);
    invoke({
      hook_event_name: "PostToolUse",
      tool_name: "mcp__codebase_memory_mcp__index_status",
      tool_input: { project: "different-project" },
      tool_response: { isError: false }
    }, stateDir);
    assert.equal(invoke({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "sed -n '1,40p' src/App.jsx" }
    }, stateDir).hookSpecificOutput.permissionDecision, "deny");

    invoke({
      hook_event_name: "PostToolUse",
      tool_name: "mcp__codebase_memory_mcp__index_status",
      tool_input: { project: "quoteflow" },
      tool_response: { isError: false }
    }, stateDir);

    assert.equal(invoke({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "sed -n '1,40p' src/App.jsx" }
    }, stateDir).hookSpecificOutput.permissionDecision, "deny");

    invoke({
      hook_event_name: "PostToolUse",
      tool_name: "mcp__codebase_memory_mcp__check_index_coverage",
      tool_input: { project: "quoteflow", paths: [] },
      tool_response: { isError: false }
    }, stateDir);
    assert.equal(invoke({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "sed -n '1,40p' src/App.jsx" }
    }, stateDir).hookSpecificOutput.permissionDecision, "deny");

    invoke({
      hook_event_name: "PostToolUse",
      tool_name: "mcp__codebase_memory_mcp__check_index_coverage",
      tool_input: { project: "quoteflow", paths: ["src/App.jsx"] },
      tool_response: { isError: false }
    }, stateDir);

    assert.equal(invoke({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "rg -n pricing src" }
    }, stateDir), null);
    assert.equal(invoke({
      hook_event_name: "PreToolUse",
      tool_name: "apply_patch",
      tool_input: { command: "*** Begin Patch" }
    }, stateDir), null);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("allows bootstrap reads outside the repository before graph preflight", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-cbm-hook-"));
  try {
    invoke({ hook_event_name: "SessionStart", source: "startup" }, stateDir);
    assert.equal(invoke({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: {
        command: "sed -n '1,40p' /home/administrator/.codex/skills/codebase-memory/SKILL.md"
      }
    }, stateDir), null);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
