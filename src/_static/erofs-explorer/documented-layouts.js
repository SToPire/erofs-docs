// Coordinates in primary/device spaces are physical. Metabox/packed coordinates
// are decoded inode offsets. Exact base cases use recorded image snapshots.
import { createLayout as basicLayout } from './layouts.js';
import { planXattrs } from './xattr-variants.js';
import { planChunks } from './chunk-variants.js';
import { applyRecordedLayout } from './recorded-layout.js';

const field = (name, offset, size, value, description) => ({ name, offset, size, value, description });
const ref = (target, label) => ({ target, label });
const align = (n, unit) => Math.ceil(n / unit) * unit;
const clone = object => structuredClone(object);
export const DEFAULT_OPTIONS = {
    format: 'compact', dataLayout: 'flat', inline: true, chunkFormat: 'blockmap', xattrs: 'none',
    blockSize: 4096, chunkBits: 0, deviceMode: 'primary', sharing: false,
    sbExtension: false, checksum: false, mtime: true, counts: 'normal',
    fileType: 'regular', sampleSize: 'mixed', directoryLayout: 'inline', nameEncoding: 'ascii', nameEnding: 'packed',
    xattrNamespace: 'user', sharedStorage: 'primary', prefixStorage: 'off', xattrFilter: 'off', imageShare: false,
};
const choices = {
    format: ['compact', 'extended'], dataLayout: ['flat', 'chunked'], chunkFormat: ['blockmap', 'indexes'],
    xattrs: ['none', 'inline', 'shared', 'shared-only'], deviceMode: ['primary', 'unified', 'explicit'],
    counts: ['normal', 'blocks-zero', 'inos-zero', 'both-zero'],
    fileType: ['regular', 'unknown', 'directory', 'char', 'block', 'fifo', 'socket', 'symlink'],
    sampleSize: ['mixed', 'empty', 'aligned', 'no-fit'], directoryLayout: ['inline', 'external'],
    nameEncoding: ['ascii', 'utf8', 'bytes'], nameEnding: ['packed', 'padded'],
    xattrNamespace: ['user', 'trusted', 'security', 'acl-access', 'acl-default'],
    sharedStorage: ['primary', 'metabox'], prefixStorage: ['off', 'standalone', 'physical-fallback', 'packed', 'metabox'],
    xattrFilter: ['off', 'on', 'reserved'],
};
export function normalizeOptions(raw = {}) {
    const o = { ...DEFAULT_OPTIONS, ...raw };
    for (const [name, values] of Object.entries(choices)) if (!values.includes(o[name])) throw new RangeError(`Unsupported ${name}: ${o[name]}`);
    o.blockSize = Number(o.blockSize);
    o.chunkBits = Number(o.chunkBits);
    if (!Number.isInteger(Math.log2(o.blockSize)) || o.blockSize < 512 || o.blockSize > 65536) throw new RangeError('Choose a block size from 512 bytes to 64 KiB.');
    if (!Number.isInteger(o.chunkBits) || o.chunkBits < 0 || o.chunkBits > 31) throw new RangeError('Chunk bits must be an integer from 0 to 31.');
    if (o.dataLayout !== 'chunked') { o.deviceMode = 'primary'; o.sharing = false; }
    else { o.inline = false; if (o.deviceMode === 'explicit') o.chunkFormat = 'indexes'; }
    if (o.chunkBits !== 0 || !['regular', 'unknown'].includes(o.fileType) || o.sampleSize !== 'mixed') o.sharing = false;
    if (!['regular', 'unknown'].includes(o.fileType)) o.sampleSize = 'mixed';
    if (o.xattrs === 'none') { o.prefixStorage = 'off'; o.xattrFilter = 'off'; o.imageShare = false; }
    if (!['shared', 'shared-only'].includes(o.xattrs)) o.sharedStorage = 'primary';
    if (['packed', 'physical-fallback'].includes(o.prefixStorage) && o.sharedStorage === 'metabox') o.prefixStorage = 'metabox';
    if (o.prefixStorage === 'off') o.imageShare = false;
    if (o.sharedStorage === 'metabox' || o.prefixStorage === 'metabox') o.sbExtension = true;
    return o;
}
function overrideFields(region, updates, removals = []) {
    const names = new Set([...removals, ...updates.map(f => f.name)]);
    region.fields = region.fields.filter(f => !names.has(f.name)).concat(updates).sort((a, b) => a.offset - b.offset);
}
function integerValue(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && /^(0x[0-9a-f]+|[0-9]+)$/i.test(value)) return Number(value);
    return 0;
}
// Linux erofs_crc32c(~0, bytes, length): reflected Castagnoli, no final XOR.
export function crc32c(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0x82f63b78 : 0);
    }
    return crc >>> 0;
}
function checksumFields(sb, B) {
    const length = B > 1024 ? B - 1024 : B;
    const bytes = new Uint8Array(length);
    const view = new DataView(bytes.buffer);
    for (const f of sb.fields) {
        if (f.name === 'checksum' || f.offset + f.size > length) continue;
        const value = integerValue(f.value);
        if (f.size === 1) view.setUint8(f.offset, value);
        else if (f.size === 2) view.setUint16(f.offset, value, true);
        else if (f.size === 4) view.setUint32(f.offset, value, true);
        else if (f.size === 8) view.setBigUint64(f.offset, BigInt(value), true);
    }
    const checksum = crc32c(bytes);
    overrideFields(sb, [field('checksum', 4, 4, `0x${checksum.toString(16).padStart(8, '0')}`,
        `CRC32-C over example bytes [1024, ${1024 + length}), treating this field as zero. UUID, volume label, omitted fields and unused bytes are zero in this checksum example.`)]);
    sb.checksumExample = { start: 1024, size: length, value: checksum, bytes: Array.from(bytes) };
}
function filenames(encoding) {
    if (encoding === 'utf8') return [{ name: 'é', bytes: [0xc3, 0xa9] }, { name: 'α', bytes: [0xce, 0xb1] }, { name: '文件', bytes: [0xe6, 0x96, 0x87, 0xe4, 0xbb, 0xb6] }];
    if (encoding === 'bytes') return [{ name: 'a', bytes: [97] }, { name: '\\x80', bytes: [128] }, { name: '\\xff', bytes: [255] }];
    return ['a', 'b', 'c'].map(name => ({ name, bytes: [name.charCodeAt(0)] }));
}
function directoryRegion(id, inode, entries, start, ending) {
    entries = [...entries].sort((a, b) => {
        for (let i = 0; i < Math.min(a.bytes.length, b.bytes.length); i++) {
            if (a.bytes[i] !== b.bytes[i]) return a.bytes[i] - b.bytes[i];
        }
        return a.bytes.length - b.bytes.length;
    });
    let cursor = entries.length * 12;
    const listed = entries.map(entry => { const result = { ...entry, nameoff: cursor }; cursor += entry.bytes.length; return result; });
    const used = cursor;
    const size = ending === 'padded' ? align(used + 1, 4) : used;
    const example = listed.find(entry => entry.name !== '.' && entry.name !== '..') || listed[0];
    return {
        id, kind: 'directory', title: `${inode.path || '/'} · entries & names`, short: 'Direntries + names',
        start, size, space: 'primary', entries: listed, namesStart: entries.length * 12, namesSize: used - entries.length * 12,
        namePadding: size - used, owner: inode.title,
        description: `${listed.length} sorted entries followed by ${used - listed.length * 12} name bytes. ${ending === 'padded' ? 'A NUL and padding follow the last name.' : 'The last name reaches the valid directory-data end.'}`,
        fields: [field('nid', 0, 8, example.nid, 'Target inode NID.'), field('nameoff', 8, 2, example.nameoff, 'Offset from the logical directory block start, measured in bytes.'), field('file_type', 10, 1, example.fileType, 'Directory-entry type hint. UNKNOWN does not invalidate the target inode type.'), field('reserved', 11, 1, 0, 'Reserved byte.')],
        references: [ref(inode.id, 'Owning inode'), ...listed.map(entry => ref(entry.target, `${entry.name} · NID ${entry.nid}`))],
        note: `Field values describe entry “${example.name}”; field offsets are within its 12-byte record. Names have no mandatory character encoding.`,
        formula: `${entries.length} × 12 + ${used - entries.length * 12} name bytes + ${size - used} padding = ${size} B`, doc: 'directories',
    };
}
function fillSpaces(regions, spaces, B) {
    for (const space of spaces) {
        const parts = regions.filter(r => r.space === space.id).sort((a, b) => a.start - b.start);
        let cursor = 0;
        const addGap = (start, size) => {
            const end = start + size;
            while (start < end) {
                const length = Math.min(end, (Math.floor(start / B) + 1) * B) - start;
                regions.push({ id: `unused-${space.id}-${start}`, kind: 'unused', short: 'Unused', title: `Unused ${space.id} interval`, start, size: length, space: space.id,
                    fields: [], references: [], description: 'No structure is shown in this part of the example address space. This is not a free-space bitmap.' });
                start += length;
            }
        };
        for (const part of parts) {
            if (part.start < cursor) throw new Error(`Overlapping ${space.id} region: ${part.id}`);
            if (part.start > cursor) addGap(cursor, part.start - cursor);
            cursor = part.start + part.size;
        }
        if (cursor > space.size) space.size = cursor;
        if (cursor < space.size) addGap(cursor, space.size - cursor);
    }
}
function annotateSpace(region, space = 'primary') {
    region.space ??= space;
    for (const child of region.children || []) annotateSpace(child, region.space);
}

