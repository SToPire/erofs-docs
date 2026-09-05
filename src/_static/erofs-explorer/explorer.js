import { createDocumentedLayout as createLayout, DEFAULT_OPTIONS } from './documented-layouts.js';

const $ = id => document.getElementById(id);
const root = $('explorer');
const grid = $('block-array');
const dock = $('details-dock');
const tooltip = $('region-tooltip');
const kindNames = { superblock: 'SUPERBLOCK', inode: 'INODE', directory: 'DIRECTORY CONTENT', data: 'FILE DATA', inline: 'INLINE DATA', 'chunk-index': 'CHUNK ADDRESS TABLE', xattr: 'EXTENDED ATTRIBUTES', 'device-table': 'DEVICE TABLE', unused: 'UNUSED SPACE' };
const bytes = value => `${value.toLocaleString('en-US')} B`;
const hex = value => `0x${value.toString(16).padStart(6, '0')}`;
let layout;
let selectedId = null;
let focusedBeforeDock = null;
let activeGroupId = 'root';
let expandedRegionId = 'directory';
let selectedFieldKey = null;
let derivedRegions = new Map();
let zoomFrame = null;
let preferredOptions = { ...DEFAULT_OPTIONS };
let activeSpace = 'primary';

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}
function regionById(id) { return layout.regions.find(region => region.id === id) || derivedRegions.get(id); }
function regionButton(id) { return [...grid.querySelectorAll('.region, .content-segment')].find(button => button.dataset.regionId === id); }
function hideTooltip() {
    tooltip.hidden = true;
    grid.querySelector('[aria-describedby="region-tooltip"]')?.removeAttribute('aria-describedby');
}
function highlight() {
    const activeGroup = groups().find(group => group.id === activeGroupId);
    for (const button of document.querySelectorAll('#example-tree button')) {
        const active = (button.dataset.groupId === activeGroupId || button.dataset.inodeId === activeGroup?.ownerId) && activeSpace === 'primary';
        button.classList.toggle('is-selected', active);
        if (active) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
    }
    const selected = regionById(selectedId);
    const related = new Set(selected?.references.map(ref => ref.target) || []);
    for (const target of [...related]) {
        const parent = regionById(target)?.parent;
        if (parent) related.add(parent);
    }
    const relatedGroups = new Set([...related].map(id => {
        const region = regionById(id);
        return region ? groupForRegion(region)?.id : null;
    }));
    for (const button of grid.querySelectorAll('.overview-segment')) {
        button.classList.toggle('is-related', button.dataset.groupId !== activeGroupId && relatedGroups.has(button.dataset.groupId));
    }
    for (const button of grid.querySelectorAll('.region, .content-segment')) {
        const active = button.dataset.regionId === selectedId;
        button.classList.toggle('is-selected', active);
        button.classList.toggle('is-related', related.has(button.dataset.regionId));
        button.setAttribute('aria-pressed', String(active));
    }
}
function showTooltip(button, event, example) {
    const region = example || regionById(button.dataset.regionId);
    hideTooltip();
    tooltip.replaceChildren(element('strong', '', region.title), element('span', 'tooltip-type', kindNames[region.kind]),
        element('span', '', `${hex(region.start)} · ${bytes(region.size)} · ${region.space || activeSpace}`), element('p', '', region.description));
    tooltip.hidden = false;
    button.setAttribute('aria-describedby', 'region-tooltip');
    const rect = button.getBoundingClientRect();
    const x = event?.clientX ?? rect.left + rect.width / 2;
    const y = event?.clientY ?? rect.top;
    tooltip.style.left = `${Math.max(12, Math.min(x + 14, innerWidth - tooltip.offsetWidth - 12))}px`;
    tooltip.style.top = `${Math.max(12, Math.min(y + 18, innerHeight - tooltip.offsetHeight - 12))}px`;
}
function referenceButton(target, label) {
    const button = element('button', 'reference-link', label);
    button.type = 'button';
    button.dataset.target = target;
    button.addEventListener('click', () => {
        selectRegion(target);
        regionButton(target)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    });
    return button;
}
function renderDock() {
    const region = regionById(selectedId);
    if (!region) return;
    $('dock-kind').textContent = kindNames[region.kind];
    $('dock-title').textContent = region.title;
    $('dock-description').textContent = region.description;
    $('dock-offset').textContent = hex(region.start);
    const address = spaceInfo(region.space || 'primary');
    $('dock-offset').title = `${region.start} bytes in ${address.label || address.title || address.id}`;
    $('offset-label').textContent = address.physical === false ? 'Decoded byte offset' : 'Physical byte offset';
    $('dock-space').textContent = address.label || address.title || address.id;
    $('dock-size').textContent = bytes(region.size);
    $('formula-section').hidden = !region.formula;
    $('dock-formula').textContent = region.formula || '';
    $('fields-section').hidden = region.fields.length === 0;
    const rows = region.fields.map(field => {
        const row = element('tr');
        row.dataset.fieldKey = `${field.name}:${field.offset}`;
        row.classList.toggle('is-highlighted', row.dataset.fieldKey === selectedFieldKey);
        const cell = element('td');
        cell.append(element('code', 'field-name', field.name), element('span', 'field-offset', `+0x${field.offset.toString(16).padStart(2, '0')}`), element('p', 'field-description', field.description));
        row.append(cell, element('td', 'field-size', `${field.size} B`), element('td', 'field-value', String(field.value)));
        return row;
    });
    $('field-table').querySelector('tbody').replaceChildren(...rows);
    $('entries-section').hidden = !region.entries;
    $('directory-table').querySelector('tbody').replaceChildren(...(region.entries || []).map(entry => {
        const row = element('tr');
        const target = element('td');
        target.append(referenceButton(entry.target, String(entry.nid)));
        row.append(element('td', '', entry.name), element('td', '', String(entry.nameoff)), target);
        return row;
    }));
    $('mapping-section').hidden = !region.mapping;
    const mappingNodes = [];
    if (region.mapping) {
        for (const [key, value] of Object.entries({ 'Logical range': `[${region.mapping.logical}, ${region.mapping.logical + region.mapping.length})`, 'Physical range': `[${hex(region.start)}, ${hex(region.start + region.size)})`, Storage: region.mapping.storage, Owner: region.mapping.owner })) {
            mappingNodes.push(element('dt', '', key), element('dd', '', value));
        }
    }
    $('mapping-details').replaceChildren(...mappingNodes);
    $('mapping-note').textContent = region.docPage === 'chunked_format'
        ? 'Each chunk has an address entry. Logical neighbors need not be stored in adjacent physical blocks.'
        : 'Flat files map directly from their inode. There is no separate file index table.';
    $('dock-note').hidden = !region.note;
    $('dock-note').textContent = region.note || '';
    $('references-section').hidden = region.references.length === 0;
    $('dock-references').replaceChildren(...region.references.map(ref => referenceButton(ref.target, ref.label)));
    const docUrls = { xattrs: root.dataset.docXattrs, chunked_format: root.dataset.docChunked };
    $('format-link').href = `${docUrls[region.docPage] || root.dataset.docUrl}#${region.doc || 'overview'}`;
}
function groups() {
    if (layout.groups) return layout.groups.filter(group => (group.space || 'primary') === activeSpace);
    return [
        { id: 'prefix', title: 'Reserved prefix', label: 'Reserved', detail: '1024 B', start: 0, size: 1024, primary: 'reserved-prefix', kind: 'unused', weight: 0.82 },
        { id: 'superblock', title: 'Superblock', label: 'Superblock', detail: '128 B', start: 1024, size: 128, primary: 'superblock', kind: 'superblock', weight: 1.13 },
        { id: 'gap', title: 'Unused interval', label: '…', detail: '', start: 1152, size: 2944, primary: 'gap-1152', kind: 'unused', weight: 0.32 },
        { id: 'root', title: 'Root directory', label: 'Root inode', detail: '+ directory', start: 4096, size: 4096, primary: 'root-inode', kind: 'directory', weight: 1.55 },
        { id: 'a', title: 'File A region', label: 'Inode A', detail: '+ data', start: 8192, size: 8192, primary: 'inode-a', kind: 'inode', weight: 1.45 },
        { id: 'b', title: 'File B region', label: 'Inode B', detail: '+ data', start: 16384, size: 16384, primary: 'inode-b', kind: 'inode', weight: 2 },
        { id: 'c', title: 'File C region', label: 'Inode C', detail: '+ data', start: 32768, size: 12288, primary: 'inode-c', kind: 'inode', weight: 1.8 },
        layout.xattrs === 'shared'
            ? { id: 'shared', title: 'Shared xattrs', label: 'Shared', detail: 'xattrs', start: 45056, size: 4096, primary: 'xattr-shared', kind: 'xattr', weight: 0.75 }
            : { id: 'unused', title: 'Unused interval', label: 'Unused', detail: '', start: 45056, size: 4096, primary: 'gap-45056', kind: 'unused', weight: 0.75 },
    ];
}
function groupForRegion(region) {
    if ((region.space || 'primary') !== activeSpace) return null;
    return groups().find(group => region.start >= group.start && region.start < group.start + group.size);
}
function spaceInfo(id = activeSpace) { return layout.addressSpaces.find(space => space.id === id); }
function renderExampleTree() {
    function branch(parent) {
        const list = element('ul');
        for (const item of layout.tree.filter(item => item.parent === parent).sort((a, b) => Number(a.directory) - Number(b.directory))) {
            const row = element('li');
            const name = item.path === '/' ? '/' : item.path + (item.directory ? '/' : '');
            const button = element('button', 'tree-entry', name);
            button.type = 'button';
            button.dataset.groupId = item.id === 'root-inode' ? 'root' : item.id.replace('inode-', '');
            button.dataset.inodeId = item.id;
            button.setAttribute('aria-label', `${item.directory ? 'Directory' : 'File'} ${item.path}`);
            button.addEventListener('click', () => selectRegion(item.contentId || item.id));
            row.append(button);
            if (item.directory) row.append(branch(item.id));
            list.append(row);
        }
        return list;
    }
    $('example-tree').replaceChildren(branch(null));
}
function renderSpaceTabs() {
    $('space-tabs').hidden = layout.addressSpaces.length < 2;
    $('space-tabs').replaceChildren(...layout.addressSpaces.map(space => {
        const button = element('button', 'space-tab', space.label || space.title || space.id);
        button.type = 'button'; button.dataset.space = space.id;
        button.setAttribute('aria-pressed', String(space.id === activeSpace));
        button.addEventListener('click', () => {
            activeSpace = space.id;
            const first = groups().find(group => group.kind !== 'unused') || groups()[0];
            activeGroupId = first.id; expandedRegionId = first.primary;
            selectedId = null; selectedFieldKey = null; dock.hidden = true;
            $('workspace').classList.remove('has-dock'); renderDiagram();
        });
        return button;
    }));
    const space = spaceInfo();
    $('diagram-space-label').textContent = `${space.label || space.title || space.id} · ${layout.options.blockSize / 1024} KiB blocks${space.physical === false ? ' · decoded offsets' : ''}`;
    $('layout-provenance').textContent = layout.provenance
        ? `Recorded mkfs.erofs layout · ${layout.blockCount} blocks · ${bytes(space.size)} · ${layout.provenance.image}`
        : 'Illustrative layout · this option combination is not recorded from an image.';
}
function makeDerivedRegions() {
    derivedRegions = new Map();
    function registerChildren(parent) {
        for (const child of parent.children || []) {
            const item = { fields: [], references: [], docPage: parent.docPage, space: parent.space || 'primary', ...child, parent: child.parentId || parent.id };
            derivedRegions.set(item.id, item);
            registerChildren(item);
        }
    }
    layout.regions.forEach(registerChildren);
    for (const directory of layout.regions.filter(region => region.entries)) {
        const entryIds = directory.entries.map((entry, index) => directory.id === 'directory' ? `dirent-${index}` : `${directory.id}-entry-${index}`);
        const namesId = `${directory.id}-names`;
        for (const [index, entry] of directory.entries.entries()) {
            derivedRegions.set(entryIds[index], {
                id: entryIds[index], kind: 'directory', title: `Directory entry · ${entry.name}`, short: `Entry ${entry.name}`,
                start: directory.start + index * 12, size: 12, parent: directory.id, space: directory.space || 'primary',
                description: `A 12-byte directory entry. Its name starts ${entry.nameoff} bytes into this logical directory block.`,
                fields: directory.fields.map(field => ({ ...field, value: ({ nid: entry.nid, nameoff: entry.nameoff, file_type: entry.fileType ?? (entry.nid === 0 ? 2 : 1), reserved: 0 })[field.name], description: ({ nid: 'NID of the target inode.', nameoff: 'Name offset relative to the logical directory block, measured in bytes.' })[field.name] || field.description })),
                references: [{ target: entry.target, label: `Target inode · NID ${entry.nid}` }, { target: namesId, label: 'Filename bytes' }],
                note: 'Field offsets are relative to this individual directory entry.', doc: 'directories',
            });
        }
        const namesStart = directory.namesStart ?? directory.entries[0].nameoff;
        const namesSize = directory.namesSize ?? directory.size - namesStart;
        derivedRegions.set(namesId, {
            id: namesId, kind: 'directory', title: 'Filename bytes', short: 'Names', start: directory.start + namesStart, size: namesSize, parent: directory.id, space: directory.space || 'primary',
            description: `${directory.entries.map(entry => `“${entry.name}”`).join(', ')} occupy ${namesSize} name bytes. Offsets count bytes, not displayed characters.`,
            fields: [], references: [{ target: directory.id, label: 'Directory content' }], doc: 'directories',
        });
        directory.viewChildren = [...entryIds, namesId];
        if (directory.namePadding) {
            const id = `${directory.id}-name-padding`;
            derivedRegions.set(id, { id, kind: 'unused', title: 'Last-name terminator and padding', short: 'NUL + padding', start: directory.start + namesStart + namesSize, size: directory.namePadding, parent: directory.id, space: directory.space || 'primary',
                description: 'The first remaining byte is NUL, terminating the last name; the remaining bytes are padding.', fields: [], references: [], doc: 'filename-encoding' });
            directory.viewChildren.push(id);
        }
    }
}

