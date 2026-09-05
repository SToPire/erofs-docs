// Authored xattr examples. Addresses belong to the explicitly named space;
// decoded metabox/packed offsets are never physical image offsets.
// Evidence: Linux ff68e5f557f69a08fdcfa4ce8b1b809d63bd4f45,
// fs/erofs/{erofs_fs.h,xattr.c,super.c}; erofs-utils lib/{xattr.c,inode.c}.
const field = (name, offset, size, value, description) => ({ name, offset, size, value, description });
const reference = (target, label) => ({ target, label });
const align = (value, unit = 4) => Math.ceil(value / unit) * unit;
const bytes = text => new TextEncoder().encode(text);
const hex = value => `0x${(value >>> 0).toString(16).padStart(8, '0')}`;
const keys = ['root', 'docs', 'assets', 'a', 'b', 'c'];
const ownerName = key => ({ root: '/', docs: '/docs/', assets: '/docs/assets/', a: '/a', b: '/docs/b', c: '/docs/assets/c' })[key];
const inodeId = key => key === 'root' ? 'root-inode' : `inode-${key}`;
const namespace = {
    user: { index: 1, prefix: 'user.', suffix: 'note' },
    trusted: { index: 4, prefix: 'trusted.', suffix: 'note' },
    security: { index: 6, prefix: 'security.', suffix: 'note' },
    'acl-access': { index: 2, prefix: 'system.posix_acl_access', suffix: '' },
    'acl-default': { index: 3, prefix: 'system.posix_acl_default', suffix: '' },
};

// XXH32 is the exact hash used by the EROFS name filter. Hashing the authored
// names needs no image, file contents, external dependency, or async operation.
function xxh32(input, seed) {
    const p1 = 0x9e3779b1, p2 = 0x85ebca77, p3 = 0xc2b2ae3d, p4 = 0x27d4eb2f, p5 = 0x165667b1;
    const rot = (value, count) => (value << count | value >>> (32 - count)) >>> 0;
    const word = at => (input[at] | input[at + 1] << 8 | input[at + 2] << 16 | input[at + 3] << 24) >>> 0;
    const round = (value, lane) => Math.imul(rot((value + Math.imul(lane, p2)) >>> 0, 13), p1) >>> 0;
    let at = 0, hash;
    if (input.length >= 16) {
        let v1 = (seed + p1 + p2) >>> 0, v2 = (seed + p2) >>> 0, v3 = seed >>> 0, v4 = (seed - p1) >>> 0;
        do {
            v1 = round(v1, word(at)); v2 = round(v2, word(at + 4));
            v3 = round(v3, word(at + 8)); v4 = round(v4, word(at + 12));
            at += 16;
        } while (at <= input.length - 16);
        hash = (rot(v1, 1) + rot(v2, 7) + rot(v3, 12) + rot(v4, 18)) >>> 0;
    } else hash = (seed + p5) >>> 0;
    hash = (hash + input.length) >>> 0;
    while (at <= input.length - 4) {
        hash = Math.imul(rot((hash + Math.imul(word(at), p3)) >>> 0, 17), p4) >>> 0;
        at += 4;
    }
    while (at < input.length) {
        hash = Math.imul(rot((hash + Math.imul(input[at++], p5)) >>> 0, 11), p1) >>> 0;
    }
    hash ^= hash >>> 15;
    hash = Math.imul(hash, p2) >>> 0;
    hash ^= hash >>> 13;
    hash = Math.imul(hash, p3) >>> 0;
    return (hash ^ hash >>> 16) >>> 0;
}

// Each name supplies its base namespace index and its full name AFTER that
// short namespace. For a long prefix, name is infix + stored suffix.
export function xattrNameFilter(names) {
    let present = 0;
    for (const { baseIndex, name } of names) {
        const bit = xxh32(bytes(name), (0x25bbe08f + baseIndex) >>> 0) & 31;
        present = (present | 1 << bit) >>> 0;
    }
    return (~present) >>> 0;
}

function aclValue(directoryAccess = false) {
    // POSIX_ACL_XATTR_VERSION=2 plus USER_OBJ, GROUP_OBJ and OTHER records.
    // Each record is u16 tag, u16 permissions, u32 ACL_UNDEFINED_ID.
    const data = new Uint8Array(28);
    const view = new DataView(data.buffer);
    view.setUint32(0, 2, true);
    for (const [i, [tag, permissions]] of [[1, directoryAccess ? 7 : 6], [4, directoryAccess ? 5 : 4], [32, directoryAccess ? 5 : 4]].entries()) {
        view.setUint16(4 + i * 8, tag, true);
        view.setUint16(6 + i * 8, permissions, true);
        view.setUint32(8 + i * 8, 0xffffffff, true);
    }
    return data;
}

