import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseCaseDetails } from "../src/sudrf/case-parser.js";
import { fixture } from "./helpers.js";

describe("parseCaseDetails — appeal card with an act (case_acts_sample.html)", () => {
  const d = parseCaseDetails(fixture("case_acts_sample.html"), "Октябрьский районный суд", "/card");

  test("reads the case identity", () => {
    assert.equal(d.caseNumber, "11-90/2024");
    assert.equal(d.caseUid, "13MS0025-01-2021-003613-83");
    assert.equal(d.judge, "Гордеева Инна Александровна");
    assert.match(d.category, /Прочие исковые дела/);
    assert.equal(d.court, "Октябрьский районный суд");
  });

  test("reads both parties with their registry identifiers", () => {
    assert.equal(d.participants.length, 2);

    const plaintiff = d.participants.find((p) => p.role === "ИСТЕЦ");
    assert.ok(plaintiff, "ИСТЕЦ must be present");
    assert.match(plaintiff!.name, /Голиаф/);
    assert.equal(plaintiff!.inn, "6658506936");
    assert.equal(plaintiff!.ogrn, "1176658096306");

    const defendant = d.participants.find((p) => p.role === "ОТВЕТЧИК");
    assert.equal(defendant?.name, "Иванова Елена Валерьевна");
  });

  test("reads the case movement timeline", () => {
    assert.equal(d.events.length, 7);
    const first = d.events[0]!;
    assert.equal(first.name, "Регистрация поступившей жалобы (представления)");
    assert.equal(first.date, "16.12.2024");
    assert.equal(first.time, "16:03");
    for (const e of d.events) {
      assert.ok(e.name.length > 0, "every event needs a name");
      assert.ok(e.date, "every event needs a date");
      assert.match(e.date!, /^\d{2}\.\d{2}\.\d{4}$/, `bad event date: ${e.date}`);
    }
  });

  test("extracts the judicial act with its full text", () => {
    assert.equal(d.documents.length, 1);
    const doc = d.documents[0]!;
    assert.equal(doc.name, "АПЕЛЛЯЦИОННОЕ ОПРЕДЕЛЕНИЕ");
    assert.equal(doc.date, "23 декабря 2024");
    assert.ok(doc.text && doc.text.length > 5000, "act text should be substantial");
    // Act text must be the decision body, not the surrounding page chrome.
    assert.match(doc.text!, /ОПРЕДЕЛЕНИЕ/);
  });
});

describe("parseCaseDetails — first-instance card with many parties", () => {
  const d = parseCaseDetails(fixture("case_fi_parties_sample.html"), "Суд", "/card");

  test("reads the identity of a first-instance case", () => {
    assert.equal(d.caseNumber, "2-724/2026 ~ М-210/2026");
    assert.equal(d.caseUid, "test-uid-2724");
    assert.equal(d.judge, "Иванов И.И.");
    assert.match(d.category, /защитой права собственности/);
  });

  test("keeps every participant row, including repeated roles", () => {
    assert.equal(d.participants.length, 9);
    // Three co-defendants share the ОТВЕТЧИК role — none may be dropped.
    const defendants = d.participants.filter((p) => p.role === "ОТВЕТЧИК").map((p) => p.name);
    assert.deepEqual(defendants, [
      "Макаров Андрей Николаевич",
      "Макаров Николай Анатольевич",
      "Макарова Татьяна Николаевна",
    ]);
    assert.ok(d.participants.some((p) => p.role === "АДВОКАТ"));
    for (const p of d.participants) {
      assert.ok(p.role.length > 0 && p.name.length > 0);
    }
  });

  test("reads the movement rows", () => {
    assert.equal(d.events.length, 2);
    assert.equal(d.events[0]!.name, "Регистрация иска");
    assert.equal(d.events[0]!.date, "20.02.2025");
  });

  test("reports no documents when the card has none", () => {
    assert.deepEqual(d.documents, []);
  });
});

describe("parseCaseDetails — robustness", () => {
  test("returns an empty card instead of throwing on an unrecognised page", () => {
    // live_case_sample.html is a card variant with no #cont tables.
    const d = parseCaseDetails(fixture("live_case_sample.html"), "Суд", "/card");
    assert.equal(d.court, "Суд");
    assert.deepEqual(d.participants, []);
    assert.deepEqual(d.events, []);
    assert.deepEqual(d.documents, []);
  });

  test("does not throw on empty input", () => {
    const d = parseCaseDetails("", "Суд", "/card");
    assert.equal(d.caseNumber, "");
    assert.deepEqual(d.participants, []);
  });
});
