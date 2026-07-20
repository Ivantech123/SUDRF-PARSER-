import * as cheerio from "cheerio";
import type {
  CaseDetails,
  CaseEvent,
  CaseParticipant,
  CaseDocument,
} from "./types.js";

function clean(s: string | undefined | null): string {
  return (s ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&rarr;/gi, "→")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Read a 2-column "label / value" table (used by cont1 and cont2). Returns a
// map of lowercased label → value. The first row is a section title ("ДЕЛО").
function kvMap($: cheerio.CheerioAPI, $table: cheerio.Cheerio<any>): Record<string, string> {
  const out: Record<string, string> = {};
  $table.find("tr").each((_, tr) => {
    const cells = $(tr).find("td,th").map((_, c) => clean($(c).text())).get();
    if (cells.length >= 2) {
      const k = cells[0].toLowerCase();
      // skip the section-title row (single cell spanning columns)
      if (k && cells[1]) out[k] = cells[1];
    }
  });
  return out;
}

// Locate the header row of a table by searching for a cell containing the
// given keyword. SUDRF detail tables have a single-cell title row first
// (e.g. "ДВИЖЕНИЕ ДЕЛА", "УЧАСТНИКИ"), with the real column headers in the
// next row — so reading `.first()` as headers yields nothing. Returns the
// 0-based row index, or -1 if no row matches (caller falls back to row 0).
function findHeaderRow(
  $: cheerio.CheerioAPI,
  $table: cheerio.Cheerio<any>,
  keyword: string | RegExp
): number {
  let idx = -1;
  const match = (cell: string) =>
    typeof keyword === "string" ? cell.includes(keyword) : keyword.test(cell);
  $table.find("tr").each((i, tr) => {
    if (idx >= 0) return;
    const cells = $(tr).find("td,th").map((_, c) => clean($(c).text()).toLowerCase()).get();
    if (cells.some(match)) idx = i;
  });
  return idx;
}

/** First-instance cards omit «нижестоящий суд», so contN ids shift — find by content. */
function findContTable(
  $: cheerio.CheerioAPI,
  headerKeywords: string[],
): cheerio.Cheerio<any> {
  const roots = ["#cont1", "#cont2", "#cont3", "#cont4", "#cont5", "#cont6"];
  for (const sel of roots) {
    const $root = $(sel);
    if (!$root.length) continue;
    const $tables = $root.find("table");
    for (let t = 0; t < $tables.length; t++) {
      const $table = $tables.eq(t);
      for (const kw of headerKeywords) {
        if (findHeaderRow($, $table, kw) >= 0) return $table;
      }
    }
  }
  // Fallback: any table on the page
  const $all = $("table");
  for (let t = 0; t < $all.length; t++) {
    const $table = $all.eq(t);
    for (const kw of headerKeywords) {
      if (findHeaderRow($, $table, kw) >= 0) return $table;
    }
  }
  return $();
}

function pickCategory(c1: Record<string, string>): string {
  const keys = [
    "категория дела",
    "категория",
    "категория спора",
    "характер спора",
    "предмет спора",
    "вид судопроизводства",
  ];
  for (const k of keys) {
    if (c1[k]?.trim()) return c1[k]!;
  }
  // fuzzy: any label containing «категор»
  for (const [k, v] of Object.entries(c1)) {
    if (/категор/i.test(k) && v.trim()) return v;
  }
  return "";
}

// Read a table's header row (lowercased cell text) by row index.
function headerCells(
  $: cheerio.CheerioAPI,
  $table: cheerio.Cheerio<any>,
  rowIdx: number
): string[] {
  const $row = $table.find("tr").eq(rowIdx);
  return $row.find("td,th").map((_, c) => clean($(c).text()).toLowerCase()).get();
}

// ── Case detail card ────────────────────────────────────────────────────
// Page: modules.php?name=sud_delo&...&name_op=case&case_id=...&case_uid=...
// Four hidden <div id="contN"> sections, plus zero or more <div id="cont_docN">
// holding the full text of each published judicial act inline.
export function parseCaseDetails(
  html: string,
  courtName: string,
  caseUrl?: string
): CaseDetails {
  const $ = cheerio.load(html);

  // ── ДЕЛО (key/value) — usually cont1, but resolve by «уид» / «номер дела» ──
  let $deloTable = $("#cont1 table").first();
  if (!$deloTable.length || !Object.keys(kvMap($, $deloTable)).some((k) => /номер|уид|категор|судья/.test(k))) {
    $deloTable = findContTable($, ["уникальный идентификатор", "номер дела", "дата поступления"]);
  }
  const c1 = kvMap($, $deloTable);
  const caseUid = c1["уникальный идентификатор дела"] ?? c1["уид"];
  const category = pickCategory(c1);
  const judge = c1["судья"];
  const entryDate = c1["дата поступления"];
  const resultDate = c1["дата рассмотрения"] ?? c1["дата решения"];
  const status = c1["результат рассмотрения"] ?? c1["результат"];

  // ── РАССМОТРЕНИЕ В НИЖЕСТОЯЩЕМ СУДЕ (optional — often missing on 1st instance) ──
  const $fiTable = findContTable($, ["номер дела в первой инстанции", "номер дела первой инстанции"]);
  const c2 = $fiTable.length ? kvMap($, $fiTable) : {};
  const firstInstance = {
    court: undefined as string | undefined,
    caseNumber: c2["номер дела в первой инстанции"] ?? c2["номер дела первой инстанции"],
    judge: c2["судья (мировой судья) первой инстанции"] ?? c2["судья первой инстанции"],
  };

  // ── ДВИЖЕНИЕ ДЕЛА — cont3 on appeal cards, often cont2 on first-instance ──
  const events: CaseEvent[] = [];
  const $eTable = findContTable($, ["наименование события"]);
  const eHdrRow = findHeaderRow($, $eTable, "наименование события");
  if (eHdrRow >= 0) {
    const eHeaders = headerCells($, $eTable, eHdrRow);
    const eCol = (name: string) => eHeaders.findIndex(h => h.includes(name));
    const eName = eCol("наименование события");
    const eDate = eCol("дата");
    const eTime = eCol("время");
    const eRoom = eCol("место");
    const eResult = eCol("результат события") >= 0 ? eCol("результат события") : eCol("результат");
    const eBasis = eCol("основание");
    const eNote = eCol("примечание");
    const ePub = eCol("дата размещения");
    $eTable.find("tr").slice(eHdrRow + 1).each((_, tr) => {
      const cells = $(tr).find("td").map((_, c) => $(c)).get();
      if (cells.length < 2) return;
      const get = (i: number) => (i >= 0 && cells[i] ? clean(cells[i].text()) : "");
      const name = get(eName);
      if (!name) return;
      // skip section title repeating in body
      if (/^движение дела$/i.test(name)) return;
      events.push({
        name,
        date: get(eDate) || undefined,
        time: get(eTime) || undefined,
        courtroom: get(eRoom) || undefined,
        result: get(eResult) || undefined,
        basis: get(eBasis) || undefined,
        note: get(eNote) || undefined,
        publishDate: get(ePub) || undefined,
      });
    });
  }

  // ── СТОРОНЫ / УЧАСТНИКИ — cont4 on appeal, cont3 (or cont2) on 1st instance ──
  // Tab title on Mordovia ray courts: «СТОРОНЫ ПО ДЕЛУ (ТРЕТЬИ ЛИЦА)»
  const participants: CaseParticipant[] = [];
  const $pTable = findContTable($, ["вид лица", "фамилия / наименование", "огрнип"]);
  const pHdrRow = Math.max(
    findHeaderRow($, $pTable, "вид лица"),
    findHeaderRow($, $pTable, /фамилия.*наименование|наименование.*фамилия/),
  );
  if (pHdrRow >= 0) {
    const pHeaders = headerCells($, $pTable, pHdrRow);
    const pCol = (name: string) => pHeaders.findIndex(h => h.includes(name));
    let pRole = pCol("вид лица");
    if (pRole < 0) pRole = pCol("вид");
    let pName = pCol("фамилия");
    if (pName < 0) pName = pCol("наименование");
    // Common layout: col0=role, col1=name when headers are multi-word
    if (pRole < 0 && pName < 0 && pHeaders.length >= 2) {
      pRole = 0;
      pName = 1;
    }
    const pInn = pCol("инн");
    const pKpp = pCol("кпп");
    // prefer ОГРН over ОГРНИП column (both match «огрн»)
    let pOgrn = -1;
    let pOgrnip = -1;
    pHeaders.forEach((h, i) => {
      if (h.includes("огрнип")) pOgrnip = i;
      else if (h.includes("огрн") && pOgrn < 0) pOgrn = i;
    });
    $pTable.find("tr").slice(pHdrRow + 1).each((_, tr) => {
      const cells = $(tr).find("td").map((_, c) => $(c)).get();
      if (cells.length < 2) return;
      const get = (i: number) => (i >= 0 && cells[i] ? clean(cells[i].text()) : "");
      const role = get(pRole);
      const name = get(pName);
      if (!role && !name) return;
      // skip title / header echoes
      if (/^(вид лица|стороны|участники)/i.test(role) && !name) return;
      if (/^(вид лица|фамилия|наименование)$/i.test(name) && /вид/i.test(role)) return;
      participants.push({
        role,
        name,
        inn: get(pInn) || undefined,
        kpp: get(pKpp) || undefined,
        ogrn: get(pOgrn) || undefined,
        ogrnip: get(pOgrnip) || undefined,
      });
    });
  }

  // derive plaintiff/defendant from participants for convenience
  const plaintiff = participants.find(p => /истец|заявитель|взыскатель/i.test(p.role))?.name;
  const defendant = participants.find(p => /ответчик|должник/i.test(p.role))?.name;
  // ── cont_docN: судебные акты (inline full text) ──
  const documents: CaseDocument[] = [];
  for (let n = 1; n <= 10; n++) {
    const $doc = $(`#cont_doc${n}`).first();
    if (!$doc.length) break;
    const text = clean($doc.text());
    if (!text) continue;
    // The act type (РЕШЕНИЕ / АПЕЛЛЯЦИОННОЕ ОПРЕДЕЛЕНИЕ / ОПРЕДЕЛЕНИЕ / ПОСТАНОВЛЕНИЕ)
    // appears in the first line, often prefixed by "Дело №…". Pull it out directly
    // rather than splitting on ". " (which breaks on "г. Саранск").
    const actTypeMatch = text.match(
      /(АПЕЛЛЯЦИОННОЕ\s+ОПРЕДЕЛЕНИЕ|КАССАЦИОННОЕ\s+ОПРЕДЕЛЕНИЕ|ОПРЕДЕЛЕНИЕ|РЕШЕНИЕ|ПОСТАНОВЛЕНИЕ|ПРИГОВОР|СУДЕБНЫЙ\s+ПРИКАЗ)/i
    );
    // case number embedded in the act header, e.g. "Дело №11-90/2024"
    const docCaseNoMatch = text.match(/Дело\s*№\s*([^\s,;]+)/i);
    const docName = actTypeMatch
      ? clean(actTypeMatch[0]).toUpperCase()
      : (text.split(/\n/).map(s => clean(s)).find(Boolean) ?? `Документ ${n}`).slice(0, 200);
    // date near the top: "г. Саранск 23 декабря 2024 г."
    const dateMatch = text.match(/(\d{1,2}\s+[а-яё]+\s+20\d{2})\s*г/i);
    documents.push({
      docId: `cont_doc${n}`,
      name: docName,
      caseNumber: docCaseNoMatch ? clean(docCaseNoMatch[1]) : undefined,
      date: dateMatch ? dateMatch[1] : undefined,
      text,
      url: undefined,
    });
  }

  // For appellate cases cont1 has no "Номер дела" row — the production number
  // (e.g. 11-90/2024) only appears in the act header. Fall back to the first
  // document's embedded case number, then to the first-instance number.
  const fallbackNumber = documents.find(d => d.caseNumber)?.caseNumber;
  const caseNumber =
    c1["номер дела"] ?? c1["№ дела"] ?? c1["номер"] ?? fallbackNumber ?? firstInstance.caseNumber ?? "";

  return {
    caseNumber,
    caseUid,
    category,
    court: courtName,
    plaintiff,
    defendant,
    judge,
    entryDate,
    resultDate,
    status,
    firstInstance: firstInstance.court || firstInstance.caseNumber || firstInstance.judge ? firstInstance : undefined,
    participants,
    events,
    documents,
    caseUrl,
  };
}
