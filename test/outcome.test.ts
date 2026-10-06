import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { classifyOutcome, summarizeOutcomes, type OutcomeVerdict } from "../src/analytics/outcome.js";

const verdict = (label: OutcomeVerdict["label"]): OutcomeVerdict =>
  ({ label, confidence: 1, evidence: "", source: "status" });

describe("classifyOutcome", () => {
  test("classifies the common first-instance results from the status line", () => {
    assert.equal(classifyOutcome({ status: "Иск удовлетворен" }).label, "granted");
    assert.equal(classifyOutcome({ status: "Отказано в удовлетворении" }).label, "denied");
    assert.equal(classifyOutcome({ status: "Производство по делу прекращено" }).label, "terminated");
    assert.equal(classifyOutcome({ status: "Заявление возвращено заявителю" }).label, "returned");
  });

  test("recognises a returned claim in either word order", () => {
    // Regression: only the verb-first form used to match, so the very common
    // "Заявление возвращено заявителю" was silently counted as unknown.
    for (const status of [
      "Заявление возвращено заявителю",
      "Исковое заявление возвращено",
      "Возвращено заявление",
      "Заявление оставлено без движения",
    ]) {
      assert.equal(classifyOutcome({ status }).label, "returned", status);
    }
  });

  test("prefers 'partial' over 'granted' when both stems are present", () => {
    // "Иск удовлетворен частично" contains the plain "иск удовлетвор" stem too,
    // so rule order decides — partial must win or every partial win is
    // over-counted as a full win in the win-rate report.
    const v = classifyOutcome({ status: "Иск удовлетворен частично" });
    assert.equal(v.label, "granted_partial");
    assert.ok(v.confidence >= 0.9);
  });

  test("matches Cyrillic stems regardless of the inflected ending", () => {
    for (const status of [
      "Иск удовлетворён",
      "Исковые требования удовлетворены",
      "требования удовлетворить",
    ]) {
      assert.notEqual(classifyOutcome({ status }).label, "unknown", status);
    }
  });

  test("falls back to the movement events when there is no status", () => {
    const v = classifyOutcome({ events: [{ name: "Решение", result: "Мировое соглашение" }] });
    assert.equal(v.label, "settled");
    assert.equal(v.source, "events");
  });

  test("falls back to the act text last, reading the operative tail", () => {
    // The резолютивная часть sits at the end of the act, so a long preamble
    // must not hide it.
    const v = classifyOutcome({
      documentText: `${"преамбула ".repeat(500)} в удовлетворении исковых требований отказать`,
    });
    assert.equal(v.label, "denied");
    assert.equal(v.source, "document");
    assert.ok(v.evidence.length > 0);
  });

  test("status wins over a contradicting act text", () => {
    const v = classifyOutcome({
      status: "Иск удовлетворен",
      documentText: "в удовлетворении исковых требований отказать",
    });
    assert.equal(v.label, "granted");
    assert.equal(v.source, "status");
  });

  test("returns unknown with zero confidence when nothing matches", () => {
    const v = classifyOutcome({});
    assert.equal(v.label, "unknown");
    assert.equal(v.confidence, 0);
    assert.equal(v.source, "none");

    assert.equal(classifyOutcome({ status: "Дело передано по подсудности" }).label, "unknown");
  });
});

describe("summarizeOutcomes", () => {
  test("counts labels and excludes unknown from the known total", () => {
    const s = summarizeOutcomes([
      verdict("granted"),
      verdict("granted"),
      verdict("denied"),
      verdict("unknown"),
    ]);
    assert.equal(s.total, 4);
    assert.equal(s.known, 3);
    assert.equal(s.byLabel.granted, 2);
    assert.equal(s.byLabel.denied, 1);
    assert.equal(s.byLabel.unknown, 1);
  });

  test("reports every label even when unused", () => {
    const s = summarizeOutcomes([]);
    assert.equal(s.total, 0);
    assert.equal(s.known, 0);
    assert.equal(s.byLabel.settled, 0);
    assert.equal(s.byLabel.appealed_upheld, 0);
  });
});
