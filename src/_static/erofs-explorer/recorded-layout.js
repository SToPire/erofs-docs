import { RECORDED_IMAGES } from './recorded-images.js';

function number(bytes, offset, size) {
    let value = 0;
    for (let i = size - 1; i >= 0; i--) value = value * 256 + bytes[offset + i];
    return value;
}

// Rebase only the exact source tree and settings captured in the two images.
// Other combinations remain explicit authored examples, not mkfs predictions.
export function applyRecordedLayout(layout, fillSpaces) {
    const o = layout.options;
    if (o.blockSize !== 4096 || o.format !== 'compact' || o.dataLayout !== 'flat'
        || o.xattrs !== 'none' || o.sampleSize !== 'mixed'
        || o.directoryLayout !== 'inline' || o.nameEncoding !== 'ascii'
        || o.nameEnding !== 'packed' || o.sbExtension || !o.mtime || o.counts !== 'normal') return layout;

    const snapshot = RECORDED_IMAGES[o.inline ? 'default' : 'noinline'];
    const B = 4096;
    const regions = layout.regions.filter(r => r.kind !== 'unused' || r.id === 'reserved-prefix');
    const byId = new Map(regions.map(r => [r.id, r]));
    for (const [id, record] of Object.entries(snapshot.inodes)) {
        const inode = byId.get(id);
        inode.start = record.start;
        inode.nid = record.nid;
        inode.formula = `0 × 4096 + ${record.nid} × 32 = ${record.start}`;
        inode.note = 'Position and fields recorded from the generated mkfs.erofs image.';
        for (const f of inode.fields) {
            if (f.name === 'i_u.startblk' && f.value === 'Unused') continue;
            const value = number(record.bytes, f.offset, f.size);
            f.value = f.name === 'i_mode' ? '0' + value.toString(8) : value;
        }
    }
    for (const region of regions) {
        if (region.entries) {
            const owner = byId.get(region.references[0].target);
            region.start = owner.start + owner.size;
            for (const entry of region.entries) entry.nid = byId.get(entry.target).nid;
            const example = region.entries.find(e => e.name !== '.' && e.name !== '..');
            region.fields.find(f => f.name === 'nid').value = example.nid;
        } else if (region.mapping) {
            const owner = region.references.map(r => byId.get(r.target)).find(r => r?.kind === 'inode');
            const record = snapshot.inodes[owner.id];
            const block = number(record.bytes, 16, 4);
            region.start = region.kind === 'inline' ? owner.start + owner.size : block * B + region.mapping.logical;
            region.formula = region.kind === 'inline'
                ? `physical = ${owner.start} + ${owner.size} = ${region.start}`
                : `physical = ${block} × 4096 + ${region.mapping.logical} = ${region.start}`;
        }
        for (const reference of region.references) {
            const target = byId.get(reference.target);
            if (target?.nid !== undefined) reference.label = reference.label.replace(/NID \d+/, `NID ${target.nid}`);
        }
    }

    const sb = byId.get('superblock');
    for (const f of sb.fields) {
        const bytes = snapshot.superblock.slice(f.offset, f.offset + f.size);
        if (f.name === 'uuid') {
            const hex = bytes.map(b => b.toString(16).padStart(2, '0')).join('');
            f.value = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
        } else if (f.name === 'volume_name') f.value = 'Empty';
        else {
            const value = number(snapshot.superblock, f.offset, f.size);
            f.value = ['magic', 'checksum', 'feature_compat', 'feature_incompat'].includes(f.name)
                ? '0x' + value.toString(16).padStart(8, '0') : value;
        }
    }
    const describe = (name, description) => { sb.fields.find(f => f.name === name).description = description; };
    describe('meta_blkaddr', 'Metadata addressing base is block 0 in this image; inode metadata shares the first block with the superblock.');
    describe('rootnid_2b', 'Recorded root NID 36 locates the root inode at byte 1152.');
    describe('checksum', 'CRC32-C copied from the actual image superblock. SB_CHKSUM is enabled by mkfs.erofs.');
    describe('uuid', 'Fixed UUID supplied to mkfs.erofs for this recorded example.');
    describe('volume_name', 'No volume label was supplied when building the image.');
    sb.note = 'Superblock values and physical placement are recorded from the generated image.';
    layout.options.checksum = true;
    layout.featureCompat = number(snapshot.superblock, 8, 4);
    layout.featureIncompat = number(snapshot.superblock, 80, 4);
    layout.blockCount = snapshot.size / B;
    layout.addressSpaces = [{ id: 'primary', label: 'Primary image', physical: true, size: snapshot.size }];
    layout.regions = regions;
    fillSpaces(regions, layout.addressSpaces, B);

    const group = (id, title, start, size, primary, kind, ownerId) => ({
        id, title, label: title, start, size, primary, kind, ownerId, space: 'primary',
        detail: `${size} B`, weight: Math.min(2, Math.max(0.7, Math.sqrt(size / B))),
    });
    const groups = [
        group('prefix', 'Reserved', 0, 1024, 'reserved-prefix', 'unused'),
        group('superblock', 'Superblock', 1024, 128, 'superblock', 'superblock'),
    ];
    const inodes = regions.filter(r => r.kind === 'inode').sort((a, b) => a.start - b.start);
    for (const [i, inode] of inodes.entries()) {
        const id = inode.id === 'root-inode' ? 'root' : inode.id.replace('inode-', '');
        groups.push(group(id, `${inode.path} · inode`, inode.start,
            (inodes[i + 1]?.start ?? B) - inode.start, inode.id, inode.type === 'directory' ? 'directory' : 'inode', inode.id));
    }
    for (const inode of inodes) {
        const data = regions.filter(r => r.mapping && r.kind !== 'inline' && r.references.some(ref => ref.target === inode.id))
            .sort((a, b) => a.start - b.start);
        if (!data.length) continue;
        const start = data[0].start;
        const end = Math.ceil(Math.max(...data.map(r => r.start + r.size)) / B) * B;
        groups.push(group(`${inode.id}-data`, `${inode.path} · data`, start, end - start, data[0].id, 'data', inode.id));
    }
    layout.groups = groups.sort((a, b) => a.start - b.start);
    layout.provenance = {
        kind: 'recorded', tool: 'mkfs.erofs 1.9.4-g0e4884ca', sha256: snapshot.sha256,
        image: o.inline ? 'default.erofs' : 'noinline.erofs',
    };
    return layout;
}
