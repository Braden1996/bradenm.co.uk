import { array, object, optional, safeParse, string, type InferOutput } from "valibot";

export const bookDetailsRecordSchema = object({
  title: string(),
  author: string(),
  description: optional(string()),
  excerptSource: optional(string()),
  firstPublished: optional(string()),
  publisher: optional(string()),
  released: optional(string()),
  pages: optional(string()),
  categories: optional(array(string())),
  sources: array(string()),
});
const bookDetailsSchema = array(bookDetailsRecordSchema);

export type BookDetails = InferOutput<typeof bookDetailsSchema>[number];

export function parseBookDetails(text: string): BookDetails[] {
  try {
    const parsed = safeParse(bookDetailsSchema, JSON.parse(text));
    return parsed.success ? parsed.output : [];
  } catch {
    return [];
  }
}
