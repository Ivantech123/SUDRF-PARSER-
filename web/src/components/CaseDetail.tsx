import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { StoredCase, StoredDocument } from "../lib/api.js";
import {
  buildCaseTimeline,
  formatTimelineDate,
  type TimelineEntry,
  type TimelineKind,
} from "../lib/case-timeline.js";
import DocumentViewer from "./DocumentViewer.js";
import ModalPortal from "./ModalPortal.js";

interface Props {
  caseData: StoredCase;
  onClose: () => void;
  backLabel?: string;
  /** Контекст сверху, напр. «Юрист: Наумов С. Г.» */
  contextLabel?: string;
  /** Click participant name → open dossier (esp. ПРЕДСТАВИТЕЛЬ) */
  onParticipantClick?: (p: { name: string; role: string }) => void;
}

function isClickableParticipant(name: string): boolean {
  const n = name.trim();
  if (n.length < 3) return false;
  if (/информация скрыта|фио\d|#|не указан/i.test(n)) return false;
  return true;
}

const KIND_STYLES: Record<TimelineKind, { dot: string; label: string }> = {
  milestone: { dot: "bg-emerald-400", label: "text-emerald-400/80" },
  event: { dot: "bg-white/50", label: "text-white/40" },
  document: { dot: "bg-sky-400", label: "text-sky-400/80" },
};

const KIND_LABELS: Record<TimelineKind, string> = {
  milestone: "Веха",
  event: "Событие",
  document: "Документ",
};

function TimelineRow({
  entry,
  isLast,
  onOpenDocument,
}: {
  entry: TimelineEntry;
  isLast: boolean;
  onOpenDocument?: (docId: string) => void;
}) {
  const style = KIND_STYLES[entry.kind];
  const isDoc = entry.kind === "document";
  const docId = isDoc ? entry.id.replace(/^doc-/, "") : null;

  return (
    <li className="relative grid grid-cols-[88px_20px_1fr] gap-x-3 gap-y-1 sm:grid-cols-[100px_24px_1fr]">
      <p className="pt-0.5 text-right font-mono text-[10px] leading-snug text-white/45">
        {formatTimelineDate(entry.date, entry.time)}
      </p>
      <div className="relative flex justify-center">
        <span className={`relative z-10 mt-1.5 block h-2.5 w-2.5 rounded-full ${style.dot}`} />
        {!isLast && <span className="absolute top-4 bottom-0 w-px bg-white/12" />}
      </div>
      <div className="min-w-0 pb-5">
        <p className={`font-mono text-[9px] uppercase tracking-[0.15em] ${style.label}`}>
          {KIND_LABELS[entry.kind]}
        </p>
        {isDoc && docId && onOpenDocument ? (
          <button
            type="button"
            onClick={() => onOpenDocument(docId)}
            className="mt-1 text-left font-mono text-[12px] leading-snug text-sky-300/90 underline decoration-white/20 underline-offset-2 transition hover:text-sky-200 hover:decoration-white/50"
          >
            {entry.title}
          </button>
        ) : (
          <p className="mt-1 font-mono text-[12px] leading-snug text-white/85">{entry.title}</p>
        )}
        {entry.lines.map((line) => (
          <p key={line} className="mt-1 font-mono text-[10px] leading-relaxed text-white/45">
            {line}
          </p>
        ))}
        {isDoc && docId && onOpenDocument && (
          <button
            type="button"
            onClick={() => onOpenDocument(docId)}
            className="mt-2 font-mono text-[9px] uppercase tracking-[0.15em] text-white/35 transition hover:text-white"
          >
            Открыть →
          </button>
        )}
      </div>
    </li>
  );
}

export default function CaseDetail({ caseData: c, onClose, backLabel, contextLabel, onParticipantClick }: Props) {
  const [tab, setTab] = useState<"timeline" | "participants" | "documents">("timeline");
  const [viewDoc, setViewDoc] = useState<StoredDocument | null>(null);
  const events = c.events ?? [];
  const participants = c.participants ?? [];
  const timeline = useMemo(() => buildCaseTimeline(c), [c]);
  const documents = c.documents ?? [];
  const hasDocuments = documents.length > 0 || c.documentsCount > 0;

  const openDocument = (docId: string) => {
    const found = documents.find((d) => d.docId === docId);
    if (found) {
      setViewDoc(found);
      setTab("documents");
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !viewDoc) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, viewDoc]);

  useEffect(() => {
    if (hasDocuments && events.length === 0) setTab("documents");
  }, [hasDocuments, events.length]);

  const tabs = [
    { id: "timeline" as const, label: "Таймлайн", count: timeline.length },
    { id: "participants" as const, label: "Участники", count: participants.length },
    { id: "documents" as const, label: "Документы", count: documents.length || c.documentsCount },
  ];

  return (
    <ModalPortal>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex items-end justify-center p-0 sm:items-center sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-label={`Дело ${c.caseNumber}`}
      >
        {/* Фон — не закрывает по клику, только кнопки */}
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" aria-hidden />

        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.98 }}
          transition={{ type: "spring", damping: 28, stiffness: 340 }}
          className="relative flex max-h-[calc(100dvh-var(--nav-bottom)-env(safe-area-inset-bottom)-0.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-t-lg border border-sky-400/50 bg-[#0c0c0f] shadow-[0_0_0_1px_rgba(56,189,248,0.15),0_24px_80px_rgba(0,0,0,0.9)] sm:max-h-[88dvh] sm:rounded-sm md:mb-0"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="shrink-0 border-b border-white/10 bg-[#0c0c0f]">
            {contextLabel && (
              <p className="border-b border-white/5 bg-sky-400/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-sky-300/90 sm:px-6">
                {contextLabel}
              </p>
            )}
            <div className="flex items-center gap-3 px-4 py-4 sm:px-6">
              <button
                type="button"
                onClick={onClose}
                className="flex shrink-0 items-center gap-2 border border-white/25 bg-white/5 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-white/80 transition hover:border-sky-400/60 hover:bg-sky-400/10 hover:text-sky-100"
              >
                <span aria-hidden>←</span>
                {backLabel ?? "Закрыть"}
              </button>
              <div className="min-w-0 flex-1 text-center sm:text-left">
                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-sky-400">
                  Карточка дела
                </p>
                <p className="truncate font-display text-xl text-white sm:text-2xl">{c.caseNumber}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 border border-white/15 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-white/50 hover:border-white/40 hover:text-white"
                aria-label="Закрыть"
              >
                Esc
              </button>
            </div>
            <p className="truncate px-4 pb-4 font-mono text-[11px] text-white/55 sm:px-6">{c.courtName}</p>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-white/30">Категория</p>
                <p className="mt-1 font-mono text-sm text-white">{c.category}</p>
              </div>
              {c.status && (
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-white/30">Статус</p>
                  <p className="mt-1 font-mono text-sm text-emerald-300">{c.status}</p>
                </div>
              )}
              {c.judge && (
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-white/30">Судья</p>
                  <p className="mt-1 font-mono text-sm text-white">{c.judge}</p>
                </div>
              )}
              {(c.hearingDate || c.hearingTime) && (
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-white/30">Заседание</p>
                  <p className="mt-1 font-mono text-sm text-emerald-300/90">
                    {[c.hearingDate, c.hearingTime].filter(Boolean).join(" ")}
                    {c.courtroom ? ` · зал ${c.courtroom}` : ""}
                  </p>
                </div>
              )}
            </div>

            {(c.plaintiff || c.defendant) && (
              <div className="mt-5 flex flex-wrap gap-3 font-mono text-[11px]">
                {c.plaintiff && (
                  <span className="border border-white/10 px-3 py-1.5 text-white/70">
                    <span className="text-white/35">Истец: </span>
                    {c.plaintiff}
                  </span>
                )}
                {c.defendant && (
                  <span className="border border-white/10 px-3 py-1.5 text-white/70">
                    <span className="text-white/35">Ответчик: </span>
                    {c.defendant}
                  </span>
                )}
              </div>
            )}

            {c.firstInstance && (c.firstInstance.court || c.firstInstance.caseNumber || c.firstInstance.judge) && (
              <section className="mt-6 border border-white/10 p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-white/35">Первая инстанция</p>
                <div className="mt-2 space-y-1 font-mono text-[11px] text-white/65">
                  {c.firstInstance.court && <p>{c.firstInstance.court}</p>}
                  {c.firstInstance.caseNumber && <p>Дело № {c.firstInstance.caseNumber}</p>}
                  {c.firstInstance.judge && <p>Судья: {c.firstInstance.judge}</p>}
                </div>
              </section>
            )}

            <div className="mt-8 flex flex-wrap gap-2 border-b border-white/10 pb-4">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`border px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em] transition ${
                    tab === t.id
                      ? "border-sky-400 bg-sky-400/15 text-sky-200"
                      : "border-white/20 text-white/50 hover:border-white/50 hover:text-white"
                  }`}
                >
                  {t.label}
                  {t.count > 0 && <span className="ml-2 opacity-60">{t.count}</span>}
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              {tab === "timeline" && (
                <motion.section
                  key="timeline"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="mt-6"
                >
                  {timeline.length === 0 ? (
                    <p className="font-mono text-[11px] text-white/40">
                      Таймлайн появится после обогащения карточки дела парсером.
                    </p>
                  ) : (
                    <ul>
                      {timeline.map((entry, i) => (
                        <TimelineRow
                          key={entry.id}
                          entry={entry}
                          isLast={i === timeline.length - 1}
                          onOpenDocument={documents.length > 0 ? openDocument : undefined}
                        />
                      ))}
                    </ul>
                  )}
                </motion.section>
              )}

              {tab === "participants" && (
                <motion.section
                  key="participants"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="mt-6"
                >
                  {participants.length === 0 ? (
                    <p className="font-mono text-[11px] text-white/40">Участники не указаны.</p>
                  ) : (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {participants.map((p, i) => {
                        const clickable = Boolean(onParticipantClick && isClickableParticipant(p.name));
                        const isRep = /представ|адвокат|защитник|юрисконсульт/i.test(p.role || "");
                        return (
                          <li key={i}>
                            <button
                              type="button"
                              disabled={!clickable}
                              onClick={() => onParticipantClick?.({ name: p.name, role: p.role || "" })}
                              className={`w-full border px-4 py-3 text-left transition ${
                                clickable
                                  ? isRep
                                    ? "border-amber-400/40 hover:border-amber-300 hover:bg-amber-400/10"
                                    : "border-white/10 hover:border-white/40 hover:bg-white/5"
                                  : "cursor-default border-white/10 opacity-70"
                              }`}
                            >
                              <p className={`font-mono text-[9px] uppercase tracking-wider ${isRep ? "text-amber-400/80" : "text-white/35"}`}>
                                {p.role}
                                {clickable ? " · открыть карточку →" : ""}
                              </p>
                              <p className="mt-1 font-mono text-[12px] text-white/90">{p.name}</p>
                              {p.inn && <p className="mt-1 font-mono text-[10px] text-white/35">ИНН {p.inn}</p>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </motion.section>
              )}

              {tab === "documents" && (
                <motion.section
                  key="documents"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="mt-6"
                >
                  {documents.length === 0 ? (
                    <div className="font-mono text-[11px] text-white/40">
                      {c.documentsCount > 0 ? (
                        <p>Документов: {c.documentsCount}. Метаданные появятся после обогащения.</p>
                      ) : (
                        <p>Судебные акты ещё не собраны.</p>
                      )}
                      {c.hasActText && (
                        <p className="mt-2 text-emerald-400/80">Тексты актов доступны в полнотекстовом поиске.</p>
                      )}
                    </div>
                  ) : (
                    <ul className="space-y-3">
                      {documents.map((doc) => (
                        <li key={doc.docId}>
                          <button
                            type="button"
                            onClick={() => setViewDoc(doc)}
                            className="group w-full border border-white/10 p-4 text-left transition hover:border-sky-400/50 hover:bg-sky-400/5"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="font-mono text-[12px] leading-snug text-white/85 group-hover:text-sky-200">
                                  {doc.name}
                                </p>
                                {doc.caseNumber && doc.caseNumber !== c.caseNumber && (
                                  <p className="mt-1 font-mono text-[10px] text-white/40">Дело № {doc.caseNumber}</p>
                                )}
                              </div>
                              {doc.date && (
                                <span className="shrink-0 font-mono text-[10px] text-sky-300/70">{doc.date}</span>
                              )}
                            </div>
                            <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-sky-400/70 group-hover:text-sky-300">
                              Открыть документ →
                            </p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </motion.section>
              )}
            </AnimatePresence>

            <section className="mt-8 flex flex-wrap gap-4 border-t border-white/10 pt-6 font-mono text-[10px] text-white/40">
              {c.caseUid && <span>УИД: {c.caseUid}</span>}
              {c.enrichedAt && (
                <span>Обогащено: {new Date(c.enrichedAt).toLocaleString("ru-RU")}</span>
              )}
              <span>Собрано: {new Date(c.collectedAt).toLocaleString("ru-RU")}</span>
              {c.caseUrl && (
                <a
                  href={`https://${c.courtSubdomain}.sudrf.ru${c.caseUrl}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-400/80 underline hover:text-sky-300"
                >
                  sudrf.ru →
                </a>
              )}
            </section>
          </div>
        </motion.div>
      </motion.div>

      {viewDoc && (
        <DocumentViewer
          caseData={c}
          doc={viewDoc}
          documents={documents}
          onClose={() => setViewDoc(null)}
          onSelectDoc={setViewDoc}
        />
      )}
    </ModalPortal>
  );
}
