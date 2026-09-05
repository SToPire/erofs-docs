# EROFS layered layout explorer

The explorer is a standalone page at `ondisk/explorer.html`, rendered by
`src/_templates/explorer.html`. It does not inherit the documentation sidebar
or article layout. `src/conf.py` selects this template for the HTML builder;
other builders use the ordinary Markdown description and directory tree.

## Build and deployment boundary

`mkfs.erofs` may only be used offline before committing, to generate reference
images and correct the SVG layout and its static data. Do not add invocations
or a dependency on it to repository scripts, builds, deployment, or the browser.
Commit the reviewed static results; serving and rebuilding the documentation
must work without erofs-utils installed. The commands in REAL-IMAGE.md document
the offline provenance only and are not build steps.

## Interaction

- The center contains three horizontal, contiguous strips: an EROFS overview,
  an expanded inode/data interval, and the selected structure’s fields or content.
  This follows the conventional overview-to-detail diagram style, not a card grid.
- Two sloping lines connect the selected interval’s left/right edges to the next
  strip’s edges. They express magnification only; NID/data references are followed
  through dock buttons and highlighting. Line coordinates update on resize.
- The root directory content is expanded initially, so all three levels are visible immediately.
  Selecting an overview section changes the expanded interval. Selecting an inode
  field opens and highlights its explanation in the dock. Selecting directory
  content expands its direntry array and names; entries can follow target NIDs.
- Hover or keyboard focus opens a summary with a type, example address, size,
  and description. Clicking, tapping, or pressing Enter opens the field dock.
- The dock shows field names, relative offsets, widths, example values, and
  meanings. Related-region buttons and directory NIDs follow references.
- Selecting an inode highlights its related directory/data regions. Escape or
  the close button closes the dock and restores focus to the selected region.
- The left options dock groups inode encoding, regular-file layout, chunk entry
  format, and xattr storage. On narrow screens it moves above the diagram and can
  be collapsed. The selected structure and field dock stay synchronized.
- Flat data may use inline tails. Chunk-based data defaults to 4 KiB chunks and either
  a 4-byte block map or 8-byte chunk indexes. The exponent control extends chunk
  sizes to B × 2^n for n=0..31. Choosing chunked disables tail
  inlining; switching back restores the previous flat-file preference.
- Xattr storage offers none, inline, or inline + shared. Attributes are inserted
  before inline data or chunk indexes, and shared entries can be followed across
  the diagram. Reset options returns to the compact/flat/no-xattr example.
- On wide screens the dock occupies the right column. On phones it is a bottom
  sheet. The strips scroll horizontally inside the diagram, preserving their
  continuous layout without causing page overflow. The page follows the system's light/dark and reduced-motion settings.

## Hand-authored placement

The page defaults to the real mkfs layout documented in [REAL-IMAGE.md](REAL-IMAGE.md):
4 KiB blocks, compact inodes, no xattrs, and inline tails, totalling 4 blocks.
Disabling file-tail inlining selects a second recorded image of 7 blocks.
Both use metadata base 0 and root NID 36. Inodes and their external data have
separate overview intervals. Other combinations use the illustrative placement
below, which is not a prediction of mkfs output.

These are explanatory values, not output parsed from an image. The frontend
never opens or generates an EROFS image. `layouts.js` defines fixed example
placements and field descriptions. `createLayout()` combines compact/extended,
flat or chunked, and xattr choices; it is not an allocator or a mkfs implementation.
The original four `PRESETS` and 24 basic combinations remain as regression
fixtures. `documented-layouts.js` composes the broader documented variants using
`xattr-variants.js` and `chunk-variants.js`. Primary/device offsets and decoded
packed/metabox offsets are independent coordinate spaces, with explicit tabs
and cross-space references. All examples deliberately use uncompressed data
and uncompressed special-inode backing.

| Blocks | Contents in the illustrative 4 KiB plain preset |
| --- | --- |
| 0 | First 1024 bytes reserved; superblock at 1024, length 128 |
| 1 | Root inode and its inline directory content |
| 2–3 | File A inode, followed by its 768-byte external data |
| 4–7 | File B inode, followed by 8704 bytes of data (two full blocks + 512-byte tail) |
| 8–10 | File C inode, followed by 5000 bytes of data (one full block + 904-byte tail) |
| 11 | /docs inode and inline directory content |
| 12 | /docs/assets inode and inline directory content |
| 13 | Shared xattr area, or unused when xattrs are disabled |

