/** Sanitize a string for use in a downloaded filename. */
export function safeFilenamePart(s: string): string {
  return s
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "document";
}

export function buildDocumentFilename(
  caseNumber: string,
  docName: string,
  date?: string,
): string {
  const parts = [caseNumber, docName, date].filter((s): s is string => Boolean(s)).map(safeFilenamePart);
  return `${parts.join("_")}.txt`;
}

export function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function printDocument(title: string, text: string): void {
  const w = window.open("", "_blank", "noopener,noreferrer,width=800,height=900");
  if (!w) return;
  w.document.write(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${title.replace(/</g, "&lt;")}</title>
  <style>
    body { font-family: "Times New Roman", serif; font-size: 14px; line-height: 1.6; margin: 2cm; color: #111; }
    h1 { font-size: 16px; margin-bottom: 1em; }
    pre { white-space: pre-wrap; word-wrap: break-word; font-family: inherit; margin: 0; }
  </style>
</head>
<body>
  <h1>${title.replace(/</g, "&lt;")}</h1>
  <pre>${text.replace(/</g, "&lt;").replace(/&/g, "&amp;")}</pre>
</body>
</html>`);
  w.document.close();
  w.focus();
  w.print();
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
