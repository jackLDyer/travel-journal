# Travel Journal

A static Astro site for travel journals, organised by trip and day folders. Each day can include a markdown summary and web-sized photos, and a local CLI can sort and optimize image files into day folders from their EXIF taken-date metadata.

## Content structure

```text
src/content/trips/<trip-slug>/
  trip.md
  days/
    YYYY-MM-DD/
      summary.md
      meta.yaml
      photos/
        image-1.webp
    unsorted/
```

`trip.md` and `summary.md` can include optional frontmatter:

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

The sorter optimizes by default for the normal GitHub Pages workflow: it writes 1600px WebP files at quality 76, rotates from EXIF, strips metadata, and keeps originals in the input folder. For each dated day that receives photos, it also creates missing `summary.md` and `meta.yaml` placeholder files without overwriting existing content. Keep full-resolution originals outside this repo. Use `--originals` only when you intentionally want to copy original files, and use `--move --originals` only when you intentionally want to move originals out of the input folder. Files without reliable EXIF taken-date metadata are placed in `src/content/trips/<trip>/days/unsorted/`.
