# Unified Data Core v3

## 架构

```
tongyi.exe（唯一 Supervisor）
└── Node 单进程 Runtime (src/runtime.js)
    ├── Data Core（统一缓存 / singleflight / SWR）
    ├── 本地 HTTP API（127.0.0.1:4725）
    ├── 千帆 CDP 注入
    └── 顺丰批量查询 Web（:6666，身份校验后复用）
```

千帆页面注入脚本 v3 仅：提取卡片 → `POST /v1/cards/batch` → 渲染。

## v3.0.2 修复说明（合并前修复版）

- **假健康绕过**：tongyi 先校验 `service` / `version` / `checks`，再分类 `healthy|degraded|unhealthy`；`status=healthy` 但 service/version 错误一律判 `unhealthy`。
- **页面自触发扫描**：`isOwnMutation()` 忽略 `.qsf-inline-fee-wrap` 自身 DOM；`scanRunning`/`scanPending` 合并并发扫描；相同 HTML 指纹跳过重复渲染。
- **AbortController 竞态**：`batch-controller.js` 局部 controller + timeout 仅取消自身；旧请求 finally 不清除新 controller。
- **6666 Web 身份**：`/api/status` 返回 `service/version/dataCoreBacked/dataCoreVersion/runtimeInstanceId`；旧 v2 或未知 HTTP 200 服务不复用，`web_port_conflict` 降级且 Data Core 不退出。
- **店铺身份**：删除 `shopKey` 冒充 `shopId` 的伪映射；未知 `shopKey` 返回 `unknown_shop`；页面保留后端 `errorCode`（409 冲突、401 失效等）。
- **缓存 LRU 恢复**：按 `updatedAt` 从旧到新插入 Map，淘汰最旧恢复项。
- **Supervisor 稳定计时**：`stableSince`/`lastFailureAt`/`failCount`；连续健康 5 分钟归零 `failCount`。
- **sfReady 拆分**：`sfConfigured` / `sfLastQueryOK` / `sfLastError`；未配置或从未查询不得虚假标绿。
- **压测**：四页面 `Promise.all` 并行；cold/warm 分别统计 P50/P95/P99。

## v3.0.1 修复说明

- **金额单位**：删除按数值大小猜测分/元的逻辑；元字段与分字段显式标注，内部 DTO 统一为元。
- **缓存持久化**：`schemaVersion: 2`，保存 `freshUntil` / `staleUntil`，重启后按绝对时间恢复 fresh/stale，兼容 v3.0.0 旧格式。
- **店铺身份**：`XY祥钰珠宝` 与 `祥钰珠宝` 精确区分；批量接口校验 `shopKey` / `shopTitle` / `shopId` 一致性。
- **健康分级**：`healthy` / `degraded` / `unhealthy`；`ok=true` 表示核心可继续服务，顺丰/CDP/注入降级不判死。
- **tongyi**：仅 `unhealthy` 连续失败才重启；`degraded` 显示黄色告警不重启。
- **dataCoreMode**：仅 `core-only`（v3 已删除页面直连旧链路）。

## 启动

```bash
npm install
npm start
# 或 tongyi 控制台启动顺丰 Worker（内部执行 node src/runtime.js）
```

## 健康检查

`GET http://127.0.0.1:4725/health`

```json
{
  "ok": true,
  "status": "healthy|degraded|unhealthy",
  "service": "qf-sf-data-core",
  "version": "3.0.2",
  "checks": {
    "processAlive": true,
    "coreReady": true,
    "packageApiReady": true,
    "afterSaleReady": true,
    "sfReady": false,
    "sfConfigured": false,
    "devtoolsConnected": false,
    "pageInjectionReady": false,
    "webReady": true
  },
  "degradedReasons": ["sf_config_missing"]
}
```

### 分级

| status | 含义 |
|--------|------|
| healthy | 核心、订单、售后、顺丰及注入链路均正常 |
| degraded | 核心/订单/售后正常，顺丰/CDP/注入/Web 等附属异常 |
| unhealthy | HTTP 不可用、服务身份错误、版本不兼容、package/after-sale 核心不可用 |