export function createDocumentedLayout(raw = {}) {
    const o = normalizeOptions({ ...raw, fileType: 'regular' });
    const B = o.blockSize;
    const I = o.format === 'extended' ? 64 : 32;
    const sbSize = o.sbExtension ? 144 : 128;
    const M = Math.ceil((1024 + sbSize) / B);
    const rootExternal = o.directoryLayout === 'external';
    const A = M + 1 + Number(rootExternal);
    const F = A + 2;
    const C = F + 4;
    const directoryStride = 1 + Number(rootExternal);
    const docsBlock = C + 3;
    const assetsBlock = docsBlock + directoryStride;
    const aux = assetsBlock + directoryStride;
    const templates = basicLayout({ format: o.format });
    const template = id => clone(templates.regions.find(r => r.id === id));
    const regions = [];
    const add = r => { const region = { fields: [], references: [], space: 'primary', ...r }; regions.push(region); return region; };
    let serial = 0;
    const inode = (id, block, title, size, type = 'regular') => {
        const r = template(id === 'root-inode' ? 'root-inode' : 'inode-b');
        Object.assign(r, { id, title, short: title, start: block * B, size: I, space: 'primary', nid: (block - M) * B / 32, owner: title, references: [], formula: `${M} × ${B} + ${(block - M) * B / 32} × 32 = ${block * B}` });
        overrideFields(r, [field('i_size', 8, I === 64 ? 8 : 4, size, 'Logical content length; external padding is excluded.'), field('i_ino', 20, 4, ++serial, 'Serial number for stat compatibility, distinct from the NID.')]);
        const timeName = o.mtime ? 'modification time (mtime)' : 'legacy change time (ctime)';
        for (const f of r.fields) if (f.name.startsWith('i_mtime')) f.description = `This timestamp carries ${timeName}. Changing MTIME changes its meaning, not its storage size.`;
        r.type = type;
        return add(r);
    };
    add({ ...template('reserved-prefix'), start: 0, size: 1024 });
    const sb = add({ ...template('superblock'), size: sbSize, references: [ref('root-inode', 'Root directory')] });
    const fileSizes = {
        mixed: [3 * B / 16, 2 * B + B / 8, B + 113 * B / 512],
        empty: [0, 0, 0],
        aligned: [B, 2 * B, B],
        'no-fit': [B - 16, 3 * B - 16, 2 * B - 16],
    }[o.sampleSize];
    const fileDefs = [
        { key: 'a', label: 'File A', block: A, size: fileSizes[0], type: 'regular', dataStartBlock: A + 1, regionBudgetBlocks: 1 },
        { key: 'b', label: 'File B', block: F, size: fileSizes[1], type: 'regular', dataStartBlock: F + 1, regionBudgetBlocks: 3 },
        { key: 'c', label: 'File C', block: C, size: fileSizes[2], type: 'regular', dataStartBlock: C + 1, regionBudgetBlocks: 2 },
    ];
    const root = inode('root-inode', M, 'Root directory inode', 66, 'directory');
    root.path = '/';
    const directoryDefs = [
        { key: 'root', inode: root, block: M, parent: 'root', path: '/' },
        { key: 'docs', block: docsBlock, parent: 'root', path: '/docs' },
        { key: 'assets', block: assetsBlock, parent: 'docs', path: '/docs/assets' },
    ];
    for (const d of directoryDefs.slice(1)) {
        d.inode = inode(`inode-${d.key}`, d.block, `${d.path}/ inode`, 0, 'directory');
        d.inode.path = d.path;
    }
    const names = filenames(o.nameEncoding);
    const parents = ['root', 'docs', 'assets'];
    fileDefs.forEach((f, i) => {
        f.parent = parents[i]; f.name = names[i];
        const parent = directoryDefs.find(d => d.key === f.parent);
        f.path = `${parent.path === '/' ? '' : parent.path}/${f.name.name}`;
        f.label = f.path;
    });
    for (const f of fileDefs) f.inode = inode(`inode-${f.key}`, f.block, `${f.label} inode`, f.size, f.type);
    for (const f of fileDefs) f.inode.path = f.path;
    const xp = planXattrs(o, { blockSize: B, metaBlock: M, sharedPhysicalStart: aux * B, prefixPhysicalStart: (aux + 1) * B,
        packedNid: (aux + 3 - M) * B / 32, metaboxNid: (aux + 5 - M) * B / 32,
        eligibleKeys: [...directoryDefs.map(d => d.key), ...fileDefs.map(f => f.key)],
        regularKeys: fileDefs.filter(f => ['regular', 'unknown'].includes(f.type)).map(f => f.key),
        directoryKeys: directoryDefs.map(d => d.key) });
    const owners = [...directoryDefs, ...fileDefs];
    for (const owner of owners) {
        const size = xp.bodySizes[owner.key];
        owner.xattrSize = size;
        overrideFields(owner.inode, [field('i_xattr_icount', 2, 2, size ? 1 + (size - 12) / 4 : 0, size ? `12 + (icount − 1) × 4 = ${size} B after the inode body.` : 'No xattr body.')]);
        const body = xp.makeBody(owner.key, owner.inode);
        if (body) { add(body); owner.inode.references.push(ref(body.id, 'Extended attributes')); }
    }
    xp.regions.forEach(add);
    let compat = (o.mtime ? 2 : 0) | xp.featureCompat | (o.checksum ? 1 : 0);
    let incompat = xp.featureIncompat;
    const directoryId = key => key === 'root' ? 'directory' : `directory-${key}`;
    for (const d of directoryDefs) {
        const parent = directoryDefs.find(candidate => candidate.key === d.parent);
        const children = directoryDefs.filter(candidate => candidate.key !== 'root' && candidate.parent === d.key);
        const entries = [
            { name: '.', bytes: [46], nid: d.inode.nid, target: d.inode.id, fileType: 2 },
            { name: '..', bytes: [46, 46], nid: parent.inode.nid, target: parent.inode.id, fileType: 2 },
            ...children.map(child => ({ name: child.key, bytes: Array.from(new TextEncoder().encode(child.key)), nid: child.inode.nid, target: child.inode.id, fileType: 2 })),
            ...fileDefs.filter(f => f.parent === d.key).map(f => ({ ...f.name, nid: f.inode.nid, target: f.inode.id, fileType: 1 })),
        ];
        const data = add(directoryRegion(directoryId(d.key), d.inode, entries, rootExternal ? (d.block + 1) * B : d.inode.start + I + d.xattrSize, o.nameEnding));
        overrideFields(d.inode, [
            field('i_mode', 4, 2, '040755', 'Directory type and permissions.'),
            field('i_size', 8, I === 64 ? 8 : 4, data.size, 'Valid directory content length.'),
            field('i_format', 0, 2, Number(I === 64) + (rootExternal ? 0 : 4), 'Directory layout is independent of regular-file layout.'),
            field('i_u.startblk', 16, 4, rootExternal ? d.block + 1 : 'Unused', 'Used only for external directory data.'),
            field('i_nlink', I === 64 ? 44 : 6, I === 64 ? 4 : 2, 2 + children.length, 'Two links plus one for each immediate child directory.'),
        ]);
        d.inode.description = `${d.path} directory; ${data.size} bytes of entries and names, ${rootExternal ? 'in an external block' : 'inline after inode and xattrs'}.`;
        d.inode.references.push(ref(data.id, 'Directory content'), ref(d.key === 'root' ? 'superblock' : directoryId(d.parent), d.key === 'root' ? 'Superblock' : 'Parent directory'));
    }
    const chunkFiles = [];
    for (const f of fileDefs) {
        const r = f.inode;
        r.references.push(ref(directoryId(f.parent), 'Parent directory entry'));
        overrideFields(r, [field('i_mode', 4, 2, '0100644', 'Regular file type and permissions, in octal.')]);
        if (o.dataLayout === 'chunked') { chunkFiles.push(f); continue; }
        const full = Math.floor(f.size / B);
        const tail = f.size % B;
        const inline = o.inline && tail > 0 && (r.start + I + f.xattrSize) % B + tail <= B;
        overrideFields(r, [field('i_format', 0, 2, Number(I === 64) + (inline ? 4 : 0), `${inline ? 'FLAT_INLINE (2)' : 'FLAT_PLAIN (0)'}. ${o.inline && !inline ? 'This content has no eligible inline tail.' : ''}`), field('i_u.startblk', 16, 4, f.size === 0 || inline && full === 0 ? 'Unused' : f.dataStartBlock, 'External start block; unused for empty or wholly inline content.')]);
        r.description = `${f.type} inode with ${f.size} content bytes. ${inline ? 'The tail follows the inode and xattrs.' : 'Content is external; a zero-length or aligned file has no inline tail.'}`;
        for (let i = 0; i < Math.ceil(f.size / B); i++) {
            const last = i === full && tail;
            const length = last ? tail : B;
            const start = last && inline ? r.start + I + f.xattrSize : (f.dataStartBlock + i) * B;
            const id = full === 0 ? `data-${f.key}` : last ? `tail-${f.key}` : `data-${f.key}-${i}`;
            add({ id, kind: last && inline ? 'inline' : 'data', title: `${f.label} · ${last ? 'tail' : `data ${i + 1}`}`, short: `${last ? 'Tail' : 'Data'} ${i + 1}`, start, size: length,
                description: `Logical bytes [${i * B}, ${i * B + length}) of ${f.label}.`, fields: [], references: [ref(r.id, 'Owning inode')],
                mapping: { logical: i * B, length, storage: last && inline ? 'Inline content' : 'External blocks', owner: r.title },
                formula: last && inline ? `physical = ${r.start} + ${I} + ${f.xattrSize} + tail offset` : `physical = ${f.dataStartBlock} × ${B} + logical offset`, doc: 'inode-data-layouts' });
            r.references.push(ref(id, 'File content'));
        }
    }
    let cp = null;
    if (chunkFiles.length) {
        cp = planChunks(o, { blockSize: B, files: chunkFiles, deviceTableStart: (aux + 2) * B, extraDeviceBlocks: 16, nuniaddr: 0x1000 });
        cp.regions.forEach(add); incompat |= cp.featureIncompat;
        for (const f of chunkFiles) {
            overrideFields(f.inode, cp.inodeFields[f.inode.id], cp.inodeFieldRemovals[f.inode.id]);
            f.inode.references.push(...cp.inodeReferences[f.inode.id]);
            f.inode.description = `Chunk-based ${f.label}; each ${cp.chunkSize}-byte logical chunk has its own address entry.`;
            f.inode.docPage = 'chunked_format'; f.inode.doc = 'inode-fields-for-chunked-inodes';
        }
    }
    const spaces = [{ id: 'primary', label: 'Primary image', physical: true, size: (aux + 1) * B }];
    for (const space of xp.addressSpaces) {
        const packed = space.id === 'packed';
        const block = aux + (packed ? 3 : 5);
        const backingBlock = block + 1;
        const helper = inode(`${space.id}-inode`, block, `${packed ? 'Packed' : 'Metabox'} inode`, space.size);
        overrideFields(helper, [field('i_u.startblk', 16, 4, backingBlock, 'Flat physical backing for this decoded stream.'), field('i_format', 0, 2, Number(I === 64), 'This example deliberately uses uncompressed flat backing for the special inode.')]);
        const contents = xp.regions.filter(r => r.space === space.id);
        helper.references = [ref(`${space.id}-backing`, 'Physical backing'), ...contents.map(r => ref(r.id, 'Decoded content'))];
        helper.description = 'Special inode supplying a decoded logical stream. The physical backing and decoded offsets are shown in separate address spaces.';
        helper.docPage = 'xattrs'; helper.doc = 'prefix-table-placement';
        add({ id: `${space.id}-backing`, kind: 'data', title: `${space.label || space.title} · backing`, short: `${space.id} backing`, start: backingBlock * B, size: space.size,
            description: 'Uncompressed physical backing in this example. The linked view uses offsets relative to the decoded special-inode stream.',
            mapping: { logical: 0, length: space.size, storage: `Uncompressed ${space.id} backing`, owner: helper.title },
            formula: `physical = ${backingBlock} × ${B} + decoded offset (${space.id})`, fields: [], references: [ref(helper.id, 'Special inode'), ...contents.map(r => ref(r.id, 'Decoded content'))], docPage: 'xattrs', doc: 'prefix-table-placement' });
        for (const r of contents) r.references.push(ref(helper.id, 'Special inode'), ref(`${space.id}-backing`, 'Physical backing'));
        spaces.push({ id: space.id, label: space.title, physical: false, size: space.size, description: space.description });
        spaces[0].size = Math.max(spaces[0].size, (backingBlock * B + space.size));
    }
    if (cp) for (const space of cp.addressSpaces) if (space.id !== 'primary') spaces.push({ ...space, size: space.blocks * B, physical: true });
    spaces[0].size = align(Math.max(spaces[0].size, ...regions.filter(r => r.space === 'primary').map(r => r.start + r.size)), B);
    const inodeCount = regions.filter(r => r.kind === 'inode').length;
    overrideFields(sb, [field('blkszbits', 12, 1, Math.log2(B), 'Block size is a power of two. A reader kernel supports block sizes up to its page size.'), field('sb_extslots', 13, 1, Number(o.sbExtension), '128-byte base plus 16 bytes per extension slot.'),
        field('rootnid_2b', 14, 2, root.nid, 'Root inode NID; zero is valid.'), field('meta_blkaddr', 40, 4, M, 'Metadata base is placed after the superblock, including for 512/1024-byte blocks.'),
        field('feature_compat', 8, 4, compat, 'SB_CHKSUM, MTIME and documented xattr-compatible feature bits.'), field('feature_incompat', 80, 4, incompat, 'Chunk, device-table, xattr-prefix and special-inode feature bits as selected.'),
        field('blocks', 36, 4, ['blocks-zero', 'both-zero'].includes(o.counts) ? 0 : spaces[0].size / B, 'Optional statistics; zero does not remove represented blocks.'), field('inos', 16, 8, ['inos-zero', 'both-zero'].includes(o.counts) ? 0 : inodeCount, 'Optional statistics; zero does not invalidate NIDs.'),
        field('epoch', 24, 8, 1700000000, `Compact inode ${o.mtime ? 'mtime' : 'legacy ctime'} is shared through epoch/fixed_nsec without the 48-bit extension.`),
        ...xp.sbFields, ...(cp ? cp.sbFields : [])]);
    for (const r of xp.regions) sb.references.push(ref(r.id, r.title));
    if (cp?.regions.some(r => r.id === 'device-table')) sb.references.push(ref('device-table', 'Extra-device table'));
    if (xp.neededPacked) sb.references.push(ref('packed-inode', 'Packed inode'));
    if (xp.neededMetabox) sb.references.push(ref('metabox-inode', 'Metabox inode'));
    if (o.checksum) checksumFields(sb, B);
    regions.forEach(r => annotateSpace(r));
    fillSpaces(regions, spaces, B);
    const group = (id, label, start, size, primary, kind = 'inode', space = 'primary') => ({ id, title: label, label, detail: '', start, size, primary, kind, weight: Math.min(2, Math.max(0.7, Math.sqrt(size / B))), space });
    const groups = [group('prefix', 'Reserved', 0, 1024, 'reserved-prefix', 'unused'), group('superblock', 'Superblock', 1024, sbSize, 'superblock', 'superblock')];
    if (M * B > 1024 + sbSize) groups.push(group('gap', '…', 1024 + sbSize, M * B - 1024 - sbSize, `unused-primary-${1024 + sbSize}`, 'unused'));
    groups.push(group('root', 'Root inode', M * B, (1 + Number(rootExternal)) * B, root.id, 'directory'));
    for (const f of fileDefs) groups.push(group(f.key, f.inode.title.replace(' inode', ''), f.block * B, (1 + f.regionBudgetBlocks) * B, f.inode.id));
    for (const d of directoryDefs.slice(1)) groups.push(group(d.key, `${d.path}/`, d.block * B, directoryStride * B, d.inode.id, 'directory'));
    let cursor = aux * B;
    const primaryExtras = regions.filter(r => r.space === 'primary' && r.start >= cursor && r.kind !== 'unused').sort((a, b) => a.start - b.start);
    for (const r of primaryExtras) {
        if (r.start > cursor) groups.push(group(`gap-${cursor}`, '…', cursor, r.start - cursor, `unused-primary-${cursor}`, 'unused'));
        groups.push(group(r.id === 'xattr-shared' ? 'shared' : r.id, r.short, r.start, r.size, r.id, r.kind)); cursor = r.start + r.size;
    }
    if (cursor < spaces[0].size) groups.push(group('unused', 'Unused', cursor, spaces[0].size - cursor, `unused-primary-${cursor}`, 'unused'));
    for (const space of spaces.slice(1)) {
        let previous;
        for (const r of regions.filter(r => r.space === space.id).sort((a, b) => a.start - b.start)) {
            if (r.kind === 'unused' && previous?.kind === 'unused' && previous.start + previous.size === r.start) {
                previous.size += r.size;
            } else {
                previous = group(r.id, r.short, r.start, r.size, r.id, r.kind, space.id);
                groups.push(previous);
            }
        }
    }
    return applyRecordedLayout({ format: o.format, inline: o.inline, inodeSize: I, dataLayout: o.dataLayout, chunkFormat: o.chunkFormat, chunkSize: B * 2 ** o.chunkBits,
        xattrs: o.xattrs, xattrBodySizes: xp.bodySizes, blockSize: B, blockCount: spaces[0].size / B, options: o, regions, groups, addressSpaces: spaces,
        featureCompat: compat, featureIncompat: incompat, fileMappings: cp?.fileMappings || {}, blocks: [],
        tree: directoryDefs.map(d => ({ id: d.inode.id, contentId: directoryId(d.key), path: d.path, parent: d.key === 'root' ? null : directoryDefs.find(p => p.key === d.parent).inode.id, directory: true }))
            .concat(fileDefs.map(f => ({ id: f.inode.id, path: f.path, parent: directoryDefs.find(d => d.key === f.parent).inode.id, directory: false }))) }, fillSpaces);
}
