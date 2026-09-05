// Hand-authored example placements. No image is read or constructed.
export const BLOCK_SIZE = 4096;
export const BLOCK_COUNT = 12;
const B = BLOCK_SIZE;
const field = (name, offset, size, value, description) => ({ name, offset, size, value, description });
const reference = (target, label) => ({ target, label });
const files = [
    { key: 'a', label: 'File A', block: 2, nid: 128, size: 768, startBlock: 3 },
    { key: 'b', label: 'File B', block: 4, nid: 384, size: 8704, startBlock: 5 },
    { key: 'c', label: 'File C', block: 8, nid: 896, size: 5000, startBlock: 9 },
];

function inodeFields(extended, inline, size, startBlock, nid, directory = false) {
    const whollyInline = inline && size < B;
    const fields = [
        field('i_format', 0, 2, (extended ? 1 : 0) + (inline ? 4 : 0),
            `Bit 0 selects ${extended ? 'extended (1)' : 'compact (0)'}. Bits 1–3 select ${inline ? 'FLAT_INLINE (2)' : 'FLAT_PLAIN (0)'}.`),
        field('i_xattr_icount', 2, 2, 0, 'Inline xattr body size encoding. Zero: no extended attributes in this example.'),
        field('i_mode', 4, 2, directory ? '040755' : '0100644', 'File type and permissions, displayed in octal.'),
        field(extended ? 'reserved' : 'i_nlink', 6, 2, extended ? 0 : directory ? 2 : 1,
            extended ? 'Reserved in the extended inode.' : 'Number of hard links to this inode.'),
        field('i_size', 8, extended ? 8 : 4, size, 'Logical content length in bytes. Padding is not part of the content.'),
    ];
    if (!extended) fields.push(field('reserved', 12, 4, 0, 'Unused in this example without the 48-bit layout extension.'));
    fields.push(
        field('i_u.startblk', 16, 4, whollyInline ? 'Unused' : startBlock,
            whollyInline ? 'All content is inline; this field does not point to an external data block.' : 'Starting filesystem block of the contiguous external data. It is a block number, not a byte offset.'),
        field('i_ino', 20, 4, directory ? 1 : files.findIndex(f => f.nid === nid) + 2,
            'Serial number for stat compatibility. This is not the NID used to locate the inode.'),
        field('i_uid', 24, extended ? 4 : 2, 0, 'Owner user ID.'),
        field('i_gid', extended ? 28 : 26, extended ? 4 : 2, 0, 'Owner group ID.'),
    );
    if (extended) fields.push(
        field('i_mtime', 32, 8, 1700000000, 'Per-inode modification time, in seconds since the Unix epoch.'),
        field('i_mtime_nsec', 40, 4, 0, 'Nanosecond part of the modification time.'),
        field('i_nlink', 44, 4, directory ? 2 : 1, 'Number of hard links, stored in 32 bits in an extended inode.'),
        field('reserved', 48, 16, '0', 'Reserved bytes; zero in this example.'),
    );
    else fields.push(field('reserved', 28, 4, 0, 'Reserved bytes. Compact inodes use the shared superblock timestamp in this core-format example.'));
    return fields;
}

