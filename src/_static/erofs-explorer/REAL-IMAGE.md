# Recorded nested-directory layout

Tool: mkfs.erofs 1.9.4-g0e4884ca. The browser uses a recorded snapshot,
not a runtime mkfs invocation or an uploaded-image parser.

The commands below were used offline before committing to establish the reference
layout. They are provenance records, not repository build or deployment steps.
Do not automate them as part of the website; ship the reviewed static results.

Source tree: /a (768 B), /docs/b (8704 B), /docs/assets/c (5000 B).
Contents: 48 lines of 15 a characters, 544 lines of 15 b characters,
500 lines of 9 c characters; each line ends in LF.
Directories use mode 0755, files 0644, with no xattrs.

```sh
mkfs.erofs -b4096 -T1700000000 --all-root --workers=1 \
  -U11111111-2222-3333-4444-555555555555 default.erofs source
mkfs.erofs -b4096 -T1700000000 --all-root --workers=1 \
  -U11111111-2222-3333-4444-555555555555 -Enoinline_data noinline.erofs source
```

Both uncompressed images have six 32-byte inodes, metadata base 0, root NID 36,
and SB_CHKSUM + MTIME enabled. fsck extraction matched the original files.

| Path | Default offset / NID | No-inline offset / NID |
|---|---|---|
| / | 1152 / 36 | 1152 / 36 |
| /a | 1248 / 39 | 1248 / 39 |
| /docs | 2048 / 64 | 1280 / 40 |
| /docs/assets | 2144 / 67 | 1376 / 43 |
| /docs/b | 2240 / 70 | 1472 / 46 |
| /docs/assets/c | 2784 / 87 | 1504 / 47 |

Default: 4 blocks / 16384 B. Block 0 contains all inodes, directories,
all of a, and the tails of b/c. Blocks 1–2 hold b's full blocks; block 3 holds
c's full block.

No-inline: 7 blocks / 28672 B. Directories remain inline in block 0.
Block 1 holds a, blocks 2–4 hold b, blocks 5–6 hold c, with tail padding.

SHA-256:

- default.erofs: 3ed6b98384a6af6614d1a7b035b553ec6af9315245a83f8733b75f176d1ba9a3
- noinline.erofs: b629e74ca41cda7bf6562764321092262ce3fc033b6463bd7f64448b68e10470

recorded-images.js retains the original superblock/inode bytes.
recorded-layout.js derives physical locations, fields, NIDs and groups.
These snapshots apply to compact 4 KiB flat files without xattrs, mixed-size
content, inline directories, ASCII names and unpadded final names.
Other combinations use the illustrative model and are labelled accordingly.
Widths are schematic in both modes; recorded physical offsets are exact.