`ok=true`：核心可继续提供主要数据服务（degraded 时仍为 true）。

## Web 状态（:6666）

`GET http://127.0.0.1:6666/api/status`

```json
{
  "ok": true,
  "service": "qf-sf-fee-web",
  "version": "3.0.2",
  "dataCoreBacked": true,
  "dataCoreService": "qf-sf-data-core",
  "dataCoreVersion": "3.0.2",
  "runtimeInstanceId": "..."
}
```

仅当 service/version/dataCoreBacked/dataCoreVersion/runtimeInstanceId 全部匹配当前 Runtime 时才复用；否则 `webReady=false`，`degradedReasons` 含 `web_port_conflict`。

## 金额单位规则

### 元字段（默认按元解析）

`paid_amount`, `paidAmount`, `pay_amount`, `order_amount`, `refund_amount`, `actual_refund_amount`, `expected_refund_amount`, `return_amt`, `apply_amount`, `refund_apply_amount`, `refund_fee`

高客单示例：`16800`、`26800`、`39800` 元不得除以 100。

### 分字段（returns_v3 汇总）

`applied_skus_amount_sum`, `applied_ship_fee_amount` → 除以 100 转为元。

## 缓存持久化 schema

文件：`data/runtime/sf-data-core-cache.json`（已 gitignore）

```json
{
  "schemaVersion": 2,
  "savedAt": 0,
  "package": {},
  "afterSaleOpen": {},
  "afterSaleClosed": {},
  "sfOk": {},
  "sfErr": {}
}
```

每条目保存：`value`, `updatedAt`, `freshUntil`, `staleUntil`, `source`, `error`, `errorCode`。

旧 v3.0.0 格式无 TTL 时按 `updatedAt + profile` 重算（仅兼容）。

## 店铺身份规则

优先级：`shopId/accountId`（`config.json` shops 注册表）→ Cookie 槽位 → 精确店名。

禁止模糊 `includes("祥钰珠宝")` 串店；禁止用 `shopKey` 冒充 `shopId`。

| 标题 | shopKey |
|------|---------|
| XY祥钰珠宝 | xyxiangyu |
| 祥钰珠宝 | xiangyu |
| 和田雅玉 | hetianyayu |
| 拾玉居和田玉 | shiyuju |

冲突返回 `shop_identity_conflict`；未知返回 `unknown_shop`。

## dataCoreMode

`config.json` → `dataCoreMode: "core-only"`（唯一模式）。

## 测试

```bash
npm test
npm run test:core
npm run check
npm run stress
SOAK_MINUTES=1 npm run soak
npm run smoke   # 需 Runtime 已启动
```

客户端模块（`src/client/batch-controller.js`、`scan-scheduler.js`、`render-utils.js`）经 `scripts/sync-inline-client.js` 嵌入注入脚本，测试与页面同源。

## 真实验收（v3.0.2）

自动化单测/压测/soak 脚本已在本地执行。四店真实环境只读验收（高客单金额、串店、缓存重启、5 分钟 scan 稳定性、30 分钟 soak）需千帆页面在线时人工执行。

## 已知限制

- soak 30 分钟长稳测试默认不在 CI 执行，需 `SOAK_MINUTES=30 npm run soak`。
- 注入脚本依赖千帆 DOM 结构，页面大改版需同步更新选择器。
- 顺丰月结配置缺失时降级运行，不查询运费。

## 回滚

切换 Git 至 v2.3.x tag/分支，tongyi 启动旧版多进程模式。

## tongyi 管理

- 启动：先探测 `/health`，核心已存活则不重复启动；`node src/runtime.js` 同版本冲突 exit 2
- 健康：严格校验 service/version/checks 后再分级；degraded 不重启
- 故障：连续 2 次 **unhealthy** 后指数退避重启（1/2/5/10/30/60s）；连续健康 5 分钟 `failCount` 归零
- 停止：SIGTERM → 等待 5s → 杀进程树 → 等待端口释放
