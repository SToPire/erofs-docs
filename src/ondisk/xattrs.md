(xattrs)=
# Extended Attributes (Xattrs)

EROFS supports [extended attributes](https://man7.org/linux/man-pages/man7/xattr.7.html)
for storing additional metadata as (name, value) pairs on individual inodes.

## Superblock Fields for Xattr Support

The EROFS superblock is located at a fixed absolute offset of **1024 bytes**.
Its base size is 128 bytes. When `sb_extslots` is non-zero, the total superblock
size is `128 + sb_extslots × 16` bytes. The first 1024 bytes are currently unused.

### Field Definitions

| Offset | Size | Name                     | Description |
|--------|------|--------------------------|-------------|
| 0x00   | 4    | `magic`                  | Magic signature: `0xE0F5E1E2` |
| 0x04   | 4    | `checksum`               | CRC32-C checksum of the superblock block |
| 0x08   | 4    | `feature_compat`         | Compatible feature flags; must have `EROFS_FEATURE_COMPAT_XATTR_FILTER` set for bloom filter |
| 0x0C   | 1    | `blkszbits`              | Block size = `2^blkszbits`; minimum 9 |
| 0x0D   | 1    | `sb_extslots`            | Number of 16-byte superblock extension slots |
| 0x0E   | 2    | `rootnid_2b`             | Root directory NID (16-bit) |
| 0x0E   | 2    | `blocks_hi`              | High 16 bits of total block count |
| 0x10   | 8    | `inos`                   | Total valid inode count |
| 0x18   | 8    | `epoch`                  | Filesystem creation time, seconds since UNIX epoch |
| 0x20   | 4    | `fixed_nsec`             | Nanoseconds component of `epoch` |
| 0x24   | 4    | `blocks_lo`              | Low 32 bits of total block count |
| 0x28   | 4    | `meta_blkaddr`           | Start block address of the metadata area |
| 0x2C   | 4    | `xattr_blkaddr`          | Start block address of the shared xattr area; see {ref}`shared_xattr_area` |
| 0x30   | 16   | `uuid`                   | 128-bit UUID for the volume |
| 0x40   | 16   | `volume_name`            | Filesystem label (not null-terminated if 16 bytes) |
| 0x50   | 4    | `feature_incompat`       | Incompatible feature flags; must have `EROFS_FEATURE_INCOMPAT_XATTR_PREFIXES` set for long prefix table |
| 0x54   | 2    | `available_compr_algs`   | Bitmap of compression algorithms |
| 0x56   | 2    | `extra_devices`          | Number of external devices |
| 0x58   | 2    | `devt_slotoff`           | Start slot offset of the external device table |
| 0x5A   | 1    | `dirblkbits`             | Directory block size = `2^(blkszbits + dirblkbits)`; currently always 0 |
| 0x5B   | 1    | `xattr_prefix_count`     | Total number of long xattr name prefixes; see {ref}`long_xattr_prefixes` |
| 0x5C   | 4    | `xattr_prefix_start`     | Start address of the long xattr prefix table; see {ref}`long_xattr_prefixes` |
| 0x60   | 8    | `packed_nid`             | NID of the packed inode for fragment storage |
| 0x68   | 1    | `xattr_filter_reserved`  | Must be 0 for bloom filter to work; see {ref}`xattr_filter` |
| 0x69   | 1    | `ishare_xattr_prefix_id` | Index into the long xattr prefix table for per-file SHA-256 content fingerprints; see {ref}`image_share_xattrs` |
| 0x6A   | 2    | `reserved`               | Reserved; must be 0 |
| 0x6C   | 4    | `build_time`             | Auxiliary 32-bit creation timestamp |
| 0x70   | 8    | `rootnid_8b`             | Root directory NID (64-bit) |
| 0x78   | 8    | `reserved2`              | Reserved; must be 0 |
| 0x80   | 8    | `metabox_nid`            | NID of the metabox inode |
| 0x88   | 8    | `reserved3`              | Reserved; must be 0 |

Fields at offsets `0x80` and above are stored in superblock extension slots and
are valid only when `sb_extslots >= 1`.

See {ref}`on_disk_superblock` in the core format for additional details.

Two storage classes exist:

- **Inline xattrs**: stored directly in the metadata block immediately following
  the inode body (and any inline data tail). They are private to the inode and
  encoded as a sequence of xattr entry records within the inline xattr region
  described by `i_xattr_icount`.
- **Shared xattrs**: stored once in the global shared xattr area. An inode references
  a shared entry through a 4-byte index stored immediately after the fixed
  12-byte inline xattr header.
  Multiple inodes that carry an identical xattr (same name and value) can reference
  the same shared entry, avoiding redundant per-inode copies.

To further reduce storage overhead for xattrs whose names share a common prefix
(for example `trusted.overlay.*` or `security.ima.*`), EROFS supports a long xattr
prefix table (`EROFS_FEATURE_INCOMPAT_XATTR_PREFIXES`). Each prefix entry records a
`base_index` that refers to one of the standard short namespace prefixes and an
additional infix string. An xattr entry whose `e_name_index` selects a long prefix
stores only the suffix that follows the full reconstructed prefix, rather than
repeating the prefix in every entry.

See {ref}`on_disk_inodes` for the `i_xattr_icount` field that governs the inline
xattr region size.

(inline_xattr_region)=
## Inline Xattr Region Layout

The inline xattr region immediately follows the inode body (at a 4-byte aligned
offset). Its total size is `(i_xattr_icount − 1) × 4 + 12` bytes, where 12 is the
fixed size of the inline xattr body header. The region is structured as:

1. The {ref}`inline_xattr_body_header` (12 bytes, fixed).
2. `h_shared_count` × 4-byte shared xattr index values.
3. Zero or more {ref}`xattr_entry_record` (inline entries).

(inline_xattr_body_header)=
### Inline Xattr Body Header

| Offset | Size   | Name            | Description |
|--------|--------|-----------------|-------------|
| 0x00   | 4      | `h_name_filter` | Inverted Bloom filter over xattr names; valid when `EROFS_FEATURE_COMPAT_XATTR_FILTER` is set; see {ref}`Xattr Filter <xattr_filter>` |
| 0x04   | 1      | `h_shared_count`| Number of shared xattr index entries|
| 0x05   | 7      | `h_reserved2`   | Reserved; must be 0 |

(xattr_entry_record)=
### Xattr Entry Record

Each inline or shared xattr entry has the following layout:

| Offset | Size   | Name           | Description |
|--------|--------|----------------|-------------|
| 0x00   | 1      | `e_name_len`   | Length of the name suffix in bytes |
| 0x01   | 1      | `e_name_index` | Namespace index (maps to a prefix string); see below |
| 0x02   | 2      | `e_value_size` | Length of the value in bytes |

Immediately following the 4-byte xattr entry header: `e_name_len` bytes of name
suffix, then `e_value_size` bytes of value. The entire entry (header + name + value)
is padded to a 4-byte boundary.

(e_name_index-namespace-mapping)=
#### `e_name_index` Namespace Mapping

Rather than storing the full namespace prefix string in every entry, EROFS encodes
the xattr namespace prefix as a 1-byte index. Bit 7 of `e_name_index` is the
`EROFS_XATTR_LONG_PREFIX` flag. When set, the lower 7 bits index into the long
xattr name prefix table (see {ref}`long_xattr_prefixes`).
When clear, the full byte selects one of the built-in short namespace prefixes:

| Value | Prefix |
|-------|--------|
| 1     | `user.` |
| 2     | `system.posix_acl_access` |
| 3     | `system.posix_acl_default` |
| 4     | `trusted.` |
| 6     | `security.` |

(shared_xattr_area)=
## Shared Xattr Area

Normally, the shared xattr area begins at block address `xattr_blkaddr`. Each shared
entry is an xattr entry record stored contiguously in this area. An inode references
a shared entry by its 32-bit index, stored in the inline xattr region immediately
after the 12-byte inline xattr header. The index is a byte offset within the
shared area divided by 4.

When `EROFS_FEATURE_COMPAT_SHARED_EA_IN_METABOX` is set, the shared xattr pool is
stored in the metabox inode's decoded data region rather than at `xattr_blkaddr`.

(long_xattr_prefixes)=
## Long Xattr Name Prefixes

This section applies when `EROFS_FEATURE_INCOMPAT_XATTR_PREFIXES` is set.

When this feature is set, a table of `xattr_prefix_count` prefix entries is stored
beginning at `xattr_prefix_start` (a byte address divided by 4). Each entry has the
following on-disk layout, padded to a 4-byte boundary:

| Offset | Size       | Name         | Description |
|--------|------------|--------------|-------------|
| 0x00   | 2          | `size`       | Byte length of the following content (`base_index` + `infix`) |
| 0x02   | 1          | `base_index` | Built-in short namespace prefix index (see {ref}`e_name_index-namespace-mapping`) |
| 0x03   | `size − 1` | `infix`      | Additional prefix string appended after the short prefix; not null-terminated |

The full reconstructed prefix is the concatenation of the short prefix indicated by
`base_index` and the `infix` bytes. An xattr entry using a long prefix stores only
the name suffix after the reconstructed prefix; `e_name_len` counts only those suffix
bytes.

For example, an xattr named `trusted.overlay.opaque` can be represented with
`base_index = 4` (`trusted.`) and `infix = "overlay."`, yielding the full prefix
`trusted.overlay.`; the stored name suffix is `opaque` with `e_name_len = 6`.

The xattr prefix table may be:
- embedded in the metabox or packed inode's data region (when `EROFS_FEATURE_COMPAT_PLAIN_XATTR_PFX` is not set), or
- stored as a standalone region located by `xattr_prefix_start` (when `EROFS_FEATURE_COMPAT_PLAIN_XATTR_PFX` is set).

(xattr_filter)=
## Xattr Filter

This section applies when `EROFS_FEATURE_COMPAT_XATTR_FILTER` is set.

When this feature is set, `h_name_filter` in the inline xattr body header holds a
32-bit inverted Bloom filter over the inode's xattr names. Each bit position
corresponds to one hash bucket:

- A bit value of **1** guarantees that no xattr present on this inode hashes to that
  bucket, so the queried name is **definitely absent**.
- A bit value of **0** means a matching xattr **may exist** and a full scan is
  required.

When `xattr_filter_reserved` in the superblock is non-zero, the bloom filter is
disabled unconditionally for all inodes in the image.

(image_share_xattrs)=
## Image-Share Xattrs

This section applies when `EROFS_FEATURE_COMPAT_ISHARE_XATTRS` is set.

When this feature is set, the superblock field `ishare_xattr_prefix_id` is valid
and identifies an entry in the long xattr prefix table. Regular files may carry an
xattr whose name equals the prefix identified by `ishare_xattr_prefix_id`
(i.e. `e_name_index` selects that entry and `e_name_len` is 0) and whose value is
a SHA-256 content fingerprint in the form `sha256:<hex-digest>`.

This convention enables tools to identify files with identical content across
different EROFS images by comparing these fingerprints.