function preset(format, inline) {
    const extended = format === 'extended';
    const inodeSize = extended ? 64 : 32;
    const regions = [];
    const add = region => { regions.push({ fields: [], references: [], ...region }); return region; };
    add({ id: 'reserved-prefix', kind: 'unused', title: 'Reserved prefix', short: 'First 1024 B', start: 0, size: 1024,
        description: 'EROFS leaves the first 1024 bytes available for uses such as boot sectors. The superblock begins after this prefix.' });
    add({ id: 'superblock', kind: 'superblock', title: 'Superblock', short: 'Superblock', start: 1024, size: 128,
        description: 'The filesystem entry point. Its fixed byte offset is 1024; it provides the root NID, block size, and metadata base.',
        fields: [
            field('magic', 0, 4, '0xE0F5E1E2', 'EROFS format signature.'),
            field('checksum', 4, 4, 'Not enabled', 'CRC32-C when the SB_CHKSUM compatible feature is enabled. No checksum is constructed for this diagram.'),
            field('feature_compat', 8, 4, '0x00000002', 'Compatible features. This example uses MTIME, so timestamps describe modification time.'),
            field('blkszbits', 12, 1, 12, 'Block size is 2^12 = 4096 bytes.'),
            field('sb_extslots', 13, 1, 0, 'Extra 16-byte superblock slots; zero gives the 128-byte base structure.'),
            field('rootnid_2b', 14, 2, 0, 'NID of the root directory. Zero is a valid NID.'),
            field('inos', 16, 8, 4, 'Four inodes in this example: the root directory and three regular files.'),
            field('epoch', 24, 8, 1700000000, 'Shared time base, used by compact inodes in this core-format example.'),
            field('fixed_nsec', 32, 4, 0, 'Shared nanosecond component.'),
            field('blocks', 36, 4, BLOCK_COUNT, 'Number of blocks illustrated here; not a measured image size.'),
            field('meta_blkaddr', 40, 4, 1, 'Metadata addressing base. inode_offset = 1 × 4096 + NID × 32.'),
            field('xattr_blkaddr', 44, 4, 0, 'Shared xattr addressing base; no xattrs are shown.'),
            field('uuid', 48, 16, 'Example only', 'Filesystem UUID. The diagram does not assign a real volume UUID.'),
            field('volume_name', 64, 16, 'Example only', 'Filesystem label.'),
            field('feature_incompat', 80, 4, 0, 'No incompatible extensions are used in this core-format example.'),
            field('is_compressed', 84, 2, 0, 'No compression is used.'),
            field('dirblkbits', 90, 1, 0, 'Directory block size is the same as the filesystem block size.'),
        ], references: [reference('root-inode', 'Root directory · NID 0')],
        note: 'Fields use community format names. Values are explanatory examples, not bytes decoded from an image.', doc: 'superblock' });
    add({ id: 'root-inode', kind: 'inode', title: 'Root directory inode', short: 'Root inode', start: B, size: inodeSize,
        description: `A ${inodeSize}-byte ${format} inode. Its 66-byte directory content is inline immediately after the inode.`,
        fields: inodeFields(extended, true, 66, 0, 0, true),
        formula: `4096 + 0 × 32 = 4096`,
        references: [reference('superblock', 'Referenced by the superblock'), reference('directory', 'Directory entries and names')], doc: 'inodes', nid: 0 });
    add({ id: 'directory', kind: 'directory', title: 'Directory entries & names', short: 'Direntries + names', start: B + inodeSize, size: 66,
        description: 'Five 12-byte directory entries followed by six bytes of names. This directory stays inline in every preset.',
        fields: [
            field('nid', 0, 8, 128, 'Target inode NID; entry “a” points to File A. The name is stored here in the directory, not in that inode.'),
            field('nameoff', 8, 2, 63, 'Byte offset of the name from the logical directory block start, not from the enclosing physical block.'),
            field('file_type', 10, 1, 1, '1 = regular file; 2 = directory.'),
            field('reserved', 11, 1, 0, 'Reserved byte; zero.'),
        ], note: 'Field offsets are relative to one 12-byte direntry. Example values above describe entry “a”.',
        entries: [
            { name: '.', nid: 0, nameoff: 60, target: 'root-inode' },
            { name: '..', nid: 0, nameoff: 61, target: 'root-inode' },
            ...files.map((f, i) => ({ name: f.key, nid: f.nid, nameoff: 63 + i, target: `inode-${f.key}` })),
        ], formula: '5 × 12 B entries + 6 B names = 66 B',
        references: [reference('root-inode', 'Owned by the root inode'), ...files.map(f => reference(`inode-${f.key}`, `${f.label} · NID ${f.nid}`))], doc: 'directories' });

    for (const file of files) {
        const fullBlocks = Math.floor(file.size / B);
        const tailSize = file.size % B;
        const inodeId = `inode-${file.key}`;
        const contentIds = fullBlocks ? [...Array(fullBlocks)].map((_, i) => `data-${file.key}-${i}`).concat(`tail-${file.key}`) : [`data-${file.key}`];
        add({ id: inodeId, kind: 'inode', title: `${file.label} inode`, short: `${file.label} inode`, start: file.block * B, size: inodeSize,
            nid: file.nid, owner: file.label, description: `${format === 'compact' ? 'Compact' : 'Extended'} inode for ${file.size.toLocaleString('en-US')} bytes of file content. ${inline ? 'The final partial block is inline.' : 'All file data is external.'}`,
            fields: inodeFields(extended, inline, file.size, file.startBlock, file.nid),
            formula: `4096 + ${file.nid} × 32 = ${file.block * B}`,
            references: [reference('directory', 'Referenced by a directory entry'), ...contentIds.map((id, i) => reference(id, `${file.label} · ${i < fullBlocks ? `data block ${i + 1}` : 'tail data'}`))],
            note: 'NID addressing always uses 32-byte slots, including for 64-byte extended inodes.', doc: 'inodes' });
        for (let i = 0; i < fullBlocks; i++) {
            add({ id: `data-${file.key}-${i}`, kind: 'data', title: `${file.label} · data block ${i + 1}`, short: `${file.label} · data ${i + 1}`,
                start: (file.startBlock + i) * B, size: B, owner: file.label,
                description: `A complete external data block. Logical file bytes [${i * B}, ${(i + 1) * B}) are stored here.`,
                mapping: { logical: i * B, length: B, storage: 'External block', owner: `${file.label} inode` },
                formula: `physical = ${file.startBlock} × 4096 + logical offset`,
                references: [reference(inodeId, `${file.label} inode · NID ${file.nid}`)], doc: 'inode-data-layouts' });
        }
        add({ id: fullBlocks ? `tail-${file.key}` : `data-${file.key}`, kind: inline ? 'inline' : 'data', title: `${file.label} · ${inline ? 'inline ' : ''}${fullBlocks ? 'tail' : 'data'}`,
            short: `${file.label} · ${inline ? 'inline' : 'tail'}`, start: inline ? file.block * B + inodeSize : (file.startBlock + fullBlocks) * B,
            size: tailSize, owner: file.label,
            description: inline ? `${tailSize} bytes immediately after the inode. ${fullBlocks ? 'Full data blocks remain external.' : 'The entire file fits here; no external block is needed.'}` : `${tailSize} bytes of file content in an external block; the rest of that block is padding.`,
            mapping: { logical: fullBlocks * B, length: tailSize, storage: inline ? 'Inline, after inode' : 'External tail block', owner: `${file.label} inode` },
            formula: inline ? `physical = ${file.block * B} + ${inodeSize} + (logical offset − ${fullBlocks * B})` : `physical = ${file.startBlock} × 4096 + logical offset`,
            references: [reference(inodeId, `${file.label} inode · NID ${file.nid}`)], doc: 'inode-data-layouts' });
    }
    // Fill only the fixed illustrated address space; this is not an allocator.
    const blocks = Array.from({ length: BLOCK_COUNT }, (_, number) => {
        const start = number * B;
        const parts = regions.filter(r => r.start >= start && r.start < start + B).sort((a, b) => a.start - b.start);
        let cursor = start;
        const spans = [];
        for (const part of parts) {
            if (part.start > cursor) spans.push(add({ id: `gap-${cursor}`, kind: 'unused', title: 'Unused in this example', short: 'Unused', start: cursor, size: part.start - cursor, description: 'Space omitted from this explanatory placement. No free-space allocator or real image is being modeled.' }));
            spans.push(part);
            cursor = part.start + part.size;
        }
        if (cursor < start + B) spans.push(add({ id: `gap-${cursor}`, kind: 'unused', title: parts.length ? 'Padding / unused space' : 'Unused in this example', short: parts.length ? 'Padding / unused' : 'Unused in this example', start: cursor, size: start + B - cursor,
            description: 'These bytes do not contain a structure in this preset. Fixed example positions are kept so that changes remain easy to compare; mkfs is not required to preserve these gaps.' }));
        return { number, start, regions: spans };
    });
    return { format, inline, inodeSize, blocks, regions };
}

