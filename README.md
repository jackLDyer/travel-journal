# Travel Journal

A static Astro site for travel journals, organised by trip and day folders. Each day can include a markdown summary and web-sized photos, and a local CLI can sort and optimize image files into day folders from their EXIF taken-date metadata.

## Content structure

```text
src/content/trips/<trip-slug>/
  trip.md
  summary.md
  meta.yaml
  days/
    YYYY-MM-DD/
      summary.md
      meta.yaml
      photos/
        image-1.webp
    unsorted/
```

`trip.md`, trip-level `summary.md`, and day `summary.md` can include optional frontmatter:

```md
---
title: A long weekend in Lisbon
description: Tiles, hills, and late dinners.
---

The written journal content goes here.
```

Day summaries can also use `location` in frontmatter for older entries. New day card metadata lives in `meta.yaml`:

```yaml
locations:
  - Ribeira
  - Jardim do Morro
highlights:
  - Sunset over the Douro
  - Late dinner by the river
```

Trip-level summary content lives in `src/content/trips/<trip-slug>/summary.md` and is shown on the trip page.

Trip-level metadata lives in `src/content/trips/<trip-slug>/meta.yaml`:

```yaml
coverPhoto: "days/2026-05-14/photos/IMG_1234.webp"
```

`coverPhoto` is optional and should be a path relative to the trip root. When set, the homepage uses that image for the trip card; otherwise it falls back to the first available photo.

## Commands

Requires Node.js `>=22.12.0`.

```bash
npm install
npm run dev
npm run build
npm run test
npm run sort-photos -- --input ./photo-dump --trip lisbon --dry-run
npm run sort-photos -- --input ./photo-dump --trip lisbon
```

The sorter optimizes by default for the normal GitHub Pages workflow: it writes 1600px WebP files at quality 76, rotates from EXIF, strips metadata, and keeps originals in the input folder. For each import it also creates missing trip root `summary.md` and `meta.yaml` files, and for each dated day that receives photos it creates missing day `summary.md` and `meta.yaml` placeholder files without overwriting existing content. When imported photos contain GPS metadata, the sorter reverse-geocodes rounded coordinates with OpenStreetMap Nominatim, merges up to three coarse city/region locations into each day `meta.yaml`, and caches lookups in `.cache/photo-geocode-cache.json`. Use `--no-locations` to skip network lookups and metadata location updates. Keep full-resolution originals outside this repo. Use `--originals` only when you intentionally want to copy original files, and use `--move --originals` only when you intentionally want to move originals out of the input folder. Files without reliable EXIF taken-date metadata are placed in `src/content/trips/<trip>/days/unsorted/`.
