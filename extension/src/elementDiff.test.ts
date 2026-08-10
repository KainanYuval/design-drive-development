import { strict as assert } from "node:assert";
import test from "node:test";
import {
  diffElements,
  elementRevision,
  parseDiagramElements,
  shouldUseFullReload,
} from "./elementDiff";

test("diffElements detects added, updated, and removed elements", () => {
  const previous = [
    { id: "a", version: 1, versionNonce: 1, updated: 1 },
    { id: "b", version: 1, versionNonce: 1, updated: 1 },
  ];
  const next = [
    { id: "a", version: 2, versionNonce: 2, updated: 2 },
    { id: "c", version: 1, versionNonce: 1, updated: 1 },
  ];

  const diff = diffElements(previous, next);
  assert.deepEqual(diff.removedIds, ["b"]);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0]?.id, "c");
  assert.equal(diff.updated.length, 1);
  assert.equal(diff.updated[0]?.id, "a");
});

test("elementRevision changes when element mutates", () => {
  const before = { id: "x", version: 1, versionNonce: 1, updated: 1 };
  const after = { id: "x", version: 1, versionNonce: 2, updated: 1 };
  assert.notEqual(elementRevision(before), elementRevision(after));
});

test("shouldUseFullReload prefers patch for small deltas", () => {
  const diff = diffElements(
    [{ id: "a", version: 1, versionNonce: 1, updated: 1 }],
    [
      { id: "a", version: 1, versionNonce: 1, updated: 1 },
      { id: "b", version: 1, versionNonce: 1, updated: 1 },
    ]
  );
  assert.equal(shouldUseFullReload(diff, 1, 2, true), false);
});

test("shouldUseFullReload falls back when most of the scene changes", () => {
  const previous = Array.from({ length: 30 }, (_, index) => ({
    id: `e-${index}`,
    version: 1,
    versionNonce: 1,
    updated: 1,
  }));
  const next = Array.from({ length: 30 }, (_, index) => ({
    id: `n-${index}`,
    version: 1,
    versionNonce: 1,
    updated: 1,
  }));
  const diff = diffElements(previous, next);
  assert.equal(shouldUseFullReload(diff, previous.length, next.length, true), true);
});

test("parseDiagramElements reads excalidraw elements array", () => {
  const elements = parseDiagramElements(
    JSON.stringify({
      type: "excalidraw",
      elements: [{ id: "box", type: "rectangle" }],
    })
  );
  assert.equal(elements.length, 1);
  assert.equal(elements[0]?.id, "box");
});
