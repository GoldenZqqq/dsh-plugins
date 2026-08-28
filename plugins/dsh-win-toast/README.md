# dsh-win-toast

DSH 插件:每轮 turn 结束时弹 **Windows 系统级通知(Toast)**,解决"对话做到一半因网络/上游问题中断了却不知道"的问题。

## 监听什么

挂在与 `dsh-session-telemetry` 相同的 `session/event` firehose 上,按 `turn/end` 事件的 `reason.kind` 分类:

| kind | 通知 | 默认 |
| --- | --- | --- |
| `error` | ❌ 对话中断(带错误码,如 `[PI_AI_ERROR]`,即网关断流重试耗尽后的最终失败) | 开 |
| `completed` | ✅ 任务完成 | 开 |
| `blocked` | ⏸ 等待你的输入(工具审批 / ask_user) | 开 |
| `max-tokens` | ⚠️ 本轮达到 token 上限 | 开 |
| `aborted` | ⏹ 手动停止 | 关(`onAborted` 开启) |

会话标题来自 `session/title` 事件,显示在通知第一行。同一会话 1.5 秒内去重,防止风暴。

## 怎么发通知

`index.js` spawn 一次 Windows PowerShell 5.1(`powershell.exe`,系统必带),用 WinRT
`ToastNotificationManager` 发 Toast——借用 powershell.exe 自带的 AppUserModelID,
不需要安装 BurntToast、不需要注册应用。WinRT 失败(如组策略禁用通知)自动退回
`NotifyIcon` 气泡通知。点击通知以 protocol 激活打开 `webUrl`(默认 DSH Web UI)。

## 安装/生效

推荐：用 [dsh-plugins 集合](../../README.md) 的安装脚本（Junction 方式，改源码即生效）：

```powershell
git clone https://github.com/GoldenZqqq/dsh-plugins
cd dsh-plugins/scripts
.\install.ps1 -Name dsh-win-toast
```

然后在所用 profile 的 `cordis.patch.yml` 里加上对应的 `insert` 条目（见下方「配置」），重启 DSH（补丁层下次启动加载；web profile 没有 HMR）。

## 配置(cordis.patch.yml 的 config 段)

```yaml
config:
  enabled: true        # 总开关
  onComplete: true     # 正常结束弹"完成"
  onError: true        # 出错收场弹"中断"
  onAborted: false     # 手动中止也弹
  minIntervalMs: 1500  # 同会话去抖窗口
  webUrl: 'http://127.0.0.1:3080'  # 点击通知打开的地址
```

## 注意

- 通知只能在 **DSH 宿主进程存活期间** 发:进程整体崩溃(断电、kill)不可能有
  任何插件发通知;网络断流导致 turn 失败这类情况(进程还活着)才会提醒。
- 配合 `settings.yaml` 里已调好的 `retryPolicy`(PI_AI_ERROR 等 12 次退避重试):
  瞬时抖动会被静默重试吸收,只有重试耗尽、真正中断时才弹"❌ 对话中断"。
