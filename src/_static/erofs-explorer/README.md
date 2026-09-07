# EROFS layout explorer

The standalone page at `ondisk/explorer.html` preserves independent controls
for inode encoding, block size, flat/chunk/LZ4 data, xattr storage, filters and
prefixes. LZ4 also supports compressed tail inlining and compact/full indexes.
Users combine these controls freely within their existing format dependencies.
There is no named-example selector.

## Static data, independent controls

mkfs.erofs is used only offline to generate hardcoded layout JSON. The website
build, deployed server and browser never invoke it. No API service or WebAssembly
filesystem builder is required.

The production data is organized by reusable structures and fields, rather than
an array of complete images indexed by every parameter combination:

- `layouts/default.json` preserves the original default image's record/hash.
- `layouts/flat.json`, `chunked.json` and `lz4.json` contain shared structure
  definitions and the recorded variations selected by the independent options.
- `layout-data.js` reads that JSON, resolves structure references, selects fields,
  and evaluates block-unit/chunk-format values. It does not allocate blocks or
  run a filesystem builder. The superblock checksum is recomputed over the
  selected recorded bytes and the fixed source content in its checksum block.
- `recorded-layout.js` and `compressed-layout.js` render the resulting records.

The initial page loads only the default record. Each additional data family is
loaded on demand and cached. Further changes within a family reuse its data.
Versioned requests prevent an older load from overwriting the user's latest
selection; failures are visible and retryable. Large research matrices and
bulk JavaScript image tables are not production assets.

The reconstructed records were compared field-for-field with the independent
offline mkfs results, including raw bytes, physical positions, directory/xattr
references, compression mappings and checksums. This is a closed example tree,
not a generic filesystem allocator or a parser for arbitrary uploaded images.
Research images and the exhaustive comparison harness stay outside this site.

## Data format

Each family JSON has a `schema`, tool version, fixed `sourceFiles`, `root` and
shared `nodes`. A node contains one of:

| Node | Meaning |
|---|---|
| `value` | Recorded scalar value |
| `array` / `object` | Structure assembled from referenced nodes |
| `select` | Recorded variation selected by a named option |
| `blocks` / `blockBits` | Block-unit value or filesystem block shift |
| `chunkSize` / `chunkFormat` | Chunk-size expression or chunk-format low bits |

References share repeated fields and structures. There is no list of input
combinations and no full image record for each combination. Checksum bytes are
zero in the family data because they depend on the selected bytes; the reader
fills them using EROFS CRC32C. Per-image SHA-256 values from the research matrix
are not copied into this representation. The original default's SHA is retained
in its standalone record; selected structures do not invent another image hash.

## Source tree and interaction

All settings use `/a` (768 B), `/docs/b` (8704 B), and `/docs/assets/c` (5000 B).
The B/C sharing checkbox changes only C's first block to match B; file lengths
and directory hierarchy remain fixed. Xattr controls populate the same inodes.
See [REAL-IMAGE.md](REAL-IMAGE.md) for offline settings and
[COVERAGE.md](COVERAGE.md) for dependencies.

Three strips show the filesystem, an expanded interval and its fields/records.
Directory NIDs, xattr references and data indexes navigate to related structures.
The dock distinguishes logical file length from stored length. Inline compressed
tails stay with their inode metadata; full indexes retain the reserved eight
bytes after the compression header. Hidden controls retain user preferences;
Reset restores the default options.

## Build and deployment

```sh
python -m pip install -r requirements.txt
make html
python -m http.server 8765 --bind 127.0.0.1 --directory build/html
```

Use a clean HTML output directory when replacing a deployment, so obsolete
research data files do not remain accessible. EPUB/LaTeX use the static Markdown
content. No runtime mkfs dependency, server-side generator, or automated test
dependency is added to the project.
