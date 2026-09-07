// Physical regions derived exclusively from offline-recorded compressed metadata.
const number = (bytes, offset, size) => {
    let value = 0;
    for (let i = size - 1; i >= 0; --i) value = value * 256 + bytes[offset + i];
    return value;
};
const hex = bytes => bytes.map(b => b.toString(16).padStart(2, '0')).join('');
const field = (name, offset, size, value, description) => ({ name, offset, size, value, description });
const ref = (target, label) => ({ target, label });
const docPage = 'compressed_format';

export function addCompressedRegions(record, inode, add, B) {
    const c = record.compression, key = record.key;
    const headerId = `compression-header-${key}`, indexId = `compression-index-${key}`;
    const packId = i => `${indexId}-pack-${i}`;
    const dataId = i => `compressed-data-${key}-${i}`;
    const L = 2 ** c.header.clusterBits;
    const doc = c.index.format === 'compact' ? 'compact-indexes' : 'full-indexes';
    inode.description += ` ${c.index.format === 'compact' ? 'COMPRESSED_COMPACT (3)' : 'COMPRESSED_FULL (1)'} indexes locate the compressed physical clusters.`;
    inode.docPage = docPage; inode.doc = 'overview';
    inode.references.push(ref(headerId, 'Compression map header'), ref(indexId, 'Compression indexes'));
    const h = c.header.bytes;
    add({ id: headerId, kind: 'compressed-index', title: `${record.path} · compression header`, short: 'Compression header',
        start: c.header.start, size: h.length, group: key, ownerId: record.id,
        fields: [
            field('h_reserved1', 0, 2, number(h, 0, 2), 'Reserved field in these LZ4 records.'),
            field('h_idata_size', 2, 2, number(h, 2, 2), 'Encoded byte length of the inline compressed tail when INLINE_PCLUSTER is set. Zero means this inode has no inline compressed tail.'),
            field('h_advise', 4, 2, number(h, 4, 2), `Bit 3 (0x8) enables an inline compressed tail. ${c.index.format === 'compact' ? 'Bit 0 permits two-byte compact indexes.' : 'This inode uses full eight-byte index records.'}`),
            field('h_algorithmtype', 6, 1, h[6], 'Low nibble selects HEAD1 compression; high nibble selects HEAD2. Algorithm 0 is LZ4.'),
            field('h_clusterbits', 7, 1, h[7], `Low four bits add to the filesystem block shift. Logical cluster size in this inode: ${L} bytes.`),
        ], references: [ref(record.id, 'Owning inode'), ref(indexId, 'Compression indexes'),
            ...c.mappings.flatMap((m, i) => m.inline ? [ref(dataId(i), 'Inline compressed tail')] : [])],
        description: 'Eight-byte compression map header, aligned to eight bytes after the inode and any xattrs.',
        formula: `ALIGN(${record.start} + ${record.bytes.length} + ${record.xattr?.bytes.length || 0}, 8) = ${c.header.start}`, docPage, doc: 'compression-map-header' });
    if (c.indexPadding) add({ id: `${indexId}-reserved`, kind: 'unused', title: 'Reserved full-index header bytes', short: 'Reserved',
        start: c.indexPadding.start, size: c.indexPadding.bytes.length, group: key, ownerId: record.id,
        fields: [field('reserved', 0, c.indexPadding.bytes.length, hex(c.indexPadding.bytes), 'Recorded reserved bytes between the compression map header and full index records.')],
        references: [ref(headerId, 'Compression map header'), ref(indexId, 'Full compression indexes')],
        description: 'Full indexes begin after an additional eight reserved bytes following the map header.', docPage, doc: 'full-indexes' });

    function entryDescription(e) {
        const type = e.typeName || ['PLAIN', 'HEAD1', 'NONHEAD', 'HEAD2'][e.type];
        if (e.padding) return 'Unused slot completing the encoded pack.';
        const bits = `bits ${e.bitOffset}–${e.bitOffset + e.bitWidth - 1}`;
        if (e.eof) return `LCN ${e.lcn} (${bits}): ${type}, cluster offset ${e.clusterOffset}; EOF boundary, no physical payload.`;
        if (e.type === 2) return `LCN ${e.lcn} (${bits}): NONHEAD, backward distance ${e.delta0}; resolves to the preceding head's stored data.`;
        const tail = c.mappings.find(m => m.inline && m.headLcn === e.lcn);
        if (tail) return `LCN ${e.lcn} (${bits}): ${type}, cluster offset ${e.clusterOffset}; inline compressed tail at byte ${tail.start}. Its stored block-address value is unused.`;
        return `LCN ${e.lcn} (${bits}): ${type}, cluster offset ${e.clusterOffset}, physical block ${e.blockAddress}.`;
    }
    const children = c.index.packs.map((pack, i) => {
        const bytes = pack.bytes, fields = [];
        if (c.index.format === 'compact') {
            const bodySize = bytes.length - 4;
            // Two 16-bit entries occupy distinct bytes in an eight-byte pack.
            // A 32-byte pack interleaves 14-bit entries; show its packed bitstream
            // as one field instead of inventing per-entry byte boundaries.
            if (pack.bitWidth === 16) {
                for (const [j, e] of pack.entries.entries()) {
                    fields.push(field(e.padding ? 'unused_slot' : `lcluster[${e.lcn}]`, j * 2, 2, '0x' + number(bytes, j * 2, 2).toString(16).padStart(4, '0'),
                        `${entryDescription(e)} Low ${pack.lowBits} bits carry the offset/distance; the next two bits carry the type.`));
                }
            } else fields.push(field('packed_indexes', 0, bodySize, hex(bytes.slice(0, bodySize)),
                `${pack.entries.length} packed ${pack.bitWidth}-bit logical-cluster records, shown as exact hexadecimal bytes. Bit offsets are relative to this pack.`));
            fields.push(field('base_blkaddr', bodySize, 4, number(bytes, bodySize, 4), 'Physical block base for external heads in this pack. Inline-tail and EOF entries do not use it to address external data.'));
        } else {
            const e = pack.entries[0];
            fields.push(field('di_advise', 0, 2, number(bytes, 0, 2), `Low two bits select the logical-cluster type. ${entryDescription(e)}`),
                field('di_clusterofs', 2, 2, number(bytes, 2, 2), 'Decompressed offset within this logical cluster.'));
            if (e.type === 2) fields.push(field('di_u.delta[0]', 4, 2, number(bytes, 4, 2), 'Backward logical-cluster distance to the head.'), field('di_u.delta[1]', 6, 2, number(bytes, 6, 2), 'Forward logical-cluster distance.'));
            else fields.push(field('di_u.blkaddr', 4, 4, number(bytes, 4, 4), e.inline
                ? 'Unused for this inline compressed tail. Its bytes follow the final index record.'
                : 'Physical block address of an external head; an EOF-only entry has no payload.'));
        }
        const references = [ref(record.id, 'Owning inode'), ref(headerId, 'Compression map header')];
        for (const [j, m] of c.mappings.entries()) {
            if (pack.entries.some(e => !e.padding && !e.eof &&
                (e.lcn === m.headLcn || e.lcn * L >= m.logical && e.lcn * L < m.logical + m.length))) {
                references.push(ref(dataId(j), `${m.inline ? 'Inline compressed tail' : 'Physical cluster'} · logical ${m.logical}`));
            }
        }
        return { id: packId(i), parentId: indexId, kind: 'compressed-index', title: `${record.path} · ${c.index.format} index ${i}`,
            short: c.index.format === 'compact' ? `Index pack ${i}` : `Index ${i}`, start: pack.start, size: bytes.length,
            fields, references, description: pack.entries.map(entryDescription).join(' '),
            note: c.index.format === 'compact' ? 'Logical-cluster indexes are bit-packed. The byte fields below show their actual shared storage.' : 'One eight-byte logical-cluster record.', docPage, doc };
    });
    add({ id: indexId, kind: 'compressed-index', title: `${record.path} · compression indexes`, short: 'Compression indexes',
        start: c.index.start, size: c.index.bytes.length, group: key, ownerId: record.id, children,
        references: [ref(record.id, 'Owning inode'), ref(headerId, 'Compression map header'), ...c.mappings.map((m, i) => ref(dataId(i), `${m.inline ? 'Inline compressed tail' : 'Physical cluster'} · logical ${m.logical}`))],
        description: `${c.index.clusterCount} logical-cluster indexes in ${children.length} recorded ${c.index.format === 'compact' ? 'packs' : 'records'}. HEAD entries identify stored extents; NONHEAD entries refer back to a head.`, docPage, doc });

    for (const [i, m] of c.mappings.entries()) {
        const id = dataId(i), pad = m.encodedStart - m.start;
        const refs = [ref(record.id, 'Owning inode'), ref(indexId, 'Compression indexes'), ref(headerId, 'Compression map header')];
        const headPack = c.index.packs.findIndex(p => p.entries.some(e => !e.padding && e.lcn === m.headLcn));
        if (headPack >= 0) refs.push(ref(packId(headPack), `Head index · LCN ${m.headLcn}`));
        const mapping = { logical: m.logical, length: m.length, physicalLength: m.physicalLength, encodedLength: m.encodedLength,
            storage: m.inline ? 'Inline LZ4 tail after compression indexes' : 'LZ4 physical cluster (including leading zero padding)', owner: record.path, compression: 'lz4' };
        const content = [];
        if (pad) content.push({ id: `${id}-padding`, parentId: id, kind: 'unused', title: 'Leading zero padding', short: 'Zero padding',
            start: m.start, size: pad, fields: [], references: [ref(id, 'Physical cluster')],
            description: `${pad} zero bytes precede the LZ4 stream within its allocated physical cluster. They are not logical file bytes.`, docPage, doc: 'physical-clusters' });
        content.push({ id: `${id}-stream`, parentId: id, kind: 'compressed-data', title: `${record.path} · LZ4 stream`, short: 'LZ4 stream',
            start: m.encodedStart, size: m.encodedLength, fields: [], references: refs,
            mapping: { ...mapping, physicalLength: m.encodedLength, storage: m.inline ? 'Inline LZ4 stream in inode metadata' : 'LZ4 stream, excluding physical padding' },
            description: `${m.encodedLength} LZ4 bytes decode to logical bytes [${m.logical}, ${m.logical + m.length}) of ${record.path}.`,
            docPage, doc: m.inline ? 'compressed-tail-inlining' : 'physical-clusters' });
        add({ id, kind: 'compressed-data', title: `${record.path} · ${m.inline ? 'inline compressed tail' : 'compressed data'}`, short: m.inline ? 'Inline LZ4 tail' : 'LZ4 physical cluster',
            start: m.start, size: m.physicalLength, group: m.inline ? key : `${key}-data`, ownerId: record.id, space: m.space,
            children: content, references: refs, mapping,
            description: m.inline
                ? `${m.encodedLength} encoded bytes follow the compression indexes inside the metadata block and decode to ${m.length} logical bytes. No external block is allocated for this tail.`
                : `${m.physicalLength} physical bytes contain ${pad} bytes of leading zero padding and ${m.encodedLength} encoded bytes. The LZ4 stream decodes to ${m.length} logical bytes.`,
            formula: m.inline ? `${c.index.start} + ${c.index.bytes.length} = ${m.start}; h_idata_size = ${m.physicalLength}`
                : `${m.start / B} × ${B} = ${m.start}; ${pad} padding + ${m.encodedLength} LZ4 bytes = ${m.physicalLength} physical bytes`,
            docPage, doc: m.inline ? 'compressed-tail-inlining' : 'physical-clusters' });
        inode.references.push(ref(id, m.inline ? 'Inline compressed tail' : 'Compressed file content'));
    }
}
