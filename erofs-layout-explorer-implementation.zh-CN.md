# EROFS Layout Explorer 分层布局实现说明

状态：已按最新交互要求实现。入口仍为 `ondisk/explorer.html`，但使用独立页面模板，不嵌入 Sphinx 文档正文。

## 1. 页面目标

页面中央采用参考图所示的分层长条结构：顶层为连续的文件系统区间，第二层展开选中区间的 inode 和数据，第三层展开字段或目录内容。上下两层由区间左右边界之间的斜线连接，表示放大。访客悬停查看摘要，点击后打开字段 dock，并通过引用按钮跳转。

当前实现覆盖 `src/ondisk/` 正文详细定义的合法 variant：非压缩 flat/chunk、inode 类型、superblock 分支、多设备、xattr 存储/prefix/filter/image-share 等。完整逐章映射见 `src/_static/erofs-explorer/COVERAGE.md`。默认 case 使用实际镜像字节快照，其他组合使用推导模型；浏览器不运行 mkfs，也不解析上传镜像。原先的整幅 SVG 切换方式及后续卡片网格均已由连续分段、逐层放大的交互图取代。

## 2. 整体布局

- 独立顶栏：EROFS 标识、页面名称、返回格式文档的链接。
- 左侧选项 dock：按 Inodes、File data、Extended attributes、Directories 四组组织，每组显示当前设置摘要。Filesystem block size 放在 File data 组的 Data layout 前，仍作用于整个文件系统。主选项决定子项是否显示；Xattr extensions 默认折叠。关闭父功能保留子项偏好，恢复时应用仍合法的组合；跨组依赖就近提示。窄屏移到主图上方；Reset options 恢复默认组合并清除偏好。
- 中央主区域：三层横向连续分段条、颜色图例、示例性质说明。默认实测镜像覆盖 4 个 4096-byte block，关闭内联对应 7 个块，但不逐块绘制为卡片。
- 第一层显示 superblock、三层目录和文件的 inode/data 区间；默认展开 root 目录项，三层同时可见。左侧提供可点击的示例目录树，选择目录或文件可定位到对应结构。
- 两侧斜线由上层选中区间的左右边界连到下层整条的左右边界，只表达放大；不能当作 NID 或数据引用线。窗口变化、dock 打开/关闭和内层横向滚动时保持对位。
- 悬停提示：结构类型、示例位置、大小和用途。
- 字段 dock：桌面位于右侧，窄屏位于底部；显示字段偏移、宽度、示例值和含义。
- 引用导航：superblock → root inode → directory entries → file inode → file data；选中后相关区域高亮。

所有主要区域都是原生按钮，支持键盘与触摸。Escape 或关闭按钮关闭 dock，并恢复焦点。悬停提示也可通过键盘焦点访问。

## 3. 示例地址区间

默认 case 已改用真实 mkfs.erofs 镜像记录：4 KiB、compact、无 xattr、普通文件尾部内联，共 4 块。关闭内联对应另一份 7 块镜像。两者均为 meta_blkaddr=0、root NID=36，全部 inode 位于第 0 块。默认 inode 物理顺序为 /、/a、/docs、/docs/assets、/docs/b、/docs/assets/c；外部文件数据使用独立图中区间。字段值来自实际 Superblock/inode 字节快照。

其他选项组合仍使用下面的推导布局，页面明确区分两类来源。完整实测参数、地址和 SHA-256 见 `src/_static/erofs-explorer/REAL-IMAGE.md`。

| Block | 推导布局 Plain 状态的内容（非默认实测镜像） |
| --- | --- |
| 0 | 前 1024 bytes 预留；superblock 位于偏移 1024，大小 128 bytes |
| 1 | 根 inode，后跟内联目录项和名字区 |
| 2 | File A inode |
| 3 | File A 数据，768 bytes |
| 4 | File B inode |
| 5–7 | File B 数据：两个完整块和 512-byte 尾部 |
| 8 | File C inode |
| 9–10 | File C 数据：一个完整块和 904-byte 尾部 |
| 11 | /docs inode 与内联目录项 |
| 12 | /docs/assets inode 与内联目录项 |
| 13 | 默认未使用；shared xattrs 模式下放置共享 entry |

