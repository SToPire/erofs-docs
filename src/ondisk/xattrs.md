(xattrs)=
# Extended Attributes (Xattrs)

EROFS supports [extended attributes](https://man7.org/linux/man-pages/man7/xattr.7.html)
for storing additional metadata as (name, value) pairs on individual inodes.

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

1. The [inline xattr body header](#inline-xattr-body-header) (12 bytes, fixed).
2. `h_shared_count` × 4-byte shared xattr index values.
3. Zero or more [xattr entry records](#xattr-entry-record) (inline entries).

(inline_xattr_body_header)=
### Inline Xattr Body Header

| Offset | Size   | Name            | Description |
|--------|--------|-----------------|-------------|
| 0x00   | 4      | `h_name_filter` | Inverted Bloom filter over xattr names; valid when `EROFS_FEATURE_COMPAT_XATTR_FILTER` is set; see [Xattr Filter](#xattr-filter-erofs_feature_compat_xattr_filter) |
| 0x04   | 1      | `h_shared_count`| Number of shared xattr index entries|
| 0x05   | 7      | `h_reserved2`   | Reserved; must be 0 |

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
xattr name prefix table (see
[Long Xattr Name Prefixes](#long-xattr-name-prefixes-erofs_feature_incompat_xattr_prefixes)).
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
See {ref}`on_disk_inodes` for the metabox inode description.

(long_xattr_prefixes)=
## Long Xattr Name Prefixes

This section applies when `EROFS_FEATURE_INCOMPAT_XATTR_PREFIXES` is set.

When this feature is set, a table of `xattr_prefix_count` prefix entries is stored
beginning at `xattr_prefix_start` (a byte address divided by 4). Each entry has the
following on-disk layout, padded to a 4-byte boundary:

| Offset | Size       | Name         | Description |
|--------|------------|--------------|-------------|
| 0x00   | 2          | `size`       | Byte length of the following content (`base_index` + `infix`) |
| 0x02   | 1          | `base_index` | Built-in short namespace prefix index (see [`e_name_index` Namespace Mapping](#e_name_index-namespace-mapping)) |
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
