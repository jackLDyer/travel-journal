import { copyFile, mkdir, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import exifr from "exifr";
import sharp from "sharp";

const DEFAULT_OPTIMIZED_MAX_DIMENSION = 1600;
const DEFAULT_OPTIMIZED_QUALITY = 76;
const SUMMARY_PLACEHOLDER = `Write the day's story here.
`;
const TRIP_SUMMARY_PLACEHOLDER = `Write the trip summary here.
`;
const META_PLACEHOLDER = `locations: []
highlights: []
`;
const TRIP_META_PLACEHOLDER = `coverPhoto: ""
`;

export const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
]);

export type SortPhotosOptions = {
  input: string;
  trip: string;
  contentRoot?: string;
  move?: boolean;
  dryRun?: boolean;
  optimize?: boolean;
  maxDimension?: number;
  quality?: number;
};

export type PlannedOperation = {
  source: string;
  destination: string;
  day: string | "unsorted";
  action: "copy" | "move" | "optimize";
};

export type ScaffoldOperation = {
  destination: string;
  day?: string;
  filename: "summary.md" | "meta.yaml";
  content: string;
};

export type SortPhotosResult = {
  operations: PlannedOperation[];
  scaffoldOperations: ScaffoldOperation[];
  skipped: string[];
  counts: Map<string, number>;
};

type ExifDateFields = {
  DateTimeOriginal?: Date | string;
  CreateDate?: Date | string;
  DateTimeDigitized?: Date | string;
};

export function isSupportedImage(filePath: string) {
  return SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function formatDay(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDestinationDirectory(contentRoot: string, trip: string, day: string | null) {
  if (day === null) {
    return path.join(contentRoot, trip, "days", "unsorted");
  }

  return path.join(contentRoot, trip, "days", day, "photos");
}

export function getDayDirectory(contentRoot: string, trip: string, day: string) {
  return path.join(contentRoot, trip, "days", day);
}

export function getOptimizedFilename(filename: string) {
  return `${path.parse(filename).name}.webp`;
}

export function parseExifDate(value: Date | string | undefined) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function getTakenDate(filePath: string) {
  try {
    const metadata = (await exifr.parse(filePath, [
      "DateTimeOriginal",
      "CreateDate",
      "DateTimeDigitized",
    ])) as ExifDateFields | undefined;

    return (
      parseExifDate(metadata?.DateTimeOriginal) ??
      parseExifDate(metadata?.CreateDate) ??
      parseExifDate(metadata?.DateTimeDigitized)
    );
  } catch {
    return null;
  }
}

export async function listImageFiles(input: string): Promise<string[]> {
  const entries = await readdir(input, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(input, entry.name);
      if (entry.isDirectory()) {
        return listImageFiles(fullPath);
      }

      return isSupportedImage(fullPath) ? [fullPath] : [];
    }),
  );

  return files.flat().sort((a, b) => a.localeCompare(b));
}

export async function resolveAvailablePath(
  destinationDirectory: string,
  filename: string,
  reserved = new Set<string>(),
) {
  const parsed = path.parse(filename);
  let attempt = 1;

  while (true) {
    const suffix = attempt === 1 ? "" : `-${attempt}`;
    const candidate = path.join(destinationDirectory, `${parsed.name}${suffix}${parsed.ext}`);
    const key = path.resolve(candidate).toLowerCase();

    if (!reserved.has(key)) {
      try {
        await stat(candidate);
      } catch {
        reserved.add(key);
        return candidate;
      }
    }

    attempt += 1;
  }
}

async function fileExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function planDayScaffolds(
  contentRoot: string,
  trip: string,
  days: Iterable<string>,
): Promise<ScaffoldOperation[]> {
  const scaffoldOperations: ScaffoldOperation[] = [];

  for (const day of [...new Set(days)].sort((a, b) => a.localeCompare(b))) {
    const dayDirectory = getDayDirectory(contentRoot, trip, day);
    const files = [
      {
        filename: "summary.md" as const,
        content: SUMMARY_PLACEHOLDER,
      },
      {
        filename: "meta.yaml" as const,
        content: META_PLACEHOLDER,
      },
    ];

    for (const file of files) {
      const destination = path.join(dayDirectory, file.filename);
      if (!(await fileExists(destination))) {
        scaffoldOperations.push({
          destination,
          day,
          filename: file.filename,
          content: file.content,
        });
      }
    }
  }

  return scaffoldOperations;
}