function attachSummary(button, summary) {
    button.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') showTooltip(button, event, summary); });
    button.addEventListener('pointerleave', hideTooltip);
    button.addEventListener('focus', () => showTooltip(button, undefined, summary));
    button.addEventListener('blur', hideTooltip);
}
function makeRegionButton(region, className = 'region') {
    const button = element('button', className);
    button.type = 'button';
    button.dataset.regionId = region.id;
    button.dataset.kind = region.kind;
    button.dataset.start = region.start;
    button.dataset.size = region.size;
    button.dataset.space = region.space || activeSpace;
    button.setAttribute('aria-label', `${region.title}, ${bytes(region.size)}`);
    button.setAttribute('aria-controls', 'details-dock');
    button.append(element('span', 'region-label', region.short), element('span', 'region-meta', bytes(region.size)));
    button.style.flexGrow = region.kind === 'inode' ? 1.2 : Math.min(2.6, Math.max(1, Math.sqrt(region.size / 1024)));
    attachSummary(button);
    button.addEventListener('click', () => selectRegion(region.id));
    return button;
}
function layer(title, subtitle, id) {
    const section = element('section', 'diagram-layer');
    const heading = element('div', 'layer-heading');
    heading.append(element('h3', '', title), element('span', '', subtitle));
    const strip = element('div', 'layout-strip');
    strip.id = id;
    section.append(heading, strip);
    return { section, strip };
}
function renderDiagram() {
    grid.style.minWidth = `${Math.max(880, groups().length * 82)}px`;
    renderSpaceTabs();
    const space = spaceInfo();
    const overview = layer(space.physical === false ? `${space.label} (logical)` : activeSpace === 'primary' ? 'EROFS filesystem' : space.label,
        space.physical === false ? 'Decoded byte offsets →' : layout.provenance ? 'Recorded image · physical byte offsets →' : 'Illustrative arrangement · physical byte offsets →', 'layout-overview');
    const group = groups().find(group => group.id === activeGroupId);
    for (const item of groups()) {
        const button = element('button', 'overview-segment');
        button.type = 'button';
        button.dataset.groupId = item.id;
        button.dataset.kind = item.kind;
        button.dataset.start = item.start;
        button.dataset.size = item.size;
        button.dataset.primary = item.primary;
        button.style.flexGrow = item.weight;
        button.classList.toggle('is-expanded', item.id === activeGroupId);
        button.setAttribute('aria-label', `Expand ${item.title}`);
        button.setAttribute('aria-pressed', String(item.id === activeGroupId));
        button.append(element('span', 'region-label', item.label), element('span', 'region-meta', item.detail));
        attachSummary(button, { ...item, description: `Expand this example interval to see its structures. Bytes [${hex(item.start)}, ${hex(item.start + item.size)}).` });
        button.addEventListener('click', () => selectRegion(item.primary));
        overview.strip.append(button);
    }
    const detail = layer(`${group.title} · expanded`, `${hex(group.start)}–${hex(group.start + group.size)}`, 'layout-detail');
    const regions = layout.regions.filter(region => (region.space || 'primary') === activeSpace && region.start >= group.start && region.start + region.size <= group.start + group.size).sort((a, b) => a.start - b.start);
    for (const region of regions) {
        const button = makeRegionButton(region);
        button.classList.toggle('is-expanded', region.id === expandedRegionId);
        detail.strip.append(button);
    }
    const expanded = regionById(expandedRegionId);
    let content = null;
    if (expanded?.children?.length || expanded?.fields.length || expanded?.mapping) {
        const title = expanded.children?.length ? `${expanded.title} · records` : expanded.entries ? 'Directory content' : expanded.fields.length ? `${expanded.title} · fields` : `${expanded.title} · contents`;
        content = layer(title, expanded.children?.length ? `${expanded.children.length} records · ${bytes(expanded.size)} total` : expanded.entries ? `${expanded.entries.length} directory entries, followed by name bytes` : expanded.fields.length ? `${bytes(expanded.size)} · field widths are shown below` : 'Logical file bytes stored in this interval', 'layout-fields');
        if (expanded.children?.length) {
            for (const child of expanded.children) content.strip.append(makeRegionButton(regionById(child.id), 'content-segment'));
        } else if (expanded.entries) {
            for (const id of expanded.viewChildren) content.strip.append(makeRegionButton(regionById(id), 'content-segment'));
        } else if (expanded.fields.length) {
            let fieldEnd = 0;
            const omitted = (offset, size) => {
                const cell = element('button', 'field-segment omitted-field');
                cell.type = 'button';
                cell.dataset.kind = 'unused';
                cell.dataset.offset = offset;
                cell.dataset.size = size;
                cell.style.flexGrow = Math.max(1, Math.sqrt(size));
                cell.append(element('span', 'field-segment-name', 'Other fields'), element('span', 'region-meta', `${size} B`));
                attachSummary(cell, { title: 'Other fields', kind: 'unused', start: expanded.start + offset, size,
                    description: 'Reserved or feature-specific fields abbreviated in this core-format view. See the format specification for the complete structure.' });
                cell.addEventListener('click', () => selectRegion(expanded.id));
                content.strip.append(cell);
            };
            for (const [index, field] of expanded.fields.entries()) {
                if (field.offset > fieldEnd) omitted(fieldEnd, field.offset - fieldEnd);
                fieldEnd = field.offset + field.size;
                const key = `${field.name}:${field.offset}`;
                const button = element('button', 'field-segment');
                button.type = 'button';
                button.dataset.fieldIndex = index;
                button.dataset.fieldName = field.name;
                button.dataset.fieldKey = key;
                button.dataset.offset = field.offset;
                button.dataset.size = field.size;
                button.dataset.kind = expanded.kind;
                button.classList.toggle('is-selected', key === selectedFieldKey);
                button.style.flexGrow = Math.max(1, Math.sqrt(field.size));
                button.setAttribute('aria-label', `${field.name}, ${field.size} bytes, offset +0x${field.offset.toString(16)}`);
                button.append(element('span', 'field-segment-name', field.name), element('span', 'region-meta', `${field.size} B`));
                attachSummary(button, { title: field.name, kind: expanded.kind, start: expanded.start + field.offset, size: field.size, description: field.description });
                button.addEventListener('click', () => selectRegion(expanded.id, key));
                content.strip.append(button);
            }
            if (fieldEnd < expanded.size) omitted(fieldEnd, expanded.size - fieldEnd);
        } else {
            const bytesNode = element('div', 'contents-segment');
            bytesNode.dataset.kind = expanded.kind;
            bytesNode.append(element('strong', '', `File bytes [${expanded.mapping.logical}, ${expanded.mapping.logical + expanded.size})`), element('span', 'region-meta', `${expanded.mapping.storage} · ${bytes(expanded.size)}`));
            content.strip.append(bytesNode);
        }
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'zoom-connectors';
    svg.setAttribute('aria-hidden', 'true');
    grid.replaceChildren(svg, overview.section, detail.section, ...(content ? [content.section] : []));
    highlight();
    scheduleZoom();
}
function scheduleZoom() {
    if (zoomFrame !== null) cancelAnimationFrame(zoomFrame);
    zoomFrame = requestAnimationFrame(() => {
        zoomFrame = null;
        const svg = $('zoom-connectors');
        if (!svg) return;
        const scroll = $('diagram-scroll');
        grid.closest('.map-panel').classList.toggle('diagram-overflow', scroll.scrollWidth > scroll.clientWidth + 1);
        const bounds = grid.getBoundingClientRect();
        svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
        const pairs = [
            ['overview', grid.querySelector(`.overview-segment[data-group-id="${activeGroupId}"]`), $('layout-detail')],
            ['fields', [...grid.querySelectorAll('#layout-detail .region')].find(button => button.dataset.regionId === expandedRegionId), $('layout-fields')],
        ];
        const lines = [];
        for (const [level, source, destination] of pairs) {
            if (!source || !destination) continue;
            const from = source.getBoundingClientRect();
            const to = destination.getBoundingClientRect();
            for (const side of ['left', 'right']) {
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.dataset.zoom = level;
                path.dataset.side = side;
                path.setAttribute('d', `M ${from[side] - bounds.left} ${from.bottom - bounds.top} L ${to[side] - bounds.left} ${to.top - bounds.top}`);
                lines.push(path);
            }
        }
        svg.replaceChildren(...lines);
    });
}
function selectRegion(id, fieldKey = null) {
    const region = regionById(id);
    if (!region) return;
    activeSpace = region.space || 'primary';
    selectedId = id;
    selectedFieldKey = fieldKey;
    activeGroupId = groupForRegion(region).id;
    expandedRegionId = region.parent || id;
    dock.hidden = false;
    $('workspace').classList.add('has-dock');
    renderDiagram();
    focusedBeforeDock = regionButton(id);
    renderDock();
    dock.scrollTop = 0;
    hideTooltip();
    $('dock-title').focus({ preventScroll: true });
    if (selectedFieldKey) {
        const row = [...$('field-table').querySelectorAll('tr')].find(row => row.dataset.fieldKey === selectedFieldKey);
        if (row) dock.scrollTop += row.getBoundingClientRect().top - dock.getBoundingClientRect().top - dock.clientHeight / 2;
    }
}
function closeDock() {
    dock.hidden = true;
    $('workspace').classList.remove('has-dock');
    const fieldButton = selectedFieldKey && [...grid.querySelectorAll('.field-segment')].find(button => button.dataset.fieldKey === selectedFieldKey);
    (fieldButton || regionButton(selectedId) || focusedBeforeDock)?.focus({ preventScroll: true });
    hideTooltip();
    scheduleZoom();
}
const optionIds = {
    dataLayout: 'data-layout', chunkFormat: 'chunk-format', blockSize: 'block-size', chunkBits: 'chunk-bits',
    deviceMode: 'device-mode',
};
const booleanIds = { inline: 'inline-toggle', sharing: 'chunk-sharing' };
function updatePreset(event) {
    const control = event?.target;
    if (control?.name === 'inode-format') preferredOptions.format = control.value;
    for (const [name, id] of Object.entries(optionIds)) if (control?.id === id) preferredOptions[name] = control.value;
    for (const [name, id] of Object.entries(booleanIds)) if (control?.id === id) preferredOptions[name] = control.checked;
    if (control?.id === 'xattr-filter') preferredOptions.xattrFilter = control.checked ? 'on' : 'off';
    if (control?.id === 'prefix-storage') preferredOptions.prefixStorage = control.checked ? 'standalone' : 'off';
    if (control?.id === 'xattr-inline' || control?.id === 'xattr-shared') {
        preferredOptions.xattrs = $('xattr-inline').checked
            ? ($('xattr-shared').checked ? 'shared' : 'inline')
            : ($('xattr-shared').checked ? 'shared-only' : 'none');
    }
    const raw = { ...preferredOptions, mtime: true, counts: 'normal', sampleSize: 'mixed', directoryLayout: 'inline', nameEncoding: 'ascii', nameEnding: 'packed', xattrNamespace: 'user', sharedStorage: 'primary', sbExtension: false, imageShare: false };
    if (raw.prefixStorage !== 'standalone') raw.prefixStorage = 'off';
    let next;
    try { next = createLayout(raw); }
    catch (error) { $('option-error').textContent = error.message; $('option-error').hidden = false; return; }
    $('option-error').hidden = true;
    layout = next;
    const o = layout.options;
    $('xattr-filter').checked = o.xattrFilter === 'on';
    $('prefix-storage').checked = o.prefixStorage === 'standalone';
    $('xattr-inline').checked = ['inline', 'shared'].includes(o.xattrs);
    $('xattr-shared').checked = ['shared', 'shared-only'].includes(o.xattrs);
    const chunked = o.dataLayout === 'chunked';
    for (const [name, id] of Object.entries(optionIds)) $(id).value = o[name];
    for (const [name, id] of Object.entries(booleanIds)) $(id).checked = Boolean(o[name]);
    $('flat-options').hidden = chunked;
    $('inline-toggle').disabled = chunked;
    $('chunk-options').hidden = !chunked;
    $('chunk-format').disabled = !chunked;
    $('chunk-bits').disabled = !chunked;
    $('device-mode').disabled = !chunked;
    $('chunk-sharing').disabled = !chunked || o.chunkBits !== 0 || o.sampleSize !== 'mixed';
    $('chunk-format').querySelector('option[value="blockmap"]').disabled = o.deviceMode === 'explicit';
    $('device-note').hidden = o.deviceMode !== 'explicit';
    $('chunk-sharing').setAttribute('aria-describedby', 'sharing-note');
    $('xattr-options').hidden = o.xattrs === 'none';
    $('prefix-storage').disabled = o.xattrs === 'none';
    $('xattr-filter').disabled = o.xattrs === 'none';
    $('xattr-summary').textContent = { none: 'None', inline: 'Inline', shared: 'Inline + Shared', 'shared-only': 'Shared' }[o.xattrs];
    $('chunk-size-note').textContent = `Chunk size: ${bytes(o.blockSize * 2 ** o.chunkBits)} (${o.blockSize} × 2^${o.chunkBits}).`;
    makeDerivedRegions(); renderExampleTree(); hideTooltip();
    if (!layout.addressSpaces.some(space => space.id === activeSpace)) activeSpace = 'primary';
    if (selectedId && !regionById(selectedId)) {
        selectedId = null; dock.hidden = true; $('workspace').classList.remove('has-dock');
    }
    if (selectedId) activeSpace = regionById(selectedId).space || 'primary';
    const expanded = regionById(expandedRegionId);
    const selected = regionById(selectedId);
    if (selected) activeGroupId = groupForRegion(selected)?.id || activeGroupId;
    if (!groups().some(group => group.id === activeGroupId)) {
        activeGroupId = (groups().find(group => group.id === 'b') || groups().find(group => group.kind !== 'unused') || groups()[0]).id;
    }
    if (!expanded || (expanded.space || 'primary') !== activeSpace || groupForRegion(expanded)?.id !== activeGroupId) expandedRegionId = groups().find(group => group.id === activeGroupId).primary;
    if (selectedFieldKey && !selected?.fields.some(field => `${field.name}:${field.offset}` === selectedFieldKey)) selectedFieldKey = null;
    renderDiagram(); if (!dock.hidden) renderDock();
    const xattrDescription = { none: 'No xattrs.', inline: 'Local xattrs.', shared: 'Local and shared xattrs.', 'shared-only': 'Shared xattr IDs only.' }[o.xattrs];
    $('layout-status').textContent = `${o.format === 'compact' ? 'Compact · 32 B' : 'Extended · 64 B'} inodes. ${chunked ? `Chunked · ${o.chunkFormat === 'indexes' ? '8-byte indexes' : '4-byte block map'}.` : `${o.inline ? 'Eligible inline' : 'External'} file tails.`} ${xattrDescription} Directory data: ${o.directoryLayout}.`;
}

document.querySelectorAll('input[name="inode-format"]').forEach(input => input.addEventListener('change', updatePreset));
for (const id of [...Object.values(optionIds), ...Object.values(booleanIds), 'xattr-inline', 'xattr-shared', 'xattr-filter', 'prefix-storage']) $(id).addEventListener('change', updatePreset);
$('reset-options').addEventListener('click', () => {
    document.querySelector('input[name="inode-format"][value="compact"]').checked = true;
    for (const [name, id] of Object.entries(optionIds)) $(id).value = DEFAULT_OPTIONS[name];
    for (const [name, id] of Object.entries(booleanIds)) $(id).checked = DEFAULT_OPTIONS[name];
    preferredOptions = { ...DEFAULT_OPTIONS };
    selectedId = null; selectedFieldKey = null; activeSpace = 'primary'; activeGroupId = 'root'; expandedRegionId = 'directory';
    dock.hidden = true; $('workspace').classList.remove('has-dock'); updatePreset();
});
$('close-dock').addEventListener('click', closeDock);
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
        if (!dock.hidden) closeDock();
        hideTooltip();
    }
});
window.addEventListener('scroll', hideTooltip, true);
window.addEventListener('resize', () => { hideTooltip(); scheduleZoom(); });
new ResizeObserver(scheduleZoom).observe(grid);
window.addEventListener('pageshow', updatePreset);
updatePreset();
document.querySelectorAll('#options-dock fieldset').forEach(fieldset => { fieldset.disabled = false; });
$('reset-options').disabled = false;
