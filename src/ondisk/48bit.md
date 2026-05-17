(on_disk_48bit)=
# 48-bit Extensions

The `EROFS_FEATURE_INCOMPAT_48BIT` extension reinterprets several fields from the
[Core On-disk Format](core_ondisk.md) to support larger block addresses, larger
root NIDs, and compact-inode timestamps.

## Activation

This extension is enabled when bit `0x00000080`
(`EROFS_FEATURE_INCOMPAT_48BIT`) is set in the superblock `feature_incompat`
field.

## Superblock Field Reinterpretation

When `EROFS_FEATURE_INCOMPAT_48BIT` is set, the following superblock fields are
reinterpreted:

| Offset | Size | Type   | Core meaning       | 48-bit meaning |
|--------|------|--------|--------------------|----------------|
| 0x0E   | 2    | `u16`  | `rootnid`          | `blocks_hi` |
| 0x18   | 8    | `u64`  | `build_time`       | `epoch` |
| 0x20   | 4    | `u32`  | `build_time_nsec`  | `fixed_nsec` |
| 0x24   | 4    | `u32`  | `blocks`           | `blocks_lo` |
| 0x6C   | 4    | `u32`  | `reserved`         | `build_time` |
| 0x70   | 8    | `u64`  | `reserved`         | `rootnid_8b` |

(on_disk_48bit_root_nid_encoding)=
## Root NID Encoding

Two fields encode the root directory NID when `EROFS_FEATURE_INCOMPAT_48BIT` is
set:

- `rootnid` (offset 0x0E, 16-bit): legacy root NID.
- `rootnid_8b` (offset 0x70, 64-bit): extended root NID. When this field is
  non-zero, it supersedes `rootnid`.

The core `rootnid` field at offset 0x0E shares a union with `blocks_hi`.

(on_disk_48bit_block_count_encoding)=
## Block Count Encoding

The total number of filesystem blocks is encoded as a 48-bit value:

```
total_blocks = (blocks_hi << 32) | blocks_lo
```

`blocks_hi` is valid only when `rootnid_8b` is non-zero, otherwise the image can
index up to `2^32` filesystem blocks.

## Filesystem Timestamps

When `EROFS_FEATURE_INCOMPAT_48BIT` is set, the following timestamp-related
fields are defined in the superblock:

- `epoch`: the base Unix timestamp used for compact-inode timestamps.
- `build_time`: the filesystem creation time, stored as a 32-bit offset relative
  to `epoch`. It is used as the `mtime` for special files and as the reference
  point for timestamp clamping or fixing.
- `fixed_nsec`: the nanoseconds component shared by compact inodes, which have no
  per-inode nanosecond field.

Extended inodes continue to use their own absolute `i_mtime` and
`i_mtime_nsec` fields.

## Inode Format Field Reinterpretation

The `i_format` field at bit 4 has the following meaning in 48-bit mode:

- **`EROFS_I_NLINK_1_BIT`** (non-directory compact inodes): when set, the hard
  link count is implicitly 1 and `i_nb.nlink` need not be read, freeing `i_nb` for
  use as `i_nb.startblk_hi` to store the high 16 bits of the block address in
  flat inodes. This flag is only meaningful for non-directory compact inodes.
- **`EROFS_I_DOT_OMITTED_BIT`** (directory inodes): when set, the `.` entry is
  omitted from the directory's dirent list to save space. This flag is only
  meaningful for directory inodes.

These two interpretations are mutually exclusive depending on the inode type.

(i_nb-union)=
### `i_nb` Union Reinterpretation

The `i_nb` field (2 bytes at offset 0x06) has different interpretations in 48-bit
mode:

| Name                | Applicable when | Description |
|---------------------|-----------------|-------------|
| `i_nb.nlink`        | Non-directory compact inodes with `EROFS_I_NLINK_1_BIT` clear | Hard link count |
| `i_nb.startblk_hi`  | Non-directory compact flat inodes with `EROFS_I_NLINK_1_BIT` set | High 16 bits of starting block address |

When `EROFS_I_NLINK_1_BIT` is set in non-directory compact flat inodes, the field
is repurposed to hold the high 16 bits of the block address, allowing 48-bit
block addressing.

## Compact Inode Field Reinterpretation

When `EROFS_FEATURE_INCOMPAT_48BIT` is set, the following compact-inode fields
are reinterpreted:

| Offset | Size | Type  | Core meaning | 48-bit meaning |
|--------|------|-------|--------------|----------------|
| 0x06   | 2    | `u16` | `i_nb.nlink` | `i_nb.startblk_hi` for non-directory compact flat inodes when `EROFS_I_NLINK_1_BIT` is set |
| 0x0C   | 4    | `u32` | `reserved`   | `i_mtime` |
| 0x10   | 4    | `u32` | `i_u.startblk` | `i_u.startblk_lo` |

### Compact Inode Timestamps

In compact inodes, `i_mtime` stores the modification time in seconds relative to
`epoch`:

```
mtime = epoch + i_mtime
```

`fixed_nsec` supplies the nanoseconds component for all compact inodes.

### Flat Inode Starting Block Encoding

For extended flat inodes, and for non-directory compact flat inodes with
`EROFS_I_NLINK_1_BIT` set, the full 48-bit starting block address is:

```
startblk = (startblk_hi << 32) | startblk_lo
```

where:

- `startblk_hi` is stored in `i_nb.startblk_hi`.
- `startblk_lo` is stored in `i_u.startblk_lo`.

For compact flat inodes, if `EROFS_I_NLINK_1_BIT` is clear, only the low 32 bits
are available in the core format.

(chunk-based_48bit_extensions)=
## Chunk-based Address Extensions

The 48-bit extension also affects the chunk-based layout defined in
{doc}`Chunk-based File Format <chunked_format>`.

### Chunk Info Record

In chunk-based inodes, bit 6 of the chunk info record is
`EROFS_CHUNK_FORMAT_48BIT`. It is meaningful only when
`EROFS_CHUNK_FORMAT_INDEXES` is set.

When `EROFS_CHUNK_FORMAT_48BIT` is set, chunk index entries carry the high
16 bits of each per-chunk starting block address.

### Chunk Index Entry (8 bytes)

When `EROFS_CHUNK_FORMAT_48BIT` is set, the chunk index entry uses the
following additional field:

| Offset | Size | Type  | Name          | Description |
|--------|------|-------|---------------|-------------|
| 0x00   | 2    | `u16` | `startblk_hi` | High 16 bits of the starting block address |

The low 32 bits remain stored in `startblk_lo`, and `device_id` retains the
same meaning defined in {doc}`Chunk-based File Format <chunked_format>`.

The full starting block address is:

```
startblk = (startblk_hi << 32) | startblk_lo
```

(device-table_48bit_extensions)=
### Device Table Extensions

When `EROFS_FEATURE_INCOMPAT_DEVICE_TABLE` is set, the 48-bit extension also
adds high bits to each 128-byte device slot record defined in
{doc}`Chunk-based File Format <chunked_format>`.

| Offset | Size | Type  | Name         | Description |
|--------|------|-------|--------------|-------------|
| 0x48   | 4    | `u32` | `blocks_hi`  | High 32 bits of the total block count |
| 0x4C   | 2    | `u16` | `uniaddr_hi` | High 16 bits of the unified starting block address |

The low bits remain stored in `blocks_lo` and `uniaddr_lo`. The full values are:

```
blocks  = (blocks_hi << 32) | blocks_lo
uniaddr = (uniaddr_hi << 32) | uniaddr_lo
```