In that illustrative preset, `meta_blkaddr = 1` and `block_size = 4096`. The root and file A/B/C NIDs are
0, 128, 384, and 896 respectively. All inode addresses obey
`4096 + NID * 32`, including for extended inodes. Gaps are deliberately kept
stable to make movement easy to compare; real builders need not keep them.

The fixed tree is /a, /docs/b, and /docs/assets/c. The three directories
contain their own `.` and `..` entries; root's parent is itself.
The /docs and /docs/assets NIDs are 1280 and 1408 in the default placement.
Root and /docs have link count 3; /docs/assets has link count 2.
Default ASCII directory content sizes are 56, 58, and 40 bytes respectively.
Entries are sorted by filename bytes before name offsets are calculated.
All directories follow the Inline / External directory-data option.

With file-tail inlining on, file A is entirely inline; the tails of B/C move
after their inodes and any xattr bodies. Their external full blocks do not move. The former tail
blocks are shown as unused. Root and wholly inline A have no meaningful
external `startblk`; the dock explicitly marks it unused. B/C still use
external start blocks 5/9. All inline content fits in its metadata block.

### Chunk-based files

Directories use a fixed flat-inline layout in the UI. Regular-file inodes use data layout 4,
so `i_format` is 8 (compact) or 9 (extended), and superblock `CHUNKED_FILE` (0x4)
is set. `i_u.c.format` and `i_u.c.reserved` replace the flat start-block union.
The format is 0 for block maps and 0x20 for 8-byte indexes; chunk size bits are 0.

`chunk-index-a/b/c` follow the inode and xattr body, aligned to 4 or 8 bytes.
They have one entry per logical 4096-byte chunk. File B illustrates independent
addresses: logical chunks 0, 1, 2 map to physical blocks 5, 7, 6. A still uses
block 3, and C uses blocks 9 and 10. The last chunk contains only the bytes up
to EOF, with external padding outside the logical file length.

Each address entry is a `children` record with absolute start, relative field
offsets, and a payload reference. The renderer expands these records into the
third strip and uses the field dock for individual entry fields. For 8-byte
indexes, `device_id=0` selects the primary device in this single-device example.

### Inline and shared xattrs

For the basic user.note/user.owner examples, each inode receives the chosen form:

- Inline: a 12-byte ibody header plus `user.note=demo`, whose entry occupies
  4 + 4 + 4 = 12 bytes. Body size is 24 bytes; `i_xattr_icount=4`.
- Inline + shared: a 12-byte header, 4-byte shared ID 0, and the same local
  12-byte entry. Body size is 28 bytes; `i_xattr_icount=5`.
- Shared `user.owner=erofs` is stored once at block 13 in the default placement.
  Its 4 + 5 + 5 = 14 bytes are padded to 16.
  Each ID 0 resolves to `13*4096 + 0*4 = 53248`.

The header, shared ID and local entry are children of each inode's
`xattr-root/docs/assets/a/b/c` region.
Only top-level regions participate in the physical interval partition;
children describe bytes inside their parent and are not counted a second time.
The body size formula is `12 + (i_xattr_icount - 1)*4` for a nonzero count.
The inode, body and inline tail occur in that order. With shared xattrs, an
8-byte chunk index needs an additional 4-byte alignment gap after the 28-byte
body. Ordinary inline/shared xattrs need no additional feature flag;
XATTR_FILTER, long prefixes and metabox storage are not enabled.

Small structures and fields are enlarged so they can be selected.
Pixel widths do not represent byte counts. The actual example offset and size
are given by the region and the dock. Inodes and data can be interleaved;
EROFS has no mandatory centralized inode or directory table.

## Files

- `layouts.js`: basic regression presets and field definitions.
- `documented-layouts.js`: option normalization, block-size/core/type variants,
  special-inode backing, address-space groups, and checksum examples.