// The original four examples remain available to callers and regression tests.
export const PRESETS = Object.fromEntries(['compact', 'extended'].flatMap(format => [false, true].map(inline => [`${format}-${inline ? 'inline' : 'noinline'}`, preset(format, inline)])));

// Feature examples below are authored placements, not decoded image contents.
// Format evidence: Linux v6.18 fs/erofs/{erofs_fs.h,data.c,xattr.c} and
// the website's ondisk/{chunked_format,xattrs}.md. In particular:
// - data.c aligns the chunk array after both the inode body and xattr body;
// - erofs_xattr_ibody_size() encodes X = 12 + (i_xattr_icount - 1) * 4;
// - xattr.c places the ibody before inline data and resolves shared IDs in
//   4-byte units from xattr_blkaddr. Ordinary xattrs need no extra feature bit.
const align = (offset, unit) => Math.ceil(offset / unit) * unit;

function xattrEntryFields(suffix, value) {
    const used = 4 + suffix.length + value.length;
    const fields = [
        field('e_name_len', 0, 1, suffix.length, 'Length in bytes of the stored name suffix, excluding the namespace prefix.'),
        field('e_name_index', 1, 1, 1, '1 selects the built-in user. namespace. The prefix is not repeated in the stored name.'),
        field('e_value_size', 2, 2, value.length, 'Length of the attribute value in bytes.'),
        field('e_name', 4, suffix.length, suffix, `Stored suffix; the complete attribute name is user.${suffix}. No NUL terminator is stored.`),
        field('e_value', 4 + suffix.length, value.length, value, 'Value bytes immediately follow the name suffix; no alignment or NUL terminator is inserted between them.'),
    ];
    if (align(used, 4) > used) fields.push(field('padding', used, align(used, 4) - used, 0, 'The entire xattr entry is rounded up to a 4-byte boundary.'));
    return fields;
}