长条中的小结构与字段放大以便选择，像素宽度不代表真实字节比例。区间严格按示例偏移先后排列，具体大小由标注、tooltip 和 dock 给出。窄屏只在图内横向滚动，不将长条换行为卡片。

这些位置是一种合法的示例安排，不暗示 EROFS 必须按该顺序分配，也不暗示必须存在集中 inode 表。固定地址和未使用区间用于让切换前后的变化可比较。

## 4. 特性开关

### Inode format

Compact 为 32 bytes，Extended 为 64 bytes。切换时更新 inode 区域大小标注、字段宽度、时间字段，以及 inode 后 xattr body、内联数据或索引的起点。

NID 仍以 32-byte slot 为单位：`inode_offset = meta_blkaddr * block_size + NID * 32`。默认实测镜像 `meta_blkaddr=0`，root/A/B/C 的 NID 分别为 36/39/70/87；切换到其他参数组合会改变布局，推导模型的位置不应当作实测结果。

### Inline file tails

开启后，A 的全部 768 bytes、B 的最后 512 bytes、C 的最后 904 bytes 移到各自 inode 及 xattr body 后面。完整外部数据块保持原位，原外部尾块标为 `Unused in this example`。

页面固定目录为 Inline，不再展示 Directory data 选项，也不受普通文件内联开关影响。内联目录和全内联 A 的外部起始块字段显示为 `Unused`。实际块位置以记录镜像或当前示意布局为准。

切换期间保持当前结构选择，字段 dock 与引用关系同步更新。不推导或宣传完整镜像节省量。

### Chunk-based data

Data layout 可选 Flat 或 Chunk-based。选择 chunked 时禁用并取消尾部内联，切回 flat 恢复此前的内联偏好。可选 4-byte block map 或 8-byte chunk index，chunk 大小为 B × 2^n，指数 n 为 0–31。

普通文件 i_format 变为 8/9，i_u 使用 chunk info summary，superblock 设置 CHUNKED_FILE (0x4)。根目录仍为 flat-inline。索引区域位于 `ALIGN(inode_offset + inode_size + xattr_size, entry_size)`，每个逻辑 chunk 一项。

File B 的逻辑 chunk 0/1/2 分别映射物理块 5/7/6，展示非连续物理映射。第三层展示各索引项，点击后解释 startblk、device_id 等字段，并可跳转到对应 payload。最后 chunk 在 EOF 截断，padding 不计入文件内容。

### Extended attributes

Xattr storage 可选 None、Inline xattrs、Inline + shared，对根目录和普通文件都生效：

| 模式 | inode 后面的 xattr body | i_xattr_icount |
| --- | --- | --- |
| None | 0 B | 0 |
| Inline | 12 B header + 12 B user.note=demo entry | 4 |
| Inline + shared | 12 B header + 4 B shared ID + 12 B local entry | 5 |

非零时 body 大小为 `12 + (i_xattr_icount - 1) * 4`。默认布局下，共享 user.owner=erofs 存在 block 13，entry 头、名字后缀、value 共 14 B，填充到 16 B。六个 inode 都通过 shared ID 0 引用它：`13 * 4096 + 0 * 4 = 53248`。

图中可展开 xattr header、shared ID 和本地 entry，跟随 shared ID 到共享区域。Xattrs 始终位于 inode 后、inline tail 或 chunk index 前。28-byte shared body 后若使用 8-byte chunk index，则额外展示 4-byte 索引对齐空间。

基础 inline/shared xattrs 不要求额外 feature bit。高级选项已支持 Bloom filter 的 off/on/reserved 三分支、long prefixes 的 standalone/physical fallback/packed/metabox 路径、共享池的 primary/metabox 位置、短 namespace、仅共享 ID 和 image-share fingerprint。

### Superblock、inode 和目录分支

Block size 可选 512 B、4 KiB、16 KiB，示例 inode/data 地址随之推导；SB 固定在偏移 1024，小块时 metadata base 必须移到 SB 后。扩展槽由 Metabox 自动启用，不再提供独立扩展槽和 checksum 开关。固定启用 MTIME，不提供时间语义开关；blocks/inos 固定填入示例数量，不提供统计字段开关。

