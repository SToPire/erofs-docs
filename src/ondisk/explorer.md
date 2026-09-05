# Layout Explorer

Explore three connected, horizontal strips: the whole EROFS filesystem, an
expanded inode/data interval, and its fields or directory content. On the website, hover over a region
for a summary, or select it to inspect its fields in the details dock. The left
options dock controls inode encoding, file data layout, and xattr storage.
Advanced sections cover device addressing, directory storage, long xattr
prefixes, filters and fingerprints.

The example contains two nested subdirectories, with a file at every level:

```text
/
├── a
└── docs/
    ├── b
    └── assets/
        └── c
```

Select a directory in the example tree to inspect its entries. Follow their
NIDs to descend to a child inode, or follow `..` to its parent directory.

The examples use 4096-byte blocks. Compact and extended inodes occupy 32 and
64 bytes respectively, while NIDs always address 32-byte slots. The address is
`meta_blkaddr * block_size + NID * 32`.

Directories can store their entries inline or in external blocks. Their entries contain
`nid` references to the target inodes and `nameoff` references into the directory
block's name area. File names are part of the directory, not the file inode.

With file tail inlining enabled, eligible tails follow their inodes.
Switching between the two recorded images also changes inode and external-data
addresses, because mkfs packs the image again. Flat layouts have
no separate file index table. Chunk-based files instead use a per-chunk address
array after their inode metadata; choose a 4-byte block map or 8-byte chunk
index to inspect both forms. Chunk size is the block size multiplied by 2 to the selected exponent;
neighboring logical chunks may be placed in nonadjacent physical blocks. Device
views distinguish primary and extra-device physical addresses.

The default layout records a real mkfs.erofs image: all six compact inodes
share block 0 with the superblock, directory entries and inline data.
The image occupies 4 blocks; disabling inline file tails selects a second
recorded image of 7 blocks. Other option combinations are labelled illustrative.
Each strip is continuous and schematic, not to scale. The sloping lines connect the boundaries
of an upper interval to its expanded view below; they do not represent NID or
data-address references. Only the superblock has a fixed offset,
1024 bytes; there is no mandatory centralized inode or directory table.

Enable inline xattrs to place a 12-byte header and local name/value entry after
each inode. Inline + shared mode also places a shared xattr ID in that body and
stores the referenced entry once in the shared area. Xattrs precede inline data
and chunk indexes; any required chunk-index alignment is shown separately.

Advanced xattr options include shared-only storage, namespace selection, long
prefixes, name filters, and image-share fingerprints. Packed and metabox views
use decoded inode offsets, with physical backing shown in the primary view.
Core options demonstrate block sizes and inode formats. Names use ASCII and
the last name ends at the valid data end, matching the recorded images.
MTIME is enabled and statistics reflect the example's actual counts.

See [Core on-disk format](core_ondisk.md), [Chunk-based inode layout](chunked_format.md),
and [Extended attributes](xattrs.md) for field definitions and constraints.
