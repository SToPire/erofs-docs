// UI options and format dependencies; no parameter matrix.
export const DEFAULT_OPTIONS = {
    format: 'compact', blockSize: 4096, dataLayout: 'flat', inline: true,
    chunkFormat: 'blockmap', chunkBits: 0, deviceMode: 'primary', sharing: false,
    xattrs: 'none', xattrFilter: 'off', prefixStorage: 'off', sampleSize: 'mixed', directoryLayout: 'inline',
    ztailpacking: false, compressionIndex: 'compact',
};
export const maxChunkBits = blockSize => 30 - Math.log2(Number(blockSize));
export function normalizeOptions(raw = {}) {
    const o = { ...DEFAULT_OPTIONS, ...raw };
    // Legacy callers must not silently receive a different fixture than requested.
    const fixed = { sampleSize: 'mixed', fileType: 'regular', directoryLayout: 'inline',
        nameEncoding: 'ascii', nameEnding: 'packed', mtime: true, counts: 'normal',
        xattrNamespace: 'user', sharedStorage: 'primary', sbExtension: false, imageShare: false };
    for (const [name, value] of Object.entries(fixed)) {
        if (raw[name] !== undefined && raw[name] !== value) throw new RangeError(`Unsupported fixture setting: ${name}=${raw[name]}.`);
        o[name] = value;
    }
    for (const [name, values] of Object.entries({ format: ['compact', 'extended'], dataLayout: ['flat', 'chunked', 'lz4'],
        chunkFormat: ['blockmap', 'indexes'], deviceMode: ['primary', 'explicit'], compressionIndex: ['compact', 'full'],
        xattrs: ['none', 'inline', 'shared', 'shared-only'], xattrFilter: ['off', 'on'], prefixStorage: ['off', 'standalone'] })) {
        if (!values.includes(o[name])) throw new RangeError(`Unsupported option: ${name}=${o[name]}.`);
    }
    o.blockSize = Number(o.blockSize);
    o.chunkBits = Number(o.chunkBits);
    if (typeof o.ztailpacking !== 'boolean') throw new RangeError('Compressed tail inlining must be enabled or disabled.');
    if (![512, 4096, 16384].includes(o.blockSize)) throw new RangeError('Supported block sizes: 512 B, 4 KiB, 16 KiB.');
    if (!Number.isInteger(o.chunkBits) || o.chunkBits < 0) throw new RangeError('Chunk exponent must be a nonnegative integer.');
    o.chunkBits = Math.min(o.chunkBits, maxChunkBits(o.blockSize));
    if (o.dataLayout === 'lz4') Object.assign(o, { inline: false, chunkFormat: 'blockmap', chunkBits: 0, deviceMode: 'primary', sharing: false });
    else if (o.dataLayout === 'flat') Object.assign(o, { chunkFormat: 'blockmap', chunkBits: 0, deviceMode: 'primary', sharing: false });
    else { o.inline = false; if (o.deviceMode === 'explicit') o.chunkFormat = 'indexes'; }
    if (o.dataLayout !== 'lz4') { o.ztailpacking = false; o.compressionIndex = 'compact'; }
    if (o.chunkBits || o.blockSize > 4096) o.sharing = false;
    if (o.xattrs === 'none') { o.xattrFilter = 'off'; o.prefixStorage = 'off'; }
    return o;
}
