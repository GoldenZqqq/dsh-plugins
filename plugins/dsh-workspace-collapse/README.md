# dsh-workspace-collapse

DSH web 插件：在左侧边栏「工作区 / Workspaces」区头加一枚切换按钮，**一键折叠或展开全部工作区分组**，不用再一个个点目录。

## 效果

- 工作区列表的区头（搜索按钮左边/右边那排图标）新增一个按钮。
- 当前只要有工作区分组是展开的，点一下 → **全部折叠**。
- 当前全部工作区都已折叠时，点一下 → **全部展开**。
- 按钮图标和悬浮提示会随当前状态变化：全部收起时显示“展开全部”，有展开时显示“折叠全部”。
- 操作走 DSH 自己的行点击，展开状态仍由 DSH 持久化；刷新后和手动点击行为完全一致。
- 切到“单列表 / 搜索”等没有分组的视图时按钮自动消失，切回分组视图自动回来。

## 原理

纯浏览器端 DOM 增强，不 fork、不修改任何 DSH 官方包：

- 目标 UI 是 `@deepseek-ai/dsh-client-ui-workspace` 渲染的左侧工作区树。工作区分组行有稳定的 ARIA 语义：`div[role="treeitem"][aria-expanded]`，本插件只依赖这一语义，不碰 CSS-modules 哈希类名。
- 只往区头 actions 容器里新增一个按钮 + 注入一条 `<style>`；折叠/展开通过对 DSH 自己的行派发真实 click 完成，不读内部 store、不碰 React fiber。
- 一个 `MutationObserver` 监听新增节点和 `aria-expanded` 变化，树重建后自动补按钮、刷新图标。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | 宿主半体占位（合法 cordis 插件面） |
| `client.js` | 浏览器半体，全部逻辑在此 |
| `cordis.patch.yml` | bundle 补丁样例 |

## 安装

推荐：用 [dsh-plugins 集合](../../README.md) 的安装脚本（Junction 方式，改源码即生效，重启 DSH 加载）：

```powershell
git clone https://github.com/GoldenZqqq/dsh-plugins
cd dsh-plugins/scripts
.\install.ps1 -Name dsh-workspace-collapse
```

然后把下面的 insert 片段加到你所用 profile 的 `cordis.patch.yml`（web profile 一般位于 `~/.dsh/profiles/web/cordis.patch.yml`）：

```yaml
- insert:
    - id: workspace-collapse
      name: dsh-workspace-collapse
      config:
        enabled: true
```

重启 DSH web 并刷新页面即生效。
（注意：重启会结束运行在该进程上的 agent 会话进程，会话历史不丢，页面里可继续恢复。）

验证：DevTools Network 里 `/plugins/dsh-workspace-collapse/client.js` 返回 200；控制台执行 `__DSH_BOOT__.entries.some(e => e.id === 'dsh-workspace-collapse')` 为 `true`。

## 配置

在 `cordis.patch.yml` 的对应行改 `config`：

```yaml
- insert:
    - id: workspace-collapse
      name: dsh-workspace-collapse
      config:
        enabled: true   # 总开关;false 即整体停用
```

## 卸载

删掉 `cordis.patch.yml` 里 `id: workspace-collapse` 的 insert 行（或整段注释掉），重启 DSH 即可；包目录留着不碍事。

## 许可

MIT · © 2026 GoldenZqqq
