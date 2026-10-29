# dsh-plugins

GoldenZqqq 的 DeepSeek Harness (DSH) 自制插件集合。每个插件是 `plugins/` 下的一个
独立 npm 包（**包名即加载名，不可改**），通过 cordis 补丁层（profile 的
`cordis.patch.yml` 里的 `insert` 条目）挂载进 DSH。

## 插件列表

| 插件 | 半体 | 作用 |
| --- | --- | --- |
| [dsh-model-collapse](plugins/dsh-model-collapse/README.md) | web 客户端 UI | 模型选择菜单按 provider 默认折叠，常驻快捷条（展开/收起/聚焦/筛选），localStorage 记忆展开状态 |
| [dsh-workspace-collapse](plugins/dsh-workspace-collapse/README.md) | web 客户端 UI | 左侧工作区列表一键切换折叠/展开全部目录，不再逐个点击 |
| [dsh-heartbeat](plugins/dsh-heartbeat/README.md) | web 客户端 UI | 心率监视器：token 速度驱动 ECG 波形与生命体征面板，出错心律不齐、重试早搏、等审批屏息（移植自 superzhang21/dsh-heartbeat，已适配 0.2.x） |
| [dsh-win-toast](plugins/dsh-win-toast/README.md) | 宿主端 | turn 完成/失败/受阻时弹 Windows 系统级通知（Toast），上游断流导致对话中断不再错过 |

## 兼容性

**当前实测：DSH `0.2.1-rc.3`**（2026-10-29）。DSH 小版本之间动接口很频繁，所以每个插件
在 `package.json` 的 `dshCompat` 里声明了实测版本与兼容区间，并且可以一键校验：

```powershell
node scripts/check-compat.mjs          # 对比当前 dsh 版本与各插件声明
```

| 插件 | 实测 DSH | 兼容区间 |
| --- | --- | --- |
| dsh-heartbeat | `0.2.1-rc.3` | `>=0.2.0 <0.3.0` |
| dsh-model-collapse | `0.2.1-rc.3` | `>=0.1.7 <0.3.0` |
| dsh-workspace-collapse | `0.2.1-rc.3` | `>=0.1.7 <0.3.0` |
| dsh-win-toast | `0.2.1-rc.3` | `>=0.1.7 <0.3.0` |

升级 DSH 前先跑一次校验，再按 [COMPATIBILITY.md](COMPATIBILITY.md) 的升级流程回归 ——
那里还按版本记录了踩过的 breaking change（`assistantStream` 门控、`remote.session` 的
inject 守卫、被移除的 `sidebar.header.dock` 槽等）。

## 安装

```powershell
git clone https://github.com/GoldenZqqq/dsh-plugins
cd dsh-plugins/scripts
.\install.ps1 -All                  # 安装全部（默认 Junction 方式）
.\install.ps1 -Name dsh-win-toast   # 只装一个
.\install.ps1 -All -Copy            # 复制方式，不用 Junction
.\install.ps1 -All -Force           # 覆盖已有安装
.\install.ps1 -All -ProfileName web # 指定 profile（默认 web）
```

- 默认在 `~/.dsh/profiles/<profile>/node_modules/<name>` 建 **NTFS Junction** 指回本 repo
  （免管理员权限）：改 repo 里的代码即时生效，重启 DSH 加载。
  DSH 解析插件时用的是 **profile 目录下**的 node_modules，装到
  `~/.dsh/profiles/node_modules` 是加载不到的 —— 这是最早版本脚本的默认值，已修正。
- `-Copy` 为纯复制，改代码后需重跑脚本。
- 已装过同名插件的旧目录会被 `-Force` 替换。

安装后还需要：

1. 在所用 profile 的 `cordis.patch.yml` 里加对应插件的 `insert` 片段
   （`dsh-model-collapse` 目录下自带 `cordis.patch.yml` 样例；`dsh-win-toast`
   的样例在其 README 的「配置」节）；
2. 重启 DSH（补丁层在下次启动时加载；web profile 没有 HMR）。

## 目录约定

```
plugins/<name>/       每个插件一个独立 npm 包（零依赖、CommonJS、private）
  index.js            宿主半体（cordis 插件面）
  client.js           浏览器半体（仅 UI 类插件；package.json 里 dsh.client.platform: "web"）
  cordis.patch.yml    给用户复制的补丁样例（可选）
  README.md           功能/配置/安装说明
  test/index.html     浏览器半体的回归台（可选，仅 UI 类插件）
scripts/install.ps1    安装脚本（Junction / 复制）
scripts/check-compat.mjs  DSH 版本兼容性校验
COMPATIBILITY.md      兼容性声明规范 + 各版本 breaking change 记录
```

## 开发约定

- 插件零 npm 依赖：装完即用，不需要 `pnpm install` 之类的步骤。
- 配置文档写在插件 `index.js` 头部注释与 README 两处，保持同步。
- Junction 安装下改代码无需重新"安装"，重启 DSH 即生效。

## 许可

MIT · © 2026 GoldenZqqq
