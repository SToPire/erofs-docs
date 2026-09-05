// Plans illustrative chunks; this module neither reads nor constructs an image.
// Documentation: src/ondisk/chunked_format.md, Chunk-based Structures and
// Multi-device Support. The 4/8-byte alignment and address-space fallback are
// checked against Linux v6.18 fs/erofs/data.c (erofs_map_blocks/erofs_map_dev):
// https://github.com/torvalds/linux/blob/v6.18/fs/erofs/data.c#L114
// Field definitions and feature bits:
// https://github.com/torvalds/linux/blob/v6.18/fs/erofs/erofs_fs.h
// device_id is independent of a special inode's i_u.rdev. Holes and 48-bit
// addressing are intentionally absent: the local Markdown does not define them.

const CHUNKED_FILE = 0x4;
const DEVICE_TABLE = 0x8;
const NULL_BLOCK = 0xffffffff;
const PRIMARY = 'primary';
const EXTRA = 'device-1';
const field = (name, offset, size, value, description) => ({ name, offset, size, value, description });
const reference = (target, label) => ({ target, label });
const align = (value, unit) => Math.ceil(value / unit) * unit;

function integer(value, name, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
        throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
    return value;
}

function choice(value, name, allowed) {
    if (!allowed.includes(value)) throw new RangeError(`Unsupported ${name}: ${value}.`);
    return value;
}

function endpoint(start, size, name) {
    return integer(start + size, `${name} end`);
}

/**
 * @param {{chunkFormat?: 'blockmap'|'indexes', chunkBits?: number,
 *   deviceMode?: 'primary'|'unified'|'explicit', sharing?: boolean}} options
 * @param {{blockSize: number, files: Array<{key: string, label: string,
 *   size: number, inode: {id: string, start: number, size: number,
 *   space?: string, nid?: number}, xattrSize?: number, dataStartBlock: number,
 *   regionBudgetBlocks: number}>, deviceTableStart?: number,
 *   extraDeviceBlocks?: number, nuniaddr?: number, primaryBlocks?: number,
 *   sharedChunkBlock?: number|{space: 'primary'|'device-1', block: number}}} context
 *
 * Top-level regions contain disjoint physical bytes, identified by `space`.
 * `children` are complete records inside their parent, with absolute start and
 * parentId; each field offset is relative to its containing record.
 * Data size excludes EOF padding; allocatedSize reserves complete blocks.
 * inodeFields/inodeReferences are arrays keyed by inode.id. The caller removes
 * inodeFieldRemovals before installing the union overrides and preserves other
 * inode references, such as the directory and xattr body.
 */
