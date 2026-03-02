(erofs_ondisk_format)=
# EROFS On-Disk Format

EROFS uses a compact, block-aligned on-disk layout that is deliberately kept as
minimal as possible to maximise runtime performance and simplify implementation.
The entire filesystem tree is built from just three core on-disk structures:

- **Superblock** — located at a fixed offset of 1024 bytes; the sole
  structure at a fixed position in the image.
- **Compact/Extended inodes** — one record per file, device,
  symlink, or directory; addressed in O(1) time via a simple NID-to-offset formula.
- **Directory entries** — 12-byte records, sorted lexicographically
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
xattrs
chunked_format
compressed_format
```
