import type { MarkdownInstance } from "astro";
import type { ImageMetadata } from "astro";
import { parse as parseYaml } from "yaml";

type MarkdownContent = {
  Content?: MarkdownInstance<Record<string, unknown>>["Content"];
  frontmatter?: Record<string, unknown>;
};

export type Photo = {
  src: ImageMetadata;
  filename: string;
  alt: string;
};

export type Day = {
  tripSlug: string;
  date: string;
  title: string;
  ordinalLabel: string;
  location?: string;
  locations: string[];
  highlights: string[];
  summary?: MarkdownContent;
  photos: Photo[];
};

export type Trip = {
  slug: string;
  title: string;
  description?: string;
  intro?: MarkdownContent;
  summary?: MarkdownContent;
  days: Day[];
  cover?: Photo;
};

type TripMeta = {
  coverPhoto?: string;
};

const tripIntros = import.meta.glob<MarkdownContent>("/src/content/trips/*/trip.md", {
  eager: true,
});

const tripSummaries = import.meta.glob<MarkdownContent>("/src/content/trips/*/summary.md", {
  eager: true,
});

const daySummaries = import.meta.glob<MarkdownContent>(
  "/src/content/trips/*/days/*/summary.md",
  { eager: true },
);

const dayMetas = import.meta.glob<string>("/src/content/trips/*/days/*/meta.yaml", {
  eager: true,
  import: "default",
  query: "?raw",
});

const tripMetas = import.meta.glob<string>("/src/content/trips/*/meta.yaml", {
  eager: true,
  import: "default",
  query: "?raw",
});

const photoModules = import.meta.glob<ImageMetadata>(
  "/src/content/trips/*/days/*/photos/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG,WEBP}",
  {
    eager: true,
    import: "default",
  },
);

const dayPathPattern = /^\/src\/content\/trips\/([^/]+)\/days\/([^/]+)\/summary\.md$/;
const dayMetaPathPattern = /^\/src\/content\/trips\/([^/]+)\/days\/([^/]+)\/meta\.yaml$/;
const photoPathPattern =
  /^\/src\/content\/trips\/([^/]+)\/days\/([^/]+)\/photos\/([^/]+)$/;
const tripPathPattern = /^\/src\/content\/trips\/([^/]+)\/trip\.md$/;
const tripSummaryPathPattern = /^\/src\/content\/trips\/([^/]+)\/summary\.md$/;
const tripMetaPathPattern = /^\/src\/content\/trips\/([^/]+)\/meta\.yaml$/;
const validDayPattern = /^\d{4}-\d{2}-\d{2}$/;

export function titleFromSlug(slug: string) {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatDisplayDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(parsed);
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asStringList(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => asString(item))
        .filter((item): item is string => item !== undefined)
    : [];
}

function getFrontmatter(module: MarkdownContent | undefined) {
  return module?.frontmatter ?? {};
}

function createEmptyDay(tripSlug: string, date: string): Day {
  return {
    tripSlug,
    date,
    title: formatDisplayDate(date),
    ordinalLabel: "",
    locations: [],
    highlights: [],
    photos: [],
  };
}

function parseDayMeta(raw: string) {
  try {
    const parsed = parseYaml(raw) as Record<string, unknown> | null;
    return {
      locations: asStringList(parsed?.locations),
      highlights: asStringList(parsed?.highlights),
    };
  } catch {
    return {
      locations: [],
      highlights: [],
    };
  }
}

function parseTripMeta(raw: string): TripMeta {
  try {
    const parsed = parseYaml(raw) as Record<string, unknown> | null;
    return {
      coverPhoto: asString(parsed?.coverPhoto),
    };
  } catch {
    return {};
  }
}

function formatDayOrdinal(index: number) {
  const words = [
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
    "Twenty",
    "Twenty One",
    "Twenty Two",
    "Twenty Three",
    "Twenty Four",
    "Twenty Five",
    "Twenty Six",
    "Twenty Seven",
    "Twenty Eight",
    "Twenty Nine",
    "Thirty",
    "Thirty One",
  ];

  return `Day ${words[index] ?? String(index + 1)}`;
}

