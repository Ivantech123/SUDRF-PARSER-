// Split a judicial act's full text into overlapping chunks for BM25 retrieval.
// Chunks respect paragraph boundaries first, then sentence boundaries, so each
// chunk is a coherent unit (not a mid-sentence cut). A sliding overlap keeps
// context across boundaries so a query spanning a split still matches.

export interface Chunk {
  id: string;            // `${caseUid}#${docIndex}#${chunkIndex}`
  caseUid: string;       // parent case UID (for joining back to CaseDetails)
  caseNumber?: string;   // denormalized for display without a lookup
  court?: string;        // denormalized
  docId: string;         // source document id (cont_docN)
  docName: string;       // act type (РЕШЕНИЕ / ОПРЕДЕЛЕНИЕ / ...)
  docDate?: string;
  index: number;         // chunk ordinal within the document
  text: string;          // chunk body
  offset: number;        // character offset of chunk start in the document text
}

export interface ChunkerOptions {
  targetChars?: number;   // aim for ~this many chars per chunk (default 1200)
  overlapChars?: number;  // overlap between consecutive chunks (default 250)
  minChars?: number;      // drop trailing chunks shorter than this (default 120)
}

const DEFAULTS: Required<ChunkerOptions> = {
  targetChars: 1200,
  overlapChars: 250,
  minChars: 120,
};

// Chunk a single document. `caseUid`/display fields are threaded in so each
// chunk is self-describing for the MCP search result.
export function chunkDocument(
  text: string,
  meta: {
    caseUid: string;
    caseNumber?: string;
    court?: string;
    docId: string;
    docName: string;
    docDate?: string;
  },
  opts: ChunkerOptions = {}
): Chunk[] {
  const { targetChars, overlapChars, minChars } = { ...DEFAULTS, ...opts };
  const paragraphs = splitParagraphs(text);

  // Greedy pack: accumulate paragraphs until we reach targetChars, then emit.
  // To create overlap, the last ~overlapChars of the current chunk seeds the next.
  const chunks: Chunk[] = [];
  let buf = "";
  let bufOffset = 0;
  let chunkIndex = 0;

  const flush = (seed: string) => {
    const body = (seed + buf).trim();
    if (body.length >= minChars) {
      chunks.push({
        id: `${meta.caseUid}#${meta.docId}#${chunkIndex}`,
        caseUid: meta.caseUid,
        caseNumber: meta.caseNumber,
        court: meta.court,
        docId: meta.docId,
        docName: meta.docName,
        docDate: meta.docDate,
        index: chunkIndex,
        text: body,
        offset: bufOffset,
      });
      chunkIndex++;
    }
    buf = "";
  };

  for (const para of paragraphs) {
    if (!para.trim()) continue;
    if (buf.length + para.length + 1 > targetChars && buf.length > 0) {
      // emit current buffer, seed next chunk with the tail for overlap
      const seed = buf.slice(Math.max(0, buf.length - overlapChars));
      flush(seed);
      bufOffset += buf.length + 1;
      buf = seed ? seed + " " : "";
    }
    buf = buf ? buf + " " + para : para;
  }
  // flush trailing buffer with no seed
  if (buf.trim()) {
    flush("");
  }

  // If a single paragraph exceeds targetChars by a lot, split it by sentence.
  return chunks.flatMap((c) =>
    c.text.length > targetChars * 1.8 ? rechunkLong(c, targetChars, overlapChars, minChars) : [c]
  );
}

function splitParagraphs(text: string): string[] {
  // sudrf act text uses \n between paragraphs; also split on hard breaks.
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{1,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// A chunk that came out too long (one giant paragraph) — split by sentence.
function rechunkLong(
  chunk: Chunk,
  targetChars: number,
  overlapChars: number,
  minChars: number
): Chunk[] {
  const sentences = chunk.text.split(/(?<=[.!?])\s+(?=[А-ЯA-Z])/);
  const out: Chunk[] = [];
  let buf = "";
  let idx = chunk.index;
  let offset = chunk.offset;
  for (const s of sentences) {
    if (buf.length + s.length + 1 > targetChars && buf.length > 0) {
      const body = buf.trim();
      if (body.length >= minChars) {
        out.push({ ...chunk, id: `${chunk.caseUid}#${chunk.docId}#${idx}`, index: idx, text: body, offset });
        idx++;
        offset += body.length + 1;
      }
      const seed = buf.slice(Math.max(0, buf.length - overlapChars));
      buf = seed ? seed + " " : "";
    }
    buf = buf ? buf + " " + s : s;
  }
  if (buf.trim().length >= minChars) {
    out.push({ ...chunk, id: `${chunk.caseUid}#${chunk.docId}#${idx}`, index: idx, text: buf.trim(), offset });
  }
  return out;
}