function xattrBody(key, inode, shared) {
    const id = `xattr-${key}`;
    const bodySize = shared ? 28 : 24;
    const start = inode.start + inode.size;
    const owner = key === 'root' ? 'Root directory' : inode.owner;
    const child = region => ({ fields: [], references: [], kind: 'xattr', owner, parentId: id, docPage: 'xattrs', ...region });
    const children = [child({
        id: `${id}-header`, title: `${owner} · xattr body header`, short: 'Ibody header', start, size: 12,
        description: 'The fixed 12-byte header starts immediately after the inode body. Shared IDs, when present, follow this header.',
        fields: [
            field('h_name_filter', 0, 4, 0, 'Xattr name Bloom filter. XATTR_FILTER is disabled in these examples, so this field is ignored.'),
            field('h_shared_count', 4, 1, shared ? 1 : 0, 'Number of 4-byte shared xattr IDs immediately following this header.'),
            field('h_reserved2', 5, 7, 0, 'Reserved bytes; all zero.'),
        ], doc: 'inline-xattr-body-header',
    })];
    if (shared) children.push(child({
        id: `${id}-shared-id`, title: `${owner} · shared xattr ID`, short: 'Shared ID 0', start: start + 12, size: 4,
        description: 'This 32-bit ID references the single shared user.owner attribute in block 11. All four inodes use the same shared entry.',
        fields: [field('shared_xattr_id', 0, 4, 0, 'Offset within the shared xattr area divided by four. ID 0 points to its first entry.')],
        formula: '11 × 4096 + 0 × 4 = 45056',
        references: [reference('xattr-shared', 'Shared user.owner = erofs')], doc: 'shared-xattr-area',
    }));
    children.push(child({
        id: `${id}-entry`, title: `${owner} · inline xattr entry`, short: 'user.note = demo', start: start + 12 + (shared ? 4 : 0), size: 12,
        description: 'A local user.note attribute stored in this inode’s xattr body: a 4-byte entry header, the 4-byte suffix note, and the 4-byte value demo.',
        fields: xattrEntryFields('note', 'demo'), formula: 'ALIGN(4 + 4 + 4, 4) = 12 B', doc: 'xattr-entry-record',
    }));
    return {
        id, kind: 'xattr', title: `${owner} · xattr body`, short: shared ? 'Xattrs + ID' : 'Xattrs', start, size: bodySize, owner,
        description: shared
            ? 'A 12-byte ibody header, one 4-byte shared ID, and a 12-byte local user.note entry. The referenced user.owner entry is stored once in block 11.'
            : 'A 12-byte ibody header and a 12-byte local user.note entry. This metadata is distinct from an inline file-data tail.',
        fields: children.map(part => field(part.short, part.start - start, part.size, part.id.endsWith('-shared-id') ? 0 : part.short,
            part.description)),
        formula: `12 + (${shared ? 5 : 4} − 1) × 4 = ${bodySize} B`,
        references: [reference(inode.id, 'Owning inode'), ...(shared ? [reference('xattr-shared', 'Shared user.owner = erofs')] : [])],
        children, docPage: 'xattrs', doc: 'inline-xattr-region-layout',
    };
}

