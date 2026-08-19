# Raw art — unprocessed

Source images the user generated manually (Gemini app, chat UI, not the
automated `generate_art.py` pipeline) and sent into the session for the
Forge flagship art pack. **These are raw, unprocessed source files** —
magenta-key (`#FF00FF`) backgrounds where applicable, un-cropped, un-sliced,
not yet run through any Art Pack ingestion pipeline.

They are checked in here purely for preservation. Nothing in this directory
is wired into `@forge/art-pack`, a `pack.json` manifest, or any fixture pack
yet — that is the job of tasks **L1–L5** (#134–#138), none of which have
landed. Do not reference these paths from application code; treat this
directory the same as `fixtures/modules/` — inputs for a pipeline, not
shippable assets.

## Batches

- `batch-1/` — 15 images (`IMG_2782.jpeg`–`IMG_2796.jpeg`). First manually
  generated set: character sheets (blacksmith, farmer, innkeeper) and
  sci-fi terrain tiles (deck plating, energy conduit, bulkhead, grating).
- `batch-2/` — 63 images (`IMG_2718.png`–`IMG_2781.jpeg`). Second, much
  larger set: 7 complete 4×4 character/creature sheets, ~25 isometric
  props, a UI/VFX sheet, and 11 candidate terrain tiles.

## Known issues, found during review (do not re-verify from scratch)

Both batches were catalogued and technically checked — real edge-crop seam
comparisons and per-quadrant brightness-spread checks with PIL/numpy, not
eyeballing — before being committed here.

**batch-1:**
- `IMG_2793.jpeg` / `IMG_2794.jpeg` (innkeeper sheet) — broken 4×6 grid,
  orientations scrambled within rows. Not cleanly sliceable. Needs a
  regenerate, not a fix.
- blacksmith and farmer sheets — 4 rows generated instead of 3 (duplicate
  west-facing row). Trivial fix: drop the duplicate row when slicing.
- scifi-deck / scifi-energy tiles — confirmed lighting-hotspot seam via
  actual edge-crop comparison. Fixable in post-processing (flatten the
  gradient), not a regenerate.
- Several character sheets have a faint drop-shadow under the feet.
  Minor, fixable by masking.

**batch-2:**
- `IMG_2731.jpeg` (wood-plank floor tile) — genuine top/bottom seam
  mismatch, confirmed by edge-crop (58.8 avg pixel delta vs. ~20–30
  baseline for the other tiles). **Needs a regenerate**, not a fix.
- `IMG_2725.png`, `IMG_2727.jpeg`, `IMG_2728.jpeg`, `IMG_2730.jpeg`,
  `IMG_2775.jpeg` (cave-rock, cobblestone, wavy-sand/wood-grain,
  dark-cave-ore, cracked-desert) — mild diagonal lighting gradient
  (brighter top-left corner), confirmed by edge-crop on cave-rock.
  Fixable in post-processing (flatten the gradient), not a regenerate.
- `IMG_2723.png` — a screenshot of the Gemini app itself, not a game
  asset. Shows a malformed 8×8 grid produced by appending "Create 5
  different variations" to a sheet prompt. Kept as evidence of the bug
  the Chroma Key prompt set's "do not generate variations" clause exists
  to prevent — exclude from ingestion.
- `IMG_2756.jpeg` (dungeon brick wall) — moderate top/bottom edge delta
  (28.6), worth a second look during slicing but not confirmed broken.
- Grass (`IMG_2719.png`), moss-cobblestone (`IMG_2729.jpeg`), sandstone
  brick (`IMG_2778.jpeg`), and ocean water (`IMG_2776.jpeg`) tiles, plus
  the two transition tiles (grass→dirt `IMG_2754`, sand→water `IMG_2755`,
  if present) — verified clean, no action needed.
