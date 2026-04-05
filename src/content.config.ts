import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const careerDateSchema = z
  .string()
  .regex(/^\d{4}(?:-\d{2}){0,2}$/, "Use YYYY, YYYY-MM, or YYYY-MM-DD.");

export const collections: Record<string, ReturnType<typeof defineCollection>> = {
  career: defineCollection({
    loader: glob({
      base: "./src/content/career",
      pattern: "**/*.md",
    }),
    schema: z.object({
      title: z.string(),
      organisation: z.string(),
      location: z.string(),
      startDate: careerDateSchema,
      endDate: careerDateSchema.optional(),
      logoSrc: z.string().optional(),
      mark: z.string().min(1).max(4),
    }),
  }),
};
