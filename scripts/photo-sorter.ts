import { copyFile, mkdir, readdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import exifr from "exifr";
import sharp from "sharp";

const DEFAULT_OPTIMIZED_MAX_DIMENSION = 1600;
const DEFAULT_OPTIMIZED_QUALITY = 76;

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

export type SortPhotosResult = {
  operations: PlannedOperation[];
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

export async function planPhotoSort(options: SortPhotosOptions): Promise<SortPhotosResult> {
  const input = path.resolve(options.input);
  const contentRoot = path.resolve(options.contentRoot ?? path.join("src", "content", "trips"));
  const imageFiles = await listImageFiles(input);
  const reserved = new Set<string>();
  const operations: PlannedOperation[] = [];
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
    const destination = await resolveAvailablePath(destinationDirectory, filename, reserved);

    operations.push({
      source,
      destination,
      day,
      action: options.optimize ? "optimize" : options.move ? "move" : "copy",
    });
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  return { operations, skipped, counts };
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
