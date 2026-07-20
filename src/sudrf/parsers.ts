import * as cheerio from "cheerio";
import type { HearingItem, HearingSchedule, CaseSearchResult, CaseSearchResponse } from "./types.js";

// sudrf tables are legacy <table>/<tr>/<td>. Column order is mostly stable but
// we parse by header text to be robust against minor court-specific variants.

function clean(s: string | undefined | null): string {
  return (s ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&rarr;/gi, "→")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Hearing schedule (Tier 1, no captcha) ───────────────────────────────
// Page: modules.php?name=sud_delo&srv_num=1&H_date=DD.MM.YYYY
// Schedule table (id="tablcont") columns:
//   №п/п | Номер дела | Время слушания | Место (Зал) | Информация по делу | Судья | Результат | Судебные акты
// "Информация по делу" is a rich <br>-separated cell:
//   КАТЕГОРИЯ: <...>  ИСТЕЦ(ЗАЯВИТЕЛЬ): <...>  ОТВЕТЧИК: <...>
//   Суд (судебный участок) первой инстанции: <...>  Номер дела в первой инстанции: <...>
export function parseHearingSchedule(html: string, courtName: string, date: string): HearingSchedule {
  const $ = cheerio.load(html);
  const items: HearingItem[] = [];

  if (/qrator|qaptcha|webknight|ddos-guard/i.test(html)) {
    return {
      court: courtName,
      date,
      count: 0,
      items,
      parseStatus: "antibot",
      warning: "Страница расписания заблокирована антиботом (Qrator/WebKnight). Повторите позже или используйте браузерный поиск.",
    };
  }

  const pageText = clean($("body").text());
  if (/дело не назначено|заседания не назначены|на указанную дату заседаний нет/i.test(pageText)) {
    return {
      court: courtName,
      date,
      count: 0,
      items,
      parseStatus: "empty_docket",
    };
  }

  let $table: cheerio.Cheerio<any> = $("#tablcont").first();
  if (!$table.length) {
    const found = $("table").toArray()
      .map(t => $(t))
      .find($t => /номер дела|время слушания/i.test(clean($t.find("tr").first().text())));
    if (found) $table = found;
  }
  if (!$table.length) {
    return {
      court: courtName,
      date,
      count: 0,
      items,
      parseStatus: "no_table",
      warning: "Таблица расписания не найдена в HTML — возможно, изменилась вёрстка sudrf.ru или отдана заглушка.",
    };
  }

  const headers = $table.find("tr").first().find("td,th").map((_, c) => clean($(c).text()).toLowerCase()).get();
  const col = (name: string) => headers.findIndex(h => h.includes(name));
  const iNum = col("номер дела") >= 0 ? col("номер дела") : 1;
  const iTime = col("время слушания") >= 0 ? col("время слушания") : col("время");
  const iRoom = col("зал") >= 0 ? col("зал") : col("место");
  const iInfo = col("информация по делу") >= 0 ? col("информация по делу") : col("информация");
  const iJudge = col("судья");

  $table.find("tr").slice(1).each((_, tr) => {
    const $tr = $(tr);
    // Section divider rows (e.g. "Гражданские дела - апелляция") span all
    // columns and carry no case link — skip them.
    if ($tr.find("td[colspan]").length && !$tr.find("a[href*='case_id']").length) return;
    const cells = $tr.find("td").map((_, c) => $(c)).get();
    if (cells.length < 4) return;
    const get = (i: number) => (i >= 0 && cells[i] ? clean(cells[i].text()) : "");
    const numCell = cells[iNum];
    const num = clean(numCell?.text() ?? "");
    if (!num || /дел не назначено/i.test(num)) return;
    const link = numCell?.find("a").attr("href") || undefined;
    // Parse the rich info cell by <br>-separated lines. We can't use .text()
    // because cheerio glues <br>-separated lines with no delimiter; instead
    // take inner HTML, turn <br> into newlines, strip tags, split.
    const infoLines = iInfo >= 0 && cells[iInfo] ? brLines(cells[iInfo]) : [];
    items.push({
      caseNumber: num,
      caseUid: uidFromLink(link),
      parties: partiesFromLines(infoLines),
      category: lineValue(infoLines, "КАТЕГОРИЯ"),
      judge: get(iJudge),
      courtroom: get(iRoom) || undefined,
      hearingTime: get(iTime) || undefined,
      hearingDate: date,
      caseUrl: link || undefined,
    });
  });

  return {
    court: courtName,
    date,
    count: items.length,
    items,
    parseStatus: items.length > 0 ? "ok" : "empty_docket",
    warning: items.length === 0
      ? "Таблица найдена, но дел нет — либо заседания не назначены, либо строки не распознаны парсером."
      : undefined,
  };
}

// Turn a cell's inner HTML into cleaned text lines, splitting on <br>.
function brLines($cell: cheerio.Cheerio<any>): string[] {
  const html = $cell.html() ?? "";
  const withBreaks = html.replace(/<br\s*\/?>/gi, "\n");
  const text = withBreaks.replace(/<[^>]+>/g, "");
  return text.split("\n").map(s => clean(s)).filter(Boolean);
}

// Match a line like "ИСТЕЦ(ЗАЯВИТЕЛЬ): value" — the label may carry a
// parenthesized suffix before the colon.
function lineValue(lines: string[], ...labels: string[]): string {
  for (const line of lines) {
    for (const label of labels) {
      const re = new RegExp(`^${label}\\s*(?:\\([^)]*\\))?\\s*[:\\)]\\s*(.*)$`, "i");
      const m = line.match(re);
      if (m && clean(m[1])) return clean(m[1]);
    }
  }
  return "";
}

function partiesFromLines(lines: string[]): string {
  const plaintiff = lineValue(lines, "ИСТЕЦ", "ЗАЯВИТЕЛЬ");
  const defendant = lineValue(lines, "ОТВЕТЧИК");
  if (plaintiff && defendant) return `${plaintiff} — ${defendant}`;
  return plaintiff || defendant || "";
}

function uidFromLink(href?: string): string | undefined {
  if (!href) return undefined;
  const m = href.match(/case_uid=([0-9a-f-]+)/i);
  return m ? m[1] : undefined;
}

// ── Search results (Tier 2, after captcha) ──────────────────────────────
// Page: modules.php?name=sud_delo&...&name_op=r  (form submits to op=r)
// Results live in <table id="tablcont">. Column layout (Oktyabrsky/Mordovia):
//   № дела | Дата поступления | Категория / Стороны / Суд первой инстанции /
//   Номер дела в первой инстанции | Судья | Дата решения | Решение |
//   Дата вступления в законную силу | Судебные акты
// The combined "Категория/Стороны/…" cell is <br>-separated, same shape as the
// hearing-schedule info cell, so we reuse the line-extraction helpers.
export function parseSearchResults(html: string, courtName: string, categoryLabel: string): CaseSearchResponse {
  const $ = cheerio.load(html);
  const results: CaseSearchResult[] = [];

  // total count from "Всего по запросу найдено — N"
  let total = 0;
  const totalMatch = html.match(/всего по запросу найдено\s*—\s*(\d+)/i);
  if (totalMatch) total = parseInt(totalMatch[1], 10);

  let $table = $("#tablcont").first();
  if (!$table.length) {
    const found = $("table").toArray()
      .map(t => $(t))
      .find($t => /№\s*дела|номер дела|всего по запросу/i.test(clean($t.find("tr").first().text())));
    if (found) $table = found;
  }
  if (!$table.length) {
    return { court: courtName, category: categoryLabel, total: 0, results };
  }

  const headers = $table.find("tr").first().find("td,th").map((_, c) => clean($(c).text()).toLowerCase()).get();
  const col = (name: string, skip?: number) => {
    const idx = headers.findIndex(h => h.includes(name));
    if (idx < 0) return -1;
    return skip !== undefined && idx === skip ? -1 : idx;
  };
  const iNum = col("№ дела") >= 0 ? col("№ дела") : (col("номер дела") >= 0 ? col("номер дела") : col("дело"));
  const iEntry = col("поступл");
  // The info cell header contains "категория / стороны / судья первой инстанции"
  // — find it first so we can exclude it from the judge/result column search.
  const iInfo = col("категор") >= 0 ? col("категор") : col("стороны");
  const iJudge = col("судья", iInfo >= 0 ? iInfo : undefined);
  const iResult = col("решен") >= 0 ? col("решен") : col("результат");
  const iStatus = col("состояни");

  $table.find("tr").slice(1).each((_, tr) => {
    const $tr = $(tr);
    if ($tr.find("td[colspan]").length && !$tr.find("a[href*='case_id']").length) return;
    const cells = $tr.find("td").map((_, c) => $(c)).get();
    if (cells.length < 2) return;
    const get = (i: number) => (i >= 0 && cells[i] ? clean(cells[i].text()) : "");
    const numCell = cells[iNum >= 0 ? iNum : 0];
    const num = clean(numCell?.text() ?? "");
    if (!num || /^страницы/i.test(num) || /всего по запросу/i.test(num)) return;
    const link = numCell?.find("a").attr("href") || undefined;
    const infoLines = iInfo >= 0 && cells[iInfo] ? brLines(cells[iInfo]) : [];
    const realCategory = lineValue(infoLines, "КАТЕГОРИЯ");
    const firstInstanceJudge = lineValue(infoLines, "СУДЬЯ", "СУД");
    results.push({
      caseNumber: num,
      caseUid: uidFromLink(link),
      category: realCategory || categoryLabel,
      plaintiff: lineValue(infoLines, "ИСТЕЦ", "ЗАЯВИТЕЛЬ") || undefined,
      defendant: lineValue(infoLines, "ОТВЕТЧИК") || undefined,
      judge: get(iJudge) || firstInstanceJudge || undefined,
      entryDate: get(iEntry) || undefined,
      resultDate: get(iResult) || undefined,
      status: get(iStatus) || undefined,
      caseUrl: link || undefined,
    });
  });

  return { court: courtName, category: categoryLabel, total: total || results.length, results };
}

// ── Pagination ──────────────────────────────────────────────────────────
// The sud_delo results page renders a "Страницы: 1 2 3 …" navigation row when
// there are more than 25 hits. Each page is a plain GET link (name_op=sr with
// an extra page param) that does NOT re-trigger the captcha — the search
// session already passed the gate. Rather than guess the param name, we follow
// the anchor hrefs verbatim. Returns relative hrefs for pages 2..N (page 1 is
// the html we already have), de-duplicated and ordered by page number.
// Live sud_delo pagination looks like:
//   <a href="./modules.php?name=sud_delo&srv_num=1&name_op=r&page=2&vnkod=…">2</a>
//   … "&gt;" → next page, "&gt;&gt;" → last page (both carry page=N)
// So we key purely on the page=N param (N ≥ 2) and ignore the visible label,
// which captures numeric cells and the >/>> arrows alike. Hrefs are relative
// ("./modules.php…"); we normalize them to an absolute path the fetch/browser
// layer accepts.
export function extractPaginationHrefs(html: string): string[] {
  const $ = cheerio.load(html);
  const seen = new Map<number, string>();

  $("a").each((_, a) => {
    let href = $(a).attr("href");
    if (!href) return;
    href = href.replace(/&amp;/gi, "&");
    if (!/name=sud_delo/i.test(href)) return;
    const pageMatch = href.match(/[?&]page=(\d+)/i);
    if (!pageMatch) return;
    const pageNum = parseInt(pageMatch[1]!, 10);
    if (!Number.isFinite(pageNum) || pageNum <= 1) return;
    if (!seen.has(pageNum)) seen.set(pageNum, normalizeHref(href));
  });

  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, href]) => href);
}

// Turn a results-page relative href into a path the fetch/browser layer takes.
function normalizeHref(href: string): string {
  if (href.startsWith("http") || href.startsWith("/")) return href;
  return "/" + href.replace(/^\.?\/*/, "");
}

/** Parse the "Всего по запросу найдено — N" total, or null if absent. */
export function extractTotalFound(html: string): number | null {
  const m = html.match(/всего по запросу найдено\s*[—\-:]?\s*(\d+)/i);
  return m ? parseInt(m[1]!, 10) : null;
}

// ── "No results" / captcha detection ────────────────────────────────────
export function isCaptchaRequired(html: string): boolean {
  return /name=['"]captcha['"]/i.test(html) && /name=['"]captchaid['"]/i.test(html);
}

export function isNoResults(html: string): boolean {
  return /дел не найдено|ничего не найдено|по вашему запросу ничего|данных по запросу не обнаружено/i.test(html);
}
