// How career dates read on the page. Parsing and arithmetic live in
// career-date.ts; this file only turns their results into strings.
import { careerDurationInMonths, parseCareerDate } from "./career-date";

// Three-letter months without full stops: the facts line is set small and
// must hold a whole period on one line.
const monthLabels = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatCareerDate(value: string) {
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

export function formatCareerPeriod(startDate: string, endDate?: string) {
  return `${formatCareerDate(startDate)} – ${endDate ? formatCareerDate(endDate) : "Present"}`;
}

function pluraliseUnit(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}

/**
 * The compact duration the facts line carries beside the period: "6 yrs",
 * "8 mos", "2 yrs 2 mos", "<1 mo". Short because the line also holds the
 * period and the place and must not wrap.
 */
export function formatCareerDuration(
  startDate: string,
  endDate?: string,
  presentDate = new Date(),
) {
  const totalMonths = careerDurationInMonths(startDate, endDate, presentDate);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const parts: string[] = [];

  if (years > 0) {
    parts.push(pluraliseUnit(years, "yr", "yrs"));
  }
  if (months > 0) {
    parts.push(pluraliseUnit(months, "mo", "mos"));
  }

  return parts.join(" ") || "<1 mo";
}

/** A small duration label for the popover header: "6Y", "8M", "2Y2M", "<1M". */
export function formatCompactCareerDuration(
  startDate: string,
  endDate?: string,
  presentDate = new Date(),
) {
  const totalMonths = careerDurationInMonths(startDate, endDate, presentDate);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;

  return `${years > 0 ? `${years}Y` : ""}${months > 0 ? `${months}M` : ""}` || "<1M";
}
