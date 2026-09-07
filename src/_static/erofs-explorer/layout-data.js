// Offline-recorded structure data, shared across independent UI options.
// This module selects fields and checksums their bytes; it does not allocate
// filesystem blocks, compress files, run mkfs, or load a parameter-case matrix.
import { DEFAULT_OPTIONS, normalizeOptions } from './options.js';

const files = new Map();
function readJSON(name) {
    if (!files.has(name)) {
        const request = fetch(new URL(`./layouts/${name}.json`, import.meta.url))
            .then(response => {
                if (!response.ok) throw new Error(`Unable to load layout data (HTTP ${response.status}).`);
                return response.json();
            })
            .catch(error => { files.delete(name); throw error; });
        files.set(name, request);
    }
    return files.get(name);
}
function decodeBytes(value, key) {
    if (typeof value === 'string' && ['bytes', 'encodedBytes', 'superblock'].includes(key)) {
        if (!/^(?:[0-9a-f]{2})*$/.test(value)) throw new Error('Invalid recorded bytes.');
        return Array.from({ length: value.length / 2 }, (_, i) => parseInt(value.slice(i * 2, i * 2 + 2), 16));
    }
    if (Array.isArray(value)) return value.map(item => decodeBytes(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, decodeBytes(item, name)]));
    return value;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
    let crc = byte;
    for (let bit = 0; bit < 8; ++bit) crc = (crc >>> 1) ^ (crc & 1 ? 0x82f63b78 : 0);
    return crc >>> 0;
});
// The checksum is a dependent field, not a separate stored case for every
// combination. Include all recorded structures and file bytes in its block.
function checksum(record, sourceFiles, options) {
    const B = record.blockSize, bytes = new Uint8Array(B > 1024 ? B - 1024 : B);
    const write = (start, data, space = 'primary') => {
        if (space !== 'primary') return;
        const from = Math.max(start, 1024), to = Math.min(start + data.length, 1024 + bytes.length);
        if (from < to) bytes.set(data.slice(from - start, to - start), from - 1024);
    };
    const capture = value => { if (value) write(value.start, value.bytes, value.space); };
    write(1024, record.superblock);
    record.sharedXattrs.forEach(capture);
    capture(record.prefixes); capture(record.deviceTable);
    const contents = Object.fromEntries(Object.entries(sourceFiles).map(([path, value]) => [path, new TextEncoder().encode(value.line.repeat(value.count))]));
    if (options.sharing) contents['/docs/assets/c'].set(contents['/docs/b'].slice(0, B));
    for (const inode of record.inodes) {
        capture(inode); capture(inode.xattr); capture(inode.directory); capture(inode.chunks);
        if (inode.compression) {
            const c = inode.compression;
            capture(c.header); capture(c.indexPadding); capture(c.index);
            for (const m of c.mappings) write(m.encodedStart, m.encodedBytes, m.space);
        } else if (!inode.directory) {
            for (const m of inode.data) write(m.start, contents[inode.path].slice(m.logical, m.logical + m.length), m.space);
        }
    }
    bytes.fill(0, 4, 8);
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    return crc >>> 0;
}

export function combineLayout(data, options) {
    if (data.schema !== 1 || !Array.isArray(data.nodes)) throw new Error('Unsupported layout data schema.');
    const memo = new Map();
    function resolve(id) {
        if (memo.has(id)) return memo.get(id);
        const node = data.nodes[id];
        if (!node) throw new Error('Invalid layout structure reference.');
        let value;
        switch (node[0]) {
        case 'value': value = node[1]; break;
        case 'array': value = node[1].map(resolve); break;
        case 'object': value = Object.fromEntries(Object.entries(node[1]).map(([key, child]) => [key, resolve(child)])); break;
        case 'select': {
            const child = node[2][String(options[node[1]])];
            if (child === undefined) throw new Error(`Unsupported ${node[1]} value in layout data.`);
            value = resolve(child); break;
        }
        case 'blocks': value = options.blockSize * node[1]; break;
        case 'blockBits': value = Math.log2(options.blockSize); break;
        case 'chunkFormat': value = options.chunkBits + node[1]; break;
        case 'chunkSize': value = options.blockSize * 2 ** options.chunkBits; break;
        default: throw new Error('Unknown layout structure.');
        }
        memo.set(id, value);
        return value;
    }
    const record = resolve(data.root);
    const crc = checksum(record, data.sourceFiles, options);
    for (let i = 0; i < 4; ++i) record.superblock[4 + i] = (crc >>> (8 * i)) & 255;
    return { ...record, options, tool: data.tool };
}

const optionKey = options => JSON.stringify(Object.keys(options).sort().map(key => [key, options[key]]));
const defaultKey = optionKey(normalizeOptions(DEFAULT_OPTIONS));
export async function loadLayout(raw = {}) {
    const options = normalizeOptions(raw);
    if (optionKey(options) === defaultKey) return { ...decodeBytes(await readJSON('default')), options };
    return combineLayout(await readJSON(options.dataLayout), options);
}
