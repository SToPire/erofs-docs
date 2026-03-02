(chunk_based_format)=
# Chunk-Based File Format

The chunk-based file format allows large files to be split into fixed-size chunks,
each backed by consecutive physical blocks. This enables efficient deduplication
and multi-device storage by addressing each chunk independently.

## Superblock Fields for Chunked Files

The EROFS superblock is located at a fixed absolute offset of **1024 bytes**.
Its base size is 128 bytes. When `sb_extslots` is non-zero, the total superblock
size is `128 + sb_extslots × 16` bytes. The first 1024 bytes are currently unused.

### Field Definitions

| Offset | Size | Name                     | Description |
|--------|------|--------------------------|-------------|
| 0x00   | 4    | `magic`                  | Magic signature: `0xE0F5E1E2` |
| 0x04   | 4    | `checksum`               | CRC32-C checksum of the superblock block |
| 0x08   | 4    | `feature_compat`         | Compatible feature flags |
| 0x0C   | 1    | `blkszbits`              | Block size = `2^blkszbits`; minimum 9 |
| 0x0D   | 1    | `sb_extslots`            | Number of 16-byte superblock extension slots |
| 0x0E   | 2    | `rootnid_2b`             | Root directory NID (16-bit) |
| 0x0E   | 2    | `blocks_hi`              | High 16 bits of total block count |
| 0x10   | 8    | `inos`                   | Total valid inode count |
| 0x18   | 8    | `epoch`                  | Filesystem creation time, seconds since UNIX epoch |
| 0x20   | 4    | `fixed_nsec`             | Nanoseconds component of `epoch` |
| 0x24   | 4    | `blocks_lo`              | Low 32 bits of total block count |
| 0x28   | 4    | `meta_blkaddr`           | Start block address of the metadata area |
| 0x2C   | 4    | `xattr_blkaddr`          | Start block address of the shared xattr area |
| 0x30   | 16   | `uuid`                   | 128-bit UUID for the volume |
| 0x40   | 16   | `volume_name`            | Filesystem label (not null-terminated if 16 bytes) |
| 0x50   | 4    | `feature_incompat`       | Incompatible feature flags; must have `EROFS_FEATURE_INCOMPAT_CHUNKED_FILE` set |
| 0x54   | 2    | `available_compr_algs`   | Bitmap of compression algorithms |
| 0x56   | 2    | `extra_devices`          | Number of external devices; 0 = none; see {ref}`device_table` |
| 0x58   | 2    | `devt_slotoff`           | Start slot offset of the external device table; see {ref}`device_table` |
| 0x5A   | 1    | `dirblkbits`             | Directory block size = `2^(blkszbits + dirblkbits)`; currently always 0 |
| 0x5B   | 1    | `xattr_prefix_count`     | Total number of long xattr name prefixes |
| 0x5C   | 4    | `xattr_prefix_start`     | Start address of the long xattr prefix table |
| 0x60   | 8    | `packed_nid`             | NID of the packed inode for fragment storage |
| 0x68   | 1    | `xattr_filter_reserved`  | Reserved; must be 0 for xattr bloom filter to work |
| 0x69   | 1    | `ishare_xattr_prefix_id` | Index into the long xattr prefix table for per-file SHA-256 content fingerprints |
| 0x6A   | 2    | `reserved`               | Reserved; must be 0 |
| 0x6C   | 4    | `build_time`             | Auxiliary 32-bit creation timestamp |
| 0x70   | 8    | `rootnid_8b`             | Root directory NID (64-bit) |
| 0x78   | 8    | `reserved2`              | Reserved; must be 0 |
| 0x80   | 8    | `metabox_nid`            | NID of the metabox inode |
| 0x88   | 8    | `reserved3`              | Reserved; must be 0 |

Fields at offsets `0x80` and above are stored in superblock extension slots and
are valid only when `sb_extslots >= 1`.

See {ref}`on_disk_superblock` in the core format for additional details.

## Inode Data Layout for Chunked Files

The data layout of an inode is encoded in bits 1–3 of `i_format`.

### `EROFS_INODE_CHUNK_BASED` (4)

The entire inode data is split into fixed-size chunks, each occupying consecutive
physical blocks. Requires `EROFS_FEATURE_INCOMPAT_CHUNKED_FILE`. `i_u` encodes a
chunk info record and an array of per-chunk address entries follows the inode body.

(chunk_based_structures)=
## Chunk-Based Structures

When the data layout is `EROFS_INODE_CHUNK_BASED`, the `i_u` field (4 bytes at
inode offset 0x10) is interpreted as a chunk info record:

### Chunk Info Record

| Bits  | Width | Description |
|-------|-------|-------------|
| 0–4   | 5     | `chunkbits`: chunk size = `2^(blkszbits + chunkbits)` |
| 5     | 1     | `EROFS_CHUNK_FORMAT_INDEXES`: entry format selector (see below) |
| 6     | 1     | `EROFS_CHUNK_FORMAT_48BIT`: when set, chunk index entries use 48-bit block addresses; requires `EROFS_CHUNK_FORMAT_INDEXES` |
| 7–31  | 25    | Reserved; must be 0 |

An array of per-chunk address entries is stored immediately after the inode body
(and inline xattr region, if any). The number of entries is
`⌈i_size / chunk_size⌉`.

### Chunk Entry Formats

The `EROFS_CHUNK_FORMAT_INDEXES` bit in the chunk info record selects one of two
per-chunk entry formats:

#### Block Map Entry (4 bytes)

When `EROFS_CHUNK_FORMAT_INDEXES` is not set, each chunk is described by a
single 32-bit block address entry. 

Without a device table，this entry is a primary-device block address.
With `EROFS_FEATURE_INCOMPAT_DEVICE_TABLE`, it is interpreted in
the unified address space and can resolve to either the primary or an extra device.

| Offset | Size | Name          | Description |
|--------|------|---------------|-------------|
| 0x00   | 4    | `startblk` | Starting block address of this chunk on the primary device |

#### Chunk Index Entry (8 bytes)

When `EROFS_CHUNK_FORMAT_INDEXES` is set, each chunk is described by an 8-byte
record that supports multi-device addressing and 48-bit block addresses (when
used together with `EROFS_CHUNK_FORMAT_48BIT`).

| Offset | Size | Name          | Description |
|--------|------|---------------|-------------|
| 0x00   | 2    | `startblk_hi` | High 16 bits of the starting block address |
| 0x02   | 2    | `device_id`   | External device index; 0 = primary device |
| 0x04   | 4    | `startblk_lo` | Low 32 bits of the starting block address |

The full starting block address is `(startblk_hi << 32) | startblk_lo`. `device_id`
indexes into the external device table to resolve the physical device and unified
address offset. See {ref}`address-resolution-for-chunk-based-inodes`.

(multi_device_support)=
## Multi-Device Support

(device_table)=
### Device Table

This section applies when `EROFS_FEATURE_INCOMPAT_DEVICE_TABLE` is set.

When `EROFS_FEATURE_INCOMPAT_DEVICE_TABLE` is set, the `extra_devices` superblock
field gives the number of additional block devices. They are described by an array
of 128-byte device slot records. The array begins at slot offset `devt_slotoff`
within the metadata area, where each slot is 128 bytes.

Each record contains:

| Offset | Size   | Name           | Description |
|--------|--------|----------------|-------------|
| 0x00   | 64     | `tag`      | Device identifier (e.g. SHA-256 digest); not null-terminated |
| 0x40   | 4      | `blocks_lo`    | Low 32 bits of the total block count of this device |
| 0x44   | 4      | `uniaddr_lo`   | Low 32 bits of the unified starting block address of this device |
| 0x48   | 4      | `blocks_hi`    | High 32 bits of the total block count |
| 0x4C   | 2      | `uniaddr_hi`   | High 16 bits of the unified starting block address |
| 0x4E   | 50     | `reserved` | Reserved; must be 0 |

The total block count of the device is `(blocks_hi << 32) | blocks_lo`.
The base block address in the unified address space is
`(uniaddr_hi << 32) | uniaddr_lo`.

(address-resolution-for-chunk-based-inodes)=
### Address Resolution for Chunk-Based Inodes

#### Chunk Index Entry (8 bytes)

When the chunk index entry format is used, each entry carries an explicit
`device_id` that directly identifies the target device:

- `device_id = 0`: `startblk` is a block address on the primary device.
- `device_id = N` (1 ≤ N ≤ `extra_devices`): `startblk` is a block address on
  extra device N, whose slot is at `devt_slotoff + (N − 1)` in the metadata area.

#### Block Map Entry (4 bytes)

The simple block map entry format has no `device_id` field. Instead, `startblk`
is an absolute block address in the unified address space, and the reader uses
`uniaddr` from the device table to identify the target device: it finds the slot
`i` whose range `[uniaddr[i], uniaddr[i] + blocks[i])` contains `startblk`, then
derives the intra-device block address as `startblk − uniaddr[i]`.