function entry({ purpose, baseIndex, prefix, suffix = '', infix = '', prefixId, value, valueLabel, valueDescription }) {
    const nameSize = bytes(suffix).length;
    const used = 4 + nameSize + value.length;
    return {
        purpose, baseIndex, prefix, suffix, infix, prefixId, value, valueLabel, valueDescription,
        nameIndex: prefixId === undefined ? baseIndex : 0x80 | prefixId,
        fullName: prefix + infix + suffix, hashName: infix + suffix,
        size: align(used), nameSize, used,
    };
}

function entryFields(record) {
    const result = [
        field('e_name_len', 0, 1, record.nameSize, record.nameSize ? 'Stored name-suffix length in bytes. The namespace and any table prefix are omitted.' : 'No name suffix is stored. The namespace or selected long prefix supplies the complete attribute name.'),
        field('e_name_index', 1, 1, record.nameIndex, record.prefixId === undefined
            ? `${record.baseIndex} selects ${record.prefix}.`
            : `0x80 | ${record.prefixId} selects long-prefix table entry ${record.prefixId}. Its base namespace is ${record.baseIndex}.`),
        field('e_value_size', 2, 2, record.value.length, 'Stored value length in bytes, excluding entry padding.'),
    ];
    if (record.nameSize) result.push(field('e_name', 4, record.nameSize, record.suffix, `Stored suffix. Reconstructed name: ${record.fullName}. No NUL terminator is stored.`));
    result.push(field('e_value', 4 + record.nameSize, record.value.length, record.valueLabel, record.valueDescription || 'Opaque attribute-value bytes immediately following the stored suffix.'));
    if (record.size > record.used) result.push(field('padding', record.used, record.size - record.used, 0, 'The entire entry is rounded up to four bytes.'));
    return result;
}

function entryRegion(record, id, start, space, extra = {}) {
    return {
        id, kind: 'xattr', title: record.fullName, short: record.fullName, start, size: record.size, space,
        description: `${record.fullName}: ${record.valueLabel}. This entry occupies ${record.size} bytes including its header and any padding.`,
        fields: entryFields(record), references: record.prefixId === undefined ? [] : [reference(`prefix-table-${record.prefixId}`, `Long-prefix table entry ${record.prefixId}`)],
        formula: `ALIGN(4 + ${record.nameSize} + ${record.value.length}, 4) = ${record.size} B`,
        docPage: 'xattrs', doc: record.purpose === 'fingerprint' ? 'image-share-xattrs' : 'xattr-entry-record', ...extra,
    };
}

function requireOffset(value, name, unit) {
    if (!Number.isSafeInteger(value) || value < 0 || value % unit) throw new RangeError(`${name} must be a nonnegative safe integer aligned to ${unit} bytes.`);
    return value;
}

