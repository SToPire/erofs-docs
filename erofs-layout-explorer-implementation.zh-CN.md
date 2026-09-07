# EROFS Layout Explorer 实现说明

保留原来的独立复选框、下拉选项及自由组合交互。`Recorded example` 合并选择器
已移除；不会用命名示例替代用户选择的参数。

## 数据边界

`mkfs.erofs` 只离线运行，用于生成硬编码 layout JSON。网站构建、部署和浏览器
不调用 mkfs，不增加 API 服务或 WebAssembly 文件系统生成器。

生产 JSON 按结构和字段共享数据，而不是为每个参数组合保存一份完整镜像快照。
前端选择这些记录中的结构分支，并处理块单位、chunk 格式等直接表达式。校验和
从当前结构与覆盖块中的源文件字节计算，不为校验和变化复制整个布局。

组合结果已与原有离线研究记录逐字段核对：原始字节、CRC32C、物理位置、目录项、
xattr、chunk 和压缩映射均一致。穷举数据和比较脚本仅用于离线验证，不进入网站。

## 固定目录与控件

```text
/
├── a                 768 B
└── docs/
    ├── b            8704 B
    └── assets/
        └── c        5000 B
```

- Inode 格式：compact / extended。
- 块大小：512 B / 4 KiB / 16 KiB。
- Flat：原文件尾内联开关。
- Chunk：指数、block map / indexes、额外设备、B/C 首块共享。
- Xattr：inline / shared 复选框、filter、long prefixes。
- LZ4：压缩尾内联、Compact / Full 压缩索引；其他压缩参数默认。

保留原有格式依赖及偏好恢复。模式切换只隐藏不适用的控件，Reset 恢复默认值。
文件长度与目录树固定；共享示例只替换 C 的首块内容。各 inode 是否压缩、是否
内联以及实际占用由记录决定，不由界面开关强行假设。

## 文件与加载

- `options.js`：原有选项及格式依赖，不包含参数矩阵。
- `layout-data.js`：按需读取 JSON、解析共享结构及计算 CRC32C。
- `layouts/default.json`：原默认布局，首屏只加载这一份。
- `layouts/flat.json` / `chunked.json` / `lz4.json`：共享结构、字段和参数分支。
- `recorded-layout.js` / `compressed-layout.js`：把当前结构转换为图中区间。
- `explorer.js` / `explorer.css`：交互、异步状态和样式。

每类 JSON 首次需要时加载，此后组合直接复用。请求版本号防止较早的加载覆盖
较新的用户选择；失败会报告并允许重试。图的分层长条、目录树、字段 dock 和
相关引用导航保持原样，已要求删除的两段说明小字不恢复。

部署使用干净的静态 HTML 目录，移除旧的批量 JavaScript 数据和命名示例目录。
不添加运行时 mkfs、服务端生成逻辑或项目测试依赖。
