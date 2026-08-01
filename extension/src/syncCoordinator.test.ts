import { strict as assert } from "node:assert";
import test from "node:test";
import {
  classifyDiagramText,
  EMPTY_EXCALIDRAW_JSON,
  isValidDiagramJson,
  normalizeDiagramText,
} from "./diagramDefaults";
import { SyncCoordinator } from "./syncCoordinator";

test("bootstrap waits for matching generation acknowledgement", () => {
  const sync = new SyncCoordinator("disk-a");
  const [load] = sync.bootstrap("disk-a");
  assert.deepEqual(load, {
    type: "loadCanvas",
    generation: 1,
    hash: "disk-a",
    origin: "initial",
  });
  assert.equal(sync.loadApplied(0, "disk-a"), false);
  assert.equal(sync.snapshot().phase, "applyingAgent");
  assert.equal(sync.loadApplied(1, "disk-a"), true);
  assert.equal(sync.snapshot().phase, "synced");
});

test("own-save disk echo never requests a canvas load", () => {
  const sync = new SyncCoordinator("base");
  sync.bootstrap("base");
  sync.loadApplied(1, "base");
  sync.canvasChanged("human");
  const [save] = sync.requestHumanSave();
  assert.deepEqual(save, {
    type: "saveHuman",
    expectedDiskHash: "base",
    humanHash: "human",
  });
  sync.humanSaveSucceeded("human");
  assert.deepEqual(sync.diskObserved("human"), []);
  assert.equal(sync.snapshot().phase, "synced");
});

test("agent revision applies live when human has no divergence", () => {
  const sync = new SyncCoordinator("base");
  sync.bootstrap("base");
  sync.loadApplied(1, "base");
  const [load] = sync.diskObserved("agent");
  assert.deepEqual(load, {
    type: "loadCanvas",
    generation: 2,
    hash: "agent",
    origin: "agent",
  });
  assert.equal(sync.loadApplied(1, "agent"), false);
  assert.equal(sync.loadApplied(2, "agent"), true);
  assert.equal(sync.snapshot().baseHash, "agent");
});

test("human dirty revision wins and agent candidate is preserved", () => {
  const sync = new SyncCoordinator("base");
  sync.bootstrap("base");
  sync.loadApplied(1, "base");
  sync.canvasChanged("human");
  const [conflict] = sync.diskObserved("agent");
  assert.deepEqual(conflict, {
    type: "preserveConflict",
    agentHash: "agent",
    humanHash: "human",
    baseHash: "base",
  });
  assert.equal(sync.snapshot().phase, "agentConflict");
  const [save] = sync.requestHumanSave();
  assert.deepEqual(save, {
    type: "saveHuman",
    expectedDiskHash: "agent",
    humanHash: "human",
  });
});

test("own previous save on disk is not a conflict with newer canvas revision", () => {
  const sync = new SyncCoordinator("base");
  sync.bootstrap("base");
  sync.loadApplied(1, "base");
  sync.canvasChanged("human-1");
  sync.requestHumanSave();
  sync.canvasChanged("human-2");
  sync.humanSaveSucceeded("human-1");
  assert.deepEqual(sync.diskObserved("human-1"), []);
  assert.equal(sync.snapshot().phase, "humanDirty");
});

test("new canvas revision during save stays dirty after old save", () => {
  const sync = new SyncCoordinator("base");
  sync.bootstrap("base");
  sync.loadApplied(1, "base");
  sync.canvasChanged("human-1");
  sync.requestHumanSave();
  sync.canvasChanged("human-2");
  sync.humanSaveSucceeded("human-1");
  assert.equal(sync.snapshot().phase, "humanDirty");
  assert.equal(sync.snapshot().canvasHash, "human-2");
  assert.equal(sync.snapshot().baseHash, "human-1");
});

test("failed save returns ownership to human dirty state", () => {
  const sync = new SyncCoordinator("base");
  sync.bootstrap("base");
  sync.loadApplied(1, "base");
  sync.canvasChanged("human");
  sync.requestHumanSave();
  sync.humanSaveFailed();
  assert.equal(sync.snapshot().phase, "humanDirty");
  assert.equal(sync.requestHumanSave()[0]?.type, "saveHuman");
});

test("agent turn ignores human canvas changes and loads agent disk live", () => {
  const sync = new SyncCoordinator("base");
  sync.bootstrap("base");
  sync.loadApplied(1, "base");
  sync.canvasChanged("human");
  sync.beginAgentTurn();
  assert.deepEqual(sync.canvasChanged("human-2"), []);
  assert.equal(sync.requestHumanSave().length, 0);
  const [load] = sync.diskObserved("agent-1");
  assert.deepEqual(load, {
    type: "loadCanvas",
    generation: 2,
    hash: "agent-1",
    origin: "agent",
  });
  assert.notEqual(sync.snapshot().phase, "agentConflict");
});

test("agent turn supersedes human dirty without preserveConflict", () => {
  const sync = new SyncCoordinator("base");
  sync.bootstrap("base");
  sync.loadApplied(1, "base");
  sync.canvasChanged("human");
  sync.beginAgentTurn();
  assert.deepEqual(sync.diskObserved("agent"), [
    {
      type: "loadCanvas",
      generation: 2,
      hash: "agent",
      origin: "agent",
    },
  ]);
});

test("rapid agent writes supersede in-flight generation", () => {
  const sync = new SyncCoordinator("base");
  sync.bootstrap("base");
  sync.loadApplied(1, "base");
  sync.diskObserved("agent-1");
  const [load2] = sync.diskObserved("agent-2");
  assert.equal(load2.type, "loadCanvas");
  if (load2.type !== "loadCanvas") {
    assert.fail("expected loadCanvas");
  }
  assert.equal(load2.generation, 3);
  assert.equal(sync.loadApplied(2, "agent-1"), false);
  assert.equal(sync.loadApplied(3, "agent-2"), true);
});

test("empty and malformed inputs normalize to a valid empty diagram", () => {
  for (const input of ["", "null", "[]", "{}", "{\"type\":\"other\"}"]) {
    assert.equal(isValidDiagramJson(input), false);
    assert.equal(normalizeDiagramText(input), EMPTY_EXCALIDRAW_JSON);
  }
  assert.equal(isValidDiagramJson(EMPTY_EXCALIDRAW_JSON), true);
  assert.equal(classifyDiagramText(""), "empty");
  assert.equal(classifyDiagramText("{"), "invalid");
  assert.equal(classifyDiagramText(EMPTY_EXCALIDRAW_JSON), "valid");
});
