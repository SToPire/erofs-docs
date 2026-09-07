# LZ4 Compressed Inode Layout

## Overview

The [Layout Explorer](explorer.md) includes images generated with `mkfs.erofs
-zlz4`, with selectable compressed tail inlining and compression index format.
Other compression settings retain their defaults. The same image can contain
compressed files and files stored with a flat layout: read each inode's
`i_format` to determine how its data is mapped.

This page explains the compressed records used by those examples. Compression
levels, custom physical-cluster sizes, fragments, compressed deduplication and
other codecs are outside these examples.
The underlying block-aligned compression design is described in
[Technical Design](../design.md#block-aligned-fitblk-compression).

Bits 1–3 of `i_format` select the data layout. Layout 1 uses full compression
indexes; layout 3 uses compact compression indexes. This is separate from bit 0,
which selects the 32-byte compact or 64-byte extended **inode** encoding.
Either inode encoding can use either compression index format. The explorer's
compact indexes use the default compression layout; full indexes use
`-Elegacy-compress` to expose the legacy layout for format comparison.

For a compressed inode, the four bytes at inode offset `0x10` contain
`i_u.compressed_blocks`, the number of allocated external physical blocks.
Inline compressed data is not counted as an external block, so this field can
be zero for a compressed file. It does not contain an external start address.
The compression indexes locate the data. `i_size` remains the decompressed
file length.

## Compression Map Header

An eight-byte `z_erofs_map_header` starts at
`ALIGN(inode_offset + inode_size + xattr_size, 8)`.
For the recorded LZ4 variants its fields are:

| Offset | Bytes | Field | Meaning |
|---|---|---|---|
| 0 | 2 | `h_reserved1` | Reserved in these examples |
| 2 | 2 | `h_idata_size` | Stored inline compressed-tail size; zero when no inline tail is present |
| 4 | 2 | `h_advise` | Mapping flags; bit 0 permits two-byte compact indexes for layout 3; bit 3 (`0x0008`) identifies an inline pcluster |
| 6 | 1 | `h_algorithmtype` | Low nibble selects HEAD1 codec, high nibble selects HEAD2; codec 0 is LZ4 |
| 7 | 1 | `h_clusterbits` | Low four bits add to the filesystem block-size shift to give the logical-cluster shift |

The superblock compression union also needs to be interpreted with its feature
flags. Without `COMPR_CFGS`, it stores `lz4_max_distance`. With `COMPR_CFGS`, it
stores an `available_compr_algs` bitmap and separate codec configuration records
follow the superblock. The explorer displays the field corresponding to the
recorded image.

## Compact Indexes

Compact indexes follow the compression map header. Their packing depends on
alignment, the logical-cluster size and `h_advise`:

- An eight-byte pack contains two 16-bit index values and a four-byte physical
  block base. Each value carries a type and an offset or distance. These are
  four-byte-per-index records only in the amortized storage sense.
- Where two-byte packing is enabled and applicable, a 32-byte pack contains
  sixteen 14-bit values and a four-byte physical block base. The 14-bit values
  cross byte boundaries, so the explorer shows their shared encoded bytes and
  explains the decoded bit ranges.

Logical-cluster types have different meanings:

| Type | Value | Mapping meaning |
|---|---|---|
| PLAIN | 0 | Uncompressed extent head, or an EOF boundary with no payload |
| HEAD1 | 1 | Compressed extent head using the low-nibble codec |
| NONHEAD | 2 | Reference back to a preceding head; no independent physical cluster |
| HEAD2 | 3 | Compressed extent head using the high-nibble codec |

A head's logical start is `LCN * logical_cluster_size + cluster_offset`.
The next head or EOF bounds its logical extent. Head block addresses are
reconstructed from the pack's physical block base and the preceding records;
the base word alone is not the final address of every entry in the pack.

A final PLAIN record can mark EOF without introducing any stored data.
An odd number of logical-cluster entries can also leave an unused slot in the
last eight-byte pack. Both cases are identified in the recorded examples.

## Full Indexes

Layout 1 uses eight-byte `z_erofs_lcluster_index` records, beginning eight bytes
after the end of the compression map header:

| Offset | Bytes | Field | Meaning |
|---|---|---|---|
| 0 | 2 | `di_advise` | Low two bits select the logical-cluster type |
| 2 | 2 | `di_clusterofs` | Offset within the logical cluster |
| 4 | 4 | `di_u.blkaddr` | Physical block address for a head |
| 4 | 2 | `di_u.delta[0]` | Alternative NONHEAD union member: backward distance |
| 6 | 2 | `di_u.delta[1]` | Alternative NONHEAD union member: forward distance |

The address and distance rows describe alternative interpretations of the same
four-byte union. They are not additional storage.

The eight bytes between the map header and the first full index are reserved
in these records. The diagram preserves that interval separately from the
index records. A head index for an inline tail does not provide its effective
physical block address: the reader uses the metadata location described below.

## Compressed Tail Inlining

The **Inline compressed tails** control enables `-Eztailpacking`. It can be
combined with either compression index format. The option permits mkfs to
store an eligible final compressed extent in the metadata block alongside the
inode, xattrs and compression metadata. The resulting inline extent must fit
within one filesystem block.

The inode's map header sets `Z_EROFS_ADVISE_INLINE_PCLUSTER` in `h_advise` and
records the stored extent length in `h_idata_size`. The reader finds the index
pack or full index record covering the file's final logical cluster; the inline
bytes begin immediately after that pack or record. This is a metadata byte
address, rather than an external block address derived from the head's block
field. The explorer preserves the raw index values and links to the resolved
inline extent.

An inline compressed tail may represent the entire file. The logical file
length remains independent of the inline stream length. Its mapping dock
reports both, and the diagram places the inline data with the inode metadata.
External compressed extents, when present, keep their own physical intervals.

For the compact-inode, 4-KiB, no-xattr fixture, enabling this option stores all
three files as inline compressed data: `/a` uses 20 B, `/docs/b` 51 B and
`/docs/assets/c` 37 B. Both compact and full compression indexes produce a
4,096-byte image, compared with 12,288 bytes when tail inlining is disabled.

## Physical Clusters

An external physical cluster is the block-aligned allocation containing compressed data.
Its allocated size, the length of the encoded stream and the length of the
decoded file extent are distinct quantities.

The recorded LZ4 examples enable `LZ4_0PADDING`: external physical clusters can
contain zero bytes before the encoded stream. The explorer separates those
bytes from the LZ4 stream. Inline tails use their recorded inline length and
are not expanded to a full physical block. Padding is excluded from the logical
file length. A compressed
stream is not addressed with the flat-file formula `startblk * B + logical`;
readers resolve the compression indexes and decode the physical cluster.

For the default 4-KiB, no-xattr fixture:

| File | Logical bytes | Physical allocation | Leading zeros | LZ4 stream |
|---|---:|---:|---:|---:|
| `/a` | 768 | 768 inline bytes | — | Stored flat-inline |
| `/docs/b` | 8704 | 4096 | 4045 | 51 |
| `/docs/assets/c` | 5000 | 4096 | 4059 | 37 |

The file data, metadata and block padding together occupy a 12,288-byte image.
The explorer reads its recorded physical locations and inode layouts; it does
not estimate a compression ratio or compress data in the browser.

Field layouts and mapping semantics are grounded in erofs-utils
`include/erofs_fs.h`, `lib/zmap.c` and `lib/decompress.c`. The example records were
checked against the image bytes and decoded back to their original files.
