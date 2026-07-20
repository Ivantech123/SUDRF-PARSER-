// delo_id → category mapping, derived from the sud_delo module's own switch().
// The numeric prefix of form fields (U1_/U2_/G2_/...) follows the category.

export interface CaseCategory {
  deloId: number;
  label: string;            // вид производства
  fieldPrefix: string;      // U1_ | U2_ | G2_ | ...
  caseType: number;         // case_type param paired with delo_id
}

export const CASE_CATEGORIES: CaseCategory[] = [
  { deloId: 4,        label: "Уголовные дела (первая инстанция)",            fieldPrefix: "u2_", caseType: 1 },
  { deloId: 5,        label: "Гражданские дела (первая инстанция)",          fieldPrefix: "g2_", caseType: 1 },
  { deloId: 1540006,  label: "Дела об административных правонарушениях",     fieldPrefix: "u1_", caseType: 1 },
  { deloId: 1540005,  label: "Административные дела (КАС РФ)",               fieldPrefix: "u1_", caseType: 1 },
  { deloId: 41,       label: "Апелляционная инстанция",                       fieldPrefix: "u2_", caseType: 1 },
  { deloId: 42,       label: "Кассационная инстанция",                        fieldPrefix: "u2_", caseType: 1 },
  { deloId: 43,       label: "Надзорная инстанция",                           fieldPrefix: "u2_", caseType: 1 },
  { deloId: 2450001,  label: "Уголовные дела (новая подсудность)",           fieldPrefix: "u2_", caseType: 1 },
  { deloId: 2800001,  label: "Гражданские дела (новая подсудность)",         fieldPrefix: "g2_", caseType: 1 },
];

export function categoryByDeloId(id: number): CaseCategory | undefined {
  return CASE_CATEGORIES.find(c => c.deloId === id);
}

// Search-form field schema per category. The shared set is mapped here so the
// MCP tool can accept normalized inputs (caseNumber, uid, participant, inn...)
// and expand them to the category-specific field names.
export interface SearchFilters {
  caseNumber?: string;      // номер дела, напр. "2-1234/2024"
  uid?: string;             // УИД (уникальный идентификатор дела)
  participantName?: string; // ФИО / наименование участника или ответчика
  inn?: string;
  kpp?: string;
  ogrn?: string;
  judge?: string;           // ФИО судьи
  entryDateFrom?: string;   // DD.MM.YYYY
  entryDateTo?: string;
  resultDateFrom?: string;
  resultDateTo?: string;
  lawArticle?: string;      // статья УК/КоАП (для уголовных/адм.)
}

// Expand normalized filters into the category-specific GET params the form
// actually submits. Field names observed on the live site:
//   <prefix>case__CASE_NUMBERSS, <prefix>case__JUDICIAL_UIDSS,
//   <PREFIX>DEFENDANT__NAMESS / <PREFIX>PARTS__NAMESS,
//   <PREFIX>PARTS__INN_STRSS, <PREFIX>PARTS__KPP_STRSS, <PREFIX>PARTS__OGRN_STRSS,
//   <PREFIX>CASE__JUDGE, <prefix>case__ENTRY_DATE1D/2D, <prefix>case__RESULT_DATE1D/2D,
//   <PREFIX>DEFENDANT__LAW_ARTICLESS
export function buildSearchParams(cat: CaseCategory, f: SearchFilters): Record<string, string> {
  const p = cat.fieldPrefix;                 // lowercased prefix (u2_, g2_, u1_)
  const P = p.toUpperCase().replace(/_$/, "_"); // U2_, G2_, U1_
  const out: Record<string, string> = {
    name: "sud_delo",
    srv_num: "1",
    name_op: "sr",          // search results op (sf = form, sr = results)
    nc: "1",
    delo_id: String(cat.deloId),
    case_type: String(cat.caseType),
    delo_table: `${p}case`,
  };
  const set = (k: string, v: string) => { if (v) out[k] = v; };
  set(`${p}case__CASE_NUMBERSS`, f.caseNumber ?? "");
  set(`${p}case__JUDICIAL_UIDSS`, f.uid ?? "");
  // name field differs by category: DEFENDANT__NAMESS (criminal/admin) vs PARTS__NAMESS (civil)
  if (cat.deloId === 5 || cat.deloId === 2800001) {
    set(`${P}PARTS__NAMESS`, f.participantName ?? "");
  } else {
    set(`${P}DEFENDANT__NAMESS`, f.participantName ?? "");
  }
  set(`${P}PARTS__INN_STRSS`, f.inn ?? "");
  set(`${P}PARTS__KPP_STRSS`, f.kpp ?? "");
  set(`${P}PARTS__OGRN_STRSS`, f.ogrn ?? "");
  set(`${P}CASE__JUDGE`, f.judge ?? "");
  set(`${p}case__ENTRY_DATE1D`, f.entryDateFrom ?? "");
  set(`${p}case__ENTRY_DATE2D`, f.entryDateTo ?? "");
  set(`${p}case__RESULT_DATE1D`, f.resultDateFrom ?? "");
  set(`${p}case__RESULT_DATE2D`, f.resultDateTo ?? "");
  set(`${P}DEFENDANT__LAW_ARTICLESS`, f.lawArticle ?? "");
  out["Submit"] = "Искать";
  return out;
}
