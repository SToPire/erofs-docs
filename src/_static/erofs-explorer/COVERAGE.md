# Layout controls and static-data coverage

The original independent controls are available, including their legal
combinations. The browser resolves hardcoded, shared structure JSON generated
from offline mkfs results. It never runs mkfs and never substitutes a named
example for the settings the user chose.

| Controls | Scope / dependency |
|---|---|
| Inode encoding | Compact 32 B or extended 64 B, independent of compression indexes |
| Filesystem block size | 512 B, 4 KiB, 16 KiB; the source file lengths remain fixed |
| Flat file tails | Inline allowed or external; actual fit follows the recorded layout |
| Chunk format | Four-byte block map or eight-byte indexes |
| Chunk exponent | `0..30-log2(B)`, within this mkfs version's range |
| Extra device | Explicit device ID requires indexes; unified addressing remains unavailable in mkfs |
| B/C chunk sharing | Same first chunk; requires exponent 0 and B of 512 or 4096 |
| Xattr storage | None, inline, inline + shared, or shared IDs only |
| Name filter and long prefixes | Independent controls when xattrs are present |
| LZ4 compressed tails | Inline compressed tails on/off; independent of the flat-tail preference |
| Compression index format | Compact/full, independent of inode encoding |

Switching data modes hides inapplicable controls and preserves their preferences.
LZ4 keeps chunk options inactive; its existing block-size, inode and xattr
controls remain usable. Enabling tail inlining does not claim every tail is
inline: each inode's data layout, index flags and stored byte ranges determine
what the diagram shows. Full compression indexes expose the legacy layout.

The fixed tree has directories `/`, `/docs`, `/docs/assets` and files `/a`
(768 B), `/docs/b` (8704 B), `/docs/assets/c` (5000 B). CRC32C is calculated over
the actual selected structures and source bytes in the checksum block. Directory
links, shared xattrs, chunk references, compression indexes, inline streams and
external allocations retain the values checked against offline images.

The production JSON shares structure/field definitions and uses direct
block/chunk expressions. It does not contain a Cartesian case list, research
image collection, or generated JavaScript snapshot table. The exhaustive
comparison against research records is an offline validation activity only.

No new compression levels, pcluster tuning, fragments, metadata compression,
other codecs, arbitrary source trees or file sizes are exposed by this change.