function chunkArray(file, inode, bodySize, entryFormat, contentIds) {
    const id = `chunk-index-${file.key}`;
    const entrySize = entryFormat === 'indexes' ? 8 : 4;
    const start = align(inode.start + inode.size + bodySize, entrySize);
    const physicalBlocks = file.key === 'b' ? [5, 7, 6] : contentIds.map((_, i) => file.startBlock + i);
    const doc = entrySize === 8 ? 'chunk-index-entry-8-bytes' : 'block-map-entry-4-bytes';
    const children = contentIds.map((target, i) => ({
        id: `${id}-${i}`, kind: 'chunk-index', title: `${file.label} · chunk ${i} ${entrySize === 8 ? 'index' : 'block map entry'}`,
        short: `Chunk ${i} → block ${physicalBlocks[i]}`, start: start + i * entrySize, size: entrySize,
        owner: file.label, parentId: id,
        description: `Logical chunk ${i} begins at file offset ${i * B}. This entry maps it to physical block ${physicalBlocks[i]} on the primary device.`,
        fields: entrySize === 8 ? [
            field('_dontcare_', 0, 2, 0, 'The high-address field is ignored without the 48-bit chunk format, which is disabled here.'),
            field('device_id', 2, 2, 0, 'Zero uses the unified address space. With no extra devices in this example, the block is on the primary device.'),
            field('startblk', 4, 4, physicalBlocks[i], 'Starting filesystem block for this chunk. Each chunk can point to an independent block.'),
        ] : [field('startblk', 0, 4, physicalBlocks[i], 'Starting filesystem block for this chunk in the primary device. This is an independent per-chunk address, not a contiguous-file starting address.')],
        formula: `physical = ${physicalBlocks[i]} × 4096 + (logical offset − ${i * B})`,
        references: [reference(target, `Chunk ${i} payload · physical block ${physicalBlocks[i]}`)],
        docPage: 'chunked_format', doc,
    }));
    return {
        id, kind: 'chunk-index', title: `${file.label} · chunk ${entrySize === 8 ? 'indexes' : 'block map'}`, short: entrySize === 8 ? 'Chunk index' : 'Block map',
        start, size: children.length * entrySize, owner: file.label,
        description: `${children.length} independently addressed chunks, with one ${entrySize}-byte entry per 4096-byte logical chunk. The last chunk contains only the bytes up to the file’s EOF.`,
        fields: children.map((part, i) => field(`chunk[${i}]`, i * entrySize, entrySize, physicalBlocks[i], part.description)),
        formula: `ALIGN(${inode.start} + ${inode.size} + ${bodySize}, ${entrySize}) = ${start}`,
        references: [reference(inode.id, 'Owning inode'), ...children.map((part, i) => reference(contentIds[i], part.short))],
        children, docPage: 'chunked_format', doc: 'chunk-based-structures',
    };
}

// Only top-level regions partition the illustrated physical address space.
// Children describe bytes inside a parent and must never be allocated again.
function partitionExample(regions) {
    const addGap = region => {
        const gap = { fields: [], references: [], kind: 'unused', ...region };
        regions.push(gap);
        return gap;
    };
    return Array.from({ length: BLOCK_COUNT }, (_, number) => {
        const start = number * B;
        const parts = regions.filter(region => region.start >= start && region.start < start + B).sort((a, b) => a.start - b.start);
        const spans = [];
        let cursor = start;
        for (const part of parts) {
            if (part.start > cursor) spans.push(addGap({
                id: `gap-${cursor}`, title: 'Padding / unused space', short: 'Padding / unused', start: cursor, size: part.start - cursor,
                description: 'This gap preserves the fixed example addresses. EROFS does not require every inode to begin at a block boundary.',
            }));
            spans.push(part);
            cursor = part.start + part.size;
        }
        if (cursor < start + B) spans.push(addGap({
            id: `gap-${cursor}`, title: parts.length ? 'Padding / unused space' : 'Unused in this example',
            short: parts.length ? 'Padding / unused' : 'Unused in this example', start: cursor, size: start + B - cursor,
            description: 'No structure is stored in these illustrated bytes. File padding is outside the logical file size; other gaps preserve example addresses and do not model a free-space allocator.',
        }));
        return { number, start, regions: spans };
    });
}

