// cspell:words Starrett Cordoza Ghuman Sönke Sonke Barzilai
import { describe, expect, test } from "bun:test";
import {
  authorMatches,
  catalogueCategories,
  catalogueExcerpt,
  chooseWork,
  makeDetails,
  mergeDetails,
  metadataKey,
  readEdition,
  readSearch,
  readWork,
} from "../scripts/lib/bookshelf-metadata";

const book = { title: "Foundation", author: "Isaac Asimov" };
const work = readWork(
  JSON.stringify({ key: "/works/OL1W", title: "Foundation", subjects: ["Science fiction"] }),
);

describe("catalogue matching", () => {
  test("rejects another author, a sequel and a study guide", () => {
    const candidates = readSearch(
      JSON.stringify({
        docs: [
          { key: "/works/OL2W", title: "Foundation", author_name: ["A Different Author"] },
          { key: "/works/OL3W", title: "Foundation and Empire", author_name: ["Isaac Asimov"] },
          {
            key: "/works/OL4W",
            title: "Study Guide for Foundation",
            author_name: ["Isaac Asimov"],
          },
        ],
      }),
    );
    expect(chooseWork(book, candidates)).toBeUndefined();
  });

  test("requires every named contributor, allowing initials and accents", () => {
    expect(
      authorMatches("Dr. Kelly Starrett & Glen Cordoza", ["Kelly Starrett", "Glen Cordoza"]),
    ).toBe(true);
    expect(authorMatches("Matt Johnson & Prince Ghuman", ["Matt Johnson"])).toBe(false);
    expect(authorMatches("Sönke Ahrens", ["Sonke Ahrens"])).toBe(true);
    expect(authorMatches("Nir Barzilai M.D.", ["Nir Barzilai"])).toBe(true);
  });

  test("prefers the recorded cover when duplicate works share a title and author", () => {
    const candidates = readSearch(
      JSON.stringify({
        docs: [
          {
            key: "/works/OL2W",
            ...book,
            author_name: [book.author],
            cover_i: 99,
            edition_count: 400,
          },
          {
            key: "/works/OL1W",
            ...book,
            author_name: [book.author],
            cover_i: 42,
            edition_count: 1,
          },
        ],
      }),
    );
    expect(
      chooseWork(book, candidates, {
        ...book,
        sourceUrl: "https://covers.openlibrary.org/b/id/42-L.jpg",
      })?.key,
    ).toBe("/works/OL1W");
  });

  test("does not use an unrelated edition or invent publisher and page count", () => {
    expect(
      readEdition(
        JSON.stringify({
          key: "/books/OL2M",
          title: "Foundation and Empire",
          number_of_pages: 400,
        }),
        book,
      ),
    ).toBeUndefined();
    expect(makeDetails(book, work).pages).toBeUndefined();
    expect(makeDetails(book, work).publisher).toBeUndefined();
    const edition = readEdition(
      JSON.stringify({
        key: "/books/OL1M",
        title: "Foundation",
        publishers: ["Example Press"],
        publish_date: "2000",
        number_of_pages: 256,
      }),
      book,
    );
    expect(makeDetails(book, work, undefined, edition)).toMatchObject({
      pages: "256",
      released: "2000",
      publisher: "Example Press",
    });
    expect(makeDetails(book, work, undefined, edition).firstPublished).toBeUndefined();
  });
});

describe("metadata presented on the note", () => {
  test("excerpts strip HTML and links and stay within 24 words", () => {
    const excerpt = catalogueExcerpt(
      "<script>alert(1)</script><p>A book about <b>people</b>, places &amp; ideas, exploring [everyday life](https://example.com) with a thoughtful perspective. " +
        "More words. ".repeat(30) +
        "</p>",
    );
    expect(excerpt).not.toMatch(/<|script|https|\[|&amp;/);
    expect(excerpt?.split(" ").length).toBe(24);
    expect(excerpt).toEndWith("…");
    expect(catalogueExcerpt("Duplicate of another catalogue entry")).toBeUndefined();
  });

  test("accepts both Open Library description representations at the boundary", () => {
    expect(
      readWork(JSON.stringify({ ...work, description: { value: "Catalogue text" } })).description,
    ).toBe("Catalogue text");
    expect(readWork(JSON.stringify({ ...work, description: "Catalogue text" })).description).toBe(
      "Catalogue text",
    );
    expect(() => readSearch('{"docs":[{"title":42}]}')).toThrow();
  });

  test("subjects are short, deduplicated annotations, not raw catalogue tags", () => {
    expect(
      catalogueCategories(["Science fiction", "Science Fiction", "Accessible book", "In library"]),
    ).toEqual(["Science fiction"]);
    expect(catalogueCategories(["Health", "Heart disease"])).toEqual(["Health"]);
    expect(catalogueCategories(["LANGUAGE ARTS & DISCIPLINES / Communication"])).toEqual([
      "Communication",
    ]);
  });

  test("curated summaries override fetched excerpts; failed refreshes retain useful fields", () => {
    const fetched = {
      ...makeDetails(book, work),
      description: "An excerpt",
      excerptSource: "https://openlibrary.org/works/OL1W",
      pages: "256",
    };
    const entries = [
      { ...book, status: "error" as const, checkedAt: "2026-09-08", details: fetched },
    ];
    const [merged] = mergeDetails([book], entries, [
      { ...book, description: "A curated summary", sources: ["https://example.com/book"] },
    ]);
    expect(merged?.description).toBe("A curated summary");
    expect(merged?.excerptSource).toBeUndefined();
    expect(merged?.pages).toBe("256");
    expect(merged?.sources).toEqual([
      "https://example.com/book",
      "https://openlibrary.org/works/OL1W",
    ]);
    expect(mergeDetails([], entries, [])).toEqual([]);
    expect(metadataKey(book)).toBe(metadataKey({ title: "FOUNDATION", author: "Isaac  Asimov" }));
  });
});
