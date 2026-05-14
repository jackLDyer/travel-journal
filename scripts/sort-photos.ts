import path from "node:path";
import { sortPhotos } from "./photo-sorter";

type CliOptions = {
  input?: string;
  trip?: string;
  contentRoot?: string;
  move?: boolean;
  dryRun?: boolean;
  optimize?: boolean;
  maxDimension?: number;
  quality?: number;
  help?: boolean;
};

function readOptions(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--input") {
      options.input = next;
      index += 1;
    } else if (arg === "--trip") {
      options.trip = next;
      index += 1;
    } else if (arg === "--content-root") {
      options.contentRoot = next;
      index += 1;
    } else if (arg === "--move") {
      options.move = true;
    } else if (arg === "--optimize") {
      options.optimize = true;
    } else if (arg === "--max-dimension") {
      options.maxDimension = Number(next);
      index += 1;
    } else if (arg === "--quality") {
      options.quality = Number(next);
      index += 1;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Sort travel photos into day folders.

Usage:
  npm run sort-photos -- --input <folder> --trip <trip-slug> [--dry-run] [--move] [--optimize]

Options:
  --input <folder>       Folder containing photos to sort
  --trip <trip-slug>     Trip folder under src/content/trips
  --content-root <path>  Override the trips content root
  --optimize             Write optimized .webp files instead of copying originals
  --max-dimension <px>   Longest optimized image edge, default 1600
  --quality <1-100>      WebP quality for optimized images, default 76
  --dry-run              Print planned operations without copying or moving
  --move                 Move files instead of copying them
`);
}

function printResult(result: Awaited<ReturnType<typeof sortPhotos>>, dryRun: boolean) {
  const verb = dryRun ? "Planned" : "Completed";
  console.log(`${verb} ${result.operations.length} photo operation(s).`);

  for (const operation of result.operations) {
    const action = dryRun
      ? operation.action.toUpperCase()
      : operation.action === "optimize"
        ? "OPTIMIZED"
        : `${operation.action.toUpperCase()}ED`;
    console.log(`${action}: ${operation.source} -> ${operation.destination}`);
  }

  if (result.counts.size > 0) {
    console.log("\nSummary:");
    for (const [day, count] of [...result.counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`  ${day}: ${count}`);
    }
  }
}

async function main() {
  const options = readOptions(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (!options.input || !options.trip) {
    printHelp();
    throw new Error("--input and --trip are required");
  }

  if (options.move && options.optimize) {
    throw new Error("--move cannot be used with --optimize because optimization never deletes originals");
  }

  if (
    options.maxDimension !== undefined &&
    (!Number.isInteger(options.maxDimension) || options.maxDimension < 1)
  ) {
    throw new Error("--max-dimension must be a positive integer");
  }

  if (
    options.quality !== undefined &&
    (!Number.isInteger(options.quality) || options.quality < 1 || options.quality > 100)
  ) {
    throw new Error("--quality must be an integer from 1 to 100");
  }

  const result = await sortPhotos({
    input: path.resolve(options.input),
    trip: options.trip,
    contentRoot: options.contentRoot,
    move: options.move,
    dryRun: options.dryRun,
    optimize: options.optimize,
    maxDimension: options.maxDimension,
    quality: options.quality,
  });

  printResult(result, Boolean(options.dryRun));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
