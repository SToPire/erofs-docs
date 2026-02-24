# Core On-Disk Format

## Overview

The EROFS core on-disk format is designed to be **as simple as possible**, since
one of the basic use cases of EROFS is as a drop-in replacement for
[tar](https://pubs.opengroup.org/onlinepubs/007908799/xcu/tar.html) or
[cpio](https://pubs.opengroup.org/onlinepubs/007908799/xcu/cpio.html):

![EROFS core on-disk format](../_static/erofs_core_format.svg)

The format design principles are as follows:

 - Data (except for _inline data_) is always block-based; metadata is not strictly block-based.

 - There are **no centralized inode or directory tables**. These are not
   suitable for image incremental updates, metadata flexibility, and
   extensibility. It is up to users to determine whether inodes or directories
   are arranged one by one or not.

 - I/O amplification from **extra metadata access** should be as small as
   possible.

There are _only **three** on-disk components to form a full filesystem tree_:
`erofs_super_block`, `erofs_inode_{compact,extended}`, and `erofs_dirent`.
If [extended attribute](https://man7.org/linux/man-pages/man7/xattr.7.html)
support also needs to be considered, the additional components will still be
limited.

Note that only `erofs_super_block` needs to be kept at a fixed offset, as
mentioned below.

(on_disk_superblock)=
## Superblock

The EROFS superblock is located at a fixed absolute offset of **1024 bytes**.
Its base size is 128 bytes. When `sb_extslots` is non-zero, the total superblock
size is `128 + sb_extslots × 16` bytes. The first 1024 bytes are currently unused,
which allows for support of other advanced formats based on EROFS, as well as
the installation of x86 boot sectors and other oddities.

### Field Definitions

| Offset | Size | Name                     | Description |
|--------|------|--------------------------|-------------|
| 0x00   | 4    | `magic`                  | Magic signature: `0xE0F5E1E2` |
| 0x04   | 4    | `checksum`               | CRC32-C checksum of the superblock block; see [Superblock Checksum](#superblock-checksum) |
| 0x08   | 4    | `feature_compat`         | Compatible feature flags; see [Feature Flags](#feature-flags) |
| 0x0C   | 1    | `blkszbits`              | Block size = `2^blkszbits`; minimum 9 |
| 0x0D   | 1    | `sb_extslots`            | Number of 16-byte superblock extension slots |
| 0x0E   | 2    | `rootnid_2b`             | Root directory NID (16-bit); see [Root NID Encoding](#root-nid-encoding) |
| 0x0E   | 2    | `blocks_hi`              | High 16 bits of total block count; see [Block Count Encoding](#block-count-encoding) |
| 0x10   | 8    | `inos`                   | Total valid inode count |
| 0x18   | 8    | `epoch`                  | Filesystem creation time, seconds since UNIX epoch |
| 0x20   | 4    | `fixed_nsec`             | Nanoseconds component of `epoch` |
| 0x24   | 4    | `blocks_lo`              | Low 32 bits of total block count; see [Block Count Encoding](#block-count-encoding) |
| 0x28   | 4    | `meta_blkaddr`           | Start block address of the metadata area |
| 0x2C   | 4    | `xattr_blkaddr`          | Start block address of the shared xattr area; see {ref}`shared_xattr_area` |
| 0x30   | 16   | `uuid`                   | 128-bit UUID for the volume |
| 0x40   | 16   | `volume_name`            | Filesystem label (not null-terminated if 16 bytes) |
| 0x50   | 4    | `feature_incompat`       | Incompatible feature flags; see [Feature Flags](#feature-flags) |
| 0x54   | 2    | `available_compr_algs`   | Bitmap of algorithms that have per-algorithm config records in the metadata area (`EROFS_FEATURE_INCOMPAT_COMPR_CFGS` set); see [Compression Configuration](#compression-configuration) |
| 0x54   | 2    | `lz4_max_distance`       | Customised LZ4 sliding-window size; 0 = default; see [Compression Configuration](#compression-configuration) |
| 0x56   | 2    | `extra_devices`          | Number of external devices; 0 = none; see [External Device Table](#external-device-table) |
| 0x58   | 2    | `devt_slotoff`           | Start slot offset of the external device table; see [External Device Table](#external-device-table) |
| 0x5A   | 1    | `dirblkbits`             | Directory block size = `2^(blkszbits + dirblkbits)`; currently always 0 |
| 0x5B   | 1    | `xattr_prefix_count`     | Total number of long xattr name prefixes; see {ref}`long_xattr_prefixes` |
| 0x5C   | 4    | `xattr_prefix_start`     | Start address of the long xattr prefix table; see {ref}`long_xattr_prefixes` |
| 0x60   | 8    | `packed_nid`             | NID of the packed inode for fragment storage; see [Packed Inode](#packed-inode-packed_nid) |
| 0x68   | 1    | `xattr_filter_reserved`  | Reserved; must be 0, otherwise xattr bloom filter is disabled unconditionally; see {ref}`xattr_filter` |
| 0x69   | 1    | `ishare_xattr_prefix_id` | Index into the long xattr prefix table for per-file SHA-256 content fingerprints; see {ref}`image_share_xattrs` |
| 0x6A   | 2    | `reserved`               | Reserved; must be 0 |
| 0x6C   | 4    | `build_time`             | Auxiliary 32-bit creation timestamp |
| 0x70   | 8    | `rootnid_8b`             | Root directory NID (64-bit); see [Root NID Encoding](#root-nid-encoding) |
| 0x78   | 8    | `reserved2`              | Reserved; must be 0 |
| 0x80   | 8    | `metabox_nid`            | NID of the metabox inode; see [Metabox Inode](#metabox-inode-metabox_nid) |
| 0x88   | 8    | `reserved3`              | Reserved; must be 0 |

Fields at offsets `0x80` and above are stored in superblock extension slots and
are valid only when `sb_extslots >= 1`.

### Magic Number

The magic number at offset 0x00 must be `0xE0F5E1E2` (little-endian). A reader must
reject any image whose first four bytes at offset 1024 do not match this value.

### Superblock Checksum

When `EROFS_FEATURE_COMPAT_SB_CHKSUM` is set, the `checksum` field contains a
CRC32-C digest. The digest is computed over the byte range `[1024, 1024 + block_size)`,
with the four bytes of the `checksum` field itself treated as zero during computation.

> For example, when `blkszbits` is 12 (block size is 4 KiB):
>
> | Offset | Size | Description                                    | Checksum covered |
> |--------|------|------------------------------------------------|------------------|
> | 0      | 1024 | Padding                                        | No               |
> | 1024   | 4    | Magic number                                   | Yes              |
> | 1028   | 4    | Checksum field in superblock, filled with zero | Yes              |
> | 1032   | 3064 | Remaining bytes in the filesystem block        | Yes              |

> **Tip:** Some implementations (e.g., `java.util.zip.CRC32C`) apply a final
> bit-wise inversion. If the superblock checksum does not match, try inverting it.

### Feature Flags

#### `feature_compat` — Compatible Feature Flags

A mount implementation that does not recognise a bit in `feature_compat` may still
mount the filesystem without loss of correctness.

| Bit mask     | Name                                        | Description |
|--------------|---------------------------------------------|-------------|
| `0x00000001` | `EROFS_FEATURE_COMPAT_SB_CHKSUM`            | Superblock CRC32-C checksum is present; see [Superblock Checksum](#superblock-checksum) |
| `0x00000002` | `EROFS_FEATURE_COMPAT_MTIME`                | Per-inode mtime is stored in extended inodes |
| `0x00000004` | `EROFS_FEATURE_COMPAT_XATTR_FILTER`         | Per-inode xattr bloom filter is present; see {ref}`xattr_filter` |
| `0x00000008` | `EROFS_FEATURE_COMPAT_SHARED_EA_IN_METABOX` | Shared xattr pool resides in the metabox inode; see {ref}`shared_xattr_area` |
| `0x00000010` | `EROFS_FEATURE_COMPAT_PLAIN_XATTR_PFX`      | Long xattr name prefix table stored as a standalone plain region; see {ref}`long_xattr_prefixes` |
| `0x00000020` | `EROFS_FEATURE_COMPAT_ISHARE_XATTRS`        | `ishare_xattr_prefix_id` is valid; per-file SHA-256 content fingerprint xattrs are present; see {ref}`image_share_xattrs` |

#### `feature_incompat` — Incompatible Feature Flags

A mount implementation that does not recognise any bit in `feature_incompat` must
refuse to mount the filesystem.

| Bit mask     | Name                                    | Description |
|--------------|-----------------------------------------|-------------|
| `0x00000001` | `EROFS_FEATURE_INCOMPAT_LZ4_0PADDING`   | Trailing zero-padding in compressed clusters |
| `0x00000002` | `EROFS_FEATURE_INCOMPAT_COMPR_CFGS`     | Compression configuration is present; see [Compression Configuration](#compression-configuration) |
| `0x00000002` | `EROFS_FEATURE_INCOMPAT_BIG_PCLUSTER`   | Pcluster can be a multiple of lcluster size; see {ref}`compressed_inode_layout` |
| `0x00000004` | `EROFS_FEATURE_INCOMPAT_CHUNKED_FILE`   | Chunk-based data layout; see {ref}`chunk_based_format` |
| `0x00000008` | `EROFS_FEATURE_INCOMPAT_DEVICE_TABLE`   | External device table is present; see {ref}`device_table` |
| `0x00000010` | `EROFS_FEATURE_INCOMPAT_ZTAILPACKING`   | Compressed tail data inlined into metadata block; see {ref}`compressed_inode_layout` |
| `0x00000020` | `EROFS_FEATURE_INCOMPAT_FRAGMENTS`      | Fragment packing via packed inode; see [Packed Inode](#packed-inode-packed_nid) |
| `0x00000020` | `EROFS_FEATURE_INCOMPAT_DEDUPE`         | Data block deduplication enabled |
| `0x00000040` | `EROFS_FEATURE_INCOMPAT_XATTR_PREFIXES` | Long xattr name prefix table; see {ref}`long_xattr_prefixes` |
| `0x00000080` | `EROFS_FEATURE_INCOMPAT_48BIT`          | Block addresses are extended from 32-bit to 48-bit; see [Root NID Encoding](#root-nid-encoding) |
| `0x00000100` | `EROFS_FEATURE_INCOMPAT_METABOX`        | Metabox inode for inline inode metadata; see [Metabox Inode](#metabox-inode-metabox_nid) |

### Root NID Encoding

Two fields encode the root directory NID, depending on whether
`EROFS_FEATURE_INCOMPAT_48BIT` is set:

- `rootnid_2b` (offset 0x0E, 16-bit): legacy root NID.
- `rootnid_8b` (offset 0x70, 64-bit): extended root NID. When this field is non-zero,
  it supersedes `rootnid_2b`. Valid only when `EROFS_FEATURE_INCOMPAT_48BIT` is set.

The `rootnid_2b` field shares a union with `blocks_hi` (the high 16 bits of the
total block count).

### Block Count Encoding

The total number of filesystem blocks is encoded as a 48-bit value:

```
total_blocks = (blocks_hi << 32) | blocks_lo
```

`blocks_hi` is valid only when `rootnid_8b` is non-zero (i.e. when
`EROFS_FEATURE_INCOMPAT_48BIT` is set), otherwise EROFS can index up to `2^32`
blocks (16 TiB with 4 KiB blocks).

### Filesystem Timestamps

The superblock contains three timestamp-related fields:

- `epoch`: the absolute Unix timestamp used as the counting base point. Compact
  inodes store `mtime` as a 32-bit offset relative to `epoch` rather than an
  absolute value.
- `build_time`: the filesystem creation time, stored as a 32-bit offset relative
  to `epoch`. Used as the `mtime` for special files and as the reference point for
  timestamp clamping or fixing.
- `fixed_nsec`: the nanoseconds component shared by all compact inodes, which have
  no per-inode nanosecond field. Extended inodes use their own `i_mtime_nsec` instead.

### Compression Configuration

Offset 0x54 is a 16-bit union with two interpretations:

- **`available_compr_algs`** : when `EROFS_FEATURE_INCOMPAT_COMPR_CFGS` is
  **set**, this field is a bitmap indicating which compression algorithms have
  per-algorithm configuration records stored in the metadata area immediately after
  the superblock block. This is the standard encoding for all new images.
- **`lz4_max_distance`** : when `EROFS_FEATURE_INCOMPAT_COMPR_CFGS` is
  **not set**, this field stores the customised LZ4 sliding-window size directly in
  the superblock; 0 means the LZ4 default. This encoding predates multi-algorithm
  support and applies only to LZ4-only images.

Each bit in `available_compr_algs` corresponds to one algorithm:

| Bit | Mask     | Constant                       | Algorithm |
|-----|----------|--------------------------------|-----------|
| 0   | `0x0001` | `Z_EROFS_COMPRESSION_LZ4`      | LZ4       |
| 1   | `0x0002` | `Z_EROFS_COMPRESSION_LZMA`     | LZMA      |
| 2   | `0x0004` | `Z_EROFS_COMPRESSION_DEFLATE`  | Deflate   |
| 3   | `0x0008` | `Z_EROFS_COMPRESSION_ZSTD`     | Zstandard |

For the layout of the per-algorithm configuration records that follow the superblock
block, see {ref}`compr_cfgs_records`.

### External Device Table

When `EROFS_FEATURE_INCOMPAT_DEVICE_TABLE` is set, the `extra_devices` superblock
field gives the number of additional block devices, described by 128-byte device
slot records at slot offset `devt_slotoff` within the metadata area. See
{ref}`device_table` for the full record layout and address resolution details.

### Special Inode NIDs

Some features reserve a dedicated special-purpose inode whose NID is recorded in
the superblock. These inodes do not appear in any directory and are referenced only
through the superblock fields listed below.

- `packed_nid`: NID of the packed inode. Valid when `EROFS_FEATURE_INCOMPAT_FRAGMENTS`
  is set. See [Packed Inode](#packed-inode-packed_nid).
- `metabox_nid`: NID of the metabox inode. Valid when `EROFS_FEATURE_INCOMPAT_METABOX`
  is set. See [Metabox Inode](#metabox-inode-metabox_nid).

(on_disk_inodes)=
## Inodes

Each on-disk inode must be aligned to a **32-byte inode slot** boundary, which is
set to be kept in line with the compact inode size. Given a NID `nid`, its inode can
be located in O(1) time by computing the absolute byte offset as follows (when
`EROFS_FEATURE_INCOMPAT_METABOX` is not set):

```
inode_offset = meta_blkaddr × block_size + 32 × nid
```

The NIDs for the root directory and special-purpose inodes are stored in the
superblock. Valid inode sizes are either **32 bytes** (compact) or **64 bytes**
(extended), distinguished by bit 0 of the `i_format` field.

### Compact Inode (32 bytes)

Defined as [`struct erofs_inode_compact`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/fs/erofs/erofs_fs.h):

| Offset | Size | Name             | Description |
|--------|------|------------------|-------------|
| 0x00   | 2    | `i_format`       | Inode format hints; see [`i_format` Field](#i_format-field) |
| 0x02   | 2    | `i_xattr_icount` | Inline xattr region size indicator |
| 0x04   | 2    | `i_mode`         | File type and permission bits |
| 0x06   | 2    | `i_nb`           | Union; see [`i_nb` Union](#i_nb-union) |
| 0x08   | 4    | `i_size`         | File size in bytes (32-bit) |
| 0x0C   | 4    | `i_mtime`        | Modification time, seconds relative to `epoch` |
| 0x10   | 4    | `i_u`            | Union; see [`i_u` Union](#i_u-union) |
| 0x14   | 4    | `i_ino`          | Inode serial number for 32-bit `stat(2)` compatibility |
| 0x18   | 2    | `i_uid`          | Owner UID (16-bit) |
| 0x1A   | 2    | `i_gid`          | Owner GID (16-bit) |
| 0x1C   | 4    | `i_reserved`     | Reserved; must be 0 |

### Extended Inode (64 bytes)

Defined as [`struct erofs_inode_extended`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/fs/erofs/erofs_fs.h):

| Offset | Size | Name              | Description |
|--------|------|-------------------|-------------|
| 0x00   | 2    | `i_format`        | Inode format hints; see [`i_format` Field](#i_format-field) |
| 0x02   | 2    | `i_xattr_icount`  | Inline xattr region size indicator |
| 0x04   | 2    | `i_mode`          | File type and permission bits |
| 0x06   | 2    | `i_nb`            | Union; see [`i_nb` Union](#i_nb-union) |
| 0x08   | 8    | `i_size`          | File size in bytes (64-bit) |
| 0x10   | 4    | `i_u`             | Union; see [`i_u` Union](#i_u-union) |
| 0x14   | 4    | `i_ino`           | Inode serial number for 32-bit `stat(2)` compatibility |
| 0x18   | 4    | `i_uid`           | Owner UID (32-bit) |
| 0x1C   | 4    | `i_gid`           | Owner GID (32-bit) |
| 0x20   | 8    | `i_mtime`         | Modification time, seconds since UNIX epoch |
| 0x28   | 4    | `i_mtime_nsec`    | Nanoseconds component of `i_mtime` |
| 0x2C   | 4    | `i_nlink`         | Hard link count (32-bit) |
| 0x30   | 16   | `i_reserved2`     | Reserved; must be 0 |

### `i_format` Field

The `i_format` field is present at offset 0x00 in both inode variants and encodes
layout metadata:

| Bits  | Width | Description |
|-------|-------|-------------|
| 0     | 1     | Inode version: 0 = compact (32-byte), 1 = extended (64-byte) |
| 1–3   | 3     | Data layout: values 0–4 are defined; 5–7 are reserved. See [Inode Data Layouts](#inode-data-layouts) |
| 4     | 1     | `EROFS_I_NLINK_1_BIT` (non-directory compact inodes) / `EROFS_I_DOT_OMITTED_BIT` (directory inodes) |
| 5–15  | 11    | Reserved; must be 0 |

Bit 4 has two mutually exclusive interpretations:

- **`EROFS_I_NLINK_1_BIT`** (non-directory compact inodes only): when set, the hard
  link count is implicitly 1 and `i_nb.nlink` need not be read, freeing `i_nb` for
  other uses such as `blocks_hi` or `startblk_hi`.
- **`EROFS_I_DOT_OMITTED_BIT`** (directory inodes only): when set, the `.` entry is
  omitted from the directory's dirent list to save space.

### `i_nb` Union

The `i_nb` field (2 bytes at offset 0x06) is interpreted based on the data layout
and whether `EROFS_I_NLINK_1_BIT` is set:

| Name               | Applicable when | Description |
|--------------------|-----------------|-------------|
| `i_nb.nlink`       | `EROFS_I_NLINK_1_BIT` unset (non-directory compact inodes) | Hard link count |
| `i_nb.blocks_hi`   | Compressed inodes | Total block count, high 16 bits |
| `i_nb.startblk_hi` | Flat inodes (`EROFS_INODE_FLAT_PLAIN`, `EROFS_INODE_FLAT_INLINE`) | Starting block number, high 16 bits |

### `i_u` Union

The `i_u` field (4 bytes at offset 0x10) is interpreted based on the data layout:

| Name              | Applicable when | Description |
|-------------------|-----------------|-------------|
| `i_u.startblk_lo` | Flat inodes | Starting block number, low 32 bits |
| `i_u.blocks_lo`   | Compressed inodes | Total block count, low 32 bits |
| `i_u.rdev`        | Character/block device inodes | Device ID |
| `i_u.c`           | Chunk-based inodes (`EROFS_INODE_CHUNK_BASED`) | Chunk info record; see {ref}`chunk_based_structures` |

### `i_xattr_icount` — Inline Xattr Region

When `i_xattr_icount` is 0, the inode has no xattrs. When non-zero, an inline xattr
region of `(i_xattr_icount − 1) × 4 + 12` bytes immediately follows the inode body.
The 12-byte fixed overhead comes from the inline xattr body header.
See {ref}`xattrs` for the full region layout.

### Special Inodes

(packed-inode-packed_nid)=
#### Packed Inode (`packed_nid`)

The packed inode is enabled by `EROFS_FEATURE_INCOMPAT_FRAGMENTS`. Its NID is stored
in the superblock field `packed_nid`. It is a normal inode whose data region is a
linear byte stream into which fragment data from multiple files is packed contiguously.
The packed inode itself may use compressed layouts, so the fragment data it contains
may itself be compressed.

The packed inode does not appear in any directory's entry list. It is referenced
exclusively via `h_fragmentoff` in the compression map header of inodes whose data
is wholly or partially stored as fragments.

(metabox-inode-metabox_nid)=
#### Metabox Inode (`metabox_nid`)

The metabox inode is enabled by `EROFS_FEATURE_INCOMPAT_METABOX`. Its NID is stored
in the superblock field `metabox_nid`. It is a normal inode whose data region stores
inode metadata for inodes embedded within it rather than occupying independent inode
slots in the metadata area. The metabox inode itself may use compressed layouts, so
the metadata blocks it contains may themselves be compressed. Its data region is
always accessed as a decoded byte stream.

A directory entry whose `nid` has bit 63 (`EROFS_DIRENT_NID_METABOX_BIT`) set refers
to an inode embedded in the metabox inode's decoded data region. The lower 63 bits
(`nid & EROFS_DIRENT_NID_MASK`) serve as the slot index; the inode is located at
`metabox_data_start + 32 × (nid & EROFS_DIRENT_NID_MASK)` rather than in the normal
metadata area. The metabox inode itself does not appear in any directory's entry list.

(inode_data_layouts)=
## Inode Data Layouts

The data layout of an inode is encoded in bits 1–3 of `i_format`. There are **five**
valid layouts in total:

### `EROFS_INODE_FLAT_PLAIN` (0)

`i_u` is interpreted as `startblk_lo` (the low 32 bits of the starting block
address). Combined with `i_nb.startblk_hi`, it forms a 48-bit starting block
address.

The inode's data lies in consecutive blocks starting from that address, occupying `⌈i_size / block_size⌉` consecutive blocks.

### `EROFS_INODE_COMPRESSED_FULL` (1)

The inode data region begins with a compression map header, followed by the logical
cluster index. See {ref}`compressed_inode_layout` for the full format.

### `EROFS_INODE_FLAT_INLINE` (2)

`i_u` is interpreted as `startblk_lo` (the low 32 bits of the starting block
address). Combined with `i_nb.startblk_hi`, it forms a 48-bit starting block
address.

The inode's data lies in consecutive blocks starting from that address, except for the tail part that is inlined in the block immediately following the inode metadata (and
its inline xattr region, if any).
If `i_size` is small enough that the entire content fits in the inline tail, there
are no preceding blocks and `i_u` is a don't-care field.

:::{note}
This layout is not allowed if the tail inode data block cannot be inlined.
:::

### `EROFS_INODE_COMPRESSED_COMPACT` (3)

A compact variant of the compressed layout. The map header and cluster index use
a narrower encoding to reduce metadata overhead for small files. See
{ref}`compressed_inode_layout` for the full format.

### `EROFS_INODE_CHUNK_BASED` (4)

The entire inode data is split into fixed-size chunks, each occupying consecutive
physical blocks. Requires `EROFS_FEATURE_INCOMPAT_CHUNKED_FILE`. `i_u` encodes a
chunk info record and an array of per-chunk address entries follows the inode body.
See {ref}`chunk_based_format` for the full format.

(on_disk_directories)=
## Directories

All on-disk directories are organised in the form of **directory blocks** of size
`2^(blkszbits + dirblkbits)` (currently `dirblkbits` is always 0).

### Directory Block Structure

Each directory block is divided into two contiguous regions:

1. A fixed-size array of directory entry records at the start of the block.
2. Variable-length filename strings packed at the end of the block, growing towards
   the entry array.

The `nameoff` field of the **first** entry in a block encodes the total number of
directory entries in that block:

```
entry_count = nameoff[0] / sizeof(erofs_dirent)
```

All entries within a directory block, including `.` and `..`, are stored in strict
**lexicographic (byte-value ascending) order** to enable an improved prefix binary
search algorithm.

### Directory Entry Record (12 bytes)

Defined as [`struct erofs_dirent`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/fs/erofs/erofs_fs.h):

| Offset | Size | Name        | Description |
|--------|------|-------------|-------------|
| 0x00   | 8    | `nid`       | Node number of the target inode; bit 63 is the metabox flag (see [Metabox Inode](#metabox-inode-metabox_nid)) |
| 0x08   | 2    | `nameoff`   | Byte offset of the filename within this directory block |
| 0x0A   | 1    | `file_type` | File type code (see below) |
| 0x0B   | 1    | `reserved`  | Reserved; must be 0 |

When `EROFS_FEATURE_INCOMPAT_METABOX` is set, bit 63 of `nid`
(`EROFS_DIRENT_NID_METABOX_BIT`) flags an inode embedded in the metabox inode.

#### `file_type` Values

| Value | Constant            | POSIX type |
|-------|---------------------|------------|
| 0     | `EROFS_FT_UNKNOWN`  | Unknown |
| 1     | `EROFS_FT_REG_FILE` | Regular file |
| 2     | `EROFS_FT_DIR`      | Directory |
| 3     | `EROFS_FT_CHRDEV`   | Character device |
| 4     | `EROFS_FT_BLKDEV`   | Block device |
| 5     | `EROFS_FT_FIFO`     | FIFO |
| 6     | `EROFS_FT_SOCK`     | Socket |
| 7     | `EROFS_FT_SYMLINK`  | Symbolic link |

### Filename Encoding

Filenames are stored as raw byte sequences and are **not** null-terminated. The
length of entry `i` is derived as:

- For all entries except the last: `nameoff[i+1] − nameoff[i]`.
- For the last entry in the block: `block_end − nameoff[last]`, where `block_end`
  is the first byte past the block. Any bytes between the end of the last filename
  and `block_end` must be filled with `0x00`.

No character encoding is mandated; UTF-8 is recommended.

:::{note}

Other alternative forms (e.g., `Eytzinger order`) were also considered (that is
why there was once [.*_classic](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/fs/erofs/namei.c?h=v5.4#n90)
naming). Here are some reasons those forms were not supported:

 - Filenames are variable-sized strings, which makes `Eytzinger order` harder
   to utilise unless `namehash` is also introduced, but that complicates the
   overall implementation and expands directory sizes.

 - It is harder to keep filenames and directory entries in the same directory
   block (especially _large directories_) to minimise I/O amplification.

 - `readdir(3)` would be impacted too if strict alphabetical order were required.

If there are better ideas to resolve these, the on-disk definition could be updated
in the future.

:::
