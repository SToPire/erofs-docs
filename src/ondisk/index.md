(erofs_ondisk_format)=
# EROFS On-Disk Format

EROFS uses a compact, block-aligned on-disk layout that is deliberately kept as
minimal as possible to maximise runtime performance and simplify implementation.
The entire filesystem tree is built from just three core on-disk structures:

- **`erofs_super_block`** — located at a fixed offset of 1024 bytes; the sole
  structure at a fixed position in the image.
- **`erofs_inode_compact` / `erofs_inode_extended`** — one record per file, device,
  symlink, or directory; addressed in O(1) time via a simple NID-to-offset formula.
- **`erofs_dirent`** — 12-byte directory entry records, sorted lexicographically
  within each directory block.

Optional features extend this foundation without breaking the core design:

- **{doc}`Extended attributes (xattrs) <xattrs>`** support per-inode metadata.
  Several mechanisms — including a shared xattr pool, long prefix tables, and a
  per-inode Bloom filter — keep storage overhead low even when xattrs are used
  extensively.
- **{doc}`Chunk-based layout <chunked_format>`** splits large files into
  fixed-size, independently-addressed chunks, enabling cross-file deduplication
  and multi-device storage.
- **{doc}`Compressed layout <compressed_format>`** is one of EROFS's core
  strengths. By applying **fixed-output-size compression**, each compressed block
  is always fully utilised, which minimises I/O amplification and allows compressed
  data to be cached and evicted at block granularity. This makes EROFS competitive
  in both read throughput and memory footprint compared to unaligned compression
  approaches, particularly on memory-constrained devices.

```{toctree}
:hidden:
core_ondisk
chunked_format
xattrs
compressed_format
```
