import { describe, expect, test } from "bun:test";
import { careerDurationInMonths } from "../src/features/about/lib/career-date";
import {
  formatCareerDate,
  formatCareerDuration,
  formatCareerPeriod,
  formatCompactCareerDuration,
} from "../src/features/about/lib/career-format";

describe("careerDurationInMonths", () => {
  test("counts both boundary months for month-precision career dates", () => {
    expect(careerDurationInMonths("2020-04", "2026-03")).toBe(72);
    expect(careerDurationInMonths("2019-09", "2020-04")).toBe(8);
  });

  test("uses the year difference for year-precision career dates", () => {
    expect(careerDurationInMonths("2014", "2017")).toBe(36);
  });

  test("does not round a partial exact-date month up", () => {
    expect(careerDurationInMonths("2026-01-31", "2026-02-01")).toBe(0);
  });

  test("measures an open-ended role up to the given present", () => {
    expect(careerDurationInMonths("2026", undefined, new Date(Date.UTC(2026, 7, 22)))).toBe(7);
  });
});

describe("formatCareerDuration", () => {
  test("is compact enough for the facts line", () => {
    expect(formatCareerDuration("2020-04", "2026-03")).toBe("6 yrs");
    expect(formatCareerDuration("2019-09", "2020-04")).toBe("8 mos");
    expect(formatCareerDuration("2014", "2017")).toBe("3 yrs");
    expect(formatCareerDuration("2017-08", "2019-09")).toBe("2 yrs 2 mos");
  });

  test("uses singular units", () => {
    expect(formatCareerDuration("2020-01", "2021-01")).toBe("1 yr 1 mo");
  });

  test("names anything under a month", () => {
    expect(formatCareerDuration("2026-01-31", "2026-02-01")).toBe("<1 mo");
  });
});

describe("formatCompactCareerDuration", () => {
  test("uses compact year and month units without changing inclusive date arithmetic", () => {
    expect(formatCompactCareerDuration("2020-04", "2026-03")).toBe("6Y");
    expect(formatCompactCareerDuration("2019-09", "2020-04")).toBe("8M");
    expect(formatCompactCareerDuration("2014", "2017")).toBe("3Y");
    expect(formatCompactCareerDuration("2017-08", "2019-09")).toBe("2Y2M");
    expect(formatCompactCareerDuration("2020-01", "2021-01")).toBe("1Y1M");
  });

  test("keeps exact dates under a month explicit", () => {
    expect(formatCompactCareerDuration("2026-01-31", "2026-02-01")).toBe("<1M");
  });

  test("measures an open role against the supplied present date", () => {
    expect(formatCompactCareerDuration("2026", undefined, new Date(Date.UTC(2026, 7, 22)))).toBe(
      "7M",
    );
  });
});

describe("formatCareerDate and formatCareerPeriod", () => {
  test("drop the full stop from month abbreviations", () => {
    expect(formatCareerDate("2017-08")).toBe("Aug 2017");
    expect(formatCareerDate("2026-01-31")).toBe("31 Jan 2026");
    expect(formatCareerDate("2014")).toBe("2014");
  });

  test("write an open period as present", () => {
    expect(formatCareerPeriod("2017-08", "2019-09")).toBe("Aug 2017 – Sep 2019");
    expect(formatCareerPeriod("2026")).toBe("2026 – Present");
  });
});
