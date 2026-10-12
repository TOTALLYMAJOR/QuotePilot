#!/usr/bin/env python3
"""Require QuotePilot's graph preflight before repository reads or edits."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[2]
PROJECT = "quoteflow"
GRAPH_TOOLS = {
    "mcp__codebase_memory_mcp__list_projects": 1,
    "mcp__codebase_memory_mcp__index_status": 2,
    "mcp__codebase_memory_mcp__check_index_coverage": 3,
}
READER = re.compile(
    r"(?:^|[;&|()\n]\s*)(?:command\s+)?(?:/usr/bin/|/bin/)?"
    r"(?:rg|grep|find|sed|cat|head|tail|awk|less|more|git\s+(?:show|grep|diff))\b"
)
REPO_PATH = re.compile(
    r"(?:^|\s)(?:\.?/)?(?:src|scripts|docs|functions|truthloop|evidence|e2e|\.codex)(?:/|\s|$)"
    r"|(?:^|\s)(?:AGENTS\.md|README\.md|package\.json)(?:\s|$)"
)
ABSOLUTE_PATH = re.compile(r"(?<!\S)(?:['\"])?(/[^\s'\"]+)(?:['\"])?")


def state_path(session_id: str) -> Path:
    state_dir = Path(
        os.environ.get("CODEBASE_MEMORY_GUARD_STATE_DIR", ROOT / ".cache/codebase-memory-guard")
    )
    state_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(session_id.encode("utf8")).hexdigest()[:24]
    return state_dir / f"{digest}.json"


def read_stage(path: Path) -> int:
    try:
        return int(json.loads(path.read_text(encoding="utf8")).get("stage", 0))
    except (FileNotFoundError, OSError, ValueError, TypeError, json.JSONDecodeError):
        return 0


def write_stage(path: Path, stage: int) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps({"stage": stage}) + "\n", encoding="utf8")
    os.replace(temporary, path)


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")


def deny(reason: str) -> None:
    emit({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    })


def inside_repository(cwd: str) -> bool:
    try:
        Path(cwd).resolve().relative_to(ROOT)
        return True
    except (OSError, ValueError):
        return False


def reads_repository(command: str) -> bool:
    if not READER.search(command):
        return False
    if str(ROOT) in command:
        return True
    command_without_absolute_paths = ABSOLUTE_PATH.sub("", command)
    if REPO_PATH.search(command_without_absolute_paths):
        return True
    return not bool(ABSOLUTE_PATH.search(command))


def handle_session_start(event: dict, path: Path) -> None:
    if event.get("source") in {"startup", "clear"}:
        write_stage(path, 0)
    emit({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": (
                "QuotePilot graph retrieval is enforced. Before repository source reads or edits, "
                "call Codebase Memory list_projects, then index_status(project='quoteflow'), then "
                "check_index_coverage for every material path or scope. Report GRAPH_COVERAGE_BLOCKED "
                "instead of silently bypassing a coverage gap."
            ),
        }
    })


def handle_graph_result(event: dict, path: Path) -> None:
    if isinstance(event.get("tool_response"), dict) and event["tool_response"].get("isError") is True:
        return
    tool_name = event.get("tool_name", "")
    required_stage = GRAPH_TOOLS.get(tool_name)
    if required_stage is None:
        return
    current_stage = read_stage(path)
    tool_input = event.get("tool_input") if isinstance(event.get("tool_input"), dict) else {}
    if required_stage > 1 and tool_input.get("project") != PROJECT:
        return
    if required_stage == 3 and not (tool_input.get("paths") or tool_input.get("scopes")):
        return
    if required_stage == 1 or current_stage == required_stage - 1:
        write_stage(path, max(current_stage, required_stage))


def handle_pre_tool(event: dict, path: Path) -> None:
    if not inside_repository(str(event.get("cwd", ""))) or read_stage(path) >= 3:
        return
    tool_name = event.get("tool_name", "")
    tool_input = event.get("tool_input") if isinstance(event.get("tool_input"), dict) else {}
    command = str(tool_input.get("command", ""))
    if tool_name == "apply_patch" or (tool_name == "Bash" and reads_repository(command)):
        deny(
            "Graph-first retrieval required: call list_projects, index_status for quoteflow, and "
            "check_index_coverage for the material paths/scopes before repository reads or edits."
        )


def main() -> None:
    event = json.load(sys.stdin)
    session_id = str(event.get("session_id", "unknown"))
    path = state_path(session_id)
    hook = event.get("hook_event_name")
    if hook == "SessionStart":
        handle_session_start(event, path)
    elif hook == "PostToolUse":
        handle_graph_result(event, path)
    elif hook == "PreToolUse":
        handle_pre_tool(event, path)


if __name__ == "__main__":
    main()
