// In-memory BM25 index over chunked documents. BM25 (Lucene/Okapi variant):
//
//   score(q, d) = Σ_t∈q  IDF(t) · (f(t,d)·(k1+1)) / (f(t,d) + k1·(1 − b + b·|d|/avgdl))
//   IDF(t)     = ln(1 + (N − df(t) + 0.5) / (df(t) + 0.5))      // Lucene form, always ≥ 0
//
// The Lucene IDF (with the +1 inside ln) avoids the negative-IDF edge case of
// the classic Okapi formula when a term appears in >half the docs. k1=1.5 and
// b=0.75 are sensible defaults for prose; expose them for tuning.

export interface Bm25Doc {
  id: string;            // unique chunk id
  tokens: string[];      // pre-tokenized body
  len: number;           // token count (cached)
}

export class Bm25Index {
  private docs = new Map<string, Bm25Doc>();
  private postings = new Map<string, Map<string, number>>(); // term → (docId → tf)
  private df = new Map<string, number>();                    // term → doc frequency
  private totalLen = 0;

  constructor(
    private k1 = 1.5,
    private b = 0.75
  ) {}

  get size(): number {
    return this.docs.size;
  }

  get avgdl(): number {
    return this.docs.size ? this.totalLen / this.docs.size : 0;
  }

  // Add (or replace) a document. Tokenization is the caller's job so we can
  // share one tokenizer across chunker/index/query.
  add(docId: string, tokens: string[]): void {
    this.remove(docId); // replace if present
    const len = tokens.length;
    this.docs.set(docId, { id: docId, tokens, len });
    this.totalLen += len;
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [term, freq] of tf) {
      if (!this.postings.has(term)) this.postings.set(term, new Map());
      this.postings.get(term)!.set(docId, freq);
      this.df.set(term, (this.df.get(term) ?? 0) + 1);
    }
  }

  remove(docId: string): void {
    const doc = this.docs.get(docId);
    if (!doc) return;
    this.docs.delete(docId);
    this.totalLen -= doc.len;
    const seen = new Set<string>();
    for (const t of doc.tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      const post = this.postings.get(t);
      if (post) {
        post.delete(docId);
        if (post.size === 0) this.postings.delete(t);
        const d = (this.df.get(t) ?? 0) - 1;
        if (d <= 0) this.df.delete(t);
        else this.df.set(t, d);
      }
    }
  }

  clear(): void {
    this.docs.clear();
    this.postings.clear();
    this.df.clear();
    this.totalLen = 0;
  }

  // Score every doc containing ≥1 query term; return top-k as [docId, score].
  search(queryTokens: string[], k = 10): Array<[string, number]> {
    const N = this.docs.size;
    if (N === 0 || queryTokens.length === 0) return [];
    const avgdl = this.avgdl || 1;
    const { k1, b } = this;

    // dedup query terms, keep term frequency in query for repeated-term boost
    const qTf = new Map<string, number>();
    for (const t of queryTokens) qTf.set(t, (qTf.get(t) ?? 0) + 1);

    const scores = new Map<string, number>();
    for (const [term, qCount] of qTf) {
      const post = this.postings.get(term);
      if (!post) continue;
      const df = this.df.get(term) ?? 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      if (idf <= 0) continue; // term in (almost) every doc — no signal
      for (const [docId, tf] of post) {
        const doc = this.docs.get(docId)!;
        const denom = tf + k1 * (1 - b + (b * doc.len) / avgdl);
        const s = (idf * (tf * (k1 + 1))) / denom;
        scores.set(docId, (scores.get(docId) ?? 0) + s * qCount);
      }
    }
    return [...scores.entries()].sort((a, c) => c[1] - a[1]).slice(0, k);
  }

  // ── Persistence ───────────────────────────────────────────────────────
  // Compact shape: term → [docId, tf] pairs + doc lens.
  // Return an object (not a nested JSON string) so the outer RagIndex save
  // does not double-escape postings at 50k–200k scale.
  serialize(): {
    k1: number;
    b: number;
    totalLen: number;
    docLens: Array<[string, number]>;
    postings: Record<string, Array<[string, number]>>;
  } {
    const postingsObj: Record<string, Array<[string, number]>> = {};
    for (const [term, post] of this.postings) {
      postingsObj[term] = [...post.entries()];
    }
    const docLens: Array<[string, number]> = [...this.docs.entries()].map(([id, d]) => [id, d.len]);
    return {
      k1: this.k1,
      b: this.b,
      totalLen: this.totalLen,
      docLens,
      postings: postingsObj,
    };
  }

  load(json: string | ReturnType<Bm25Index["serialize"]>): void {
    const data = (typeof json === "string" ? JSON.parse(json) : json) as {
      k1: number; b: number; totalLen: number;
      docLens: Array<[string, number]>;
      postings: Record<string, Array<[string, number]>>;
    };
    this.k1 = data.k1;
    this.b = data.b;
    this.totalLen = data.totalLen;
    this.docs.clear();
    this.postings.clear();
    this.df.clear();
    for (const [id, len] of data.docLens) {
      // we don't persist the full token array (it's reconstructible from
      // postings if ever needed); store len only for scoring.
      this.docs.set(id, { id, tokens: [], len });
    }
    for (const [term, pairs] of Object.entries(data.postings)) {
      const post = new Map<string, number>();
      for (const [docId, tf] of pairs) post.set(docId, tf);
      this.postings.set(term, post);
      this.df.set(term, post.size);
    }
  }
}
