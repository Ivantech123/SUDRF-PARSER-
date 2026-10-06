import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  extractPaginationHrefs,
  extractTotalFound,
  isCaptchaRequired,
  isNoResults,
  parseHearingSchedule,
  parseSearchResults,
} from "../src/sudrf/parsers.js";
import { fixture } from "./helpers.js";

// ── Hearing schedule (Tier 1) ───────────────────────────────────────────
// Mirrors the live #tablcont layout documented in parsers.ts: the case number
// cell carries the card link, and "Информация по делу" is a <br>-separated
// block of LABEL: value lines.
function scheduleHtml(rows: string): string {
  return `<html><body><table id="tablcont">
    <tr><td>№п/п</td><td>Номер дела</td><td>Время слушания</td><td>Место (Зал)</td>
        <td>Информация по делу</td><td>Судья</td><td>Результат</td></tr>
    ${rows}
  </table></body></html>`;
}

describe("parseHearingSchedule", () => {
  test("parses a docket row into a structured hearing", () => {
    const html = scheduleHtml(`
      <tr>
        <td>1</td>
        <td><a href="/modules.php?name=sud_delo&name_op=case&case_id=1&case_uid=11111111-2222-3333-4444-555555555555">2-100/2026</a></td>
        <td>09:30</td>
        <td>зал 4</td>
        <td>КАТЕГОРИЯ: О защите прав потребителей<br>ИСТЕЦ(ЗАЯВИТЕЛЬ): Иванов И.И.<br>ОТВЕТЧИК: ООО "Ромашка"</td>
        <td>Петров П.П.</td>
        <td></td>
      </tr>`);

    const s = parseHearingSchedule(html, "Октябрьский районный суд", "01.07.2026");

    assert.equal(s.parseStatus, "ok");
    assert.equal(s.count, 1);
    assert.equal(s.court, "Октябрьский районный суд");
    const [item] = s.items;
    assert.equal(item!.caseNumber, "2-100/2026");
    assert.equal(item!.caseUid, "11111111-2222-3333-4444-555555555555");
    assert.equal(item!.hearingTime, "09:30");
    assert.equal(item!.courtroom, "зал 4");
    assert.equal(item!.judge, "Петров П.П.");
    assert.equal(item!.hearingDate, "01.07.2026");
    assert.equal(item!.category, "О защите прав потребителей");
    // The label carries a parenthesised suffix before the colon.
    assert.equal(item!.parties, 'Иванов И.И. — ООО "Ромашка"');
    assert.match(item!.caseUrl!, /case_id=1/);
  });

  test("skips section divider rows that carry no case link", () => {
    const html = scheduleHtml(`
      <tr><td colspan="7">Гражданские дела - апелляция</td></tr>
      <tr>
        <td>1</td><td><a href="/m?case_id=2&case_uid=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee">2-5/2026</a></td>
        <td>10:00</td><td>1</td><td>КАТЕГОРИЯ: Прочие</td><td>Судья С.С.</td><td></td>
      </tr>`);

    const s = parseHearingSchedule(html, "Суд", "01.07.2026");
    assert.equal(s.count, 1);
    assert.equal(s.items[0]!.caseNumber, "2-5/2026");
  });

  test("reports an antibot challenge instead of parsing the challenge page", () => {
    const s = parseHearingSchedule(
      "<html><script>qrator_jsid='x'</script></html>",
      "Суд",
      "01.07.2026",
    );
    assert.equal(s.parseStatus, "antibot");
    assert.equal(s.count, 0);
    assert.ok(s.warning);
  });

  test("distinguishes an explicitly empty docket from a missing table", () => {
    const empty = parseHearingSchedule(
      "<html><body>На указанную дату заседаний нет</body></html>",
      "Суд",
      "01.07.2026",
    );
    assert.equal(empty.parseStatus, "empty_docket");

    const broken = parseHearingSchedule("<html><body><p>что-то ещё</p></body></html>", "Суд", "01.07.2026");
    assert.equal(broken.parseStatus, "no_table");
    assert.ok(broken.warning);
  });

  test("finds the table by header text when #tablcont is absent", () => {
    const html = `<html><body><table>
      <tr><th>Номер дела</th><th>Время слушания</th><th>Зал</th><th>Информация по делу</th></tr>
      <tr><td><a href="/m?case_id=9&case_uid=99999999-9999-9999-9999-999999999999">3-7/2026</a></td>
          <td>11:15</td><td>2</td><td>КАТЕГОРИЯ: Прочие</td></tr>
    </table></body></html>`;

    const s = parseHearingSchedule(html, "Суд", "02.07.2026");
    assert.equal(s.parseStatus, "ok");
    assert.equal(s.items[0]!.caseNumber, "3-7/2026");
    assert.equal(s.items[0]!.hearingTime, "11:15");
  });
});

