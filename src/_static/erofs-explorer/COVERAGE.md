# Layout Explorer model coverage

This inventory connects the on-disk documentation to the options implemented by
`documented-layouts.js`, `chunk-variants.js`, and `xattr-variants.js`. It describes
authored examples, not an image parser or a filesystem conformance suite.

The default compact 4 KiB flat/no-xattr case now uses recorded mkfs.erofs
images, with and without file-tail inlining. See [REAL-IMAGE.md](REAL-IMAGE.md)
for exact offsets, source settings and hashes. The remaining matrix describes
the illustrative model; it is not a claim of mkfs output for every combination.

Automated tests and their dependencies have been removed. This inventory
describes implemented examples, not current automated verification.

The matrix uses boundary values and dependent combinations. It does not claim
to enumerate the Cartesian product of all options, all numeric field values,
arbitrary directory trees, or every possible mkfs placement.

## Core structures

| Documentation chapter | Model option or behavior | Named cases / semantic checks |
|---|---|---|
| [Superblock / Field Definitions](../../ondisk/core_ondisk.md#field-definitions) | `blockSize`: 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536; `blkszbits=log2(B)` | `block-*`; inode metadata starts after the fixed-offset superblock even when B is 512 or 1024 |
| [Superblock](../../ondisk/core_ondisk.md#superblock) | `sbExtension`: 128-byte base or one 16-byte extension slot | `default`, `block-*`, `extended`; the example exposes zero/one slot, not every u8 slot count |
| [Superblock Checksum](../../ondisk/core_ondisk.md#superblock-checksum) | `checksum`: absent/present; SB_CHKSUM bit and an actual CRC over explicitly serialized example bytes | `block-*`; independent Python CRC calculation and `123456789` known vector |
| [Feature Flags](../../ondisk/core_ondisk.md#feature-flags) | `mtime`: modern mtime or legacy ctime meaning; field storage is retained | `ctime-compact`, `ctime-extended`, other cases with MTIME enabled |
| [blocks and inos Fields](../../ondisk/core_ondisk.md#blocks-and-inos-fields) | `counts`: `normal`, `blocks-zero`, `inos-zero`, `both-zero` | `counts-*`; zero statistics do not erase regions or invalidate NIDs |
| [Inodes](../../ondisk/core_ondisk.md#inodes) | `format`: `compact`/`extended`; NID always addresses 32-byte slots | `default`, `extended`, chunk cases; all inode positions checked against metadata base plus NID × 32 |
| [Compact Inode](../../ondisk/core_ondisk.md#compact-inode-32-bytes), [Extended Inode](../../ondisk/core_ondisk.md#extended-inode-64-bytes) | 32/64-byte inode and corresponding field widths; compact time comes from superblock fields | Field boundaries in every case; timestamp semantic assertions |
| [Inode Data Layouts](../../ondisk/core_ondisk.md#inode-data-layouts) | `dataLayout=flat`; `inline` allows eligible regular-file tails after the inode and complete xattr body | `size-mixed`, xattr cases, basic regressions |
| [FLAT_PLAIN / FLAT_INLINE](../../ondisk/core_ondisk.md#erofs-inode-flat-inline-2) | UI fixes `sampleSize` to `mixed`, preserving recorded sizes at 4 KiB blocks | `size-*`; file content modes are not exposed as controls |
| [Directories](../../ondisk/core_ondisk.md#directories) | UI fixes `directoryLayout` to `inline`, independent of regular-file chunking | /, /docs, /docs/assets each have their own inode and data; parent references and link counts follow the fixed tree |
| [file_type Values](../../ondisk/core_ondisk.md#file-type-values) | Fixed regular files and directories, with matching directory-entry hints | /a, /docs/b, /docs/assets/c; no selectable inode type or UNKNOWN hint |
| [i_u Union](../../ondisk/core_ondisk.md#i-u-union) | Character/block devices store encoded `rdev`; FIFO/socket have no ordinary file data; symlinks store target bytes | `type-char`, `type-block`, `type-fifo`, `type-socket`, `type-symlink` |
| [Filename Encoding](../../ondisk/core_ondisk.md#filename-encoding) | `nameEncoding`: `ascii`, `utf8`, `bytes`; `nameEnding`: `packed`/`padded` | Twelve `directory-*` cases; sorted byte strings, byte-based nameoff, and final-name padding |

The displayed block-size range is an application range, not a statement that
the disk format has a universal 64 KiB maximum. The document specifies a minimum;
a reader kernel is additionally limited by its page size. The superblock stays
at byte offset 1024 as block sizes change. A one-slot demonstration is likewise
not an assertion that larger extension counts are forbidden.

The checksum example uses the kernel/erofs-utils coverage rule: start at 1024,
with length `B - 1024` when `B > 1024`, otherwise length `B`. The checksum field is
zero during calculation. UUID, label, omitted fields and unused bytes are zero
in this explicitly described checksum example; this is not a checksum of a
generated image. EROFS's accumulator has no final XOR, so the known input
`123456789` produces the unfinalized remainder `0x1cf96d7c`; applying the final XOR
produces the standard finalized CRC32C value `0xe3069283`.

## Chunk layout and devices

| Documentation chapter | Model option or behavior | Named cases / semantic checks |
|---|---|---|
| [CHUNK_BASED](../../ondisk/chunked_format.md#erofs-inode-chunk-based-4) | `dataLayout=chunked`; CHUNKED_FILE bit; `i_u.c.format` and reserved half replace the flat-address union | `chunks-*` |
| [Chunk Info Summary](../../ondisk/chunked_format.md#chunk-info-summary) | `chunkBits`: every integer 0–31; chunk size `B × 2^chunkBits` | Combined-model cases use 0, 1, 31; planner preflight also exercised all 32 exponents |
| [Chunk Entry Formats](../../ondisk/chunked_format.md#chunk-entry-formats) | `chunkFormat=blockmap` (4 B) / `indexes` (8 B) | `chunks-blockmap-*`, `chunks-indexes-*`; count `ceil(file_size/chunk_size)` and array alignment |
| [Device Table](../../ondisk/chunked_format.md#device-table) | `deviceMode`: `primary`, `unified`, `explicit`; one extra-device example and one 128-byte slot | `chunks-*-primary-*`, `chunks-*-unified-*`, `chunks-indexes-explicit-*` |
| [Block Address Resolution](../../ondisk/chunked_format.md#block-address-resolution-for-chunk-based-inodes) | Unified entries use ID 0 and subtract uniaddr on an extra-device match; explicit ID 1 uses device-local blocks; unmatched unified addresses remain primary | Entry-to-payload offsets checked within each address space |
| [Chunk-based overview](../../ondisk/chunked_format.md) | `sharing`: two complete identical logical chunks reference one physical payload | `sharing-*`; one shared region, two consumers, references back to both entries |

Chunking disables flat inline tails. Explicit device selection requires the
8-byte format; normalization selects that format and the UI disables the 4-byte
choice. A chunk occupies consecutive blocks internally, while different chunks
may be noncontiguous. EOF padding is excluded from payload size.

The current sharing fixture uses the first block-sized chunk of regular B and C.
Normalization enables it only for exponent 0, regular/unknown B, and mixed size.
That fixture restriction is not an on-disk restriction on shared chunk sizes.
The planner supports one additional device in these examples; it does not
claim to exhaust every legal extra_devices count or device-table placement.

## Extended attributes

| Documentation chapter | Model option or behavior | Named cases / semantic checks |
|---|---|---|
| [Inode Fields / Inline Xattr Region Layout](../../ondisk/xattrs.md#inline-xattr-region-layout) | `xattrs`: `none`, `inline`, `shared` (local + shared), `shared-only` | `xattrs-*`; complete ibody precedes inline data or the aligned chunk array |
| [Inline Xattr Body Header](../../ondisk/xattrs.md#inline-xattr-body-header) | Fixed 12-byte header, shared count and 4-byte IDs, then local entries | Nested-record containment and field bounds; shared references resolve to complete entries |
| [Xattr Entry Record](../../ondisk/xattrs.md#xattr-entry-record) | Header + suffix + value, aligned to 4 B; zero-length suffixes for ACL/image-share examples | Namespace/prefix cases; field sizes and containing-record bounds |
| [Namespace Mapping](../../ondisk/xattrs.md#e-name-index-namespace-mapping) | `xattrNamespace`: `user`, `trusted`, `security`, `acl-access`, `acl-default` | `namespace-*`; indexes 1, 4, 6, 2, 3; additional `acl-*-directory` cases check directory B's ACL body and access permissions |
| [Shared Xattr Area](../../ondisk/xattrs.md#shared-xattr-area) | `sharedStorage`: `primary`/`metabox`; shared IDs are 4-byte offsets, not entry ordinals | `prefix-*-primary`, `prefix-*-metabox`; target offset and address space checked |
| [Long Xattr Name Prefixes](../../ondisk/xattrs.md#long-xattr-name-prefixes) | Prefix flag, table count, record size/base index/infix, `0x80 | ordinal` name indexes | `prefix-*`; long-name entries reference their table record |
| [Prefix Table Placement](../../ondisk/xattrs.md#prefix-table-placement) | `prefixStorage`: `off`, `standalone`, `physical-fallback`, `packed`, `metabox`; start field counts 4-byte units | Eight legal prefix/shared-storage combinations; physical/decoded-space distinction and PLAIN flag differences |
| [Xattr Filter](../../ondisk/xattrs.md#xattr-filter) | `xattrFilter`: `off`, `on`, `reserved`; nonzero superblock reserved field disables an otherwise stored filter | `filter-*`; feature bits, disabled-state storage, and independent native XXH32 vectors for short/long names |
| [Image-share Xattrs](../../ondisk/xattrs.md#image-share-xattrs) | `imageShare`: both feature dependencies; table ordinal; zero stored suffix; example fingerprint value | Prefix cases and `fingerprint-type-*`; fingerprints only on regular/unknown-hint files |

Shared-only storage can still carry prefix and fingerprint entries in the
shared pool. Default ACL examples are restricted to directories. Image-share
fingerprints contain a 7-byte `sha256:` prefix and 32 raw digest bytes in the
source-backed example. They are illustrative values, not computed content
hashes. This byte representation is distinguished from a human-readable hex
rendering.

Physical fallback leaves PLAIN_XATTR_PFX clear and uses primary-image offsets
when neither metabox nor a packed inode supplies the prefix stream. It has the
same physical placement as a standalone table but different feature flags.
It cannot coexist with metabox routing; normalization selects metabox instead.

Advanced xattr controls require xattrs. Shared storage controls require shared
entries. Image-share requires a long-prefix table. Packed-prefix selection is
unavailable when metabox routing takes precedence; normalization selects metabox.
Metabox use requires a superblock extension containing its helper inode NID.

`primary` and `device-1` are physical address spaces. `packed` and `metabox` are
decoded offsets within special inodes; an equal numerical offset in another
space is not an overlap. Their physical backing is shown separately. The model
uses uncompressed backing for these examples; it does not model the compression
algorithm or compressed indexes of those helper inodes.

## Reference-only and excluded inputs

| Mentioned topic | Coverage status |
|---|---|
| 48-bit layout, high address fields, alternative root-NID encoding | Reference only. The source Markdown identifies extension-specific fields but does not define a complete 48-bit visual model. |
| Compressed file layouts and metadata compression | Reference only. Decoded packed/metabox views do not implement compressed on-disk indexes or codec behavior. |
| Hole/null-address chunks | Reader-source reference only; the current on-disk Markdown does not define the sentinel or its mapping semantics. No hole option is offered. |
| Reserved datalayouts 5–7 and illegal reserved feature bits | Unsupported inputs, not usable variants. The model does not manufacture valid layouts for them. |
| Eytzinger directory ordering | The documentation describes a rejected alternative. It is not a supported directory-layout option. |

`xattrFilter=reserved` is different from enabling illegal reserved layout bits:
the documentation explicitly defines the nonzero field as a filter-disable
condition, so it is included as a valid demonstration.

## Verification boundary

The examples illustrate the documented options and their dependencies.
There is no automated test suite in this repository.
