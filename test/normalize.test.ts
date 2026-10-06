import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { extractEntityCandidates, normalizeEntityName } from "../src/entities/normalize.js";

describe("normalizeEntityName", () => {
  test("strips quotes and keeps the legal form in the display name", () => {
    const n = normalizeEntityName('ООО "Ромашка"');
    assert.equal(n?.canonical, "ООО Ромашка");
    assert.equal(n?.key, "ромашка");
    assert.equal(n?.opf, "ООО");
    assert.equal(n?.raw, 'ООО "Ромашка"');
  });

  test("detects a Cyrillic legal form at all", () => {
    // Regression: the old /^(ооо|…)\b/ used an ASCII-only \b, which never
    // matches after "О", so opf was always undefined and canonical lost the
    // legal form entirely.
    for (const [input, opf] of [
      ["ООО Ромашка", "ООО"],
      ["АО Вектор", "АО"],
      ["ПАО Сбербанк", "ПАО"],
      ["ЗАО Вектор", "ЗАО"],
      ["ОАО РЖД", "ОАО"],
      ["ФГУП Почта России", "ФГУП"],
      ["ГУП Водоканал", "ГУП"],
      ["ИП Сидоров А.А.", "ИП"],
    ] as const) {
      assert.equal(normalizeEntityName(input)?.opf, opf, input);
    }
  });

  test("prefers the longest legal form", () => {
    // "ФГУП" must not be read as "ГУП", nor "ПАО" as "АО".
    assert.equal(normalizeEntityName("ФГУП Почта России")?.opf, "ФГУП");
    assert.equal(normalizeEntityName("ПАО Сбербанк")?.opf, "ПАО");
  });

  test("folds the spelled-out legal form onto its abbreviation", () => {
    // Court cards mix both spellings for the same company; they must dedupe.
    const long = normalizeEntityName('Общество с ограниченной ответственностью "Голиаф"');
    const short = normalizeEntityName('ООО "Голиаф"');
    assert.equal(long?.key, short?.key);
    assert.equal(long?.canonical, short?.canonical);
    assert.equal(long?.opf, "ООО");

    assert.equal(normalizeEntityName("Публичное акционерное общество «Сбербанк»")?.canonical, "ПАО Сбербанк");
    assert.equal(normalizeEntityName('Акционерное общество "Вектор"')?.canonical, "АО Вектор");
    assert.equal(
      normalizeEntityName("Индивидуальный предприниматель Сидоров А.А.")?.canonical,
      "ИП Сидоров А.А.",
    );
  });

  test("abbreviation and long form agree on a nested-quote company", () => {
    // Taken verbatim from scripts/case_acts_sample.html.
    const n = normalizeEntityName('Общество с ограниченной ответственностью "Коллекторское агенство "Голиаф"');
    assert.equal(n?.opf, "ООО");
    assert.equal(n?.key, "коллекторское агенство голиаф");
  });

  test("does not mistake a surname for a legal form", () => {
    // "Ипатов" begins with "ИП" but is not an entrepreneur marker.
    for (const name of ["Ипатов Сергей", "Аосипов Пётр", "Нковалёв Иван"]) {
      assert.equal(normalizeEntityName(name)?.opf, undefined, name);
    }
    assert.equal(normalizeEntityName("Ипатов Сергей")?.canonical, "Ипатов Сергей");
  });

  test("treats a bare natural person as having no legal form", () => {
    const n = normalizeEntityName("Иванов Иван Иванович");
    assert.equal(n?.opf, undefined);
    assert.equal(n?.canonical, "Иванов Иван Иванович");
    assert.equal(n?.key, "иванов иван иванович");
  });

  test("is case- and quote-style insensitive for dedup", () => {
    const keys = [
      'ООО "Ромашка"',
      "ооо Ромашка",
      "ООО «Ромашка»",
      "ООО Ромашка",
    ].map((s) => normalizeEntityName(s)?.key);
    assert.deepEqual(new Set(keys), new Set(["ромашка"]));
  });

  test("rejects input that is empty or only a legal form", () => {
    for (const bad of ["", "   ", "A", "ООО", "АО", "Общество с ограниченной ответственностью"]) {
      assert.equal(normalizeEntityName(bad), null, JSON.stringify(bad));
    }
  });
});

describe("extractEntityCandidates", () => {
  test("splits a compound party string", () => {
    assert.deepEqual(
      extractEntityCandidates("Иванов И.И.; ООО Ромашка, ИП Петров"),
      ["Иванов И.И.", "ООО Ромашка", "ИП Петров"],
    );
  });

  test("drops empty fragments and bare numbers", () => {
    assert.deepEqual(extractEntityCandidates("Иванов И.И.;; 12 , ООО Ромашка"), [
      "Иванов И.И.",
      "ООО Ромашка",
    ]);
  });

  test("returns nothing for blank input", () => {
    assert.deepEqual(extractEntityCandidates(""), []);
    assert.deepEqual(extractEntityCandidates("   "), []);
  });
});
