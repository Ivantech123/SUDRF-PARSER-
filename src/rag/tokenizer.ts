// Russian-aware text tokenizer for the BM25 RAG index.
// Pipeline: normalize → lowercase → split → drop stopwords → light stem.
// The stemmer is intentionally minimal (suffix stripping) — good enough for
// BM25 term matching across case inflections without a full morphology lib.

// Russian stopwords + a few legal-corpus frequent words that carry no signal.
const STOPWORDS = new Set<string>([
  "и","в","во","не","что","он","на","я","с","со","как","а","то","все","она","так",
  "его","но","да","ты","к","у","же","вы","за","бы","по","только","ее","мне","было",
  "вот","от","меня","о","из","ему","теперь","когда","даже","ну","вдруг","ли","если",
  "уже","или","ни","быть","был","него","до","вас","нибудь","опять","уж","вам","ведь",
  "там","потом","себя","ничего","ей","может","они","тут","где","есть","над","для",
  "тебя","их","чем","была","сам","чтоб","без","будто","чего","раз","тоже","себе",
  "под","будет","ж","тогда","кто","этот","того","потому","этого","какой","совсем",
  "ним","здесь","этом","один","почти","мой","тем","чтобы","нее","сейчас","были",
  "куда","зачем","всех","никогда","можно","при","наконец","два","об","другой","хоть",
  "после","над","больше","тот","через","эти","нас","про","всего","них","какая","много",
  "разве","три","эту","моя","впрочем","хорошо","свою","этой","перед","иногда","лучше",
  "чуть","том","нельзя","такой","им","более","конечно","всю","среди","её","ею",
  // legal filler
  "года","год","г","ст","п","пп","ппц","рк","суд","суда","суду","дела","дело","дел",
  "которые","который","которая","которое","данного","данной","данного","указанные",
]);

// Common Russian suffixes stripped for a crude stem. Ordered longest-first so
// the most specific suffix is removed before the generic ones.
const SUFFIXES = [
  "иями","овами","ями","ами","ого","ему","его","ому","ему","их","ых","ию","ия","ия",
  "ем","ам","ом","ах","ях","ую","юю","ий","ый","ой","ая","яя","ое","ее","и","ы","е",
  "й","а","я","о","у","ю","ь","ъ",
];

export function tokenize(text: string): string[] {
  const norm = text
    .toLowerCase()
    .replace(/ё/g, "е")
    // keep letters (incl. Cyrillic), digits, and hyphens inside words; split on the rest
    .replace(/[^a-zа-я0-9\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!norm) return [];
  const out: string[] = [];
  for (const raw of norm.split(" ")) {
    if (raw.length < 2) continue;
    if (STOPWORDS.has(raw)) continue;
    const tok = stem(raw);
    if (!tok || STOPWORDS.has(tok)) continue;
    out.push(tok);
  }
  return out;
}

function stem(word: string): string {
  // don't stem very short words or digits-only tokens
  if (word.length <= 4) return word;
  for (const suf of SUFFIXES) {
    if (word.length - suf.length >= 4 && word.endsWith(suf)) {
      return word.slice(0, word.length - suf.length);
    }
  }
  return word;
}

// Tokenize a query the same way documents are tokenized — BM25 needs the same
// analysis chain on both sides. Re-exports tokenize; kept for naming clarity.
export function tokenizeQuery(query: string): string[] {
  return tokenize(query);
}
