import type { CollectionEntry } from "astro:content";
import type { AstroComponentFactory } from "astro/runtime/server/index.js";
import type { LogoBezel } from "../../../components/lib/logo-bezel";
import { parseCareerDate } from "./career-date";
import {
  formatCareerDuration,
  formatCareerPeriod,
  formatCompactCareerDuration,
} from "./career-format";

export type CareerEntry = CollectionEntry<"career">;

/** The shape of data/career-images.json, keyed by the content's image paths. */
export type CareerImageMap = Record<
  string,
  {
    bezel?: LogoBezel;
    height?: number;
    palette?: string[];
    src?: string;
    viewerHeight?: number;
    viewerSrc?: string;
    viewerWidth?: number;
    width?: number;
  }
>;

export type CareerEntryViewModel = {
  Content: AstroComponentFactory;
  compactDuration: string;
  duration: string;
  explainerAlt?: string;
  explainerHeight: number;
  explainerSrc?: string;
  explainerWidth: number;
  logoBezel?: LogoBezel;
  logoHeight: number;
  logoSrc?: string;
  logoWidth: number;
  mark: string;
  organisation: string;
  period: string;
  years: string;
  summary?: string;
  website?: string;
  slug: string;
};

function getDaysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toSortKey(year: number, month: number, day: number) {
  return year * 10_000 + month * 100 + day;
}

function getStartSortKey(value: string) {
  const parsed = parseCareerDate(value);

  return toSortKey(parsed.year, parsed.month, parsed.day);
}

function getEndSortKey(value?: string) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const parsed = parseCareerDate(value);

  if (parsed.precision === "year") {
    return toSortKey(parsed.year, 12, 31);
  }

  if (parsed.precision === "month") {
    return toSortKey(parsed.year, parsed.month, getDaysInMonth(parsed.year, parsed.month));
  }

  return toSortKey(parsed.year, parsed.month, parsed.day);
}

function compareSortKeysDescending(left: number, right: number) {
  if (left === right) {
    return 0;
  }

  return left > right ? -1 : 1;
}

/** Most recent first: by start, then by end, then by id for a stable order. */
export function compareCareerEntries(left: CareerEntry, right: CareerEntry) {
  const startDifference = compareSortKeysDescending(
    getStartSortKey(left.data.startDate),
    getStartSortKey(right.data.startDate),
  );

  if (startDifference !== 0) {
    return startDifference;
  }

  const endDifference = compareSortKeysDescending(
    getEndSortKey(left.data.endDate),
    getEndSortKey(right.data.endDate),
  );

  if (endDifference !== 0) {
    return endDifference;
  }

  return left.id.localeCompare(right.id);
}

export function createCareerEntryViewModel(
  entry: CareerEntry,
  Content: AstroComponentFactory,
  careerImageMap: CareerImageMap,
): CareerEntryViewModel {
  const image = entry.data.logoSrc ? careerImageMap[entry.data.logoSrc] : undefined;
  const explainerImage = entry.data.explainerSrc
    ? careerImageMap[entry.data.explainerSrc]
    : undefined;

  const viewModel: CareerEntryViewModel = {
    Content,
    compactDuration: formatCompactCareerDuration(entry.data.startDate, entry.data.endDate),
    duration: formatCareerDuration(entry.data.startDate, entry.data.endDate),
    explainerHeight: explainerImage?.height ?? 0,
    explainerWidth: explainerImage?.width ?? 0,
    logoHeight: image?.height ?? 0,
    logoWidth: image?.width ?? 0,
    mark: entry.data.mark,
    organisation: entry.data.organisation,
    period: formatCareerPeriod(entry.data.startDate, entry.data.endDate),
    years: `${parseCareerDate(entry.data.startDate).year} – ${entry.data.endDate ? parseCareerDate(entry.data.endDate).year : "Present"}`,
    slug: entry.id,
  };
  if (entry.data.summary) {
    viewModel.summary = entry.data.summary;
  }
  if (entry.data.website) {
    viewModel.website = entry.data.website;
  }
  if (entry.data.explainerAlt) {
    viewModel.explainerAlt = entry.data.explainerAlt;
  }
  if (explainerImage?.src) {
    viewModel.explainerSrc = explainerImage.src;
  }
  if (image?.bezel) {
    viewModel.logoBezel = image.bezel;
  }
  if (image?.src) {
    viewModel.logoSrc = image.src;
  }
  return viewModel;
}
