# dsh-plugins

GoldenZqqq 的 DeepSeek Harness (DSH) 自制插件集合。每个插件是 `plugins/` 下的一个
独立 npm 包（**包名即加载名，不可改**），通过 cordis 补丁层（profile 的
`cordis.patch.yml` 里的 `insert` 条目）挂载进 DSH。

## 插件列表

| 插件 | 半体 | 作用 |
| --- | --- | --- |
| [dsh-model-collapse](plugins/dsh-model-collapse/README.md) | web 客户端 UI | 模型选择菜单按 provider 默认折叠，常驻快捷条（展开/收起/聚焦/筛选），localStorage 记忆展开状态 |
| [dsh-workspace-collapse](plugins/dsh-workspace-collapse/README.md) | web 客户端 UI | 左侧工作区列表一键切换折叠/展开全部目录，不再逐个点击 |
| [dsh-win-toast](plugins/dsh-win-toast/README.md) | 宿主端 | turn 完成/失败/受阻时弹 Windows 系统级通知（Toast），上游断流导致对话中断不再错过 |

## 安装

```powershell
git clone https://github.com/GoldenZqqq/dsh-plugins
cd dsh-plugins/scripts
.\install.ps1 -All                  # 安装全部（默认 Junction 方式）
.\install.ps1 -Name dsh-win-toast   # 只装一个
.\install.ps1 -All -Copy            # 复制方式，不用 Junction
.\install.ps1 -All -Force           # 覆盖已有安装
```

- 默认在 `~/.dsh/profiles/node_modules/<name>` 建 **NTFS Junction** 指回本 repo
  （免管理员权限）：改 repo 里的代码即时生效，重启 DSH 加载。
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
scripts/install.ps1   安装脚本（Junction / 复制）
```

## 开发约定

- 插件零 npm 依赖：装完即用，不需要 `pnpm install` 之类的步骤。
- 配置文档写在插件 `index.js` 头部注释与 README 两处，保持同步。
- Junction 安装下改代码无需重新"安装"，重启 DSH 即生效。

## 许可

MIT · © 2026 GoldenZqqq
