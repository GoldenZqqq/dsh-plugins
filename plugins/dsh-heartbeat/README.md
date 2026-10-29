# dsh-heartbeat

给 DSH Web 装一颗会跳的心脏：**模型吐 token 越快，心率越高**，旁边跑一条真实的
ECG 波形，出错时心律不齐、重试时早搏、等你审批时屏息。

从 [superzhang21/dsh-heartbeat](https://github.com/superzhang21/dsh-heartbeat) fork 而来，
针对 DSH 0.2.x 重写了挂载与事件层，并在其基础上加了 ECG、生命体征面板和病理状态机。
上游原始版本只写了 `assistant/chunk`，而 0.2.x 的实时 token 事件是
`assistant/live-chunk` —— 这就是它在现有版本上"装了但不跳"的真正原因。

## 状态与心率

| 状态 | 心率 | 触发条件 | 表现 |
| --- | --- | --- | --- |
| 冬眠 Hibernating | 20–30 BPM | 没有会话在跑 | 缓慢呼吸，偶发漏搏 |
| 思考 Thinking | 38–50 BPM | 有会话在跑，但还没吐 token | 浅浅的等待 |
| 输出 Streaming | 50–160 BPM | token 正常流出，随 tok/s 平滑上升 | 绿色 ECG |
| 狂暴 Redline | 180–200 BPM | 持续 > 40 tok/s | 红光 + 卡片外发光 |
| 早搏 Ectopic | 突跳 +42 BPM | `llm/retry` | 一拍提前出现 |
| 心律不齐 Arrhythmia | 140–175 BPM | `turn/end` 的 `reason.kind = error` | 波形畸形、漏搏 |
| 屏息 Apnea | 30–37 BPM | `turn/end` 的 `reason.kind = blocked` | 等待你审批，波幅压低 |
| 离线 Offline | 停在最后值 | 连接断开 | 一条带噪声的直线 |

## 面板

- **ECG**：不是装饰动画，是按心动相位实时合成的 P-QRS-T 波形（高斯脉冲叠加），
  速率变了 RR 间期跟着变，异常状态下波形真的会变丑。
- **生命体征**：tok/s、TTFT（首字延迟）、本次 token 数、工具调用次数。
- **模型标识**：从 `request/header` 读 provider/model。

## 交互

- 拖动到任意位置，靠近边缘自动吸附，位置存在 `localStorage`（`dsh-heartbeat:pos`）。
- 双击切换「卡片 / 迷你条」；迷你条只留 ♥ + BPM，不挡视线。
- 右键菜单：切换形态、重置位置、重置统计、暂停动画。

## 配置

写在 `cordis.patch.yml` 的 `insert` 条目里，全部可选：

```yaml
- insert:
    - id: heartbeat
      name: dsh-heartbeat
      config:
        enabled: true      # 总开关
        mode: card         # card | rail
        scale: 1           # 0.8–1.6
        opacity: 1         # 0.4–1，悬停时自动回满
        showEcg: true
        showHud: true
        position: bottom-right   # top-left | top-right | bottom-left | bottom-right
        accent: ''         # 自定义强调色，留空则跟随状态色
```

## 安装

```powershell
# 1) 装进当前 profile（默认建 junction，改代码即时生效）
cd dsh-plugins\scripts
.\install.ps1 -Name dsh-heartbeat

# 2) 在 ~/.dsh/profiles/<profile>/cordis.patch.yml 加上面的 insert 片段
# 3) 重启 DSH（web profile 没有 HMR），刷新页面
```

## 测试

`test/index.html` 是一个不依赖 DSH 的回归台：用假的 `ctx` 挂载 client.js，
模拟 token 流 / 出错 / 重试 / 断线，逐项断言心率、状态和 DOM 清理。

```powershell
# 从仓库根目录起一个静态服务（file:// 下跨目录加载脚本会被浏览器拦掉）
python -m http.server 8099
# 浏览器打开 http://127.0.0.1:8099/plugins/dsh-heartbeat/test/index.html
```

改了 client.js 之后先跑一遍这个，比重启 DSH 试错快得多。

## 实现要点

- **不注册 DSH 的 slot**。`sidebar.header.dock` 在 0.2.x 已被移除，槽表还会继续变；
  直接挂 `document.body` 才是跨版本稳的做法。`shell.overlay` 那条路也放弃了 ——
  浮层默认点击穿透，挂上去会拖不动。
- **只依赖三个稳定服务**：`connection` / `sessions` / `remote`，`inject` 里没有 `slots`。
  每处取值都做了空值兜底，任何一处 API 漂移都不会让小组件整个消失。
- **零 npm 依赖**：不 require react，也不 require 任何 `@deepseek-ai/*` 客户端包，
  纯 DOM + Canvas。
- 动画统一由 rAF 驱动，React 完全不参与重渲染。

## 许可

MIT。上游版权归 DeepSeek Harness contributors / superzhang21，本仓库的移植与增强部分归 GoldenZqqq。
