# 兼容性

DSH 每个小版本之间都可能带 breaking change，所以本仓库把兼容性写成**机器可校验**的声明，
而不是只写在文档里等人猜。

## 当前声明

| 插件 | 版本 | 实测 DSH | 兼容区间 | 验证日期 |
| --- | --- | --- | --- | --- |
| dsh-heartbeat | 1.0.2 | `0.2.1-rc.3` | `>=0.2.0 <0.3.0` | 2026-10-29 || dsh-model-collapse | 1.2.0 | `0.2.1-rc.3` | `>=0.1.7 <0.3.0` | 2026-10-29 |
| dsh-workspace-collapse | 0.2.0 | `0.2.1-rc.3` | `>=0.1.7 <0.3.0` | 2026-10-29 |
| dsh-win-toast | 1.0.0 | `0.2.1-rc.3` | `>=0.1.7 <0.3.0` | 2026-10-29 |

- **实测 DSH**：真的装上跑过、界面正常的版本，精确到 rc 号。
- **兼容区间**：作者认为可以用的范围，**可能没有逐个实测**。区间比较只看
  `major.minor.patch`，`rc`/`beta` 这类预发布标签只在"实测"里做精确匹配 ——
  否则 `0.3.0-rc.1` 会按 semver 的预发布排序被算进 `<0.3.0`，把已经换了次版本的新版误报成可用。

## 怎么校验

```powershell
node scripts/check-compat.mjs                 # 自动探测当前 dsh 版本
node scripts/check-compat.mjs --version 0.2.1-rc.3
node scripts/check-compat.mjs --strict        # "未实测"也算失败，适合放 CI
node scripts/check-compat.mjs --json          # 机器可读
```

三种结论：

| 标记 | 含义 | 该怎么办 |
| --- | --- | --- |
| ✓ 已实测 | 版本在插件的 `tested` 里 | 无事发生 |
| ! 未实测 | 落在 `range` 内，但没在这一版上跑过 | 先跑插件自带的回归台，再更新 `tested` |
| ✗ 不兼容 | 落在 `range` 外，或声明有误 | 需要适配，见下面的变更记录 |

退出码：`0` 全部可接受；`1` 有不兼容（`--strict` 下未实测也算）；`2` 探测不到版本。

## 声明字段

每个插件的 `package.json` 里有一条 `dshCompat`（放在非 `dsh` 命名空间，npm 与 DSH 都会忽略它）：

```json
"dshCompat": {
  "tested": ["0.2.1-rc.3"],
  "range": ">=0.2.0 <0.3.0",
  "verifiedAt": "2026-10-29",
  "dependsOn": [
    "client:remote.session.follow(assistantStream)",
    "client:event:assistant-stream"
  ]
}
```

- `tested`：精确版本字符串，**必须真的装上跑过**。加新版本号前先跑回归台。
- `range`：宽松区间，表示"理论上还能用"。预发布标签不参与区间比较。
- `verifiedAt`：最后一次实测日期。
- `dependsOn`：这个插件实际依赖的接口清单。出问题时先按这张表去对应版本里核对，
  比从头翻 `client.js` 快得多。

## DSH 版本变更记录（踩过的坑）

### 0.2.x

| 变更 | 影响 | 对策 |
| --- | --- | --- |
| 实时 token 不再是 durable 事件：宿主改发 process-local 的 `assistant-stream` 帧，且**必须**在 follow 请求里带 `assistantStream: true` 才下发 | 只监听 `assistant/chunk` 的插件永远收不到 token（心率卡在冬眠档、tok/s 恒为 0） | follow 带 `assistantStream: true`，处理 `{type:'assistant-stream', frame}`；`assistant/live-chunk` 是客户端折叠后的事件名，不要指望它出现在 journal 里 |
| `remote.session` 成为需要**单独 inject** 的嵌套服务 | 只声明 `remote` 时读 `ctx.remote.session` 直接抛 `cannot get property "remote.session" without inject`，整块面板静默失效 | `inject` 里同时写 `remote` 与 `remote.session` |
| `sidebar.header.dock` 槽被移除（现存 `sidebar.footer`） | 往该槽注册的组件不再显示 | 改用 `sidebar.footer`，或干脆挂 `document.body` |
| `shell.overlay` 条目默认**点击穿透** | 浮层里的组件看得见、点不到、拖不动 | 条目需显式接管指针事件，或改为直接挂 body |
| `@deepseek-ai/dsh-client-ui-slots` / `dsh-client-store` 等不再作为独立客户端模块下发（并入 renderer 的 bundle） | 第三方插件 `require('@deepseek-ai/dsh-client-ui-slots')` 会失败 | 不要 require 这些包；需要槽能力就用 `ctx.slots` 服务 |
| `system-prompt` 移除了 `{{cwd}}` 变量，但 `dsh-base` 默认配置仍引用它 | 每次组装 system prompt 抛 `unknown prompt variable`，turn 直接失败 | 用户层 patch 覆盖 `personaSuffix: ''`（本仓库的 web profile 已这么干） |

### 0.1.x

| 变更 | 影响 | 对策 |
| --- | --- | --- |
| 旧的 `connection.api.events.mux` 事件流移除 | 基于它的插件收不到任何事件 | 改用 `ctx.get('sessions').list` + `remote.session.follow` |
| `dsh-client-runtime` / `dsh-client-ui-slots` 作为独立包存在 | —— | 现在已不可用，见上表 |

## 升级流程

1. 升级 DSH。
2. `node scripts/check-compat.mjs` —— 看哪些插件从"已实测"掉成"未实测"或"不兼容"。
3. 对掉档的插件跑回归：
   - `dsh-heartbeat`：`python -m http.server 8099` 后开
     `http://127.0.0.1:8099/plugins/dsh-heartbeat/test/index.html`，全绿才算过；
   - `dsh-model-collapse` / `dsh-workspace-collapse`：纯 DOM 增强，装上后手点一遍按钮和折叠状态；
   - `dsh-win-toast`：宿主端，发一条会失败的请求看 Toast 是否弹出。
4. 通过后把新版本号写进 `dshCompat.tested`，更新 `verifiedAt`。
5. 提交，并在提交信息里写清验证的是哪个 DSH 版本。