- `chunk-variants.js`: chunk-size, address forms, device table, and sharing.
- `xattr-variants.js`: namespace, shared-only/pools, prefixes, filters, fingerprints.
- `COVERAGE.md`: documentation-to-option mapping and explicit scope limits.
- `explorer.js`: continuous strips, zoom connectors, hover summaries, selection,
  derived directory-entry views, and field dock.
- `explorer.css`: the independent page layout, dock, focus, and responsive styles.
- The template and Markdown description include a static directory tree for
  no-JS and non-HTML output.

The original static SVG switcher and the later twelve-card grid have been
replaced by this connected overview-to-detail diagram.

## Format references

- [Core on-disk format](https://erofs.docs.kernel.org/en/latest/ondisk/core_ondisk.html)
- [Linux v6.18 structure definitions](https://github.com/torvalds/linux/blob/v6.18/fs/erofs/erofs_fs.h)
- [Inode addressing](https://github.com/torvalds/linux/blob/v6.18/fs/erofs/internal.h)
- [Flat mapping and inline constraints](https://github.com/torvalds/linux/blob/v6.18/fs/erofs/data.c#L79)
- [Chunk-based format](https://erofs.docs.kernel.org/en/latest/ondisk/chunked_format.html)
- [Extended attributes](https://erofs.docs.kernel.org/en/latest/ondisk/xattrs.html)
- [Xattr reading](https://github.com/torvalds/linux/blob/v6.18/fs/erofs/xattr.c)
- [Directory handling](https://github.com/torvalds/linux/blob/v6.18/fs/erofs/dir.c)

The dock uses community-documentation aliases such as `i_u.startblk` and
`is_compressed`. It covers the variants detailed in the source Markdown, including multiple
devices and decoded xattr storage, without implementing 48-bit addressing or
compressed on-disk index formats that those pages only reference. The values are examples;
checksum and UUID are deliberately not fabricated as valid encoded bytes.


## Documented option families

`COVERAGE.md` maps detailed legal branches to their model options.
Advanced sidebar sections expose:

- Block sizes 512 B, 4 KiB, and 16 KiB, automatic Metabox extension, fixed MTIME
  semantics, and populated block/inode statistics.
- A fixed six-inode tree with two nested subdirectories, one file at every
  level, matching directory-entry type hints, and inline/external directories.
- Empty, block-aligned, eligible-tail and non-fitting-tail samples.
  Filename bytes are fixed to ASCII; the last name ends at the valid data end,
  matching the recorded images.
- Chunk exponents 0..31, one extra device with unified or explicit addressing,
  and one shared full chunk. Fixture constraints are explained in the coverage
  table; they are not additional on-disk restrictions.
- Shared-only xattr bodies, all documented namespaces, long prefixes in a
  standalone table or special inode, physical fallback without PLAIN,
  effective/disabled name filters, and image-share fingerprints.

The root and sample file metadata/data positions are derived from the chosen
block size. In particular, 512/1024-byte block presets move the metadata base
after the superblock instead of overlapping its fixed byte offset 1024.
Example file lengths scale with the block size so that comparisons remain small.
Special and helper inodes have no fabricated regular-file data references.

Metabox and packed views show decoded offsets; each has a separate physical
inode and flat backing. A shared xattr address remains `xattr_blkaddr*B + ID*4`
in its selected coordinate space. Prefix addresses always use four-byte units.
No decoder, image parser, or runtime filesystem tool is involved.

Checksum values are calculated from the displayed example superblock fields,
with zero UUID/label/omitted bytes and a zero checksum field. The covered range
starts at 1024 with length `B>1024 ? B-1024 : B`, matching kernel CRC32-C without
final XOR. This is an explanatory byte buffer, not a generated filesystem image.

Invalid reserved layouts, rejected Eytzinger ordering, and reference-only
compression/48-bit topics are explicitly separated in the coverage table.
The latter are not presented as fully implemented on-disk variants.

## Build and preview

```sh
python -m pip install -r requirements.txt
make html
python -m http.server 8765 --bind 127.0.0.1 --directory build/html
```

Open `http://127.0.0.1:8765/ondisk/explorer.html`. `make epub` and `make latex`
build the static document formats. Automated tests and their dependencies have
been removed.

After changing the directory hierarchy, update the static trees in the template
and Markdown description. Run a fresh Sphinx build to publish updated assets.
