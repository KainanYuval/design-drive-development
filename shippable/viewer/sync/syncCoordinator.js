"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncCoordinator = void 0;
/**
 * Pure revision coordinator. It decides ownership; hosts perform I/O effects.
 * Disk is durable interchange. An open human session wins concurrent writes.
 */
class SyncCoordinator {
    constructor(initialDiskHash) {
        this.agentTurnActive = false;
        this.state = {
            phase: "booting",
            baseHash: initialDiskHash,
            canvasHash: initialDiskHash,
            diskHash: initialDiskHash,
            generation: 0,
            agentTurnActive: false,
        };
    }
    snapshot() {
        return {
            ...this.state,
            agentTurnActive: this.agentTurnActive,
        };
    }
    isAgentTurnActive() {
        return this.agentTurnActive;
    }
    beginAgentTurn() {
        this.agentTurnActive = true;
        this.state.agentTurnActive = true;
        this.state.awaitingHash = undefined;
        this.state.savingHash = undefined;
        if (this.state.phase === "humanDirty" ||
            this.state.phase === "savingHuman" ||
            this.state.phase === "agentConflict") {
            this.state.phase = "synced";
            this.state.canvasHash = this.state.baseHash;
        }
    }
    endAgentTurn() {
        this.agentTurnActive = false;
        this.state.agentTurnActive = false;
    }
    bootstrap(hash) {
        this.state.diskHash = hash;
        return [this.beginLoad(hash, "initial")];
    }
    canvasChanged(hash) {
        if (this.agentTurnActive) {
            return [];
        }
        if (hash === this.state.canvasHash) {
            return [];
        }
        this.state.canvasHash = hash;
        this.state.phase = "humanDirty";
        this.state.awaitingHash = undefined;
        return [];
    }
    diskObserved(hash) {
        this.state.diskHash = hash;
        if (this.agentTurnActive) {
            if (hash === this.state.canvasHash && this.state.phase === "synced") {
                return [];
            }
            if (this.state.phase === "applyingAgent" &&
                this.state.awaitingHash === hash) {
                return [];
            }
            return [this.beginLoad(hash, "agent")];
        }
        if (hash === this.state.canvasHash) {
            if (this.state.phase !== "savingHuman") {
                this.markSynced(hash);
            }
            return [];
        }
        if ((this.state.phase === "humanDirty" ||
            this.state.phase === "savingHuman") &&
            hash === this.state.baseHash) {
            return [];
        }
        if (this.state.phase === "humanDirty" ||
            this.state.phase === "savingHuman" ||
            this.state.phase === "agentConflict") {
            this.state.phase = "agentConflict";
            return [
                {
                    type: "preserveConflict",
                    agentHash: hash,
                    humanHash: this.state.canvasHash,
                    baseHash: this.state.baseHash,
                },
            ];
        }
        if (this.state.phase === "applyingAgent" &&
            this.state.awaitingHash === hash) {
            return [];
        }
        return [this.beginLoad(hash, "agent")];
    }
    requestHumanSave() {
        if (this.agentTurnActive) {
            return [];
        }
        if (this.state.phase !== "humanDirty" &&
            this.state.phase !== "agentConflict") {
            return [];
        }
        const expectedDiskHash = this.state.phase === "agentConflict"
            ? this.state.diskHash
            : this.state.baseHash;
        this.state.phase = "savingHuman";
        this.state.savingHash = this.state.canvasHash;
        return [
            {
                type: "saveHuman",
                expectedDiskHash,
                humanHash: this.state.canvasHash,
            },
        ];
    }
    humanSaveSucceeded(savedHash) {
        this.state.diskHash = savedHash;
        this.state.baseHash = savedHash;
        this.state.savingHash = undefined;
        if (this.state.canvasHash === savedHash) {
            this.markSynced(savedHash);
        }
        else {
            this.state.phase = "humanDirty";
        }
    }
    humanSaveFailed() {
        this.state.savingHash = undefined;
        this.state.phase = "humanDirty";
    }
    humanSaveLostRace(agentHash) {
        this.state.diskHash = agentHash;
        this.state.phase = "agentConflict";
        return [
            {
                type: "preserveConflict",
                agentHash,
                humanHash: this.state.canvasHash,
                baseHash: this.state.baseHash,
            },
        ];
    }
    loadApplied(generation, appliedHash) {
        if (generation !== this.state.generation ||
            appliedHash !== this.state.awaitingHash) {
            return false;
        }
        this.state.canvasHash = appliedHash;
        this.markSynced(appliedHash);
        return true;
    }
    acceptExternal(hash) {
        this.state.diskHash = hash;
        return [this.beginLoad(hash, "conflict-resolution")];
    }
    beginLoad(hash, origin) {
        const generation = this.state.generation + 1;
        this.state.generation = generation;
        this.state.phase = "applyingAgent";
        this.state.awaitingHash = hash;
        return { type: "loadCanvas", generation, hash, origin };
    }
    markSynced(hash) {
        this.state.phase = "synced";
        this.state.baseHash = hash;
        this.state.canvasHash = hash;
        this.state.diskHash = hash;
        this.state.awaitingHash = undefined;
        this.state.savingHash = undefined;
    }
}
exports.SyncCoordinator = SyncCoordinator;
//# sourceMappingURL=syncCoordinator.js.map