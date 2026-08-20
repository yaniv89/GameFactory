# Art pipeline tools

Image-processing tooling that turns raw art (`fixtures/raw-art/`) into
pack-ready assets for `@forge/art-pack` (docs/adr/0014). Python, not
TypeScript — PIL/numpy are the right tool for pixel-level image work, and
this doesn't ship in the product bundle, so it isn't bound by the JS/TS
tech-stack pin in `CLAUDE.md` Section 2.

## `chroma_key_extract.py` — L3, task #136

Keys a raw, magenta-keyed (`#FF00FF`) source image out to a real,
spill-suppressed alpha channel and crops it tight to the actual content.
Does **not** slice a facing-strip or animation-strip into frames — that's
L4 (task #137), a separate stage this one's output feeds into — and does
nothing useful on a terrain tile (they aren't chroma-keyed; the whole
frame is the asset).

```bash
# One file.
python3 chroma_key_extract.py path/to/source.png path/to/output.png

# A whole directory (non-recursive), reporting every failure instead of
# stopping at the first — real per-file issues are expected (see
# fixtures/raw-art/README.md's own catalogue).
python3 chroma_key_extract.py fixtures/raw-art/batch-2 /tmp/out --batch
```

A file with no magenta content at all (a terrain tile, a non-chroma-keyed
photo) fails loudly (`NoKeyColorFoundError` / a non-zero exit code) rather
than silently passing through unchanged — that's almost always a sign the
wrong file was pointed at this tool, not something to key "successfully"
into a no-op.

Tuning flags (`--key`, `--tolerance`, `--feather`, `--pad`) and the
spill-score algorithm itself — why it isn't plain Euclidean distance to
the key color — are documented in the module's own docstring and
`ChromaKeyOptions`'/`_spill_score`'s doc comments.

### Tests

```bash
python3 -m unittest tools/art-pipeline/test_chroma_key_extract -v
```

Synthetic, deterministic images only — the real `fixtures/raw-art/`
photos are for manual, visual end-to-end verification (composite the
output onto a solid color and look at it; a magenta fringe or a clipped
crop is easy to spot and hard to catch with a numeric assertion alone),
not a repeatable unit-test fixture.
