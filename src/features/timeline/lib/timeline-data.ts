import { getCollection, render } from "astro:content";
import careerImages from "../../../../data/career-images.json";
import {
  compareCareerEntries,
  createTimelineEntryViewModel,
  type CareerEntry,
  type TimelineEntryViewModel,
} from "./timeline-view-model";

type CareerImageMap = Record<
  string,
  {
    height?: number;
    src?: string;
    width?: number;
  }
>;

const careerImageMap =
  (
    careerImages as {
      images?: CareerImageMap;
    }
  ).images ?? {};

export async function loadTimelineEntries(): Promise<TimelineEntryViewModel[]> {
  const careerCollection = (await getCollection("career")).toSorted(compareCareerEntries);

  return Promise.all(
    careerCollection.map(async (entry: CareerEntry) => {
      const { Content } = await render(entry);

      return createTimelineEntryViewModel(entry, Content, careerImageMap);
    }),
  );
}

export async function loadTimelineSlugs(): Promise<string[]> {
  const careerCollection = (await getCollection("career")).toSorted(compareCareerEntries);

  return careerCollection.map((entry: CareerEntry) => entry.id);
}