页面使用固定目录树：/a、/docs/b、/docs/assets/c。根目录下面有两级嵌套子目录，每层都有普通文件；不再提供 inode B 类型选择。目录项类型提示与实际 inode 类型一致。/docs/b 可展示空内容、整块对齐和尾部无法内联，所有目录均可选内联/外置，文件名固定 ASCII，最后一个名字直接到目录有效数据末尾，不提供编码或末尾填充选项。

### 地址空间

多设备通过 128 B device slot 展示 unified/device_id=0 和 explicit/device_id>0 的解析差异。显式设备要求 8 B index；共享 chunk 只保存一份 payload，多个索引引用它。

新增 address-space tabs 区分 primary、device-1、metabox decoded 和 packed decoded。跨空间引用自动切换视图，dock 标明是物理还是 decoded 偏移。特殊 inode 的物理 backing 与 decoded 内容分别展示；不把相同数值的不同空间偏移当成重叠。

## 5. 字段与关系

Superblock dock 解释 magic、根 NID、块大小、metadata base、inode/block 数量、时间、特性标志等关键字段。Inode dock 解释 i_format、i_size、i_mode、起始块、UID/GID、nlink、时间和保留字段。

默认 root 目录含 `.`、`..`、`a`、`docs`，内容大小 56 B；/docs 含 `.`、`..`、`assets`、`b`，大小 58 B；/docs/assets 含 `.`、`..`、`c`，大小 40 B。各目录项按名称字节排序后计算 nameoff。每级 `..` 引用实际父目录，根目录的 `..` 指向自身。目录链接数分别为 3、3、2；默认实测 /docs 和 /docs/assets 的 NID 为 64 和 67；关闭内联的实测镜像为 40 和 43。目录项与字段 dock 均可逐级导航到目标 inode。

点击第三层字段会打开 dock，并高亮该字段对应行；关闭 dock 后焦点返回该字段。Superblock 中本版未展开的字段用 Other fields 占位，保留整个结构的字节覆盖。

文件数据 dock 解释逻辑范围、物理范围、存储方式和所属 inode。flat 文件直接映射数据，chunked 文件通过显式索引项映射。新增字段的文档链接分别指向 chunked_format.md 和 xattrs.md。引用不可见的子项时，会高亮其父区域；引用全局 shared xattr 时也会高亮顶层共享区域。

## 6. 技术栈与文件

沿用 Sphinx/MyST 发布，使用原生 HTML、CSS 和 JavaScript ES modules。`html-page-context` 为 Explorer 返回独立模板；其他文档页面沿用原主题。

```text
src/_templates/explorer.html             独立页面
src/_static/erofs-explorer/layouts.js     基础预设与回归案例
src/_static/erofs-explorer/documented-layouts.js   完整选项归一化和组合
src/_static/erofs-explorer/chunk-variants.js       chunk、多设备和共享
src/_static/erofs-explorer/xattr-variants.js       高级 xattr 分支
src/_static/erofs-explorer/COVERAGE.md            逐章覆盖与验证边界
src/_static/erofs-explorer/explorer.js    分层长条、放大连接线、tooltip、dock 和切换
src/_static/erofs-explorer/explorer.css   独立布局、主题与响应式
src/_static/erofs-explorer/README.md      示例、格式依据、维护方法
src/ondisk/explorer.md                   非 HTML 格式的文字与图片
src/conf.py                             独立模板路由
```

示例代码只处理有限的固定区域和简单地址公式，不是 mkfs 或通用布局分配器。没有服务端、镜像上传、二进制解析器、数据库或额外打包链。

## 7. 验证

按要求已删除全部自动化测试、测试依赖及 GitHub Actions 工作流。页面可通过 Sphinx 在本机构建。

Sphinx HTML 使用独立页面，EPUB/LaTeX 使用 Markdown 正文及静态目录树。网站入口继续位于首页、on-disk 索引和设计说明。

构建方法和字段依据见 `src/_static/erofs-explorer/README.md`。仅被原文提及而未详细定义的 48-bit 和压缩 on-disk 格式在覆盖表中标为 reference-only；非法 reserved layouts 和被否决的 Eytzinger ordering 不作为合法选项。
