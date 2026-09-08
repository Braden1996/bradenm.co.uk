// Career dates as written in the content — "2026", "2020-04", "2026-01-31" —
// parsed and measured. Formatting them for the page is career-format.ts.
export type ParsedCareerDate = {
  day: number;
  month: number;
  precision: "day" | "month" | "year";
  year: number;
};

export function parseCareerDate(value: string): ParsedCareerDate {
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

function monthsBetween(start: ParsedCareerDate, end: ParsedCareerDate): number {
  if (start.precision === "year" && end.precision === "year") {
    return Math.max(0, (end.year - start.year) * 12);
  }

  const startMonth = start.year * 12 + start.month - 1;
  const endMonth = end.year * 12 + end.month - 1;
  let months = endMonth - startMonth;

  // A month-only range names whole calendar months, so both boundary months
  // count. Exact dates instead count completed month anniversaries.
  if (end.precision === "month") {
    months += 1;
    return Math.max(1, months);
  }
  if (end.day < start.day) {
    months -= 1;
  }

  return Math.max(0, months);
}

/** Whole months from `startDate` to `endDate`, or to `presentDate` when open-ended. */
export function careerDurationInMonths(
  startDate: string,
  endDate?: string,
  presentDate = new Date(),
) {
  const start = parseCareerDate(startDate);
  const end = endDate
    ? parseCareerDate(endDate)
    : {
        day: presentDate.getUTCDate(),
        month: presentDate.getUTCMonth() + 1,
        precision: "day" as const,
        year: presentDate.getUTCFullYear(),
      };

  return monthsBetween(start, end);
}