// ── Search results (Tier 2) ─────────────────────────────────────────────

describe("parseSearchResults", () => {
  const html = fixture("okt-postsubmit.html");

  test("parses a captured Oktyabrsky results page", () => {
    const r = parseSearchResults(html, "Октябрьский районный суд", "Гражданские дела");

    // "Всего по запросу найдено — 141" with 25 rows rendered on page 1.
    assert.equal(r.total, 141);
    assert.equal(r.results.length, 25);
    assert.equal(r.court, "Октябрьский районный суд");
  });

  test("extracts the case identity and parties of the first row", () => {
    const [row] = parseSearchResults(html, "Суд", "Гражданские дела").results;

    assert.equal(row!.caseNumber, "11-20/2026");
    assert.equal(row!.caseUid, "adbd81c8-3918-42f1-b8b0-aef436a4f6d8");
    assert.equal(row!.plaintiff, "Фролов Сергей Анатольевич");
    assert.equal(row!.defendant, "Фролов Никита Алексеевич");
    assert.equal(row!.entryDate, "17.06.2026");
    assert.match(row!.caseUrl!, /name_op=case&case_id=179849368/);
    // The real category comes from the info cell, not the requested label.
    assert.match(row!.category, /защитой прав потребителей/);
  });

  test("every row carries a case number and no pagination noise leaks in", () => {
    for (const row of parseSearchResults(html, "Суд", "Кат").results) {
      assert.ok(row.caseNumber.length > 0);
      assert.doesNotMatch(row.caseNumber, /^Страницы/i);
      assert.doesNotMatch(row.caseNumber, /всего по запросу/i);
    }
  });

  test("returns an empty response for a no-results page", () => {
    const r = parseSearchResults(fixture("post-submit.html"), "Суд", "Кат");
    assert.equal(r.results.length, 0);
    assert.equal(r.total, 0);
  });

  test("returns an empty response rather than throwing on junk input", () => {
    const r = parseSearchResults("<html><body>nope</body></html>", "Суд", "Кат");
    assert.deepEqual(r.results, []);
    assert.equal(r.total, 0);
  });
});

describe("extractTotalFound", () => {
  test("reads the hit count from a real page", () => {
    assert.equal(extractTotalFound(fixture("okt-postsubmit.html")), 141);
  });

  test("returns null when the page has no total", () => {
    assert.equal(extractTotalFound(fixture("post-submit.html")), null);
    assert.equal(extractTotalFound("<html></html>"), null);
  });
});

describe("extractPaginationHrefs", () => {
  test("collects the page>=1 links from a real results page", () => {
    const hrefs = extractPaginationHrefs(fixture("okt-postsubmit.html"));
    assert.ok(hrefs.length > 0);
    for (const h of hrefs) {
      assert.match(h, /name=sud_delo/);
      assert.match(h, /[?&]page=\d+/);
      // Hrefs arrive as "./modules.php…"; the fetch layer needs a path.
      assert.ok(h.startsWith("/") || h.startsWith("http"), `not normalised: ${h.slice(0, 40)}`);
      assert.doesNotMatch(h, /&amp;/, "entities must be decoded before fetching");
    }
  });

  test("orders pages ascending and de-duplicates the >/>> arrows", () => {
    const html = `<html><body>
      <a href="./modules.php?name=sud_delo&name_op=r&page=3">3</a>
      <a href="./modules.php?name=sud_delo&name_op=r&page=2">2</a>
      <a href="./modules.php?name=sud_delo&name_op=r&page=2">&gt;</a>
      <a href="./modules.php?name=sud_delo&name_op=r&page=1">1</a>
      <a href="/other.php?page=4">unrelated</a>
    </body></html>`;

    assert.deepEqual(extractPaginationHrefs(html), [
      "/modules.php?name=sud_delo&name_op=r&page=2",
      "/modules.php?name=sud_delo&name_op=r&page=3",
    ]);
  });

  test("ignores page=1 — that page is already in hand", () => {
    const html = `<a href="./modules.php?name=sud_delo&page=1">1</a>`;
    assert.deepEqual(extractPaginationHrefs(html), []);
  });
});

describe("isNoResults / isCaptchaRequired", () => {
  test("detects the no-results page", () => {
    assert.equal(isNoResults(fixture("post-submit.html")), true);
    assert.equal(isNoResults(fixture("okt-postsubmit.html")), false);
  });

  test("captcha detection needs both the captcha and captchaid fields", () => {
    assert.equal(isCaptchaRequired(`<input name="captcha"><input name="captchaid">`), true);
    assert.equal(isCaptchaRequired(`<input name="captcha">`), false);
    assert.equal(isCaptchaRequired("<html></html>"), false);
  });
});
