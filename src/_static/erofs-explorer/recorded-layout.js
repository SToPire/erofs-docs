// Render reviewed metadata snapshots. No allocator, image upload, or mkfs runs here.
import { loadLayout } from './layout-data.js';
import { addCompressedRegions } from './compressed-layout.js';

const align = (value, unit) => Math.ceil(value / unit) * unit;
const number = (bytes, offset, size) => {
    let value = 0;
    for (let i = size - 1; i >= 0; --i) value = value * 256 + bytes[offset + i];
    return value;
};
const hex = bytes => bytes.map(b => b.toString(16).padStart(2, '0')).join('');
const text = bytes => new TextDecoder().decode(new Uint8Array(bytes));
const field = (name, offset, size, value, description) => ({ name, offset, size, value, description });
const ref = (target, label) => ({ target, label });
const spaceId = space => space === 'blob' ? 'device-1' : space || 'primary';
const directoryId = key => key === 'root' ? 'directory' : `directory-${key}`;

function numericField(bytes, name, offset, size, description, display) {
    const value = size <= 8 ? number(bytes, offset, size) : hex(bytes.slice(offset, offset + size));
    return field(name, offset, size, display ? display(value) : value, description);
}
function inodeFields(record) {
    const b = record.bytes, extended = b.length === 64;
    const f = (name, offset, size, description, display) => numericField(b, name, offset, size, description, display);
    const fields = [f('i_format', 0, 2, 'Bit 0 selects compact/extended encoding; bits 1–3 select the data layout recorded in this inode.'),
        f('i_xattr_icount', 2, 2, 'Zero means no xattrs; otherwise the following body occupies 12 + (icount − 1) × 4 bytes.'),
        f('i_mode', 4, 2, 'File type and permissions, in octal.', v => '0' + v.toString(8)),
        f(extended ? 'reserved' : 'i_nlink', 6, 2, extended ? 'Unused union in these extended inodes.' : 'Number of hard links.'),
        f('i_size', 8, extended ? 8 : 4, 'Logical content size in bytes, excluding external padding.')];
    if (!extended) fields.push(f('i_reserved2', 12, 4, 'Unused without the 48-bit extension. These compact inodes use the superblock epoch and fixed_nsec.'));
    if (record.layout === 4) fields.push(f('i_u.c.format', 16, 2, 'Low five bits are the chunk exponent; bit 5 selects eight-byte indexes.'), f('i_u.c.reserved', 18, 2, 'Reserved half of the chunk info summary.'));
    else if (record.compression) fields.push(f('i_u.compressed_blocks', 16, 4, 'External physical block count for this compressed file; inline compressed tails are excluded. Compression indexes locate the data; this field is not a start address.'));
    else fields.push(f('i_u.startblk', 16, 4, record.layout === 2 && record.size < record.blockSize
        ? 'All content is inline; the stored value is not an external data reference.' : 'First external data block. Physical offset = startblk × block size.'));
    fields.push(f('i_ino', 20, 4, 'Serial number for stat compatibility, distinct from the NID.'),
        f('i_uid', 24, extended ? 4 : 2, 'Owner UID.'), f('i_gid', extended ? 28 : 26, extended ? 4 : 2, 'Owner GID.'));
    if (extended) fields.push(f('i_mtime', 32, 8, 'Modification time in Unix seconds.'), f('i_mtime_nsec', 40, 4, 'Nanosecond component.'), f('i_nlink', 44, 4, 'Number of hard links.'), f('i_reserved2', 48, 16, 'Reserved bytes, displayed in hexadecimal.'));
    else fields.push(f('i_reserved', 28, 4, 'Reserved bytes.'));
    return fields;
}
function superblockFields(b) {
    const compressed = number(b, 84, 2) !== 0;
    const compressionConfigs = (number(b, 80, 4) & 2) !== 0;
    const specs = [
        ['magic', 0, 4, 'EROFS signature.'], ['checksum', 4, 4, 'CRC32-C over the selected structure and data bytes in the checksum block; checked against offline mkfs images.'],
        ['feature_compat', 8, 4, 'Compatible feature bitmap from this image.'], ['blkszbits', 12, 1, 'Filesystem block size = 2^blkszbits.'],
        ['sb_extslots', 13, 1, 'Additional 16-byte superblock slots after the 128-byte base.'], ['rootnid_2b', 14, 2, 'Root directory NID.'],
        ['inos', 16, 8, 'Number of inodes in the generated filesystem.'], ['epoch', 24, 8, 'Base time for compact inode timestamps.'],
        ['fixed_nsec', 32, 4, 'Shared nanosecond component.'], ['blocks', 36, 4, 'Block count recorded in the superblock; additional-device blocks may be included.'],
        ['meta_blkaddr', 40, 4, 'Inode addressing base: meta_blkaddr × block size + NID × 32.'],
        ['xattr_blkaddr', 44, 4, 'Shared xattr base: xattr_blkaddr × block size + shared ID × 4.'],
        ['feature_incompat', 80, 4, 'Incompatible feature bitmap from this image.'],
        [compressionConfigs ? 'available_compr_algs' : compressed ? 'lz4_max_distance' : 'is_compressed', 84, 2,
            compressionConfigs ? 'Compression algorithm bitmap selected by COMPR_CFGS.' : compressed ? 'LZ4 maximum match distance stored in the legacy compression union.' : 'The compression union is zero in this uncompressed image.'],
        ['extra_devices', 86, 2, 'Number of devices in addition to the primary image.'], ['devt_slotoff', 88, 2, 'Device table offset in 128-byte units.'],
        ['dirblkbits', 90, 1, 'Directory-block size shift relative to the filesystem block size.'], ['xattr_prefix_count', 91, 1, 'Number of recorded long-name prefixes.'],
        ['xattr_prefix_start', 92, 4, 'Long-prefix table address in four-byte units.'], ['packed_nid', 96, 8, 'Special packed inode NID; zero when absent.'],
        ['xattr_filter_reserved', 104, 1, 'A nonzero value would disable the name filter.'], ['ishare_xattr_prefix_id', 105, 1, 'Image-share prefix ordinal; unused here.'],
        ['reserved', 106, 2, 'Reserved bytes.'], ['build_time', 108, 4, 'Build-time delta from epoch.'], ['rootnid_8b', 112, 8, 'Alternative root NID for 48-bit layouts; unused here.'], ['reserved2', 120, 8, 'Reserved bytes.'],
    ];
    const fields = specs.map(([name, offset, size, description]) => numericField(b, name, offset, size, description,
        ['magic', 'checksum', 'feature_compat', 'feature_incompat'].includes(name) ? v => '0x' + v.toString(16).padStart(8, '0') : undefined));
    const uuid = hex(b.slice(48, 64));
    fields.push(field('uuid', 48, 16, [uuid.slice(0, 8), uuid.slice(8, 12), uuid.slice(12, 16), uuid.slice(16, 20), uuid.slice(20)].join('-'), 'Fixed UUID supplied to mkfs.erofs.'),
        field('volume_name', 64, 16, text(b.slice(64, 80)).replace(/\0+$/, '') || 'Empty', 'Volume label stored in the image.'));
    return fields.sort((a, b) => a.offset - b.offset);
}

