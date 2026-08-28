# dsh-model-collapse

DSH web 插件：把模型选择下拉（composer 左下角的模型菜单）里按 provider 分组的列表**默认全部折叠**，点击分组标题才展开，告别一打开就是几十行的长列表。

## 效果

### 折叠（v1.0）

- 每个 provider 分组标题前显示 `▾`（展开）/ `▸`（收起），后面跟模型数量角标 `(N)`。
- 打开菜单时所有分组默认收起；「当前选中模型」所在的分组默认展开（可通过配置关掉）。
- 点击标题切换折叠；你的展开状态按 provider 名称记忆在浏览器 `localStorage`（键 `dsh-model-collapse:expanded-v1`），下次打开菜单、重启 DSH 都保持。
- 键盘可用：`Tab` 到标题后 `Enter`/`空格` 切换；`↑/↓` 自动跳过被收起的行。

### 快捷条（v1.1，菜单顶部常驻，sticky 跟随滚动）

| 控件 | 作用 |
| --- | --- |
| **展开** | 一键展开所有 provider 分组 |
| **收起** | 一键收起所有 provider 分组 |
| **聚焦** | 只展开「当前选中模型」所在分组，其余全部收起（provider 多时一眼定位当前模型归属） |
| **↺** | 清空展开状态记忆，回到初始（选中组展开、其余收起） |
| **筛选框** | 按关键字实时过滤模型：命中的分组自动展开、无命中的整组隐藏，数量角标变成 `命中/总数` |

### 键盘快捷键

| 按键 | 作用 |
| --- | --- |
| `Alt+E` | 全部展开 |
| `Alt+C` | 全部收起 |
| `Alt+F` | 聚焦筛选框（全选已有内容） |
| 筛选框内 `Enter` | 跳到第一个匹配的模型 |
| 筛选框内 `Esc` | 清空筛选（再按一次 Esc 关闭菜单） |

## 原理

纯浏览器端 DOM 增强，不 fork、不修改任何 DSH 官方包：

- 目标 UI 是 `@deepseek-ai/dsh-client-ui-model-selection` 渲染的菜单，其分组结构有稳定的 ARIA 语义（`section[role="group"]` > 标题 `div[id]` + `button[role="menuitemradio"][aria-checked]`），本插件只依赖这些语义选择器，不碰 CSS-modules 哈希类名。
- 只往 React 已渲染的节点上写 `data-*` 属性 + 一条 `<style>` 规则实现折叠（`display:none`），不增删/包裹 React 管理的节点，重新渲染不会打架。
- 唯一新增的节点是快捷条本身：`prepend` 在菜单根部。React 更新只操作自己持有引用的子节点，外来节点会保留；菜单整体卸载时快捷条随之消失，下一轮 rescan 重新装上。
- 快捷条样式直接复用 DSW 设计变量（`--dsw-specific-menu`、`--dsw-alias-interactive-bg-hover`、`--dsw-alias-label-*`、`--dsw-alias-border-*`），暗色/亮色主题自动跟原生一致。
- 一个 `MutationObserver` 在菜单每次出现/刷新时给新分组补装饰、补装快捷条。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | 宿主半体占位（合法 cordis 插件面，让补丁层能挂载本包） |
| `client.js` | 浏览器半体，全部逻辑在此 |
| `cordis.patch.yml` | bundle 补丁（`dsh plugin add` 安装时应用） |

## 安装

推荐：用 [dsh-plugins 集合](../../README.md) 的安装脚本（Junction 方式，改源码即生效，重启 DSH 加载）：

```powershell
git clone https://github.com/GoldenZqqq/dsh-plugins
cd dsh-plugins/scripts
.\install.ps1 -Name dsh-model-collapse
```

或 `dsh plugin add`（market 安装器，从旧独立仓库安装）：

```sh
dsh plugin --profile web add GoldenZqqq/dsh-model-collapse
```

重启 DSH web 并刷新页面即生效。
（注意：重启会结束运行在该进程上的 agent 会话进程，会话历史不丢，页面里可继续恢复。）

验证：DevTools Network 里 `/plugins/dsh-model-collapse/client.js` 返回 200；控制台执行 `__DSH_BOOT__.entries.some(e => e.id === 'dsh-model-collapse')` 为 `true`。

## 配置

在 `cordis.patch.yml` 的对应行改 `config`：

```yaml
- insert:
    - id: model-collapse
      name: dsh-model-collapse
      config:
        enabled: true              # 总开关;false 即整体停用
        expandSelectedGroup: true  # 首跑时是否默认展开"当前选中模型"所在分组
        quickBar: true             # 菜单顶部常驻快捷条(展开/收起/聚焦/重置/筛选)
        accordion: false           # true=手风琴模式:展开某分组时自动收起其他组
```

想清空记忆回到初始状态：点快捷条上的「↺」，或在 DevTools 控制台执行
`localStorage.removeItem('dsh-model-collapse:expanded-v1')` 后刷新。

## 卸载

删掉 `cordis.patch.yml` 里 `id: model-collapse` 的 insert 行（或整个注释掉），重启 DSH 即可；包目录留着不碍事。

## 许可

MIT · © 2026 GoldenZqqq