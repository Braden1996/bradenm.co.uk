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

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * The years a margin note wears beside its name, in the letter's voice: a
 * finished entry reads "2020 – 2026" (or one year), and the current one reads
 * "since April 2026", the way the letter would say it.
 */
export function formatCareerYears(startDate: string, endDate?: string) {
  const start = parseCareerDate(startDate);
  if (!endDate) {
    const month = start.precision === "year" ? "" : `${monthNames[start.month - 1]} `;
    return `since ${month}${start.year}`;
  }
  const end = parseCareerDate(endDate).year;
  return start.year === end ? String(end) : `${start.year} – ${end}`;
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