export async function createRecordedLayout(options = {}) {
    return createLayoutFromRecord(await loadLayout(options));
}

export function createLayoutFromRecord(s) {
    const o = s.options, B = s.blockSize;
    const regions = [], groups = [], tree = [];
    const add = r => { const region = { fields: [], references: [], space: 'primary', ...r }; regions.push(region); return region; };
    const inodeByNid = new Map(s.inodes.map(i => [i.nid, i]));
    const parents = { root: null, docs: 'root-inode', assets: 'inode-docs', a: 'root-inode', b: 'inode-docs', c: 'inode-assets' };
    const spaces = [{ id: 'primary', label: 'Primary image', physical: true, size: s.size }];
    if (s.blob) spaces.push({ id: 'device-1', label: 'Extra device 1', physical: true, size: s.blob.size });
    add({ id: 'reserved-prefix', kind: 'unused', title: 'Reserved prefix', short: 'Reserved', start: 0, size: 1024, group: 'prefix', description: 'The first 1024 bytes precede the fixed-offset superblock.' });
    add({ id: 'superblock', kind: 'superblock', title: 'Superblock', short: 'Superblock', start: 1024, size: s.superblock.length, group: 'superblock', fields: superblockFields(s.superblock),
        references: [ref('root-inode', `Root directory · NID ${s.rootNid}`)], description: 'Filesystem entry point, copied from the generated image.', doc: 'superblock' });
    const prefixes = [];
    if (s.prefixes) {
        const b = s.prefixes.bytes, children = [];
        for (let at = 0, i = 0; i < number(s.superblock, 91, 1); ++i) {
            const length = number(b, at, 2), size = align(2 + length, 4), infix = text(b.slice(at + 3, at + 2 + length));
            prefixes.push({ base: b[at + 2], infix });
            const fields = [field('size', 0, 2, length, 'Length of base_index and infix, excluding this length field.'), field('base_index', 2, 1, b[at + 2], 'Built-in xattr namespace.'), field('infix', 3, length - 1, infix, 'Additional prefix after the built-in namespace.')];
            if (size > length + 2) fields.push(field('padding', length + 2, size - length - 2, hex(b.slice(at + length + 2, at + size)), 'Recorded alignment bytes.'));
            children.push({ id: `prefix-table-${i}`, parentId: 'prefix-table', kind: 'xattr', title: `Long prefix ${i} · ${infix}`, short: infix, start: s.prefixes.start + at, size, fields, references: [], description: 'Recorded long-name prefix entry.' });
            at += size;
        }
        add({ id: 'prefix-table', kind: 'xattr', title: 'Long xattr prefix table', short: 'Long prefixes', start: s.prefixes.start, size: s.prefixes.bytes.length, children,
            description: 'Prefix entries read from the physical table selected by the superblock.', docPage: 'xattrs', doc: 'long-xattr-name-prefixes' });
    }
    function xattrEntry(id, start, b, parentId) {
        const len = b[0], index = b[1], valueSize = number(b, 2, 2), suffix = text(b.slice(4, 4 + len));
        const prefix = index & 128 ? prefixes[index & 127] : { base: index, infix: '' };
        const name = ({ 1: 'user.', 2: 'system.posix_acl_access', 3: 'system.posix_acl_default', 4: 'trusted.', 6: 'security.' }[prefix.base] || '') + prefix.infix + suffix;
        const value = text(b.slice(4 + len, 4 + len + valueSize));
        const fields = [field('e_name_len', 0, 1, len, 'Stored name-suffix length.'), field('e_name_index', 1, 1, index, 'Built-in namespace or 0x80 | long-prefix ordinal.'), field('e_value_size', 2, 2, valueSize, 'Value length excluding alignment.')];
        if (len) fields.push(field('e_name', 4, len, suffix, `Reconstructed name: ${name}.`));
        if (valueSize) fields.push(field('e_value', 4 + len, valueSize, value, 'Recorded attribute value.'));
        if (4 + len + valueSize < b.length) fields.push(field('padding', 4 + len + valueSize, b.length - 4 - len - valueSize, hex(b.slice(4 + len + valueSize)), 'Recorded four-byte alignment padding.'));
        return { id, parentId, kind: 'xattr', title: name, short: name, start, size: b.length, fields,
            references: index & 128 ? [ref(`prefix-table-${index & 127}`, 'Long-name prefix')] : [], description: `${name} = ${value}`, docPage: 'xattrs', doc: 'xattr-entry-record' };
    }
    const shared = new Map();
    for (const entry of s.sharedXattrs) {
        const region = add(xattrEntry(`xattr-shared-${entry.id}`, entry.start, entry.bytes));
        region.group = 'shared-xattrs'; shared.set(entry.id, region);
    }
    if (s.deviceTable) {
        const b = s.deviceTable.bytes;
        add({ id: 'device-table', kind: 'device-table', title: 'Extra device table', short: 'Device table', start: s.deviceTable.start, size: b.length,
            fields: [field('tag', 0, 64, text(b.slice(0, 64)).replace(/\0+$/, '') || 'Empty', 'Device identification tag.'), numericField(b, 'blocks', 64, 4, 'Recorded additional-device block count.'), numericField(b, 'uniaddr', 68, 4, 'Unified block-address base.'), numericField(b, 'blocks_hi', 72, 2, 'High block-count bits.'), numericField(b, 'uniaddr_hi', 74, 2, 'High unified-address bits.'), field('reserved', 76, 52, hex(b.slice(76)), 'Reserved slot bytes.')],
            description: 'One 128-byte slot describes the extra device. Chunk indexes select device ID 1.', docPage: 'chunked_format', doc: 'device-table' });
    }
    const payloads = [];
    for (const record of s.inodes) {
        const isDir = Boolean(record.directory), group = record.key;
        const inode = add({ id: record.id, kind: 'inode', title: `${record.path} · inode`, short: `${record.path} inode`, start: record.start, size: record.bytes.length,
            nid: record.nid, path: record.path, type: isDir ? 'directory' : 'regular', group, ownerId: record.id,
            fields: inodeFields({ ...record, blockSize: B }), description: `${record.bytes.length}-byte inode for ${record.path}; ${record.size} bytes of logical content.`,
            formula: `${s.metaBlock} × ${B} + ${record.nid} × 32 = ${record.start}`, doc: 'inodes', references: [ref(isDir && group === 'root' ? 'superblock' : directoryId(({ docs: 'root', assets: 'docs', a: 'root', b: 'docs', c: 'assets' })[group]), 'Parent reference')] });
        tree.push({ id: record.id, contentId: isDir ? directoryId(group) : undefined, path: record.path, parent: parents[group], directory: isDir });
        if (record.xattr) {
            const { start, bytes: b } = record.xattr, id = `xattr-${group}`, children = [];
            children.push({ id: `${id}-header`, parentId: id, kind: 'xattr', title: 'Inline xattr header', short: 'Header', start, size: 12,
                fields: [numericField(b, 'h_name_filter', 0, 4, 'Recorded negative-name Bloom filter.', v => '0x' + v.toString(16).padStart(8, '0')), field('h_shared_count', 4, 1, b[4], 'Number of shared IDs following this header.'), field('h_reserved2', 5, 7, hex(b.slice(5, 12)), 'Reserved bytes.')], references: [], description: '12-byte xattr ibody header.' });
            let at = 12;
            for (let i = 0; i < b[4]; ++i, at += 4) {
                const sid = number(b, at, 4), target = shared.get(sid), childId = `${id}-shared-id-${i}`;
                children.push({ id: childId, parentId: id, kind: 'xattr', title: `Shared xattr ID ${sid}`, short: `ID ${sid}`, start: start + at, size: 4,
                    fields: [field('shared_id', 0, 4, sid, 'Four-byte units relative to the shared xattr base.')], references: [ref(target.id, target.title)],
                    formula: `${number(s.superblock, 44, 4)} × ${B} + ${sid} × 4 = ${target.start}`, description: 'Reference to a complete shared name/value entry.', doc: 'shared-xattr-area' });
                target.references.push(ref(childId, `${record.path} · shared ID`));
            }
            for (let i = 0; at < b.length; ++i) {
                const size = align(4 + b[at] + number(b, at + 2, 2), 4);
                children.push(xattrEntry(`${id}-entry-${i}`, start + at, b.slice(at, at + size), id)); at += size;
            }
            add({ id, kind: 'xattr', title: `${record.path} · xattrs`, short: 'Xattrs', start, size: b.length, group, ownerId: record.id, children,
                references: [ref(record.id, 'Owning inode')], description: 'Recorded xattr body between inode and inline content or chunk addresses.', docPage: 'xattrs', doc: 'inline-xattr-region-layout' });
            inode.references.push(ref(id, 'Extended attributes'));
        }
        if (record.directory) {
            const d = record.directory, b = d.bytes, namesStart = number(b, 8, 2), entries = [];
            for (let at = 0; at < namesStart; at += 12) {
                const nid = number(b, at, 8), nameoff = number(b, at + 8, 2), end = at + 12 < namesStart ? number(b, at + 20, 2) : b.length;
                const nameBytes = b.slice(nameoff, end);
                entries.push({ nid, nameoff, name: text(nameBytes), bytes: nameBytes, fileType: b[at + 10], target: inodeByNid.get(nid).id });
            }
            const e = entries[0], id = directoryId(group);
            add({ id, kind: 'directory', title: `${record.path} · entries & names`, short: 'Direntries + names', start: d.start, size: b.length,
                group: record.layout === 2 ? group : `${group}-data`, ownerId: record.id, entries, namesStart, namesSize: b.length - namesStart, namePadding: 0,
                fields: [field('nid', 0, 8, e.nid, 'Target inode NID.'), field('nameoff', 8, 2, e.nameoff, 'Name offset within this directory block.'), field('file_type', 10, 1, e.fileType, '1 = regular file; 2 = directory.'), field('reserved', 11, 1, 0, 'Reserved byte.')],
                references: [ref(record.id, 'Owning inode'), ...entries.map(e => ref(e.target, `${e.name} · NID ${e.nid}`))],
                description: `${entries.length} directory entries and ${b.length - namesStart} name bytes read from the image.`, note: `Field values describe entry “${e.name}”.`, doc: 'directories' });
            inode.references.push(ref(id, 'Directory content'));
        } else if (record.compression) {
            addCompressedRegions(record, inode, add, B);
        } else if (record.chunks) {
            const c = record.chunks, id = `chunk-index-${group}`, children = [];
            for (const [i, e] of c.entries.entries()) {
                const childId = `${id}-entry-${i}`, at = i * c.entrySize, b = c.bytes;
                const fields = c.entrySize === 8 ? [numericField(b, 'startblk_hi', at, 2, 'High address bits; zero without 48-bit addressing.'), numericField(b, 'device_id', at + 2, 2, '0 uses unified addressing (primary in these images); 1 selects the additional device.'), numericField(b, 'startblk', at + 4, 4, 'Chunk start block on the selected device.')]
                    : [numericField(b, 'startblk', at, 4, 'Chunk start block on the primary device.')];
                for (const f of fields) f.offset -= at;
                const child = { id: childId, parentId: id, kind: 'chunk-index', title: `${record.path} · chunk ${i}`, short: `Chunk ${i}`, start: c.start + at, size: c.entrySize,
                    fields, references: [ref(record.id, 'Owning inode')], description: `Logical bytes [${e.logical}, ${e.logical + e.length}) map to ${spaceId(e.space)} byte ${e.start}.`,
                    formula: `${e.blkaddr} × ${B} = ${e.start}`, docPage: 'chunked_format', doc: 'chunk-entry-formats' };
                if (spaceId(e.space) !== 'primary') child.references.push(ref('device-table', 'Device address table'));
                children.push(child); payloads.push({ ...e, record, child, chunk: true });
            }
            add({ id, kind: 'chunk-index', title: `${record.path} · chunk addresses`, short: 'Chunk addresses', start: c.start, size: c.bytes.length,
                group, ownerId: record.id, children, references: [ref(record.id, 'Owning inode')], description: `${c.entries.length} recorded ${c.entrySize}-byte addresses; ${c.chunkSize}-byte logical chunks.`, docPage: 'chunked_format', doc: 'chunk-entry-formats' });
            inode.references.push(ref(id, 'Chunk address table'));
        } else {
            for (const [i, e] of record.data.entries()) {
                const tail = e.length < B, id = record.data.length === 1 ? `data-${group}` : tail ? `tail-${group}` : `data-${group}-${i}`;
                add({ id, kind: e.inline ? 'inline' : 'data', title: `${record.path} · ${tail ? 'tail' : 'data'}`, short: e.inline ? 'Inline data' : 'File data', start: e.start, size: e.length,
                    space: spaceId(e.space), group: e.inline ? group : `${group}-data`, ownerId: record.id, mapping: { logical: e.logical, length: e.length, storage: e.inline ? 'Inline after inode and xattrs' : 'External blocks', owner: record.path },
                    references: [ref(record.id, 'Owning inode')], description: `Logical bytes [${e.logical}, ${e.logical + e.length}) of ${record.path}.`,
                    formula: e.inline ? `${record.start} + ${record.bytes.length} + ${record.xattr?.bytes.length || 0} = ${e.start}` : `${number(record.bytes, 16, 4)} × ${B} + ${e.logical} = ${e.start}`, doc: 'inode-data-layouts' });
                inode.references.push(ref(id, 'File content'));
            }
        }
    }
    // Multiple logical chunks may reference the same physical payload, including
    // a final partial chunk. Draw their physical union once, with all consumers.
    for (const space of spaces) {
        const sorted = payloads.filter(p => spaceId(p.space) === space.id).sort((a, b) => a.start - b.start);
        const unions = [];
        for (const p of sorted) {
            let u = unions.at(-1);
            if (!u || p.start >= u.end) { u = { start: p.start, end: p.start + p.length, consumers: [] }; unions.push(u); }
            u.end = Math.max(u.end, p.start + p.length); u.consumers.push(p);
        }
        for (const u of unions) {
            const id = `chunk-data-${space.id}-${u.start}`, consumers = u.consumers;
            const owners = [...new Map(consumers.map(p => [p.record.id, p.record])).values()];
            const r = add({ id, kind: 'data', title: `${consumers.length > 1 ? 'Shared chunk' : consumers[0].record.path + ' · chunk'} payload`, short: consumers.length > 1 ? 'Shared chunk' : 'Chunk data',
                start: u.start, size: u.end - u.start, space: space.id,
                references: [...owners.map(r => ref(r.id, `${r.path} inode`)), ...consumers.map(p => ref(p.child.id, `${p.record.path} · logical ${p.logical}`))],
                description: consumers.length === 1 ? `Logical bytes [${consumers[0].logical}, ${consumers[0].logical + consumers[0].length}) of ${consumers[0].record.path}.`
                    : owners.map(r => `${r.path}: ${consumers.filter(p => p.record.id === r.id).length} chunk reference(s)`).join('; ') + '. These entries share the recorded physical bytes. Follow a reference to inspect its logical range.',
                docPage: 'chunked_format', doc: 'chunk-entry-formats' });
            if (consumers.length === 1) r.mapping = { logical: consumers[0].logical, length: r.size, storage: 'External chunk', owner: consumers[0].record.path };
            consumers.forEach(p => p.child.references.push(ref(id, 'Physical chunk payload')));
        }
    }
    for (const space of spaces) {
        const parts = regions.filter(r => r.space === space.id).sort((a, b) => a.start - b.start);
        let cursor = 0, previous;
        const gap = (start, size) => {
            const id = `unused-${space.id}-${start}`;
            return add({ id, kind: 'unused', title: 'Alignment / padding', short: 'Padding', start, size, space: space.id,
                description: 'Bytes outside the recorded structures and logical file content. This is not a free-space map.' });
        };
        const groupRegion = r => {
            const id = r.group || r.id;
            if (previous && previous.source === id && previous.start + previous.size === r.start) previous.size += r.size;
            else {
                const owner = s.inodes.find(i => i.id === r.ownerId);
                previous = { id: `${space.id}-${id}`, source: id, start: r.start, size: r.size, primary: r.id,
                    title: owner ? `${owner.path} · ${id.endsWith('-data') ? 'data' : 'inode'}` : r.title, kind: r.kind, ownerId: r.ownerId, space: space.id };
                // Preserve stable tree group identifiers across case switches.
                if (r.kind === 'inode') previous.id = r.group;
                groups.push(previous);
            }
        };
        for (const r of parts) {
            if (r.start < cursor) throw new Error(`Overlapping recorded region: ${r.id}`);
            if (r.start > cursor) {
                const g = gap(cursor, r.start - cursor);
                if (previous) g.group = previous.source;
                groupRegion(g);
            }
            groupRegion(r); cursor = r.start + r.size;
        }
        if (cursor > space.size) throw new Error(`Recorded structures exceed ${space.id}.`);
        if (cursor < space.size) {
            const g = gap(cursor, space.size - cursor);
            if (previous) g.group = previous.source;
            groupRegion(g);
        }
    }
    for (const g of groups) { g.label = g.title; g.detail = `${g.size} B`; g.weight = Math.min(2, Math.max(0.5, Math.sqrt(g.size / B))); }
    return { options: o, regions, groups, tree, addressSpaces: spaces, format: o.format, inline: o.inline, xattrs: o.xattrs,
        inodeSize: o.format === 'compact' ? 32 : 64, blockSize: B, blockCount: s.size / B, dataLayout: o.dataLayout, chunkSize: B * 2 ** o.chunkBits,
        featureCompat: number(s.superblock, 8, 4), featureIncompat: number(s.superblock, 80, 4),
        provenance: { kind: 'recorded-structures', tool: s.tool,
            ...(s.image ? { referenceImage: s.image, referenceSha256: s.sha256 } : {}) } };
}
