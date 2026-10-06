// Normalized data shapes returned by the parsers and exposed via MCP tools.

export interface HearingItem {
  caseNumber: string;       // номер дела
  caseUid?: string;         // УИД
  parties: string;          // стороны (истец/ответчик, кратко)
  category: string;         // категория дела
  judge: string;            // судья
  courtroom?: string;       // зал
  hearingTime?: string;     // время слушания
  hearingDate: string;      // дата слушания (DD.MM.YYYY)
  caseUrl?: string;         // ссылка на карточку дела
}

export type HearingParseStatus =
  | "ok"           // table found, cases listed (may be 0 rows)
  | "empty_docket" // page explicitly says no hearings scheduled
  | "no_table"     // schedule table not found — page layout changed or blocked
  | "http_error"   // server answered 429/5xx until the retry budget ran out
  | "antibot";     // Qrator/WebKnight challenge

export interface HearingSchedule {
  court: string;
  date: string;
  count: number;
  items: HearingItem[];
  parseStatus: HearingParseStatus;
  warning?: string;
}

export interface CaseSearchResult {
  caseNumber: string;
  caseUid?: string;
  category: string;
  plaintiff?: string;       // истец
  defendant?: string;       // ответчик
  judge?: string;
  entryDate?: string;       // дата поступления
  resultDate?: string;      // дата решения
  status?: string;          // состояние/результат
  caseUrl?: string;
}

export interface CaseSearchResponse {
  court: string;
  category: string;
  total: number;
  results: CaseSearchResult[];
}

export interface CaseEvent {
  date?: string;             // дата события
  time?: string;             // время
  name: string;              // наименование события (рассмотрение, решение и т.п.)
  result?: string;           // результат события
  basis?: string;            // основание для результата
  note?: string;             // примечание
  courtroom?: string;        // место проведения
  publishDate?: string;      // дата размещения
}

export interface CaseParticipant {
  role: string;              // вид лица: ИСТЕЦ / ОТВЕТЧИК / ТРЕТЬЕ ЛИЦО / ПРЕДСТАВИТЕЛЬ / АДВОКАТ ...
  name: string;              // ФИО / наименование
  inn?: string;
  kpp?: string;
  ogrn?: string;
  ogrnip?: string;
}

export interface CaseDocument {
  docId: string;             // внутренний id (cont_doc index) для дедупа
  name: string;              // наименование документа (тип акта / заголовок)
  caseNumber?: string;       // номер дела из шапки акта (для апелляционных — единственный источник)
  date?: string;             // дата акта (если удаётся извлечь)
  text: string;              // полный текст судебного акта (inline в cont_docN)
  url?: string;              // ссылка, если акт выложен файлом (редко)
}

export interface CaseDetails {
  caseNumber: string;
  caseUid?: string;
  category: string;          // реальная категория дела из карточки
  court: string;             // наименование суда
  plaintiff?: string;
  defendant?: string;
  judge?: string;            // председательствующий
  entryDate?: string;        // дата поступления
  resultDate?: string;       // дата решения
  status?: string;           // результат / состояние дела
  firstInstance?: {          // реквизиты рассмотрения в нижестоящем суде
    court?: string;
    caseNumber?: string;
    judge?: string;
  };
  participants: CaseParticipant[];
  events: CaseEvent[];
  documents: CaseDocument[];
  caseUrl?: string;
}
