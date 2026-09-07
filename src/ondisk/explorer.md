# Layout Explorer

Explore three connected, horizontal strips: the whole EROFS filesystem, an
expanded inode/data interval, and its fields or directory content. Hover over a
region for a summary, or select it to inspect its fields and follow references.
The independent controls combine hardcoded layout JSON generated offline with
`mkfs.erofs`. Repeated structures and fields are shared in the data files; the
website does not publish a research parameter-case matrix or run mkfs.

All images use the same directory structure and file lengths as the original
recorded example, including when the filesystem block size changes:

```text
/
├── a                 768 B
└── docs/
    ├── b            8704 B
    └── assets/
        └── c        5000 B
```

Select a directory in the tree to inspect its entries. Follow their NIDs to a
child inode, or follow `..` to its parent. Directory entries contain `nid`
references and `nameoff` offsets into the directory block's name area. Names
belong to the directory, not the target inode.

Choose inode encoding, filesystem block size, flat/chunk/LZ4 data and xattr
storage independently. The controls retain their existing format dependencies.
Compact and extended inodes occupy 32 and 64 bytes; NIDs address 32-byte slots:
`meta_blkaddr * block_size + NID * 32`. The superblock begins at byte 1024.
The source file lengths and hierarchy stay fixed when options change.

Flat data supports the original file-tail inlining checkbox. The default
compact, 4-KiB, no-xattr layout uses four blocks with file-tail inlining and
seven without it. Xattrs can contain local entries, shared IDs or both, with
independent name-filter and long-prefix controls.

Chunk options select the chunk-size exponent, block map or eight-byte indexes,
an additional device, and B/C first-chunk sharing. Explicit device IDs require
eight-byte indexes. Sharing requires block-sized chunks at 512 B or 4 KiB.
Directory/data references navigate between primary and additional devices.

LZ4 supports inline compressed tails and compact/full compression indexes.
These are independent of the inode-encoding and xattr controls. Other compression
parameters remain at their defaults. The map header's `h_idata_size` gives the
inline encoded length; full indexes retain eight reserved bytes after that
header. The diagram follows the recorded per-inode data layout, including any
file that mkfs stored uncompressed.

Changing modes preserves the hidden controls' preferences. Reset restores the
original defaults. JSON is loaded on demand by data family and reused for
subsequent combinations; an older request cannot replace a newer selection.
The selected structures and calculated checksum were checked against the
offline image bytes, without a runtime filesystem allocator or compressor.

Strip widths are schematic; the displayed offsets, lengths and field values
come from the recorded structures. Sloping lines connect an interval's boundaries
to its expanded view. Reference buttons follow NIDs and data addresses. The
browser selects static snapshots; website builds and deployment do not require
`mkfs.erofs`.

See [Core on-disk format](core_ondisk.md), [Chunk-based inode layout](chunked_format.md),
[Compressed inode layout](compressed_format.md), and [Extended attributes](xattrs.md)
for field definitions and constraints.
