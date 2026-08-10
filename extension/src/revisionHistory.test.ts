import { strict as assert } from "node:assert";
import test from "node:test";
import { RevisionHistory } from "./revisionHistory";
import { SyncCoordinator } from "./syncCoordinator";

test("revision history reset starts with one checkpoint", () => {
  const history = new RevisionHistory();
  history.reset({ hash: "a", source: "initial" });
  assert.equal(history.current()?.hash, "a");
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), false);
});

test("revision history push dedupes consecutive identical hashes", () => {
  const history = new RevisionHistory();
  history.reset({ hash: "a", source: "initial" });
  history.push({ hash: "a", source: "human" });
  history.push({ hash: "b", source: "human" });
  history.push({ hash: "b", source: "human" });
  assert.equal(history.canUndo(), true);
  history.undo();
  assert.equal(history.current()?.hash, "a");
});

test("revision history undo and redo restore checkpoints", () => {
  const history = new RevisionHistory();
  history.reset({ hash: "a", source: "initial" });
  history.push({ hash: "b", source: "agent" });
  history.push({ hash: "c", source: "human" });

  assert.equal(history.undo()?.hash, "b");
  assert.equal(history.canRedo(), true);
  assert.equal(history.redo()?.hash, "c");
  assert.equal(history.current()?.hash, "c");
});

test("new push clears redo stack", () => {
  const history = new RevisionHistory();
  history.reset({ hash: "a", source: "initial" });
  history.push({ hash: "b", source: "agent" });
  history.undo();
  assert.equal(history.canRedo(), true);
  history.push({ hash: "c", source: "human" });
  assert.equal(history.canRedo(), false);
});

test("sync revertUnsavedHuman reloads base revision", () => {
  const sync = new SyncCoordinator("base");
  sync.bootstrap("base");
  sync.loadApplied(1, "base");
  sync.canvasChanged("human");
  const [load] = sync.revertUnsavedHuman();
  assert.deepEqual(load, {
    type: "loadCanvas",
    generation: 2,
    hash: "base",
    origin: "undo",
  });
});

test("sync forceLoad uses explicit origin", () => {
  const sync = new SyncCoordinator("base");
  sync.bootstrap("base");
  sync.loadApplied(1, "base");
  const [load] = sync.forceLoad("agent", "redo");
  assert.deepEqual(load, {
    type: "loadCanvas",
    generation: 2,
    hash: "agent",
    origin: "redo",
  });
});
