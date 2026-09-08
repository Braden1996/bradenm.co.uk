import { array, boolean, number, object, optional, safeParse, string } from "valibot";
import type { BookshelfPayload } from "./bookshelf-data";

const coverCandidate = object({ src: string(), width: number(), height: number() });
const payloadSchema = object({
  books: array(
    object({
      id: string(),
      text: string(),
      details: optional(
        object({
          firstPublished: optional(string()),
          pages: optional(string()),
          categories: optional(array(string())),
        }),
      ),
    }),
  ),
  atlas: array(
    object({
      id: string(),
      atlasIndex: number(),
      title: string(),
      author: string(),
      formats: array(string()),
      cover: object({
        src: string(),
        width: number(),
        height: number(),
        candidates: array(coverCandidate),
      }),
      profile: object({
        width: number(),
        height: number(),
        depth: number(),
        rotation: number(),
        offsetX: number(),
        offsetZ: number(),
        hardback: boolean(),
        coated: boolean(),
        seed: number(),
      }),
    }),
  ),
});

export function parseAtlasPayload(text: string): BookshelfPayload | null {
  try {
    const parsed = safeParse(payloadSchema, JSON.parse(text));
    return parsed.success ? parsed.output : null;
  } catch {
    return null;
  }
}
