"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_TURN_DEFAULT_LABEL = exports.AGENT_TURN_LOCK_SUFFIX = exports.AGENT_TURN_PERSIST_READY_MS = exports.PERSIST_READY_MS = exports.AGENT_TURN_WATCH_DEBOUNCE_MS = exports.WATCH_DEBOUNCE_MS = void 0;
exports.agentTurnLockPath = agentTurnLockPath;
exports.parseAgentTurnLock = parseAgentTurnLock;
exports.readAgentTurnLockSync = readAgentTurnLockSync;
const fs = __importStar(require("node:fs"));
exports.WATCH_DEBOUNCE_MS = 50;
exports.AGENT_TURN_WATCH_DEBOUNCE_MS = 16;
exports.PERSIST_READY_MS = 100;
exports.AGENT_TURN_PERSIST_READY_MS = 16;
exports.AGENT_TURN_LOCK_SUFFIX = ".ddd-agent-turn.lock";
exports.AGENT_TURN_DEFAULT_LABEL = "Agent turn";
function agentTurnLockPath(diagramPath) {
    return `${diagramPath}${exports.AGENT_TURN_LOCK_SUFFIX}`;
}
function parseAgentTurnLock(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (parsed?.kind === "agent-turn") {
            return {
                kind: "agent-turn",
                label: typeof parsed.label === "string" && parsed.label.trim()
                    ? parsed.label.trim()
                    : exports.AGENT_TURN_DEFAULT_LABEL,
                pid: typeof parsed.pid === "number" ? parsed.pid : undefined,
                startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : undefined,
            };
        }
    }
    catch {
        // Lock file exists but is not JSON yet — still treat as an active agent turn.
    }
    return { kind: "agent-turn", label: exports.AGENT_TURN_DEFAULT_LABEL };
}
function readAgentTurnLockSync(diagramPath) {
    const lockPath = agentTurnLockPath(diagramPath);
    try {
        if (!fs.existsSync(lockPath)) {
            return null;
        }
        return parseAgentTurnLock(fs.readFileSync(lockPath, "utf8"));
    }
    catch {
        return { kind: "agent-turn", label: exports.AGENT_TURN_DEFAULT_LABEL };
    }
}
//# sourceMappingURL=agentTurn.js.map