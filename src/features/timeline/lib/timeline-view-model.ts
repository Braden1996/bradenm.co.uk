import type { CollectionEntry } from "astro:content";
import type { AstroComponentFactory } from "astro/runtime/server/index.js";

export type CareerEntry = CollectionEntry<"career">;

type ParsedCareerDate = {
  day: number;
  month: number;
  precision: "day" | "month" | "year";
  year: number;
};

type CareerImageMap = Record<
  string,
  {
    height?: number;
    src?: string;
    width?: number;
  }
>;

export type TimelineEntryViewModel = {
  Content: AstroComponentFactory;
  location: string;
  logoHeight: number;
  logoSrc?: string;
  logoWidth: number;
  mark: string;
  organisation: string;
  period: string;
  slug: string;
  title: string;
};

const monthLabels = [
  "Jan.",
  "Feb.",
  "Mar.",
  "Apr.",
  "May",
  "Jun.",
  "Jul.",
  "Aug.",
  "Sep.",
  "Oct.",
  "Nov.",
  "Dec.",
];

function getDaysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseCareerDate(value: string): ParsedCareerDate {
  const [yearPart, monthPart, dayPart] = value.split("-");

  if (!yearPart) {
    throw new Error(`Invalid career date: ${value}`);
  }

  const year = Number.parseInt(yearPart, 10);

  if (dayPart) {
    if (!monthPart) {
      throw new Error(`Invalid career date: ${value}`);
    }

    return {
      day: Number.parseInt(dayPart, 10),
      month: Number.parseInt(monthPart, 10),
      precision: "day",
      year,
    };
  }

  if (monthPart) {
    return {
      day: 1,
      month: Number.parseInt(monthPart, 10),
      precision: "month",
      year,
    };
  }

  return {
    day: 1,
    month: 1,
    precision: "year",
    year,
  };
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

function formatCareerDate(value: string) {
  const parsed = parseCareerDate(value);

  if (parsed.precision === "year") {
    return String(parsed.year);
  }

  const monthLabel = monthLabels[parsed.month - 1];

  if (parsed.precision === "month") {
    return `${monthLabel} ${parsed.year}`;
  }

  return `${parsed.day} ${monthLabel} ${parsed.year}`;
}

function formatCareerPeriod(startDate: string, endDate?: string) {
  return `${formatCareerDate(startDate)} - ${endDate ? formatCareerDate(endDate) : "Present"}`;
}

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

export function createTimelineEntryViewModel(
  entry: CareerEntry,
  Content: AstroComponentFactory,
  careerImageMap: CareerImageMap,
): TimelineEntryViewModel {
  const image = entry.data.logoSrc ? careerImageMap[entry.data.logoSrc] : undefined;

  return {
    Content,
    location: entry.data.location,
    logoHeight: image?.height ?? 0,
    ...(image?.src ? { logoSrc: image.src } : {}),
    logoWidth: image?.width ?? 0,
    mark: entry.data.mark,
    organisation: entry.data.organisation,
    period: formatCareerPeriod(entry.data.startDate, entry.data.endDate),
    slug: entry.id,
    title: entry.data.title,
  };
}
