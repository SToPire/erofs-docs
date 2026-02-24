(chunk_based_format)=
# Chunk-Based File Format

The chunk-based file format allows large files to be split into fixed-size chunks,
each backed by consecutive physical blocks. This enables efficient deduplication
and multi-device storage by addressing each chunk independently.

Requires `EROFS_FEATURE_INCOMPAT_CHUNKED_FILE` in the superblock
`feature_incompat` field. See {ref}`on_disk_inodes` for the inode layout and the
`i_u.c` field that carries the chunk info record.

(chunk_based_structures)=
## Chunk-Based Structures

### Chunk Info Record

When the data layout is `EROFS_INODE_CHUNK_BASED`, the `i_u` field (4 bytes at
inode offset 0x10) is interpreted as a chunk info record:

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
address offset. See [Address Resolution for Chunk-Based Inodes](#address-resolution-for-chunk-based-inodes).

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
