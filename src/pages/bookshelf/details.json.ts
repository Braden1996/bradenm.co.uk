import type { APIRoute } from "astro";
import details from "../../../data/bookshelf-metadata.json";
import { parseBookDetails } from "../../features/bookshelf/lib/book-details";

// Committed records keep ordinary builds and the reader's browser off external APIs.
export const GET: APIRoute = () => Response.json(parseBookDetails(JSON.stringify(details)));
