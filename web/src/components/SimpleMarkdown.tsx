import type { ReactNode } from "react";

/** Minimal markdown → React (headings, lists, paragraphs, bold/code). */
export default function SimpleMarkdown({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div className="space-y-3 font-mono text-[12px] leading-relaxed text-white/75">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        const first = lines[0] ?? "";
        if (/^##\s+/.test(first)) {
          return (
            <div key={i}>
              <h3 className="font-display text-lg uppercase tracking-wide text-amber-200/90">
                {first.replace(/^##\s+/, "")}
              </h3>
              {lines.slice(1).length > 0 ? (
                <p className="mt-2 whitespace-pre-wrap">{inlineFormat(lines.slice(1).join("\n"))}</p>
              ) : null}
            </div>
          );
        }
        if (lines.every((l) => /^[-*•]\s+/.test(l.trim()) || !l.trim())) {
          return (
            <ul key={i} className="list-disc space-y-1.5 pl-5">
              {lines
                .filter((l) => l.trim())
                .map((l, j) => (
                  <li key={j}>{inlineFormat(l.replace(/^[-*•]\s+/, ""))}</li>
                ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {inlineFormat(block)}
          </p>
        );
      })}
    </div>
  );
}

function inlineFormat(s: string): ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-white/90">
          {p.slice(2, -2)}
        </strong>
      );
    }
    if (p.startsWith("`") && p.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-white/10 px-1 text-amber-100/90">
          {p.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{p}</span>;
  });
}
