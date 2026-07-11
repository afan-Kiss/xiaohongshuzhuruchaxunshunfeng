# Unified Data Core v3

## 架构

```
tongyi.exe（唯一 Supervisor）
└── Node 单进程 Runtime (src/runtime.js)
    ├── Data Core（统一缓存 / singleflight / SWR）
    ├── 本地 HTTP API（127.0.0.1:4725）
    ├── 千帆 CDP 注入
    └── 顺丰批量查询 Web（:6666）
```

千帆页面注入脚本 v3 仅：提取卡片 → `POST /v1/cards/batch` → 渲染。

## 启动

```bash
npm install
npm start
# 或 tongyi 控制台启动顺丰 Worker（内部执行 node src/runtime.js）
```

## 健康检查

`GET http://127.0.0.1:4725/health`

必须满足：

- `service == qf-sf-data-core`
- `version == 3.0.0`
- `features.batchCards / singleflight / persistentCache == true`
- `checks.coreReady == true`
- CDP 有页面时 `injectedCount >= pageCount` 且版本一致

## 缓存

- 进程内 LRU + fresh/stale TTL
- 持久化：`data/runtime/sf-data-core-cache.json`（已 gitignore）
- 错误短缓存 1–3 秒，不长期缓存失败

## dataCoreMode

`config.json` → `dataCoreMode`:

- `prefer-core`（默认）：Core 成功不走 legacy
- `core-only`：仅 Core
- `legacy-only`：仅旧链路（不推荐）

## 测试

```bash
npm test
npm run test:core
npm run check
npm run smoke   # 需 Runtime 已启动
```

## 回滚

切换 Git 至 v2.3.x tag/分支，tongyi 启动旧版 `tongyi-console-launch.js` 多进程模式。

## tongyi 管理

- 启动：`node src/runtime.js`
- 健康：完整 Data Core /health，不再仅检查 fonts
- 故障：连续 2 次失败后指数退避重启
- 停止：SIGTERM → 等待 5s → 杀进程树 → 等待端口释放
