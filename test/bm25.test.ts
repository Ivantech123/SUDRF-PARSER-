import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { Bm25Index } from "../src/rag/bm25.js";
import { tokenize } from "../src/rag/tokenizer.js";

describe("Bm25Index", () => {
  function indexOf(docs: Record<string, string>): Bm25Index {
    const ix = new Bm25Index();
    for (const [id, text] of Object.entries(docs)) ix.add(id, tokenize(text));
    return ix;
  }

  test("ranks the document that actually matches first", () => {
    const ix = indexOf({
      a: "взыскание задолженности по договору займа",
      b: "раздел совместно нажитого имущества супругов",
      c: "защита прав потребителей возврат товара",
    });

    const [top] = ix.search(tokenize("задолженность по займу"), 3);
    assert.equal(top?.[0], "a");
  });

  test("returns nothing for an empty index or empty query", () => {
    assert.deepEqual(new Bm25Index().search(tokenize("иск"), 5), []);
    assert.deepEqual(indexOf({ a: "иск о взыскании" }).search([], 5), []);
  });

  test("respects the k limit and orders by descending score", () => {
    const ix = indexOf({
      a: "взыскание задолженности договор займа",
      b: "взыскание задолженности",
      c: "взыскание",
      d: "имущество",
    });
    const hits = ix.search(tokenize("взыскание задолженности"), 2);
    assert.equal(hits.length, 2);
    assert.ok(hits[0]![1] >= hits[1]![1], "scores must be descending");
  });

  test("add() replaces a document instead of double-counting it", () => {
    const ix = new Bm25Index();
    ix.add("a", tokenize("взыскание задолженности"));
    ix.add("a", tokenize("взыскание задолженности"));
    assert.equal(ix.size, 1);
  });

  test("remove() drops the document from results", () => {
    const ix = indexOf({ a: "взыскание задолженности", b: "раздел имущества" });
    ix.remove("a");
    assert.equal(ix.size, 1);
    assert.deepEqual(ix.search(tokenize("задолженность"), 5), []);
  });

  test("remove() of an unknown id is a no-op", () => {
    const ix = indexOf({ a: "взыскание" });
    ix.remove("missing");
    assert.equal(ix.size, 1);
  });

  test("clear() empties the index", () => {
    const ix = indexOf({ a: "взыскание", b: "имущество" });
    ix.clear();
    assert.equal(ix.size, 0);
    assert.equal(ix.avgdl, 0);
    assert.deepEqual(ix.search(tokenize("взыскание"), 5), []);
  });

  test("survives a serialize/load round-trip with identical ranking", () => {
    const original = indexOf({
      a: "взыскание задолженности по договору займа",
      b: "раздел совместно нажитого имущества супругов",
    });
    const before = original.search(tokenize("задолженность займ"), 5);

    const restored = new Bm25Index();
    restored.load(JSON.parse(JSON.stringify(original.serialize())));

    assert.equal(restored.size, original.size);
    assert.equal(restored.avgdl, original.avgdl);
    assert.deepEqual(restored.search(tokenize("задолженность займ"), 5), before);
  });

  test("remove() still purges postings after a load (no stale hits)", () => {
    // Regression: load() cannot restore the full token array, so remove() used
    // to iterate an empty list and leave every posting behind. The chunk stayed
    // searchable forever and df kept inflating on each reparse.
    const original = indexOf({
      a: "взыскание задолженности по договору займа",
      b: "раздел совместно нажитого имущества супругов",
    });

    const restored = new Bm25Index();
    restored.load(original.serialize());
    restored.remove("a");

    assert.equal(restored.size, 1);
    const hits = restored.search(tokenize("задолженность займ"), 5);
    assert.deepEqual(
      hits.map(([id]) => id),
      [],
      "removed chunk must not come back from stale postings",
    );
  });

  test("re-adding a loaded document does not leave its old terms searchable", () => {
    // The enrich/reparse path calls addCase(replace=true) on an index freshly
    // loaded from disk, which is exactly this sequence.
    const original = indexOf({ a: "взыскание задолженности по договору займа" });

    const restored = new Bm25Index();
    restored.load(original.serialize());
    restored.add("a", tokenize("раздел совместно нажитого имущества супругов"));

    assert.equal(restored.size, 1);
    assert.deepEqual(
      restored.search(tokenize("задолженность займ"), 5).map(([id]) => id),
      [],
      "terms from the superseded version must be gone",
    );
    assert.deepEqual(
      restored.search(tokenize("имущество супругов"), 5).map(([id]) => id),
      ["a"],
      "terms from the new version must be searchable",
    );
  });

  test("repeated reparse of a loaded index keeps scores stable", () => {
    // df inflation from leaked postings used to drift IDF on every reparse.
    const build = () => {
      const ix = indexOf({
        a: "взыскание задолженности по договору займа",
        b: "раздел совместно нажитого имущества супругов",
      });
      const restored = new Bm25Index();
      restored.load(ix.serialize());
      return restored;
    };

    const once = build();
    const many = build();
    for (let i = 0; i < 5; i++) many.add("a", tokenize("взыскание задолженности по договору займа"));

    const [a] = once.search(tokenize("задолженность займ"), 1);
    const [b] = many.search(tokenize("задолженность займ"), 1);
    assert.equal(a?.[0], "a");
    assert.equal(b?.[0], "a");
    assert.ok(
      Math.abs(a![1] - b![1]) < 1e-9,
      `score drifted across reparses: ${a![1]} vs ${b![1]}`,
    );
  });
});

describe("tokenize", () => {
  test("lowercases, folds ё→е and drops punctuation", () => {
    assert.deepEqual(tokenize("Ёлка, ёлка!"), tokenize("елка елка"));
  });

  test("drops stopwords and very short tokens", () => {
    const out = tokenize("и в на о взыскание");
    assert.ok(!out.includes("и"));
    assert.ok(!out.includes("на"));
    assert.ok(out.length > 0);
  });

  test("stems inflections to a shared term so queries match documents", () => {
    const [doc] = tokenize("задолженности");
    const [query] = tokenize("задолженность");
    assert.equal(doc, query);
  });

  test("returns an empty array for blank input", () => {
    assert.deepEqual(tokenize(""), []);
    assert.deepEqual(tokenize("   "), []);
    assert.deepEqual(tokenize("!!! ???"), []);
  });
});
