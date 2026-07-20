import type { StoredCase } from "./api.js";

export type TimelineKind = "milestone" | "event" | "document";

export interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  sortKey: number;
  date?: string;
  time?: string;
  title: string;
  lines: string[];
}

/** Parse DD.MM.YYYY (and optional HH:MM) for chronological sort. */
export function parseRuDateTime(date?: string, time?: string): number {
  if (!date) return Number.MAX_SAFE_INTEGER;
  const m = date.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const [, d, mo, y] = m;
  let hours = 12;
  let mins = 0;
  if (time) {
    const t = time.match(/(\d{1,2}):(\d{2})/);
    if (t) {
      hours = Number(t[1]);
      mins = Number(t[2]);
    }
  }
  return new Date(Number(y), Number(mo) - 1, Number(d), hours, mins).getTime();
}

function pushMilestone(
  items: TimelineEntry[],
  id: string,
  date: string | undefined,
  time: string | undefined,
  title: string,
  lines: string[],
): void {
  if (!date && lines.length === 0) return;
  items.push({
    id,
    kind: "milestone",
    sortKey: parseRuDateTime(date, time),
    date,
    time,
    title,
    lines,
  });
}

export function buildCaseTimeline(c: StoredCase): TimelineEntry[] {
  const items: TimelineEntry[] = [];
  const docs = c.documents ?? [];

  pushMilestone(items, "entry", c.entryDate, undefined, "Поступило в суд", []);
  pushMilestone(items, "hearing", c.hearingDate, c.hearingTime, "Заседание", [
    c.courtroom ? `Зал: ${c.courtroom}` : "",
  ].filter(Boolean));
  pushMilestone(items, "result", c.resultDate, undefined, "Решение / результат", [
    c.status ?? "",
  ].filter(Boolean));

  for (const [i, ev] of (c.events ?? []).entries()) {
    const lines = [
      ev.result,
      ev.basis ? `Основание: ${ev.basis}` : "",
      ev.note ? `Примечание: ${ev.note}` : "",
      ev.courtroom ? `Зал: ${ev.courtroom}` : "",
      ev.publishDate ? `Размещено: ${ev.publishDate}` : "",
    ].filter(Boolean) as string[];

    items.push({
      id: `ev-${i}`,
      kind: "event",
      sortKey: parseRuDateTime(ev.date, ev.time),
      date: ev.date,
      time: ev.time,
      title: ev.name,
      lines,
    });
  }

  for (const [i, doc] of docs.entries()) {
    const lines = [
      doc.caseNumber && doc.caseNumber !== c.caseNumber ? `Дело № ${doc.caseNumber}` : "",
      c.hasActText ? "Текст акта в поиске" : "",
    ].filter(Boolean) as string[];

    items.push({
      id: `doc-${doc.docId || i}`,
      kind: "document",
      sortKey: parseRuDateTime(doc.date),
      date: doc.date,
      title: doc.name,
      lines,
    });
  }

  items.sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
    const kindOrder: Record<TimelineKind, number> = { milestone: 0, event: 1, document: 2 };
    return kindOrder[a.kind] - kindOrder[b.kind];
  });

  return items;
}

export function formatTimelineDate(date?: string, time?: string): string {
  return [date, time].filter(Boolean).join(" ") || "—";
}
