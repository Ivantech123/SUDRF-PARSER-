import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import ModalPortal from "./ModalPortal.js";
import {
  getCaseDocument,
  type CaseDocumentView,
  type StoredCase,
  type StoredDocument,
} from "../lib/api.js";
import {
  buildDocumentFilename,
  copyToClipboard,
  countWords,
  downloadTextFile,
  printDocument,
} from "../lib/document-export.js";

interface Props {
  caseData: StoredCase;
  doc: StoredDocument;
  documents: StoredDocument[];
  onClose: () => void;
  onSelectDoc: (doc: StoredDocument) => void;
}

export default function DocumentViewer({
  caseData: c,
  doc,
  documents,
  onClose,
  onSelectDoc,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<CaseDocumentView | null>(null);
  const [copied, setCopied] = useState(false);

  const docIndex = documents.findIndex((d) => d.docId === doc.docId);
  const prevDoc = docIndex > 0 ? documents[docIndex - 1] : null;
  const nextDoc = docIndex >= 0 && docIndex < documents.length - 1 ? documents[docIndex + 1] : null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setView(null);
    try {
      const data = await getCaseDocument(c.id, doc.docId);
      setView(data.document);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить документ");
    } finally {
      setLoading(false);
    }
  }, [c.id, doc.docId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && prevDoc) onSelectDoc(prevDoc);
      if (e.key === "ArrowRight" && nextDoc) onSelectDoc(nextDoc);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onSelectDoc, prevDoc, nextDoc]);

  const text = view?.text ?? "";
  const filename = buildDocumentFilename(c.caseNumber, doc.name, doc.date);
  const sudrfUrl = c.caseUrl
    ? `https://${c.courtSubdomain}.sudrf.ru${c.caseUrl}`
    : undefined;

  const handleDownload = () => {
    if (!text) return;
    downloadTextFile(filename, text);
  };

  const handleCopy = async () => {
    if (!text) return;
    try {
      await copyToClipboard(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Не удалось скопировать в буфер обмена");
    }
  };

  const handlePrint = () => {
    if (!text) return;
    printDocument(`${doc.name} — ${c.caseNumber}`, text);
  };

  const toolbarBtn =
    "border border-white/25 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-white/65 transition hover:border-white hover:text-white disabled:cursor-not-allowed disabled:opacity-30";

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[210] flex flex-col bg-black/95 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Документ: ${doc.name}`}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex min-h-0 flex-1 flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 border-b border-white/15 px-4 py-4 sm:px-6">
          <div className="mx-auto flex max-w-5xl flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/35">
                {c.caseNumber}
                {doc.date && <span className="ml-3 text-sky-400/70">{doc.date}</span>}
              </p>
              <h2 className="mt-1 font-display text-xl text-white sm:text-2xl">{doc.name}</h2>
              {view?.source && view.source !== "file" && (
                <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-white/30">
                  источник: {view.source === "catalog" ? "каталог" : view.source === "sudrf" ? "sudrf.ru" : "поиск"}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 font-mono text-[11px] uppercase tracking-[0.2em] text-white/40 hover:text-white"
            >
              ← К делу
            </button>
          </div>

          <div className="mx-auto mt-4 flex max-w-5xl flex-wrap items-center gap-2">
            <button type="button" className={toolbarBtn} onClick={handleDownload} disabled={!text}>
              Скачать .txt
            </button>
            <button type="button" className={toolbarBtn} onClick={handleCopy} disabled={!text}>
              {copied ? "Скопировано" : "Копировать"}
            </button>
            <button type="button" className={toolbarBtn} onClick={handlePrint} disabled={!text}>
              Печать
            </button>
            {view?.downloadUrl && (
              <a
                href={view.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className={toolbarBtn}
              >
                Скачать файл →
              </a>
            )}
            {sudrfUrl && (
              <a href={sudrfUrl} target="_blank" rel="noreferrer" className={toolbarBtn}>
                На sudrf.ru →
              </a>
            )}
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                className={toolbarBtn}
                disabled={!prevDoc}
                onClick={() => prevDoc && onSelectDoc(prevDoc)}
              >
                ← Пред.
              </button>
              <button
                type="button"
                className={toolbarBtn}
                disabled={!nextDoc}
                onClick={() => nextDoc && onSelectDoc(nextDoc)}
              >
                След. →
              </button>
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          <div className="mx-auto max-w-5xl">
            {loading && (
              <div className="flex min-h-[40vh] items-center justify-center border border-white/10">
                <p className="font-mono text-sm text-white/40">Загрузка документа...</p>
              </div>
            )}

            {!loading && error && (
              <div className="flex min-h-[40vh] flex-col items-center justify-center border border-white/10 text-center">
                <p className="font-mono text-sm text-red-300/80">{error}</p>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="mt-4 border border-white/30 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.15em] text-white/70 hover:border-white"
                >
                  Повторить
                </button>
              </div>
            )}

            {!loading && !error && view?.source === "file" && !text && view.downloadUrl && (
              <div className="flex min-h-[40vh] flex-col items-center justify-center border border-white/10 text-center">
                <p className="font-mono text-sm text-white/60">Текст недоступен — документ выложен файлом.</p>
                <a
                  href={view.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 border border-white px-5 py-3 font-mono text-[11px] uppercase tracking-[0.15em] text-white hover:bg-white hover:text-black"
                >
                  Скачать с sudrf.ru →
                </a>
              </div>
            )}

            {!loading && !error && text && (
              <article className="border border-white/10 bg-white/[0.02] p-6 sm:p-8">
                <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-white/85">
                  {text}
                </pre>
              </article>
            )}
          </div>
        </main>

        {!loading && text && (
          <footer className="shrink-0 border-t border-white/10 px-6 py-3">
            <p className="mx-auto max-w-5xl font-mono text-[10px] text-white/35">
              {text.length.toLocaleString("ru-RU")} символов · {countWords(text).toLocaleString("ru-RU")} слов
              {documents.length > 1 && (
                <span className="ml-3">
                  документ {docIndex + 1} из {documents.length}
                </span>
              )}
            </p>
          </footer>
        )}
      </motion.div>
    </div>
    </ModalPortal>
  );
}
