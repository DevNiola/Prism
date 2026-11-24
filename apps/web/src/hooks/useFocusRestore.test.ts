import { test } from "node:test";
import assert from "node:assert/strict";
import { createFocusRestorer } from "./useFocusRestore";

// These tests cover the focus-restore logic that powers modal/panel close
// (including the Esc path). They use mock elements bound to a fake document so
// no DOM is required. Run with: npx tsx apps/web/src/hooks/useFocusRestore.test.ts

test("restores focus to the element captured before the panel opened (Esc-driven close path)", () => {
  const calls: string[] = [];
  const trigger = { focus: () => calls.push("trigger") } as unknown as HTMLElement;
  const doc = {
    activeElement: trigger,
    contains: () => true,
  } as unknown as Document;

  const restorer = createFocusRestorer(doc);
  restorer.capture();
  // Simulate the panel closing — e.g. user pressed Esc.
  restorer.restore();

  assert.deepStrictEqual(calls, ["trigger"]);
});

test("restore is a no-op when nothing was focused before opening", () => {
  const calls: string[] = [];
  const doc = {
    activeElement: null,
    contains: () => true,
  } as unknown as Document;

  const restorer = createFocusRestorer(doc);
  restorer.capture();
  restorer.restore();

  assert.deepStrictEqual(calls, []);
});

test("restore skips an element that is no longer connected to the document", () => {
  const calls: string[] = [];
  const trigger = { focus: () => calls.push("trigger") } as unknown as HTMLElement;
  const doc = {
    activeElement: trigger,
    contains: () => false,
  } as unknown as Document;

  const restorer = createFocusRestorer(doc);
  restorer.capture();
  restorer.restore();

  assert.deepStrictEqual(calls, []);
});

test("restore only fires once per capture", () => {
  const calls: string[] = [];
  const trigger = { focus: () => calls.push("trigger") } as unknown as HTMLElement;
  const doc = {
    activeElement: trigger,
    contains: () => true,
  } as unknown as Document;

  const restorer = createFocusRestorer(doc);
  restorer.capture();
  restorer.restore();
  restorer.restore(); // second restore should be a no-op

  assert.deepStrictEqual(calls, ["trigger"]);
});