export function planXattrs(options = {}, context = {}) {
    const {
        xattrs = 'none', xattrNamespace = 'user', prefixStorage = 'off', sharedStorage = 'primary',
        xattrFilter = 'off', imageShare = false,
    } = options;
    for (const [name, value, allowed] of [
        ['xattrs', xattrs, ['none', 'inline', 'shared', 'shared-only']],
        ['xattrNamespace', xattrNamespace, Object.keys(namespace)],
        ['prefixStorage', prefixStorage, ['off', 'standalone', 'physical-fallback', 'packed', 'metabox']],
        ['sharedStorage', sharedStorage, ['primary', 'metabox']],
        ['xattrFilter', xattrFilter, ['off', 'on', 'reserved']],
    ]) if (!allowed.includes(value)) throw new RangeError(`Unsupported ${name}: ${value}`);
    if (typeof imageShare !== 'boolean') throw new TypeError('imageShare must be a boolean.');
    if (xattrs === 'none' && (prefixStorage !== 'off' || xattrFilter !== 'off' || imageShare)) throw new RangeError('Advanced xattr options require xattrs to be enabled.');
    if (imageShare && prefixStorage === 'off') throw new RangeError('Image-share xattrs require a long-prefix table location.');
    const B = context.blockSize ?? 4096;
    if (!Number.isSafeInteger(B) || B < 512 || !Number.isInteger(Math.log2(B))) throw new RangeError('blockSize must be a power of two of at least 512 bytes.');
    const selectedKeys = context.eligibleKeys ?? keys;
    const selectedRegularKeys = context.regularKeys ?? ['a', 'b', 'c'];
    if (!Array.isArray(selectedKeys) || selectedKeys.some(key => !keys.includes(key))) throw new RangeError('eligibleKeys must identify an example directory or file.');
    if (!Array.isArray(selectedRegularKeys) || selectedRegularKeys.some(key => !['a', 'b', 'c'].includes(key))) throw new RangeError('regularKeys must contain only a, b, or c.');
    const eligibleKeys = keys.filter(key => selectedKeys.includes(key));
    const regularKeys = eligibleKeys.filter(key => selectedRegularKeys.includes(key));
    const shared = (xattrs === 'shared' || xattrs === 'shared-only') && eligibleKeys.length > 0;
    const onlyShared = xattrs === 'shared-only';
    const neededMetabox = prefixStorage === 'metabox' || shared && sharedStorage === 'metabox';
    const neededPacked = prefixStorage === 'packed';
    if (neededPacked && neededMetabox) throw new RangeError('Packed prefixes cannot coexist with shared xattrs in metabox: METABOX takes precedence when PLAIN_XATTR_PFX is clear.');
    if (neededMetabox && (!Number.isSafeInteger(context.metaboxNid) || context.metaboxNid < 0)) throw new RangeError('A valid physical metaboxNid is required.');
    if (neededPacked && (!Number.isSafeInteger(context.packedNid) || context.packedNid <= 0)) throw new RangeError('A nonzero packedNid is required.');
    const sharedSpace = sharedStorage === 'metabox' ? 'metabox' : 'primary';
    const sharedStart = shared ? sharedSpace === 'metabox' ? B : requireOffset(context.sharedPhysicalStart, 'sharedPhysicalStart', B) : 0;
    const prefixSpace = ['standalone', 'physical-fallback'].includes(prefixStorage) ? 'primary' : prefixStorage;
    if (prefixStorage === 'physical-fallback' && neededMetabox) throw new RangeError('Physical prefix fallback requires no metabox routing.');
    const prefixStart = prefixStorage === 'off' ? 0 : prefixSpace === 'primary' ? requireOffset(context.prefixPhysicalStart, 'prefixPhysicalStart', 4) : 2 * B;
    const local = Object.fromEntries(keys.map(key => [key, []]));
    const sharedFor = Object.fromEntries(keys.map(key => [key, []]));
    const sharedRecords = [];
    const sharedUsers = new Map();
    const prefixes = [];
    const regions = [];
    const pushShared = (record, users, id) => {
        if (!users.length) return;
        record.globalId = id;
        sharedRecords.push(record);
        sharedUsers.set(record, users);
        for (const key of users) sharedFor[key].push(record);
    };
    if (shared) pushShared(entry({
        purpose: 'owner', baseIndex: 1, prefix: 'user.', suffix: 'owner', value: bytes('erofs'), valueLabel: 'erofs',
    }), eligibleKeys, 'xattr-shared-owner');
    if (xattrs !== 'none' && !onlyShared) {
        const ns = namespace[xattrNamespace];
        for (const key of eligibleKeys) {
            if (xattrNamespace === 'acl-default' && !(context.directoryKeys || ['root']).includes(key)) continue;
            const acl = xattrNamespace.startsWith('acl-');
            const directoryAccess = (context.directoryKeys || ['root']).includes(key) && xattrNamespace === 'acl-access';
            local[key].push(entry({
                purpose: 'main', baseIndex: ns.index, prefix: ns.prefix, suffix: ns.suffix,
                value: acl ? aclValue(directoryAccess) : bytes('demo'),
                valueLabel: acl ? directoryAccess ? 'POSIX ACL: user::rwx, group::r-x, other::r-x' : 'POSIX ACL: user::rw-, group::r--, other::r--' : 'demo',
                valueDescription: acl ? '28 stored bytes: little-endian ACL version 2 (4 B), then USER_OBJ, GROUP_OBJ and OTHER records (8 B each). Each record has a u16 tag, u16 permissions and u32 ACL_UNDEFINED_ID. The default ACL is illustrated only on the directory.' : undefined,
            }));
        }
    }
    if (prefixStorage !== 'off') {
        prefixes.push({ baseIndex: 4, prefix: 'trusted.', infix: 'overlay.' });
        const opaque = entry({ purpose: 'prefix', baseIndex: 4, prefix: 'trusted.', infix: 'overlay.', suffix: 'opaque', prefixId: 0, value: bytes('y'), valueLabel: 'y' });
        if (onlyShared) pushShared(opaque, eligibleKeys, 'xattr-shared-prefix');
        else for (const key of eligibleKeys) local[key].push(opaque);
    }
    if (imageShare) {
        const prefixId = prefixes.length;
        prefixes.push({ baseIndex: 1, prefix: 'user.', infix: 'erofs.fingerprint.v1' });
        for (const key of regularKeys) {
            const i = ['a', 'b', 'c'].indexOf(key);
            // A byte-valid illustrative digest, not a claim to have hashed a file.
            const value = new Uint8Array(39);
            value.set(bytes('sha256:'));
            for (let n = 0; n < 32; n++) value[7 + n] = (i * 67 + n * 11) & 255;
            const fingerprint = entry({
                purpose: 'fingerprint', baseIndex: 1, prefix: 'user.', infix: 'erofs.fingerprint.v1', prefixId, value,
                valueLabel: `sha256: + 32 raw digest bytes (${ownerName(key)} example)`,
                valueDescription: '39 stored bytes: the 7-byte ASCII prefix sha256: followed by a raw 32-byte digest. These are illustrative bytes, not a hash computed from an image. A hex display would not change the stored length.',
            });
            if (onlyShared) pushShared(fingerprint, [key], `xattr-shared-fingerprint-${key}`);
            else local[key].push(fingerprint);
        }
    }
    let sharedBytes = 0;
    for (const record of sharedRecords) {
        record.sharedId = sharedBytes / 4;
        record.globalStart = sharedStart + sharedBytes;
        sharedBytes += record.size;
    }
    const sharedRefId = (key, index) => `xattr-${key}-shared-id${index ? `-${index}` : ''}`;
    if (sharedRecords.length) {
        const children = sharedRecords.map(record => entryRegion(record, record.globalId, record.globalStart, sharedSpace, {
            parentId: 'xattr-shared',
            references: [
                ...(record.prefixId === undefined ? [] : [reference(`prefix-table-${record.prefixId}`, `Long-prefix table entry ${record.prefixId}`)]),
                ...sharedUsers.get(record).map(key => reference(sharedRefId(key, sharedFor[key].indexOf(record)), `${ownerName(key)} · shared ID ${record.sharedId}`)),
            ],
        }));
        regions.push({
            id: 'xattr-shared', kind: 'xattr', title: 'Shared xattr area', short: 'Shared xattrs', start: sharedStart, size: sharedBytes, space: sharedSpace,
            description: `Each complete name/value entry is stored once. IDs count 4-byte units from ${sharedSpace === 'metabox' ? 'the shared base in the decoded metabox stream' : 'the physical shared base in the primary image'}.`,
            fields: children.map(child => field(child.short, child.start - sharedStart, child.size, child.short, child.description)),
            references: children.flatMap(child => child.references), children,
            formula: `${sharedStart / B} × ${B} + shared ID × 4 (${sharedSpace === 'primary' ? 'physical bytes' : 'metabox decoded bytes'})`,
            docPage: 'xattrs', doc: 'shared-xattr-area',
        });
    }
    let prefixBytes = 0;
    if (prefixes.length) {
        const children = prefixes.map((prefix, index) => {
            const infixSize = bytes(prefix.infix).length;
            const payloadSize = 1 + infixSize;
            const size = align(2 + payloadSize);
            const start = prefixStart + prefixBytes;
            prefixBytes += size;
            const fields = [
                field('size', 0, 2, payloadSize, 'Length of the following base_index plus infix; the 2-byte length field and alignment padding are excluded.'),
                field('base_index', 2, 1, prefix.baseIndex, `Built-in namespace: ${prefix.prefix}`),
                field('infix', 3, infixSize, prefix.infix, 'Additional name bytes following the short namespace. No NUL terminator is stored.'),
            ];
            if (size > 2 + payloadSize) fields.push(field('padding', 2 + payloadSize, size - 2 - payloadSize, 0, 'The next prefix record begins at a 4-byte boundary.'));
            return {
                id: `prefix-table-${index}`, kind: 'xattr', title: `Long prefix ${index} · ${prefix.prefix}${prefix.infix}`, short: `${index}: ${prefix.prefix}${prefix.infix}`,
                start, size, space: prefixSpace, parentId: 'prefix-table',
                description: `Entry index ${index} reconstructs ${prefix.prefix}${prefix.infix}. An xattr selects it with e_name_index = 0x80 | ${index}.`,
                fields, references: [], formula: `ALIGN(2 + ${payloadSize}, 4) = ${size} B`, docPage: 'xattrs', doc: 'long-xattr-name-prefixes',
            };
        });
        regions.push({
            id: 'prefix-table', kind: 'xattr', title: 'Long xattr prefix table', short: 'Long prefixes', start: prefixStart, size: prefixBytes, space: prefixSpace,
            description: `${prefixes.length} length-prefixed records in ${prefixSpace === 'primary' ? 'primary-image physical space' : `${prefixSpace}-inode decoded space`}. The superblock address is measured in 4-byte units.`,
            fields: children.map(child => field(child.short, child.start - prefixStart, child.size, child.short, child.description)),
            references: [], children, formula: `xattr_prefix_start × 4 = ${prefixStart} (${prefixSpace === 'primary' ? 'physical bytes' : `${prefixSpace} decoded bytes`})`,
            docPage: 'xattrs', doc: 'prefix-table-placement',
        });
    }
    const bodySizes = Object.fromEntries(keys.map(key => {
        const payload = sharedFor[key].length * 4 + local[key].reduce((sum, record) => sum + record.size, 0);
        return [key, payload ? 12 + payload : 0];
    }));
    const filters = Object.fromEntries(keys.map(key => [key, xattrNameFilter([...local[key], ...sharedFor[key]].map(record => ({ baseIndex: record.baseIndex, name: record.hashName })))]));
    const featureCompat = (xattrFilter !== 'off' ? 0x4 : 0) | (shared && sharedStorage === 'metabox' ? 0x8 : 0) |
        (prefixStorage === 'standalone' ? 0x10 : 0) | (imageShare ? 0x20 : 0);
    const featureIncompat = (prefixes.length ? 0x40 : 0) | (neededMetabox ? 0x100 : 0) | (neededPacked ? 0x20 : 0);
    const sbFields = [
        field('xattr_blkaddr', 44, 4, shared ? sharedStart / B : 0, shared
            ? `Shared-area base in ${sharedSpace === 'primary' ? 'primary physical space' : 'the metabox decoded stream'}. Entry offset = this field × block size + shared ID × 4.` : 'No shared xattr area is present.'),
        field('xattr_prefix_count', 91, 1, prefixes.length, 'Number of long-prefix table records. Entry IDs use the low seven bits of e_name_index.'),
        field('xattr_prefix_start', 92, 4, prefixes.length ? prefixStart / 4 : 0, prefixes.length
            ? `Start in 4-byte units in ${prefixSpace === 'primary' ? 'physical primary space' : `decoded ${prefixSpace} space`}, not a byte address or block number.` : 'No long-prefix table is present.'),
        field('xattr_filter_reserved', 104, 1, xattrFilter === 'reserved' ? 1 : 0, xattrFilter === 'reserved'
            ? 'Nonzero disables name-filter lookup even though XATTR_FILTER remains enabled and per-inode bitmaps are stored.' : 'Zero permits filter lookup when the XATTR_FILTER feature bit is enabled.'),
        field('ishare_xattr_prefix_id', 105, 1, imageShare ? prefixes.length - 1 : 0, imageShare
            ? 'Plain table ordinal, without the 0x80 long-prefix flag. Regular-file entries select this prefix and store no name suffix.' : 'Ignored because ISHARE_XATTRS is disabled.'),
    ];
    if (neededPacked) sbFields.push(field('packed_nid', 96, 8, context.packedNid, 'NID of the packed inode. With FRAGMENTS enabled, this inode supplies the decoded stream containing the prefix table.'));
    if (neededMetabox) sbFields.push(field('metabox_nid', 128, 8, context.metaboxNid, 'Physical NID of the metabox inode. The superblock must include at least one 16-byte extension slot. Shared entries or prefixes use offsets within its decoded content.'));
    const addressSpaces = ['metabox', 'packed'].filter(space => space === 'metabox' ? neededMetabox : neededPacked).map(space => {
        const contents = regions.filter(region => region.space === space);
        return {
            id: space, space, title: `${space === 'metabox' ? 'Metabox' : 'Packed inode'} decoded contents`,
            description: 'Offsets in this view are logical bytes within the special inode’s decoded content. Its physical backing is shown separately.',
            inodeNid: space === 'metabox' ? context.metaboxNid : context.packedNid,
            size: align(Math.max(...contents.map(region => region.start + region.size)), B), regionIds: contents.map(region => region.id),
        };
    });
    for (const [i, region] of regions.entries()) for (const other of regions.slice(i + 1)) {
        if (region.space === other.space && region.start < other.start + other.size && other.start < region.start + region.size) throw new RangeError(`Global xattr regions ${region.id} and ${other.id} overlap in ${region.space} space.`);
    }
    function makeBody(key, inode) {
        if (!keys.includes(key)) throw new RangeError(`Unknown example inode key: ${key}`);
        if (!bodySizes[key]) return null;
        const id = `xattr-${key}`;
        const start = inode.start + inode.size;
        const space = inode.space || 'primary';
        const owner = inode.path || ownerName(key);
        requireOffset(start, `${key} xattr body start`, 4);
        const filterActive = xattrFilter === 'on';
        const bitmap = xattrFilter === 'off' ? 0 : filters[key];
        const children = [{
            id: `${id}-header`, kind: 'xattr', title: `${owner} · xattr body header`, short: 'Ibody header', start, size: 12, space, owner, parentId: id,
            description: 'The fixed header immediately follows the inode body. Shared IDs come next, followed by any local entries.',
            fields: [
                field('h_name_filter', 0, 4, hex(bitmap), filterActive
                    ? 'Inverted XXH32 bitmap over all local and shared names. A 1 bit proves a matching name absent; a 0 bit requires a lookup. Long names hash their infix plus stored suffix.'
                    : `The bitmap is ignored because ${xattrFilter === 'reserved' ? 'xattr_filter_reserved is nonzero' : 'XATTR_FILTER is disabled'}.`),
                field('h_shared_count', 4, 1, sharedFor[key].length, 'Number of 4-byte shared IDs immediately following this header.'),
                field('h_reserved2', 5, 7, 0, 'Reserved bytes; zero.'),
            ], references: [], docPage: 'xattrs', doc: 'inline-xattr-body-header',
        }];
        let cursor = start + 12;
        for (const [index, record] of sharedFor[key].entries()) {
            children.push({
                id: sharedRefId(key, index), kind: 'xattr', title: `${owner} · shared ID ${record.sharedId}`, short: `ID ${record.sharedId}: ${record.fullName}`,
                start: cursor, size: 4, space, owner, parentId: id,
                description: `This ID references ${record.fullName} in ${sharedSpace === 'primary' ? 'the primary image' : 'the decoded metabox stream'}.`,
                fields: [field('shared_xattr_id', 0, 4, record.sharedId, 'Offset in the shared area divided by four, not an entry ordinal or inode NID.')],
                references: [reference(record.globalId, record.fullName)],
                formula: `${sharedStart / B} × ${B} + ${record.sharedId} × 4 = ${record.globalStart} (${sharedSpace})`, docPage: 'xattrs', doc: 'shared-xattr-area',
            });
            cursor += 4;
        }
        for (const record of local[key]) {
            const suffix = record.purpose === 'main' ? 'entry' : record.purpose === 'prefix' ? 'prefix-entry' : 'fingerprint';
            children.push(entryRegion(record, `${id}-${suffix}`, cursor, space, { owner, parentId: id }));
            cursor += record.size;
        }
        return {
            id, kind: 'xattr', title: `${owner} · xattr body`, short: onlyShared ? 'Shared xattr IDs' : sharedFor[key].length ? 'Local + shared xattrs' : 'Local xattrs',
            start, size: bodySizes[key], space, owner,
            description: `A 12-byte header, ${sharedFor[key].length} shared IDs and ${local[key].length} local entries. Inline file data or chunk indexes follow this whole body.`,
            fields: children.map(child => field(child.short, child.start - start, child.size, child.short, child.description)),
            references: [reference(inode.id || inodeId(key), 'Owning inode'), ...children.flatMap(child => child.references)],
            children, icount: 1 + (bodySizes[key] - 12) / 4,
            formula: `12 + (${1 + (bodySizes[key] - 12) / 4} − 1) × 4 = ${bodySizes[key]} B`,
            docPage: 'xattrs', doc: 'inline-xattr-region-layout',
        };
    }
    return { bodySizes, makeBody, regions, featureCompat, featureIncompat, sbFields, neededMetabox, neededPacked, addressSpaces };
}