export function createLayout({ format = 'compact', dataLayout = 'flat', inline = false, chunkFormat = 'blockmap', xattrs = 'none' } = {}) {
    for (const [name, value, choices] of [
        ['format', format, ['compact', 'extended']],
        ['dataLayout', dataLayout, ['flat', 'chunked']],
        ['chunkFormat', chunkFormat, ['blockmap', 'indexes']],
        ['xattrs', xattrs, ['none', 'inline', 'shared']],
    ]) if (!choices.includes(value)) throw new RangeError(`Unsupported ${name}: ${value}`);
    const chunked = dataLayout === 'chunked';
    const effectiveInline = !chunked && Boolean(inline);
    const xattrBodySize = xattrs === 'none' ? 0 : xattrs === 'shared' ? 28 : 24;
    const xattrIcount = xattrBodySize ? 1 + (xattrBodySize - 12) / 4 : 0;
    const base = preset(format, effectiveInline);
    const regions = base.regions.filter(region => region.kind !== 'unused' || region.id === 'reserved-prefix');
    const byId = new Map(regions.map(region => [region.id, region]));
    const add = region => {
        const complete = { fields: [], references: [], ...region };
        regions.push(complete);
        byId.set(complete.id, complete);
        return complete;
    };
    const superblock = byId.get('superblock');
    const sbField = name => superblock.fields.find(item => item.name === name);
    Object.assign(sbField('feature_incompat'), {
        value: chunked ? '0x00000004' : 0,
        description: chunked ? 'CHUNKED_FILE (0x4) enables chunk-based regular-file inodes. No device table, compression, or 48-bit layout is enabled.' : 'No incompatible extensions are enabled. Basic local and shared xattrs require no additional feature flag.',
    });
    Object.assign(sbField('xattr_blkaddr'), {
        value: xattrs === 'shared' ? 11 : 0,
        description: xattrs === 'shared' ? 'Shared xattrs begin in block 11. A shared ID selects a 4-byte unit relative to this block address.' : 'No shared xattr area is present in this example.',
    });
    sbField('epoch').description = 'Shared time base used by compact inodes without the 48-bit layout extension.';
    if (xattrs === 'shared') superblock.references.push(reference('xattr-shared', 'Shared xattr area · block 11'));

    const inodes = [{ key: 'root', inode: byId.get('root-inode') }, ...files.map(file => ({ key: file.key, inode: byId.get(`inode-${file.key}`) }))];
    for (const { key, inode } of inodes) {
        Object.assign(inode.fields.find(item => item.name === 'i_xattr_icount'), {
            value: xattrIcount,
            description: xattrIcount ? `The xattr body is 12 + (${xattrIcount} − 1) × 4 = ${xattrBodySize} bytes, immediately following this inode.` : 'Zero means that this inode has no xattr body.',
        });
        if (xattrBodySize) {
            const body = add(xattrBody(key, inode, xattrs === 'shared'));
            inode.references.push(reference(body.id, `${xattrBodySize}-byte xattr body`));
        }
    }
    if (xattrs === 'shared') add({
        id: 'xattr-shared', kind: 'xattr', title: 'Shared xattr entry · user.owner', short: 'Shared user.owner', start: 11 * B, size: 16,
        description: 'One shared user.owner = erofs entry, referenced by the root directory and all three regular files. Sharing applies to the complete name/value pair.',
        fields: xattrEntryFields('owner', 'erofs'), formula: 'ALIGN(4 + 5 + 5, 4) = 16 B',
        references: inodes.map(({ key }) => reference(`xattr-${key}-shared-id`, `${key === 'root' ? 'Root directory' : `File ${key.toUpperCase()}`} · shared ID 0`)),
        docPage: 'xattrs', doc: 'shared-xattr-area',
    });
    const directory = byId.get('directory');
    directory.start += xattrBodySize;
    byId.get('root-inode').description = `A ${base.inodeSize}-byte ${format} inode. Its 66-byte directory content is inline immediately after ${xattrBodySize ? `the inode and its ${xattrBodySize}-byte xattr body` : 'the inode'}.`;
    directory.description = 'Five 12-byte directory entries followed by six bytes of names. The root directory stays flat-inline even when regular files use chunks. Its contents follow the inode body and any xattr body.';

    for (const file of files) {
        const inode = byId.get(`inode-${file.key}`);
        const fullBlocks = Math.floor(file.size / B);
        const contentIds = fullBlocks ? Array.from({ length: fullBlocks }, (_, i) => `data-${file.key}-${i}`).concat(`tail-${file.key}`) : [`data-${file.key}`];
        if (!chunked) {
            if (effectiveInline) {
                const tail = byId.get(contentIds.at(-1));
                tail.start += xattrBodySize;
                tail.description = `${tail.size} file bytes immediately after the inode${xattrBodySize ? ` and its ${xattrBodySize}-byte xattr body` : ''}. ${fullBlocks ? 'Full file-data blocks remain external.' : 'The entire file fits here; no external data block is needed.'}`;
                tail.mapping.storage = xattrBodySize ? 'Inline, after inode and xattrs' : 'Inline, after inode';
                tail.formula = `physical = ${inode.start} + ${inode.size} + ${xattrBodySize} + (logical offset − ${fullBlocks * B})`;
            }
            continue;
        }
        Object.assign(inode.fields.find(item => item.name === 'i_format'), {
            value: format === 'extended' ? 9 : 8,
            description: `Bit 0 selects ${format === 'extended' ? 'extended (1)' : 'compact (0)'}. Bits 1–3 select CHUNK_BASED (4). Chunk-based data does not use flat inline tails.`,
        });
        const unionIndex = inode.fields.findIndex(item => item.name === 'i_u.startblk');
        inode.fields.splice(unionIndex, 1,
            field('i_u.c.format', 16, 2, chunkFormat === 'indexes' ? 32 : 0,
                `The format half of struct erofs_inode_chunk_info. Bits 0–4 are 0, giving a chunk size of 4096 << 0 = 4096 bytes. Bit 5 is ${chunkFormat === 'indexes' ? '1 (8-byte chunk indexes)' : '0 (4-byte block map)'}. Bit 6 (48-bit format) is 0.`),
            field('i_u.c.reserved', 18, 2, 0, 'The reserved half of struct erofs_inode_chunk_info. It is not an external starting block address.'),
        );
        inode.description = `${format === 'extended' ? 'Extended' : 'Compact'} inode for ${file.size.toLocaleString('en-US')} bytes of file content. A per-chunk address array follows the inode and any xattr body; all chunk payloads are external.`;
        inode.docPage = 'chunked_format';
        inode.doc = 'inode-fields-for-chunked-inodes';
        const array = chunkArray(file, inode, xattrBodySize, chunkFormat, contentIds);
        const metadataEnd = inode.start + inode.size + xattrBodySize;
        if (array.start > metadataEnd) add({
            id: `chunk-align-${file.key}`, kind: 'unused', title: 'Chunk-index alignment padding', short: 'Align', start: metadataEnd, size: array.start - metadataEnd,
            owner: file.label, description: 'The 8-byte chunk-index array must be aligned to 8 bytes. This 4-byte gap follows the 28-byte xattr body; it is not file data or part of the xattr body.',
            formula: `ALIGN(${metadataEnd}, 8) − ${metadataEnd} = 4 B`,
            references: [reference(array.id, 'Aligned chunk-index array')], docPage: 'chunked_format', doc: 'chunk-based-structures',
        });
        add(array);
        inode.references.push(reference(array.id, 'Per-chunk address array'));
        for (const [i, contentId] of contentIds.entries()) {
            const content = byId.get(contentId);
            const entry = array.children[i];
            const physicalBlock = entry.fields.find(item => item.name === 'startblk').value;
            content.start = physicalBlock * B;
            content.kind = 'data';
            content.title = `${file.label} · chunk ${i} ${content.size < B ? 'partial payload' : 'payload'}`;
            content.short = `Chunk ${i}`;
            content.description = `${content.size} valid bytes of logical chunk ${i}, starting at file offset ${i * B}. The chunk entry selects physical block ${physicalBlock}${content.size < B ? '; the remaining bytes in that physical block are padding beyond EOF' : ''}.`;
            content.mapping = { logical: i * B, length: content.size, storage: 'External chunk', owner: `${file.label} inode`, chunk: i, physicalBlock };
            content.formula = entry.formula;
            content.references.push(reference(entry.id, `Chunk ${i} address entry`));
            content.docPage = 'chunked_format';
            content.doc = 'chunk-based-structures';
        }
    }
    const blocks = partitionExample(regions);
    return { format, inline: effectiveInline, inodeSize: base.inodeSize, dataLayout, chunkFormat, chunkSize: B, xattrs, xattrBodySize, blocks, regions };
}