export function planChunks(options = {}, context) {
    if (!context || !Array.isArray(context.files))
        throw new TypeError('A chunk context with files is required.');
    const chunkFormat = choice(options.chunkFormat ?? 'blockmap', 'chunkFormat', ['blockmap', 'indexes']);
    const deviceMode = choice(options.deviceMode ?? 'primary', 'deviceMode', ['primary', 'unified', 'explicit']);
    const chunkBits = integer(options.chunkBits ?? 0, 'chunkBits', 0, 31);
    const sharing = options.sharing ?? false;
    if (typeof sharing !== 'boolean') throw new TypeError('sharing must be a boolean.');
    if (deviceMode === 'explicit' && chunkFormat !== 'indexes')
        throw new RangeError('Explicit device IDs require 8-byte chunk indexes.');
    const B = integer(context.blockSize, 'blockSize', 512);
    if (!Number.isInteger(Math.log2(B))) throw new RangeError('blockSize must be a power of two.');
    const C = integer(B * 2 ** chunkBits, 'chunk size', B);
    const U = chunkFormat === 'indexes' ? 8 : 4;
    const hasDevice = deviceMode !== 'primary';
    const extraBlocks = hasDevice ? integer(context.extraDeviceBlocks ?? 16, 'extraDeviceBlocks', 1, NULL_BLOCK) : 0;
    const uniaddr = hasDevice ? integer(context.nuniaddr ?? 0x1000, 'nuniaddr', deviceMode === 'unified' ? 1 : 0, NULL_BLOCK - 1) : 0;
    if (hasDevice && uniaddr + extraBlocks > NULL_BLOCK)
        throw new RangeError('The extra device range must not include the reserved null block address.');

    const regions = [];
    const reserved = new Map([[PRIMARY, []], [EXTRA, []]]);
    const inodeFields = {};
    const inodeFieldRemovals = {};
    const inodeReferences = {};
    const fileMappings = {};
    const keys = new Set();
    const inodeIds = new Set();
    const add = value => {
        const region = { fields: [], references: [], space: PRIMARY, docPage: 'chunked_format', ...value };
        regions.push(region);
        return region;
    };
    const collisions = (space, start, end) => reserved.get(space).filter(item => start < item.end && item.start < end);
    const reserve = (space, start, size, owner) => {
        integer(start, `${owner} start`);
        integer(size, `${owner} reserved size`, 1);
        const end = endpoint(start, size, owner);
        const overlap = collisions(space, start, end)[0];
        if (overlap) throw new RangeError(`${owner} overlaps ${overlap.owner} in ${space}.`);
        reserved.get(space).push({ start, end, owner });
    };

    const files = context.files.map(file => {
        if (typeof file.key !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(file.key) || keys.has(file.key))
            throw new TypeError('File keys must be unique nonempty identifier strings.');
        keys.add(file.key);
        if (!file.inode || typeof file.inode.id !== 'string' || !file.inode.id || inodeIds.has(file.inode.id))
            throw new TypeError('Every file needs a unique inode ID.');
        inodeIds.add(file.inode.id);
        const space = file.inode.space ?? PRIMARY;
        if (space !== PRIMARY) throw new RangeError('Core inode metadata must be on the primary device.');
        const start = integer(file.inode.start, `${file.key} inode start`);
        if (start % 32) throw new RangeError('Inodes must begin at 32-byte slot boundaries.');
        const inodeSize = choice(file.inode.size, 'inode size', [32, 64]);
        const xattrSize = integer(file.xattrSize ?? 0, `${file.key} xattrSize`);
        if (xattrSize % 4) throw new RangeError('The xattr body must be 4-byte aligned.');
        const size = integer(file.size, `${file.key} file size`);
        const dataStartBlock = integer(file.dataStartBlock, `${file.key} dataStartBlock`, 0, NULL_BLOCK - 1);
        const budget = integer(file.regionBudgetBlocks, `${file.key} regionBudgetBlocks`);
        if (dataStartBlock + budget > NULL_BLOCK)
            throw new RangeError('A primary data interval must not include the null block address.');
        reserve(PRIMARY, start, inodeSize + xattrSize, `${file.key} inode and xattrs`);
        return { ...file, label: file.label || `File ${file.key.toUpperCase()}`, size,
            inode: { ...file.inode, space }, xattrSize, dataStartBlock,
            regionBudgetBlocks: budget, chunkCount: Math.ceil(size / C) };
    });

    // Reserve all metadata first so data allocation cannot hide a conflicting
    // caller placement. Empty files have no physical address-array region.
    const arrays = new Map();
    for (const file of files) {
        const { inode } = file;
        inodeFields[inode.id] = [
            field('i_format', 0, 2, inode.size === 64 ? 9 : 8,
                'Bit 0 selects the inode size; bits 1–3 select CHUNK_BASED (4).'),
            field('i_u.c.format', 16, 2, chunkBits | (U === 8 ? 0x20 : 0),
                `Bits 0–4 give ${chunkBits}; chunks are ${B} × 2^${chunkBits} = ${C} bytes. Bit 5 selects ${U}-byte entries.`),
            field('i_u.c.reserved', 18, 2, 0, 'Reserved half of the 4-byte chunk summary.'),
        ];
        inodeFieldRemovals[inode.id] = ['i_u', 'i_u.startblk', 'i_u.rdev', 'i_u.c.format', 'i_u.c.reserved'];
        inodeReferences[inode.id] = [];
        fileMappings[file.key] = { inodeId: inode.id, dataLayout: 'chunked', chunkSize: C,
            entrySize: U, indexRegionId: null, chunks: [] };
        if (!file.chunkCount) continue;
        const metadataEnd = endpoint(inode.start, inode.size + file.xattrSize, `${file.key} metadata`);
        const start = align(metadataEnd, U);
        if (start !== metadataEnd) {
            reserve(PRIMARY, metadataEnd, start - metadataEnd, `${file.key} index alignment`);
            add({ id: `chunk-align-${file.key}`, kind: 'unused', title: 'Chunk-index alignment padding', short: 'Alignment',
                start: metadataEnd, size: start - metadataEnd, owner: file.label,
                description: `The ${U}-byte address array begins at ALIGN(inode + xattrs, ${U}).`,
                references: [reference(`chunk-index-${file.key}`, 'Aligned address array')], doc: 'chunk-based-structures' });
        }
        const size = integer(file.chunkCount * U, `${file.key} index size`, U);
        reserve(PRIMARY, start, size, `${file.key} address array`);
        const array = add({ id: `chunk-index-${file.key}`, kind: 'chunk-index',
            title: `${file.label} · chunk ${U === 8 ? 'indexes' : 'block map'}`, short: U === 8 ? 'Chunk indexes' : 'Chunk block map',
            start, size, owner: file.label, children: [],
            description: `${file.chunkCount} entries map ${C}-byte logical chunks. An entry describes a chunk, not every filesystem block.`,
            formula: `ALIGN(${inode.start} + ${inode.size} + ${file.xattrSize}, ${U}) = ${start}`,
            references: [reference(inode.id, 'Owning inode')], doc: 'chunk-based-structures' });
        arrays.set(file.key, array);
        inodeReferences[inode.id].push(reference(array.id, 'Per-chunk address array'));
        Object.assign(fileMappings[file.key], { indexRegionId: array.id, indexStart: start, indexSpace: PRIMARY });
    }

    let deviceSlot;
    let tableStart = 0;
    if (hasDevice) {
        tableStart = integer(context.deviceTableStart, 'deviceTableStart', 0, 0xffff * 128);
        if (tableStart % 128) throw new RangeError('The device table must be aligned to a 128-byte slot.');
        reserve(PRIMARY, tableStart, 128, 'device table');
        deviceSlot = { id: 'device-slot-1', kind: 'device-table', space: PRIMARY, start: tableStart, size: 128,
            parentId: 'device-table', title: 'Extra device 1', short: 'Device 1', docPage: 'chunked_format', doc: 'device-table',
            description: 'The first extra-device slot. Device ID 1 selects this record; unified addresses use its uniaddr range.',
            fields: [
                field('tag', 0, 64, 'erofs-extra-1', 'Example identifier. Some kernel mounting paths can use the tag as a device path.'),
                field('blocks', 64, 4, extraBlocks, 'Capacity of this extra device, in filesystem blocks.'),
                field('uniaddr', 68, 4, uniaddr, 'Start of this device in the unified block address space.'),
                field('_dontcare_', 72, 4, 0, '48-bit extension fields; ignored in this example.'),
                field('_reserved_', 76, 52, 0, 'Reserved bytes, filled with zero.'),
            ], references: [] };
        add({ id: 'device-table', kind: 'device-table', title: 'Device table', short: 'Device table',
            start: tableStart, size: 128, children: [deviceSlot],
            description: 'One 128-byte slot describes the extra device. The primary device has no slot in this array.',
            formula: `${tableStart / 128} × 128 = ${tableStart}`,
            references: [reference(deviceSlot.id, 'Extra device 1')], doc: 'device-table' });
    }

    const allocate = (space, first, count, blocks, owner, preferred = first) => {
        const limit = first + count;
        const fits = block => block >= first && block + blocks <= limit &&
            !collisions(space, block * B, (block + blocks) * B).length;
        let block = preferred;
        if (!fits(block)) {
            block = first;
            while (block + blocks <= limit) {
                const overlap = collisions(space, block * B, (block + blocks) * B);
                if (!overlap.length) break;
                block = Math.max(...overlap.map(item => Math.ceil(item.end / B)));
            }
        }
        if (!fits(block)) throw new RangeError(`${owner} does not fit its allocated ${space} interval.`);
        reserve(space, block * B, blocks * B, owner);
        return block;
    };
    const makePayload = (id, space, block, length, shared = false) => add({
        id, kind: 'data', space, start: block * B, size: length, allocatedSize: align(length, B),
        title: shared ? 'Shared chunk payload' : 'Chunk payload', short: shared ? 'Shared chunk' : 'Chunk data',
        description: shared ? 'Two complete, identical logical chunks reference these same physical bytes.'
            : `${length} valid file bytes. Any remaining bytes in the allocation are padding beyond EOF.`,
        shared, mappings: [], doc: 'chunk-based-structures',
    });

    let sharedPayload = null;
    let sharedFiles = [];
    if (sharing) {
        const eligible = files.filter(file => file.size >= C);
        const b = eligible.find(file => file.key === 'b');
        const c = eligible.find(file => file.key === 'c');
        sharedFiles = b && c ? [b, c] : eligible.slice(0, 2);
        if (sharedFiles.length < 2)
            throw new RangeError('Sharing needs two files containing at least one complete chunk.');
        const configured = context.sharedChunkBlock;
        const defaultSpace = hasDevice ? EXTRA : PRIMARY;
        const space = typeof configured === 'object' && configured !== null ? configured.space : defaultSpace;
        choice(space, 'shared chunk space', hasDevice ? [PRIMARY, EXTRA] : [PRIMARY]);
        const block = integer(typeof configured === 'object' && configured !== null ? configured.block
            : configured ?? (space === EXTRA ? 0 : sharedFiles[0].dataStartBlock), 'sharedChunkBlock', 0, NULL_BLOCK - 1);
        const count = C / B;
        if (block + count > NULL_BLOCK || (space === EXTRA && block + count > extraBlocks))
            throw new RangeError('The shared chunk exceeds its device capacity.');
        if (space === PRIMARY) {
            // A caller may reserve a separate primary interval. If it intersects
            // a file's supplied interval, it must fit entirely inside that group.
            for (const file of files) {
                const end = file.dataStartBlock + file.regionBudgetBlocks;
                if (block < end && file.dataStartBlock < block + count &&
                    (block < file.dataStartBlock || block + count > end))
                    throw new RangeError('The shared chunk crosses a supplied file interval.');
            }
        }
        reserve(space, block * B, C, 'shared chunk');
        sharedPayload = makePayload('chunk-data-shared', space, block, C, true);
    }

    const remoteFile = files.find(file => file.key === 'b' && file.chunkCount) || files.find(file => file.chunkCount);
    const remoteChunk = remoteFile && remoteFile.chunkCount > 1 ? 1 : 0;
    for (const file of files) {
        const array = arrays.get(file.key);
        for (let number = 0; number < file.chunkCount; number++) {
            const logical = number * C;
            const length = Math.min(C, file.size - logical);
            const allocatedBlocks = Math.ceil(length / B);
            let payload;
            if (sharedPayload && number === 0 && sharedFiles.includes(file)) payload = sharedPayload;
            else {
                const space = hasDevice && file === remoteFile && number === remoteChunk ? EXTRA : PRIMARY;
                let preferred = file.dataStartBlock;
                if (!hasDevice && !sharing && B === 4096 && chunkBits === 0 && file.key === 'b' && file.chunkCount === 3)
                    preferred += [0, 2, 1][number];
                const block = space === EXTRA
                    ? allocate(EXTRA, 0, extraBlocks, allocatedBlocks, `${file.key} chunk ${number}`)
                    : allocate(PRIMARY, file.dataStartBlock, file.regionBudgetBlocks, allocatedBlocks, `${file.key} chunk ${number}`, preferred);
                payload = makePayload(`chunk-data-${file.key}-${number}`, space, block, length);
                payload.title = `${file.label} · chunk ${number} payload`;
                payload.short = `${file.label} · chunk ${number}`;
            }
            const block = payload.start / B;
            if (payload.space === PRIMARY && hasDevice && uniaddr && block < uniaddr + extraBlocks &&
                uniaddr < block + payload.allocatedSize / B)
                throw new RangeError('A primary payload overlaps the extra device unified-address interval.');
            const deviceId = payload.space === EXTRA && deviceMode === 'explicit' ? 1 : 0;
            const startblk = payload.space === EXTRA && !deviceId ? uniaddr + block : block;
            integer(startblk, 'encoded chunk block address', 0, NULL_BLOCK - 1);
            const entryId = `chunk-index-${file.key}-${number}`;
            const entry = {
                id: entryId, kind: 'chunk-index', parentId: array.id, space: PRIMARY,
                start: array.start + number * U, size: U, owner: file.label,
                title: `${file.label} · chunk ${number} ${U === 8 ? 'index' : 'block map entry'}`,
                short: `Chunk ${number}`, docPage: 'chunked_format',
                doc: U === 8 ? 'chunk-index-entry-8-bytes' : 'block-map-entry-4-bytes',
                description: `Logical bytes [${logical}, ${logical + length}) map to ${payload.space}, local block ${block}.`,
                fields: U === 8 ? [
                    field('_dontcare_', 0, 2, 0, 'High block-address extension; ignored without the 48-bit chunk format.'),
                    field('device_id', 2, 2, deviceId, deviceId ? 'Device 1 is selected directly; startblk is device-local.'
                        : 'Resolve startblk through the unified address space, falling back to the primary device.'),
                    field('startblk', 4, 4, startblk, deviceId ? 'Starting block on the selected extra device.' : 'Starting block in the unified address space.'),
                ] : [field('startblk', 0, 4, startblk, 'Starting block in the unified address space; no device ID is stored in this format.')],
                formula: payload.space === EXTRA && !deviceId
                    ? `local block = ${startblk} − ${uniaddr} = ${block}`
                    : `physical byte = ${block} × ${B} + (logical offset − ${logical})`,
                references: [reference(payload.id, `Chunk ${number} payload · ${payload.space}`),
                    ...(payload.space === EXTRA ? [reference('device-slot-1', 'Extra-device address information')] : [])],
            };
            array.children.push(entry);
            array.references.push(reference(entry.id, `Chunk ${number} address entry`));
            payload.references.push(reference(entry.id, `${file.label} · chunk ${number} address entry`));
            const mapping = { index: number, entryId, payloadId: payload.id, logicalStart: logical,
                length, allocatedBytes: payload.allocatedSize, space: payload.space, block,
                encodedStartBlock: startblk, deviceId, shared: payload.shared };
            fileMappings[file.key].chunks.push(mapping);
            payload.mappings.push({ fileKey: file.key, inodeId: file.inode.id, owner: file.label, ...mapping });
        }
    }

    for (const payload of regions.filter(region => region.kind === 'data')) {
        const owners = [...new Set(payload.mappings.map(mapping => mapping.owner))];
        payload.owner = owners.join(' / ');
        payload.mapping = { logical: payload.mappings[0].logicalStart, length: payload.size,
            storage: payload.shared ? 'Shared external chunk' : 'External chunk', owner: payload.owner,
            physicalBlock: payload.start / B, space: payload.space };
        if (deviceSlot && payload.space === EXTRA)
            deviceSlot.references.push(reference(payload.id, payload.title));
    }
    const primaryBlocks = Math.max(context.primaryBlocks === undefined ? 0 : integer(context.primaryBlocks, 'primaryBlocks'),
        ...files.map(file => file.dataStartBlock + file.regionBudgetBlocks),
        ...reserved.get(PRIMARY).map(item => Math.ceil(item.end / B)), 0);
    const addressSpaces = [{ id: PRIMARY, label: 'Primary device', deviceId: 0, blockSize: B, blocks: primaryBlocks }];
    if (hasDevice) addressSpaces.push({ id: EXTRA, label: 'Extra device 1', deviceId: 1,
        blockSize: B, blocks: extraBlocks, uniaddr });
    return {
        regions, inodeFields, inodeFieldRemovals, inodeReferences,
        featureIncompat: CHUNKED_FILE | (hasDevice ? DEVICE_TABLE : 0),
        sbFields: [
            field('extra_devices', 0x56, 2, hasDevice ? 1 : 0, 'Number of extra devices; valid when DEVICE_TABLE is set.'),
            field('devt_slotoff', 0x58, 2, hasDevice ? tableStart / 128 : 0, 'Device-table byte offset divided by 128; valid when DEVICE_TABLE is set.'),
        ],
        addressSpaces, fileMappings, chunkSize: C, chunkBits, entrySize: U, deviceMode, sharing,
    };
}
