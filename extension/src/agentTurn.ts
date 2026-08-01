import * as fs from "node:fs";

export const WATCH_DEBOUNCE_MS = 50;
export const AGENT_TURN_WATCH_DEBOUNCE_MS = 16;
export const PERSIST_READY_MS = 100;
export const AGENT_TURN_PERSIST_READY_MS = 16;
export const AGENT_TURN_LOCK_SUFFIX = ".ddd-agent-turn.lock";
export const AGENT_TURN_DEFAULT_LABEL = "Agent turn";

export type AgentTurnLockInfo = {
  kind: "agent-turn";
  label?: string;
  pid?: number;
  startedAt?: string;
};

export function agentTurnLockPath(diagramPath: string): string {
  return `${diagramPath}${AGENT_TURN_LOCK_SUFFIX}`;
}

export function parseAgentTurnLock(raw: string): AgentTurnLockInfo {
  try {
    const parsed = JSON.parse(raw) as {
      kind?: string;
      label?: string;
      pid?: number;
      startedAt?: string;
    };
    if (parsed?.kind === "agent-turn") {
      return {
        kind: "agent-turn",
        label:
          typeof parsed.label === "string" && parsed.label.trim()
            ? parsed.label.trim()
            : AGENT_TURN_DEFAULT_LABEL,
        pid: typeof parsed.pid === "number" ? parsed.pid : undefined,
        startedAt:
          typeof parsed.startedAt === "string" ? parsed.startedAt : undefined,
      };
    }
  } catch {
    // Lock file exists but is not JSON yet — still treat as an active agent turn.
  }

  return { kind: "agent-turn", label: AGENT_TURN_DEFAULT_LABEL };
}

export function readAgentTurnLockSync(
  diagramPath: string
): AgentTurnLockInfo | null {
  const lockPath = agentTurnLockPath(diagramPath);
  try {
    if (!fs.existsSync(lockPath)) {
      return null;
    }
    return parseAgentTurnLock(fs.readFileSync(lockPath, "utf8"));
  } catch {
    return { kind: "agent-turn", label: AGENT_TURN_DEFAULT_LABEL };
  }
}