export async function planTripScaffolds(
  contentRoot: string,
  trip: string,
): Promise<ScaffoldOperation[]> {
  const tripDirectory = path.join(contentRoot, trip);
  const files = [
    {
      destination: path.join(tripDirectory, "summary.md"),
      filename: "summary.md" as const,
      content: TRIP_SUMMARY_PLACEHOLDER,
    },
    {
      destination: path.join(tripDirectory, "meta.yaml"),
      filename: "meta.yaml" as const,
      content: TRIP_META_PLACEHOLDER,
    },
  ];
  const scaffoldOperations: ScaffoldOperation[] = [];

  for (const file of files) {
    if (!(await fileExists(file.destination))) {
      scaffoldOperations.push(file);
    }
  }

  return scaffoldOperations;
}

export async function planPhotoSort(options: SortPhotosOptions): Promise<SortPhotosResult> {
  const input = path.resolve(options.input);
  const contentRoot = path.resolve(options.contentRoot ?? path.join("src", "content", "trips"));
  const imageFiles = await listImageFiles(input);
  const reserved = new Set<string>();
  const operations: PlannedOperation[] = [];
  const datedDays = new Set<string>();
  const skipped: string[] = [];
  const counts = new Map<string, number>();

  for (const source of imageFiles) {
    const takenDate = await getTakenDate(source);
    const day = takenDate ? formatDay(takenDate) : "unsorted";
    const destinationDirectory = getDestinationDirectory(
      contentRoot,
      options.trip,
      takenDate ? day : null,
    );
    const filename = options.optimize
      ? getOptimizedFilename(path.basename(source))
      : path.basename(source);
    const destination = path.join(destinationDirectory, filename);
    const key = path.resolve(destination).toLowerCase();

    if (reserved.has(key) || (await fileExists(destination))) {
      skipped.push(source);
      continue;
    }

    reserved.add(key);

    operations.push({
      source,
      destination,
      day,
      action: options.optimize ? "optimize" : options.move ? "move" : "copy",
    });
    counts.set(day, (counts.get(day) ?? 0) + 1);
    if (takenDate) {
      datedDays.add(day);
    }
  }

  const scaffoldOperations = [
    ...(await planTripScaffolds(contentRoot, options.trip)),
    ...(await planDayScaffolds(contentRoot, options.trip, datedDays)),
  ];

  return { operations, scaffoldOperations, skipped, counts };
}

export async function optimizePhoto(
  source: string,
  destination: string,
  maxDimension = DEFAULT_OPTIMIZED_MAX_DIMENSION,
  quality = DEFAULT_OPTIMIZED_QUALITY,
) {
  await sharp(source)
    .rotate()
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality })
    .toFile(destination);
}

export async function sortPhotos(options: SortPhotosOptions) {
  const result = await planPhotoSort(options);

  if (!options.dryRun) {
    for (const operation of result.scaffoldOperations) {
      await mkdir(path.dirname(operation.destination), { recursive: true });
      try {
        await writeFile(operation.destination, operation.content, { flag: "wx" });
      } catch (error) {
        if (!isFileExistsError(error)) {
          throw error;
        }
      }
    }

    for (const operation of result.operations) {
      await mkdir(path.dirname(operation.destination), { recursive: true });
      if (operation.action === "optimize") {
        await optimizePhoto(
          operation.source,
          operation.destination,
          options.maxDimension,
          options.quality,
        );
      } else if (operation.action === "move") {
        await rename(operation.source, operation.destination);
      } else {
        await copyFile(operation.source, operation.destination);
      }
    }
  }

  return result;
}

function isFileExistsError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}
