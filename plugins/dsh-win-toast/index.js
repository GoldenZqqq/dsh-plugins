'use strict';

/**
 * dsh-win-toast — DSH 插件:turn 结束时弹 Windows 系统级通知(Toast)。
 *
 * 监听宿主 session/event firehose(与 dsh-session-telemetry 同一条通道):
 *   - turn/end 且 reason.kind === "error"     → "对话中断"通知(上游断流、
 *     重试耗尽、非重试错误等最终失败;错误码如 PI_AI_ERROR 一并显示)
 *   - turn/end 且 reason.kind === "completed" → "任务完成"通知
 *   - reason.kind === "blocked"               → "等待你的输入"(工具审批/提问)
 *   - reason.kind === "max-tokens"            → "本轮达到 token 上限"
 *   - reason.kind === "aborted"               → 默认静默(手动停止),onAborted 开启后提示
 *   - session/title                           → 记住会话标题,通知里显示
 *
 * 发送方式:spawn Windows PowerShell(5.1) 用 WinRT ToastNotificationManager
 * 发 Toast(借用 powershell.exe 的 AppUserModelID,无需任何注册);失败自动
 * 退回气泡通知。点击通知以协议激活打开 webUrl(默认 DSH Web UI)。
 *
 * config(cordis.patch.yml 里写,均可省略):
 *   enabled:       boolean  总开关(默认 true)
 *   onComplete:    boolean  turn 正常结束弹通知(默认 true)
 *   onError:       boolean  turn 出错收场弹"中断"通知(默认 true)
 *   onAborted:     boolean  手动中止也弹(默认 false)
 *   minIntervalMs: number   同一会话两条通知的最小间隔,防风暴(默认 1500)
 *   webUrl:        string   点击通知打开的 URL(默认 http://127.0.0.1:3080)
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

const DEFAULTS = {
  enabled: true,
  onComplete: true,
  onError: true,
  onAborted: false,
  minIntervalMs: 1500,
  webUrl: 'http://127.0.0.1:3080',
};

/** 压平控制字符与空白;通知文本要进 XML,不能带原始控制字符。 */
const clean = (value) =>
  String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 190);

module.exports = {
  name: 'dsh-win-toast',
  inject: [],
  apply(ctx, rawConfig) {
    const config = { ...DEFAULTS, ...(rawConfig ?? {}) };
    if (!config.enabled) return;

    const script = path.join(__dirname, 'toast.ps1');
    const titles = new Map(); // sessionKey -> 会话标题
    const lastAt = new Map(); // sessionKey -> 上次通知时间戳

    const show = (kind, title, body, sessionKey) => {
      const now = Date.now();
      if (config.minIntervalMs > 0 && now - (lastAt.get(sessionKey) ?? 0) < config.minIntervalMs) return;
      lastAt.set(sessionKey, now);

      const args = [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', script,
        '-Kind', kind,
        '-Title', clean(title).slice(0, 90) || 'DSH',
        '-Body', clean(body),
      ];
      if (config.webUrl) args.push('-Launch', String(config.webUrl));

      try {
        const child = spawn('powershell.exe', args, {
          windowsHide: true,
          stdio: 'ignore',
        });
        child.on('error', (error) => {
          ctx.logger?.warn?.('dsh-win-toast: spawn powershell failed: ' + (error?.message ?? error));
        });
      } catch (error) {
        ctx.logger?.warn?.('dsh-win-toast: spawn threw: ' + (error?.message ?? error));
      }
    };

    ctx.on('session/event', (session, event) => {
      try {
        if (!event || typeof event.type !== 'string') return;
        const key = session?.id ?? 'session';

        if (event.type === 'session/title') {
          const title = event.data?.title;
          if (typeof title === 'string' && title.trim()) titles.set(key, title.trim());
          return;
        }
        if (event.type !== 'turn/end') return;

        const reason = event.data?.reason ?? {};
        const kind = reason.kind;
        const title = titles.get(key) ?? 'DSH 会话';

        if (kind === 'error') {
          if (!config.onError) return;
          const failure = reason.error ?? {};
          const code = clean(failure.code ?? '');
          const message = clean(failure.message ?? '') || '未知错误';
          show('error', `❌ 对话中断 · ${title}`, code ? `[${code}] ${message}` : message, key);
        } else if (kind === 'aborted') {
          if (!config.onAborted) return;
          show('info', `⏹ 已停止 · ${title}`, '本轮对话被手动中止', key);
        } else if (kind === 'blocked') {
          if (!config.onComplete) return;
          show('info', `⏸ 等待你的输入 · ${title}`, '本轮已暂停(可能在等工具审批或回答)', key);
        } else if (kind === 'max-tokens') {
          if (!config.onComplete) return;
          show('info', `⚠️ 达到 token 上限 · ${title}`, '本轮因长度上限提前结束', key);
        } else if (kind === 'completed') {
          if (!config.onComplete) return;
          show('ok', `✅ 任务完成 · ${title}`, '本轮对话已正常结束', key);
        }
      } catch (error) {
        ctx.logger?.warn?.('dsh-win-toast: handler error: ' + (error?.message ?? error));
      }
    });
  },
};