export function getTrips(): Trip[] {
  const daysByTrip = new Map<string, Map<string, Day>>();
  const tripMetaBySlug = new Map<string, TripMeta>();

  for (const [path, rawMeta] of Object.entries(tripMetas)) {
    const match = path.match(tripMetaPathPattern);
    if (!match) {
      continue;
    }

    const [, tripSlug] = match;
    tripMetaBySlug.set(tripSlug, parseTripMeta(rawMeta));
  }

  for (const [path, rawMeta] of Object.entries(dayMetas)) {
    const match = path.match(dayMetaPathPattern);
    if (!match) {
      continue;
    }

    const [, tripSlug, date] = match;
    if (!validDayPattern.test(date)) {
      continue;
    }

    const tripDays = daysByTrip.get(tripSlug) ?? new Map<string, Day>();
    const day = tripDays.get(date) ?? createEmptyDay(tripSlug, date);
    const meta = parseDayMeta(rawMeta);
    day.locations = meta.locations;
    day.highlights = meta.highlights;
    tripDays.set(date, day);
    daysByTrip.set(tripSlug, tripDays);
  }

  for (const [path, summary] of Object.entries(daySummaries)) {
    const match = path.match(dayPathPattern);
    if (!match) {
      continue;
    }

    const [, tripSlug, date] = match;
    if (!validDayPattern.test(date)) {
      continue;
    }

    const frontmatter = getFrontmatter(summary);
    const tripDays = daysByTrip.get(tripSlug) ?? new Map<string, Day>();
    const day = tripDays.get(date) ?? createEmptyDay(tripSlug, date);
    day.summary = summary;
    day.title = asString(frontmatter.title) ?? day.title;
    day.location = asString(frontmatter.location);
    tripDays.set(date, day);
    daysByTrip.set(tripSlug, tripDays);
  }

  for (const [path, src] of Object.entries(photoModules)) {
    const match = path.match(photoPathPattern);
    if (!match) {
      continue;
    }

    const [, tripSlug, date, filename] = match;
    if (!validDayPattern.test(date)) {
      continue;
    }

    const tripDays = daysByTrip.get(tripSlug) ?? new Map<string, Day>();
    const day = tripDays.get(date) ?? createEmptyDay(tripSlug, date);
    day.photos.push({
      src,
      filename,
      alt: `${titleFromSlug(tripSlug)} on ${formatDisplayDate(date)}: ${filename}`,
    });
    tripDays.set(date, day);
    daysByTrip.set(tripSlug, tripDays);
  }

  const tripSlugs = new Set<string>(daysByTrip.keys());
  for (const path of Object.keys(tripIntros)) {
    const match = path.match(tripPathPattern);
    if (match) {
      tripSlugs.add(match[1]);
    }
  }
  for (const path of Object.keys(tripSummaries)) {
    const match = path.match(tripSummaryPathPattern);
    if (match) {
      tripSlugs.add(match[1]);
    }
  }

  return [...tripSlugs]
    .sort()
    .map((slug) => {
      const intro = tripIntros[`/src/content/trips/${slug}/trip.md`];
      const summary = tripSummaries[`/src/content/trips/${slug}/summary.md`];
      const frontmatter = getFrontmatter(intro);
      const days = [...(daysByTrip.get(slug)?.values() ?? [])]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((day, index) => ({
          ...day,
          ordinalLabel: formatDayOrdinal(index),
          photos: day.photos.sort((a, b) => a.filename.localeCompare(b.filename)),
        }));
      const explicitCoverPath = tripMetaBySlug.get(slug)?.coverPhoto;
      const photosByPath = new Map<string, Photo>(
        days.flatMap((day) =>
          day.photos.map((photo) => [`days/${day.date}/photos/${photo.filename}`, photo] as const),
        ),
      );
      const cover = explicitCoverPath
        ? photosByPath.get(explicitCoverPath) ?? days.find((day) => day.photos.length > 0)?.photos[0]
        : days.find((day) => day.photos.length > 0)?.photos[0];

      return {
        slug,
        title: asString(frontmatter.title) ?? titleFromSlug(slug),
        description: asString(frontmatter.description),
        intro,
        summary,
        days,
        cover,
      };
    });
}

export function getTrip(slug: string) {
  return getTrips().find((trip) => trip.slug === slug);
}

export function getDay(tripSlug: string, date: string) {
  return getTrip(tripSlug)?.days.find((day) => day.date === date);
}
