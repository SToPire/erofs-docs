# Offline layout provenance

mkfs.erofs (erofs-utils) 1.9.4 is used only offline to generate the hardcoded
layout JSON. Independent controls select recorded structure and field variants
from that JSON. Website builds, the static server and the browser do not invoke
mkfs, and no runtime filesystem service or WebAssembly builder is used.

## Fixed source tree

```text
/
├── a                 768 B
└── docs/
    ├── b            8704 B
    └── assets/
        └── c        5000 B
```

A contains 48 lines of fifteen `a` characters, B 544 lines of fifteen `b`
characters and C 500 lines of nine `c` characters; every line ends in LF.
Directory/file modes are 0755/0644. The B/C sharing control replaces C's first
filesystem block with B's first block, preserving all lengths and paths.

All offline commands fix these settings:

```text
-T1700000000 --all-root --workers=1
-U11111111-2222-3333-4444-555555555555
```

## Controls and offline arguments

| Control | Argument |
|---|---|
| Filesystem block size | `-b512`, `-b4096` or `-b16384` |
| Inode encoding | `-Eforce-inode-compact` or `-Eforce-inode-extended` |
| External flat file tails | `-Enoinline_data` |
| Chunk size | `--chunksize=<B * 2^n>` |
| Chunk entry format | `-Eforce-inode-blockmap` or `-Eforce-chunk-indexes` |
| Extra device | `--blobdev=data.blob`, with indexes |
| Inline / mixed / shared-only xattrs | `-x2147483647` / `-x1` / `-x0` |
| Name filter | `-Exattr-name-filter` or `-E^xattr-name-filter` |
| Long prefixes | `--xattr-prefix=user.erofs.` and `-Eplain-xattr-prefixes` |
| LZ4 | `-zlz4`, with default compression settings |
| Inline compressed tails | `-Eztailpacking` |
| Full compression indexes | `-Elegacy-compress` |

Extended options are comma-separated within `-E`. The UI's existing dependencies
still apply. The table documents offline generation; it is not a build script.

Inline xattrs use `user.note=demo:<path>`, where path is relative (`docs/b`) or
`/` for the root. Shared xattrs use common `user.owner=erofs`. Long-prefix
entries use `user.erofs.note=prefix:<path>` for inline/mixed storage and common
`user.erofs.note=demo` for shared-only storage. These names/values are applied
to all six inodes selected by the storage controls.

## Baselines

The original flat default and no-inline images retain their SHA-256:

| Layout | Bytes | SHA-256 |
|---|---:|---|
| Compact, 4 KiB, inline, no xattrs | 16384 | `3ed6b98384a6af6614d1a7b035b553ec6af9315245a83f8733b75f176d1ba9a3` |
| Same, external file tails | 28672 | `b629e74ca41cda7bf6562764321092262ce3fc033b6463bd7f64448b68e10470` |

For compact inodes, 4 KiB blocks and no xattrs, both LZ4 index formats use 12288 B
with compressed tail inlining off and 4096 B with it on. Inline LZ4 streams for
A/B/C contain 20/51/37 B. Full indexes retain the eight reserved bytes after the
map header. `i_u.compressed_blocks` excludes inline tails; their actual length
is given by `h_idata_size`.

## Production representation and verification

The production files are `layouts/default.json` and three shared structure
families, `flat.json`, `chunked.json`, `lz4.json`. The default is a standalone
baseline. Each family shares repeated structures and field values, with option
selection and simple block/chunk expressions. It does not store a complete
snapshot for each input tuple or publish research image hashes/case manifests.
The format is described in README.md.

Superblock checksum bytes are dependent values. They are calculated from the
selected recorded metadata plus the fixed source bytes that fall within the
checksum block; this avoids duplicating records solely for checksum changes.
No filesystem allocation or compression algorithm runs in the browser.

The resulting records were compared against all existing offline research
results: every raw structure byte, checksum, physical address, directory/xattr
reference, chunk and compression mapping matched. The comparison harness,
research images and exhaustive records remain outside website sources and
static deployment output. Individual image SHA values are not fabricated for
composed records; the standalone default retains its original image hash.
