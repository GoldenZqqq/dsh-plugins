'use strict';
/**
 * dsh-heartbeat — 浏览器半体。
 *
 * 一个"活着"的心率监视器：把模型吐 token 的速度映射成心率，用真实 ECG 波形、
 * 生命体征面板和病理状态机把 DSH 的工作状态可视化成一颗跳动的心脏。
 *
 * 设计原则（与 dsh-model-collapse / dsh-workspace-collapse 一致）：
 * - 纯 DOM 挂载：不 fork、不修改任何 React 组件，不注册 DSH 的 slot。
 *   槽表在 0.1 → 0.2 之间删过键（sidebar.header.dock 已被移除），
 *   挂在 body 上才是跨版本最稳的姿势。
 * - 数据面只依赖三个稳定服务：connection / sessions / remote。
 *   所有取用都做空值兜底，任何一处 API 漂移都不该让小组件整体消失。
 * - 零 npm 依赖，不 require 任何客户端包（只碰标准 DOM API）。
 *
 * 兼容说明：DSH 0.2.x 的实时 token 事件是 `assistant/live-chunk`，
 * 0.1.x 是老 `assistant/chunk`；两个都监听，所以新旧版本都能跳动。
 *
 * config（cordis.patch.yml 的 insert 条目里写，全部可选）：
 *   enabled:   boolean  总开关（默认 true；false 即不挂载）
 *   mode:      'card' | 'rail'   初始形态（默认 card；rail 是只留 ♥+数字的迷你条）
 *   scale:     number   整体缩放 0.8–1.6（默认 1）
 *   opacity:   number   不透明度 0.4–1（默认 1，悬停时自动回满）
 *   showEcg:   boolean  显示 ECG 波形（默认 true）
 *   showHud:   boolean  显示 tok/s、TTFT 等指标（默认 true）
 *   position:  初始落位 top-left | top-right | bottom-left | bottom-right（默认 bottom-right）
 *   accent:    string   自定义强调色（CSS 颜色，留空则跟随状态色）
 */

window.__ModuleLoader__.load({
	id: 'dsh-heartbeat',
	factory: (_require) => {
		var module = { exports: {} };
		var exports = module.exports;

		/* ══════════════════════════════════════════════════════════════════
		 * 常量
		 * ══════════════════════════════════════════════════════════════════ */

		/* 心率档位：和上游保持同一套数值，便于对比。 */
		const HIBERNATE_BASE = 25;
		const THINK_BPM_BASE = 44;
		const NORMAL_BPM_FLOOR = 50;
		const NORMAL_BPM_AMP = 110;
		const BURST_BPM_BASE = 180;
		const BURST_BPM_CEIL = 200;
		const BURST_ENTER = 40; // tok/s 进狂暴
		const BURST_LEAVE = 30; // tok/s 退狂暴（滞回）

		const WINDOW_MS = 3000; // 速率统计窗口
		const STREAM_HOLD_MS = 1000; // 最后一次 token 后仍算"输出中"的时长
		const RATE_TAU = 650; // 速率平滑时间常数
		const METRIC_INTERVAL_MS = 120; // 面板刷新节流

		const ARRHYTHMIA_MS = 6000; // 出错后的心律不齐持续时长
		const PREMATURE_MS = 1400; // 重试早搏的视觉持续时长

		const STORAGE_POS = 'dsh-heartbeat:pos';
		const STORAGE_MODE = 'dsh-heartbeat:mode';
		const STORAGE_STATS = 'dsh-heartbeat:stats';
		const STYLE_ID = 'dsh-heartbeat-style';
		const HOST_ID = 'dsh-heartbeat';

		/* ══════════════════════════════════════════════════════════════════
		 * 小工具
		 * ══════════════════════════════════════════════════════════════════ */

		function clamp(v, lo, hi) {
			return v < lo ? lo : v > hi ? hi : v;
		}

		function num(v, lo, hi, fallback) {
			const n = typeof v === 'number' ? v : Number(v);
			if (!Number.isFinite(n)) return fallback;
			return clamp(n, lo, hi);
		}

		/** 有机的静息抖动：慢速正弦 + 微小噪声，避免数字像死的一样定住。 */
		function drift(base, span, periodMs) {
			return base + Math.sin(Date.now() / periodMs) * span + (Math.random() - 0.5) * 0.6;
		}

		/** 32 位整数哈希，用于让每次心跳的"异常"可复现（回看波形时不闪）。 */
		function hash32(n) {
			let x = (n | 0) * 2654435761;
			x ^= x >>> 15;
			x = (x * 2246822507) | 0;
			x ^= x >>> 13;
			return (x >>> 0) / 4294967296;
		}

		function readStorage(key) {
			try {
				const raw = window.localStorage.getItem(key);
				return raw === null ? null : JSON.parse(raw);
			} catch {
				return null;
			}
		}

		function writeStorage(key, value) {
			try {
				window.localStorage.setItem(key, JSON.stringify(value));
			} catch {
				/* 隐私模式 / 配额满：位置记忆失效不该影响主体功能。 */
			}
		}

		/* ══════════════════════════════════════════════════════════════════
		 * 引擎：把事件流折算成心率与病理状态
		 * ══════════════════════════════════════════════════════════════════ */

		function createEngine() {
			return {
				windowStamps: [],
				tokens: 0,
				tokensSession: 0,
				toolCalls: 0,
				retries: 0,

				rate: 0,
				rateRaw: 0,
				peakRate: 0,
				bpm: HIBERNATE_BASE,
				targetBpm: HIBERNATE_BASE,
				phase: 0, // 0–1 的当前心动周期位置
				phaseTotal: 0, // 无界相位，供 ECG 回看用
				periodMs: 60000 / HIBERNATE_BASE,

				streaming: false,
				burst: false,
				connected: false,
				anyRunning: false,

				provider: '',
				model: '',

				/* TTFT：从 request/header 到第一个 token delta 的毫秒数（-1 = 还没测到）。 */
				requestAt: 0,
				ttftMs: -1,
				firstTokenOfStep: false,

				/* 病理状态：arrhythmia（心律不齐）/ premature（早搏）/ apnea（屏息）。 */
				pathology: '',
				pathologyUntil: 0,

				lastTokenAt: -Infinity,
				lastFrameAt: 0,
				burstAt: 0,
				peakSessionRate: 0,

				disposed: false,

				/** 计入一个 token delta。 */
				markToken(now) {
					this.windowStamps.push(now);
					this.tokens += 1;
					this.tokensSession += 1;
					this.lastTokenAt = now;
					if (this.requestAt > 0 && this.firstTokenOfStep) {
						this.ttftMs = Math.max(0, now - this.requestAt);
						this.firstTokenOfStep = false;
					}
				},

				/** 一个 step 的开始（request/header）——重置 TTFT 计时。 */
				markRequest(now) {
					this.requestAt = now;
					this.firstTokenOfStep = true;
				},

				/**
				 * 处理一帧 process-local 的 assistant-stream —— 0.2.x 实时输出的真正来源。
				 * 必须在 follow 里显式请求 assistantStream: true 才会下发这些帧。
				 * @param frame - SessionAssistantStreamFrame：start / chunk / end。
				 * @param now - 收到该帧的时刻。
				 */
				handleAssistantFrame(frame, now) {
					if (!frame || typeof frame.type !== 'string') return;
					this.connected = true;
					if (frame.type === 'start') {
						this.markRequest(now);
						return;
					}
					if (frame.type === 'chunk') {
						const chunk = frame.chunk;
						if (chunk && (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' || chunk.type === 'tool-call-delta')) {
							this.markToken(now);
						}
					}
				},

				/**
				 * 用 opening snapshot 补齐"打开之前"的信息：
				 * 模型名来自 durable 的 request/header，一个 step 只发一次，
				 * 不补的话中途打开面板就一直是 —。
				 * @param frame - follow 的首帧。
				 */
				seedFromSnapshot(frame) {
					const records = frame && frame.records;
					if (Array.isArray(records)) {
						for (let i = records.length - 1; i >= 0; i -= 1) {
							const ev = records[i] && records[i].event;
							if (!ev || ev.type !== 'request/header') continue;
							const config = ev.data && ev.data.header && ev.data.header.config;
							if (config) {
								if (config.provider) this.provider = String(config.provider);
								if (config.model) this.model = String(config.model);
							}
							break;
						}
					}
					/* 已经吐出来的部分按 compact stream 的 delta 数补个底，别从 0 开始。 */
					const opening = frame && frame.assistantStream && frame.assistantStream.activeAttempt;
					if (opening && Array.isArray(opening.stream)) {
						let n = 0;
						for (const member of opening.stream) {
							const chunk = member && (member.chunk || member);
							if (chunk && (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' || chunk.type === 'tool-call-delta')) n += 1;
						}
						if (n > this.tokensSession) this.tokensSession = n;
					}
				},

				markPathology(kind, ms) {
					this.pathology = kind;
					this.pathologyUntil = Math.max(this.pathologyUntil, Date.now() + ms);
				},

				/** 处理一条 Session 线事件（原始 SessionWireEvent）。 */
				handleEvent(ev, now) {
					if (!ev || typeof ev.type !== 'string') return;
					this.connected = true;

					/* 实时与旧版两类 chunk 事件都认。 */
					if (ev.type === 'assistant/live-chunk' || ev.type === 'assistant/chunk') {
						const chunk = ev.data && ev.data.chunk;
						if (!chunk) return;
						if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' || chunk.type === 'tool-call-delta') {
							this.markToken(now);
						}
						return;
					}

					if (ev.type === 'request/header') {
						const config = ev.data && ev.data.header && ev.data.header.config;
						if (config) {
							if (config.provider) this.provider = String(config.provider);
							if (config.model) this.model = String(config.model);
						}
						this.markRequest(now);
						return;
					}

					if (ev.type === 'tool/call') {
						this.toolCalls += 1;
						return;
					}

					if (ev.type === 'llm/retry' || ev.type === 'llm/retry-started') {
						this.retries += 1;
						this.markPathology('premature', PREMATURE_MS);
						return;
					}

					if (ev.type === 'turn/end') {
						const reason = ev.data && ev.data.reason;
						const kind = reason && reason.kind;
						if (kind === 'error') {
							this.markPathology('arrhythmia', ARRHYTHMIA_MS);
						} else if (kind === 'blocked') {
							this.markPathology('apnea', 120000);
						} else {
							if (this.pathology === 'apnea') this.pathology = '';
						}
						return;
					}

					/* 新一轮动作开始，屏息结束。 */
					if (ev.type === 'turn/start' || ev.type === 'step/start' || ev.type === 'user/message') {
						if (this.pathology === 'apnea') this.pathology = '';
					}
				},

				/** 每帧推进：速率窗口、心率趋近、心动相位。 */
				advance(now) {
					/* 过期病理状态自动消退。 */
					if (this.pathology && Date.now() > this.pathologyUntil) this.pathology = '';

					/* 滑窗里丢掉 3s 之前的采样点。 */
					const cutoff = now - WINDOW_MS;
					let i = 0;
					while (i < this.windowStamps.length && this.windowStamps[i] < cutoff) i += 1;
					if (i > 0) this.windowStamps.splice(0, i);

					const span = Math.min(WINDOW_MS, now - (this.windowStamps[0] ?? now));
					this.rateRaw = span > 1 ? this.windowStamps.length / (span / 1000) : 0;
					if (this.rateRaw > this.peakRate) this.peakRate = this.rateRaw;
					if (this.streaming && this.rateRaw > this.peakSessionRate) this.peakSessionRate = this.rateRaw;

					const dt = this.lastFrameAt === 0 ? METRIC_INTERVAL_MS : now - this.lastFrameAt;
					if (dt > 0) {
						const alpha = 1 - Math.exp(-dt / RATE_TAU);
						this.rate += alpha * (this.rateRaw - this.rate);
					}

					this.streaming = now - this.lastTokenAt < STREAM_HOLD_MS;

					let target;
					if (!this.connected) {
						target = this.bpm; // 断线：停在最后的心率上
					} else if (this.pathology === 'arrhythmia') {
						/* 心律不齐：快而乱的室率。 */
						target = 150 + Math.sin(now / 180) * 25;
						this.burst = false;
					} else if (this.pathology === 'apnea') {
						target = 34 + Math.sin(now / 2600) * 3; // 屏息：慢而浅
						this.burst = false;
					} else if (this.pathology === 'premature') {
						target = clamp(this.bpm + 42, NORMAL_BPM_FLOOR, BURST_BPM_CEIL); // 早搏：突跳一下
					} else if (!this.streaming && !this.anyRunning) {
						target = clamp(drift(HIBERNATE_BASE, 3.6, 9000), 20, 30);
						this.burst = false;
					} else if (this.streaming && this.rate >= BURST_ENTER) {
						target = clamp(
							BURST_BPM_BASE + ((this.rate - BURST_ENTER) / 40) * (BURST_BPM_CEIL - BURST_BPM_BASE),
							BURST_BPM_BASE,
							BURST_BPM_CEIL,
						);
						if (!this.burst) this.burstAt = now;
						this.burst = true;
					} else {
						if (!this.streaming && this.anyRunning) target = clamp(drift(THINK_BPM_BASE, 3, 12000), 38, 50);
						else target = clamp(NORMAL_BPM_FLOOR + NORMAL_BPM_AMP * (1 - Math.exp(-this.rate / 24)), NORMAL_BPM_FLOOR, 160);
						if (this.burst && this.rate < BURST_LEAVE) this.burst = false;
					}

					const tau = this.pathology === 'arrhythmia' ? 180 : this.streaming ? 800 : this.anyRunning ? 1500 : 2600;
					const alphaB = 1 - Math.exp(-dt / tau);
					this.bpm += alphaB * (target - this.bpm);
					this.targetBpm = target;

					this.periodMs = 60000 / Math.max(15, this.bpm);
					const rawDt = this.lastFrameAt === 0 ? 16 : now - this.lastFrameAt;
					this.lastFrameAt = now;
					const dPhase = rawDt / this.periodMs;
					this.phase = (this.phase + dPhase) % 1;
					this.phaseTotal += dPhase;

					/* 偶发的"漏搏"——静息时像真人一样不均匀。 */
					if (!this.burst && this.pathology === '' && this.phase < 0.012 && Math.random() < 0.004) this.phase = 0.27;
				},

				classify() {
					if (!this.connected) return 'disconnected';
					if (this.pathology === 'arrhythmia') return 'arrhythmia';
					if (this.pathology === 'apnea') return 'apnea';
					if (this.pathology === 'premature') return 'premature';
					if (this.burst) return 'burst';
					if (this.streaming) return 'streaming';
					if (this.anyRunning) return 'thinking';
					return 'idle';
				},

				snapshot() {
					return {
						bpm: this.bpm,
						rate: this.rate,
						rateRaw: this.rateRaw,
						tokens: this.tokens,
						tokensSession: this.tokensSession,
						toolCalls: this.toolCalls,
						retries: this.retries,
						ttftMs: this.ttftMs,
						state: this.classify(),
						connected: this.connected,
						streaming: this.streaming,
						burst: this.burst,
						peakRate: this.peakRate,
						peakSessionRate: this.peakSessionRate,
						provider: this.provider,
						model: this.model,
						periodMs: this.periodMs,
					};
				},

				reset() {
					this.windowStamps = [];
					this.rate = 0;
					this.rateRaw = 0;
					this.tokensSession = 0;
					this.peakSessionRate = 0;
					this.ttftMs = -1;
					this.requestAt = 0;
					this.firstTokenOfStep = false;
					this.pathology = '';
					this.pathologyUntil = 0;
					this.burst = false;
				},
			};
		}

		/* ══════════════════════════════════════════════════════════════════
		 * 状态字典：颜色 + 文案（中英双语按界面语言选）
		 * ══════════════════════════════════════════════════════════════════ */

		const STATES = {
			idle: { zh: '冬眠', en: 'Hibernating', color: '#5b8def' },
			thinking: { zh: '思考', en: 'Thinking', color: '#4fb8a8' },
			streaming: { zh: '输出', en: 'Streaming', color: '#37c86a' },
			burst: { zh: '狂暴', en: 'Redline', color: '#ff4d4f' },
			premature: { zh: '早搏', en: 'Ectopic', color: '#f5a623' },
			arrhythmia: { zh: '心律不齐', en: 'Arrhythmia', color: '#e5484d' },
			apnea: { zh: '屏息', en: 'Apnea', color: '#8b6cff' },
			disconnected: { zh: '离线', en: 'Offline', color: '#6b7280' },
		};

		function isChineseUi() {
			const lang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
			if (lang) return lang.indexOf('zh') === 0;
			return (navigator.language || '').toLowerCase().indexOf('zh') === 0;
		}

		/* ══════════════════════════════════════════════════════════════════
		 * ECG：把相位换算成 P-QRS-T 波形
		 * ══════════════════════════════════════════════════════════════════ */

		/** 高斯脉冲：ECG 的每个波都是这么一个"鼓包"。 */
		function gauss(x, mu, sigma) {
			const d = (x - mu) / sigma;
			return Math.exp(-0.5 * d * d);
		}

		/**
		 * 一个心动周期的合成波形。
		 * @param phase - 0–1 的周期内相位。
		 * @param beat - 第几次心跳（用于让异常可复现）。
		 * @param style - '' | 'arrhythmia' | 'apnea' | 'disconnected'
		 * @returns 归一化振幅，大致 -0.35 ~ 1。
		 */
		function ecgSample(phase, beat, style) {
			if (style === 'disconnected') {
				/* 离线：一条带噪声的直线，偶尔抖一下。 */
				return (Math.random() - 0.5) * 0.06;
			}

			const h = hash32(beat);

			if (style === 'arrhythmia') {
				/* 室早/漏搏交替：没有 P 波、QRS 宽大、T 波倒置。 */
				if (h < 0.28) return (Math.random() - 0.5) * 0.08; // 漏搏
				if (h < 0.55) {
					return -0.9 * gauss(phase, 0.3, 0.055) + 0.25 * gauss(phase, 0.62, 0.09);
				}
				return (
					0.35 * gauss(phase, 0.2, 0.05) +
					1.15 * gauss(phase, 0.34, 0.022) -
					0.4 * gauss(phase, 0.4, 0.03) -
					0.45 * gauss(phase, 0.66, 0.08)
				);
			}

			if (style === 'apnea') {
				/* 屏息：慢、浅、T 波低平。 */
				return 0.25 * gauss(phase, 0.18, 0.05) + 0.55 * gauss(phase, 0.32, 0.018) + 0.12 * gauss(phase, 0.6, 0.07);
			}

			/* 正常 P-QRS-T。 */
			let v =
				0.13 * gauss(phase, 0.14, 0.028) + // P
				0.22 * gauss(phase, 0.28, 0.016) - // Q
				1.0 * gauss(phase, 0.302, 0.011) + // R
				0.26 * gauss(phase, 0.326, 0.014) + // S
				0.30 * gauss(phase, 0.5, 0.045); // T

			/* 轻微基线漂移 + 噪声，像真实贴电极的信号。 */
			v += Math.sin(phase * Math.PI * 2) * 0.015 + (Math.random() - 0.5) * 0.012;
			return v;
		}

		/**
		 * ECG 画布：每帧按"回溯相位"重算整条曲线，不需要滚动缓冲。
		 * 因为任意时刻 t-i·dt 的相位 = phaseTotal - i·dt/period，可以解析求出。
		 */
		function createEcg(canvas) {
			const ctx2d = canvas.getContext('2d');
			let dpr = 1;
			let cssW = 0;
			let cssH = 0;

			function resize() {
				/* 用 clientWidth：布局尺寸，不含祖先 transform 的缩放，画出来才不糊。 */
				cssW = Math.max(1, Math.round(canvas.clientWidth || 0));
				cssH = Math.max(1, Math.round(canvas.clientHeight || 0));
				if (cssW <= 1 || cssH <= 1) {
					cssW = 224;
					cssH = 54;
				}
				dpr = window.devicePixelRatio || 1;
				canvas.width = Math.round(cssW * dpr);
				canvas.height = Math.round(cssH * dpr);
				ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
			}

			resize();

			return {
				resize,
				draw(engine, color) {
					if (!ctx2d || cssW === 0) return;
					const style = engine.connected ? engine.pathology : 'disconnected';
					const mid = cssH * 0.62;
					const amp = cssH * 0.42;

					ctx2d.clearRect(0, 0, cssW, cssH);

					/* 心电图纸网格。 */
					ctx2d.strokeStyle = 'rgba(127, 140, 160, 0.12)';
					ctx2d.lineWidth = 1;
					ctx2d.beginPath();
					for (let x = 0; x < cssW; x += 8) {
						ctx2d.moveTo(x + 0.5, 0);
						ctx2d.lineTo(x + 0.5, cssH);
					}
					for (let y = 0; y < cssH; y += 8) {
						ctx2d.moveTo(0, y + 0.5);
						ctx2d.lineTo(cssW, y + 0.5);
					}
					ctx2d.stroke();

					/* 扫描线本身：从右往左算相位。 */
					const samples = Math.min(320, Math.max(80, Math.round(cssW / 1.5)));
					const dtMs = 16;
					const period = Math.max(120, engine.periodMs);
					const stepPhase = dtMs / period;
					const basePhase = engine.phaseTotal;

					ctx2d.beginPath();
					for (let i = 0; i < samples; i += 1) {
						const back = (samples - 1 - i) * stepPhase;
						const pt = basePhase - back;
						const phase = pt - Math.floor(pt);
						const beat = Math.floor(pt);
						const v = ecgSample(phase, beat, style);
						const x = (i / (samples - 1)) * cssW;
						const y = clamp(mid - v * amp, 0, cssH);
						if (i === 0) ctx2d.moveTo(x, y);
						else ctx2d.lineTo(x, y);
					}
					ctx2d.strokeStyle = color;
					ctx2d.lineWidth = 1.6;
					ctx2d.lineJoin = 'round';
					ctx2d.lineCap = 'round';
					ctx2d.shadowColor = color;
					ctx2d.shadowBlur = engine.burst ? 10 : 4;
					ctx2d.stroke();
					ctx2d.shadowBlur = 0;

					/* 右端亮点 = 当前时刻的笔尖。 */
					const beatNow = Math.floor(basePhase);
					const nowV = ecgSample(basePhase - beatNow, beatNow, style);
					ctx2d.fillStyle = color;
					ctx2d.beginPath();
					ctx2d.arc(cssW - 1.5, clamp(mid - nowV * amp, 0, cssH), 2.2, 0, Math.PI * 2);
					ctx2d.fill();
				},
			};
		}

		/* ══════════════════════════════════════════════════════════════════
		 * 视图
		 * ══════════════════════════════════════════════════════════════════ */

		const CSS = `
#${HOST_ID} {
  position: fixed;
  z-index: 60;
  pointer-events: auto;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  font-family: var(--dsw-font-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
  transform: scale(var(--hb-scale, 1));
  /* 原点固定在左上：这样 left/top 就是视觉左上角，缩放不会让贴边的小组件跑出屏幕。 */
  transform-origin: top left;
  opacity: var(--hb-opacity, 1);
  transition: opacity 0.18s ease;
}
#${HOST_ID}:hover { opacity: 1; }
#${HOST_ID} .hb-card {
  box-sizing: border-box;
  width: 248px;
  padding: 10px 12px 9px;
  border-radius: 14px;
  background: var(--dsw-specific-sidebar-fill, rgba(16, 20, 28, 0.92));
  border: 0.5px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
  box-shadow: var(--dsw-elevation-prominent, 0 10px 28px rgba(0, 0, 0, 0.34));
  backdrop-filter: blur(10px);
  color: var(--dsw-alias-label-primary, #e6e8ee);
  cursor: grab;
}
#${HOST_ID}[data-dragging] .hb-card { cursor: grabbing; }
#${HOST_ID} .hb-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 6px;
}
#${HOST_ID} .hb-heart {
  font-size: 15px;
  line-height: 1;
  color: var(--hb-accent, #37c86a);
  transform: scale(calc(1 + var(--hb-pulse, 0) * 0.34));
  transition: color 0.2s ease;
  will-change: transform;
}
#${HOST_ID} .hb-bpm {
  font-size: 22px;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
#${HOST_ID} .hb-unit {
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
  margin-bottom: 2px;
}
#${HOST_ID} .hb-state {
  margin-left: auto;
  font-size: 10.5px;
  line-height: 1;
  padding: 3px 7px;
  border-radius: 999px;
  color: var(--hb-accent, #37c86a);
  background: color-mix(in srgb, var(--hb-accent, #37c86a) 14%, transparent);
  white-space: nowrap;
}
#${HOST_ID} .hb-ecg {
  display: block;
  width: 100%;
  height: 54px;
  margin: 2px 0 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--hb-accent, #37c86a) 5%, transparent);
}
#${HOST_ID} .hb-hud {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 5px 4px;
  margin-bottom: 6px;
}
#${HOST_ID} .hb-metric {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
#${HOST_ID} .hb-metric b {
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#${HOST_ID} .hb-metric span {
  font-size: 8.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#${HOST_ID} .hb-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 9.5px;
  color: var(--dsw-alias-label-tertiary, #8b93a3);
}
#${HOST_ID} .hb-model {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}
#${HOST_ID} .hb-dot {
  width: 4px; height: 4px; border-radius: 50%;
  background: var(--hb-accent, #37c86a);
  flex: none;
}
#${HOST_ID}[data-burst] .hb-card {
  border-color: color-mix(in srgb, #ff4d4f 55%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, #ff4d4f 25%, transparent),
              0 10px 34px color-mix(in srgb, #ff4d4f 30%, transparent);
}
#${HOST_ID} .hb-rail {
  display: none;
  align-items: center;
  gap: 5px;
  padding: 5px 9px 5px 8px;
  border-radius: 999px;
  background: var(--dsw-specific-sidebar-fill, rgba(16, 20, 28, 0.92));
  border: 0.5px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
  box-shadow: var(--dsw-elevation-prominent, 0 6px 18px rgba(0, 0, 0, 0.3));
  backdrop-filter: blur(10px);
  color: var(--dsw-alias-label-primary, #e6e8ee);
  cursor: grab;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
#${HOST_ID}[data-mode="rail"] .hb-card { display: none; }
#${HOST_ID}[data-mode="rail"] .hb-rail { display: inline-flex; }
#${HOST_ID} .hb-rail .hb-heart { font-size: 13px; }
#${HOST_ID} .hb-rail .hb-rail-bpm { font-weight: 600; }
#${HOST_ID} .hb-menu {
  position: absolute;
  min-width: 132px;
  padding: 4px;
  border-radius: 10px;
  background: var(--dsw-specific-menu, rgba(24, 28, 38, 0.98));
  border: 0.5px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.12));
  box-shadow: var(--dsw-elevation-prominent, 0 10px 26px rgba(0, 0, 0, 0.4));
  font-size: 11.5px;
  display: none;
}
#${HOST_ID} .hb-menu[data-open] { display: block; }
#${HOST_ID} .hb-menu button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
#${HOST_ID} .hb-menu button:hover { background: var(--dsw-alias-fill-l1, rgba(255, 255, 255, 0.08)); }
@media (prefers-reduced-motion: reduce) {
  #${HOST_ID} .hb-heart { transition: none; }
}
`;

		function injectStyle() {
			if (document.getElementById(STYLE_ID) !== null) return;
			const tag = document.createElement('style');
			tag.id = STYLE_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		const UI_TEXT = {
			zh: {
				ecg: 'ECG',
				rate: 'tok/s',
				ttft: '首字',
				tokens: 'tokens',
				tools: '工具',
				menuCard: '卡片模式',
				menuRail: '迷你条',
				menuReset: '重置位置',
				menuStats: '重置统计',
				menuPause: '暂停动画',
				menuResume: '恢复动画',
			},
			en: {
				ecg: 'ECG',
				rate: 'tok/s',
				ttft: 'TTFT',
				tokens: 'tokens',
				tools: 'tools',
				menuCard: 'Card mode',
				menuRail: 'Mini bar',
				menuReset: 'Reset position',
				menuStats: 'Reset stats',
				menuPause: 'Pause animation',
				menuResume: 'Resume animation',
			},
		};

		function createView(config, engine) {
			const zh = isChineseUi();
			const text = zh ? UI_TEXT.zh : UI_TEXT.en;

			const host = document.createElement('div');
			host.id = HOST_ID;
			host.setAttribute('role', 'status');
			host.setAttribute('aria-live', 'off');
			host.dataset.mode = config.mode;

			/* ── 卡片 ─────────────────────────────────────────────── */
			const card = document.createElement('div');
			card.className = 'hb-card';

			const head = document.createElement('div');
			head.className = 'hb-head';

			const heart = document.createElement('span');
			heart.className = 'hb-heart';
			/* U+FE0E = 文本呈现选择符：不加的话部分系统会把 ♥ 渲染成彩色 emoji，盖掉状态色。 */
			heart.textContent = '\u2665\uFE0E';

			const bpmEl = document.createElement('span');
			bpmEl.className = 'hb-bpm';
			bpmEl.textContent = '--';

			const unit = document.createElement('span');
			unit.className = 'hb-unit';
			unit.textContent = 'BPM';

			const stateEl = document.createElement('span');
			stateEl.className = 'hb-state';
			stateEl.textContent = '--';

			head.append(heart, bpmEl, unit, stateEl);

			const ecgCanvas = document.createElement('canvas');
			ecgCanvas.className = 'hb-ecg';
			if (!config.showEcg) ecgCanvas.style.display = 'none';

			const hud = document.createElement('div');
			hud.className = 'hb-hud';
			if (!config.showHud) hud.style.display = 'none';

			const metricRefs = {};
			for (const key of ['rate', 'ttft', 'tokens', 'tools']) {
				const box = document.createElement('div');
				box.className = 'hb-metric';
				const value = document.createElement('b');
				value.textContent = '—';
				const label = document.createElement('span');
				label.textContent = text[key];
				box.append(value, label);
				hud.appendChild(box);
				metricRefs[key] = value;
			}

			const foot = document.createElement('div');
			foot.className = 'hb-foot';
			const dot = document.createElement('span');
			dot.className = 'hb-dot';
			const modelEl = document.createElement('span');
			modelEl.className = 'hb-model';
			modelEl.textContent = '—';
			foot.append(dot, modelEl);

			card.append(head, ecgCanvas, hud, foot);

			/* ── 迷你条 ───────────────────────────────────────────── */
			const rail = document.createElement('div');
			rail.className = 'hb-rail';
			const railHeart = document.createElement('span');
			railHeart.className = 'hb-heart';
			railHeart.textContent = '\u2665\uFE0E';
			const railBpm = document.createElement('span');
			railBpm.className = 'hb-rail-bpm';
			railBpm.textContent = '--';
			rail.append(railHeart, railBpm);

			/* ── 右键菜单 ─────────────────────────────────────────── */
			const menu = document.createElement('div');
			menu.className = 'hb-menu';
			const menuItems = [
				{ id: 'mode', label: () => (host.dataset.mode === 'rail' ? text.menuCard : text.menuRail) },
				{ id: 'reset', label: () => text.menuReset },
				{ id: 'stats', label: () => text.menuStats },
				{ id: 'pause', label: () => (paused ? text.menuResume : text.menuPause) },
			];
			const menuButtons = {};
			for (const item of menuItems) {
				const btn = document.createElement('button');
				btn.type = 'button';
				btn.addEventListener('click', (event) => {
					event.stopPropagation();
					onMenuAction(item.id);
					closeMenu();
				});
				menu.appendChild(btn);
				menuButtons[item.id] = btn;
			}

			host.append(card, rail, menu);
			document.body.appendChild(host);

			const ecg = createEcg(ecgCanvas);

			/* ── 位置 ─────────────────────────────────────────────── */
			const MARGIN = 20;

			function viewportSize() {
				return { w: window.innerWidth, h: window.innerHeight };
			}

			function hostSize() {
				/* offsetWidth/Height 是布局尺寸（不受 transform 影响），乘缩放就是视觉尺寸。 */
				return {
					w: (host.offsetWidth || 248) * config.scale,
					h: (host.offsetHeight || 120) * config.scale,
				};
			}

			function clampPos(x, y) {
				const vp = viewportSize();
				const size = hostSize();
				const maxX = Math.max(MARGIN, vp.w - size.w - MARGIN);
				const maxY = Math.max(MARGIN, vp.h - size.h - MARGIN);
				return { x: clamp(x, MARGIN, maxX), y: clamp(y, MARGIN, maxY) };
			}

			function defaultPos() {
				const vp = viewportSize();
				const size = hostSize();
				const right = vp.w - size.w - MARGIN;
				const bottom = vp.h - size.h - MARGIN;
				switch (config.position) {
					case 'top-left':
						return { x: MARGIN, y: MARGIN };
					case 'top-right':
						return { x: right, y: MARGIN };
					case 'bottom-left':
						return { x: MARGIN, y: bottom };
					default:
						return { x: right, y: bottom };
				}
			}

			let pos = (() => {
				const saved = readStorage(STORAGE_POS);
				if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return clampPos(saved.x, saved.y);
				return defaultPos();
			})();

			function applyPos() {
				host.style.left = `${Math.round(pos.x)}px`;
				host.style.top = `${Math.round(pos.y)}px`;
				host.style.right = 'auto';
				host.style.bottom = 'auto';
			}

			applyPos();

			/* 尺寸要在挂载后再量一次（首帧字体/画布布局还没稳定）。 */
			requestAnimationFrame(() => {
				pos = clampPos(pos.x, pos.y);
				applyPos();
				ecg.resize();
			});

			/* ── 拖拽 ─────────────────────────────────────────────── */
			let dragging = false;
			let dragOffset = { x: 0, y: 0 };
			let moved = false;

			function onPointerDown(event) {
				if (event.button !== undefined && event.button !== 0) return;
				closeMenu();
				const rect = host.getBoundingClientRect();
				dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
				dragging = true;
				moved = false;
				host.dataset.dragging = '';
				host.setPointerCapture?.(event.pointerId);
				event.preventDefault();
			}

			function onPointerMove(event) {
				if (!dragging) return;
				moved = true;
				const vp = viewportSize();
				const size = hostSize();
				/* left/top 就是视觉左上角（transform-origin: top left），所以不用再除缩放。 */
				const x = event.clientX - dragOffset.x;
				const y = event.clientY - dragOffset.y;
				pos = {
					x: clamp(x, MARGIN, Math.max(MARGIN, vp.w - size.w - MARGIN)),
					y: clamp(y, MARGIN, Math.max(MARGIN, vp.h - size.h - MARGIN)),
				};
				applyPos();
			}

			function onPointerUp(event) {
				if (!dragging) return;
				dragging = false;
				delete host.dataset.dragging;
				host.releasePointerCapture?.(event.pointerId);

				/* 边缘吸附：拖到离边 28px 内就贴上去。 */
				const SNAP = 28;
				const vp = viewportSize();
				const size = hostSize();
				const right = vp.w - size.w - MARGIN;
				const bottom = vp.h - size.h - MARGIN;
				let { x, y } = pos;
				if (x - MARGIN < SNAP) x = MARGIN;
				else if (right - x < SNAP) x = right;
				if (y - MARGIN < SNAP) y = MARGIN;
				else if (bottom - y < SNAP) y = bottom;
				pos = clampPos(x, y);
				applyPos();
				writeStorage(STORAGE_POS, pos);
			}

			card.addEventListener('pointerdown', onPointerDown);
			rail.addEventListener('pointerdown', onPointerDown);
			window.addEventListener('pointermove', onPointerMove);
			window.addEventListener('pointerup', onPointerUp);
			window.addEventListener('pointercancel', onPointerUp);

			/* ── 菜单 ─────────────────────────────────────────────── */
			let paused = false;

			function openMenu(clientX, clientY) {
				for (const item of menuItems) menuButtons[item.id].textContent = item.label();
				menu.dataset.open = '';
				const rect = host.getBoundingClientRect();
				menu.style.left = `${Math.max(0, clientX - rect.left - 8)}px`;
				menu.style.top = `${Math.max(0, clientY - rect.top + 4)}px`;
			}

			function closeMenu() {
				delete menu.dataset.open;
			}

			function onMenuAction(id) {
				if (id === 'mode') {
					const next = host.dataset.mode === 'rail' ? 'card' : 'rail';
					setMode(next);
					writeStorage(STORAGE_MODE, next);
				} else if (id === 'reset') {
					pos = defaultPos();
					applyPos();
					writeStorage(STORAGE_POS, { x: pos.x, y: pos.y });
				} else if (id === 'stats') {
					engine.reset();
					writeStorage(STORAGE_STATS, null);
				} else if (id === 'pause') {
					paused = !paused;
					host.dataset.paused = paused ? '' : undefined;
					if (!paused) engine.lastFrameAt = 0;
				}
			}

			function setMode(mode) {
				host.dataset.mode = mode;
				requestAnimationFrame(() => {
					pos = clampPos(pos.x, pos.y);
					applyPos();
					ecg.resize();
				});
			}

			host.addEventListener('contextmenu', (event) => {
				event.preventDefault();
				openMenu(event.clientX, event.clientY);
			});
			host.addEventListener('dblclick', () => {
				if (moved) return;
				const next = host.dataset.mode === 'rail' ? 'card' : 'rail';
				setMode(next);
				writeStorage(STORAGE_MODE, next);
			});
			window.addEventListener('pointerdown', (event) => {
				if (!host.contains(event.target)) closeMenu();
			});

			function onResize() {
				pos = clampPos(pos.x, pos.y);
				applyPos();
				ecg.resize();
			}
			window.addEventListener('resize', onResize);

			/* ── 渲染 ─────────────────────────────────────────────── */
			const cache = { bpm: '', state: '', rate: '', ttft: '', tokens: '', tools: '', model: '', accent: '' };

			function setText(node, key, value) {
				if (cache[key] === value) return;
				cache[key] = value;
				node.textContent = value;
			}

			return {
				host,
				engine,
				get paused() {
					return paused;
				},
				dispose() {
					card.removeEventListener('pointerdown', onPointerDown);
					rail.removeEventListener('pointerdown', onPointerDown);
					window.removeEventListener('pointermove', onPointerMove);
					window.removeEventListener('pointerup', onPointerUp);
					window.removeEventListener('pointercancel', onPointerUp);
					window.removeEventListener('resize', onResize);
					host.remove();
					const style = document.getElementById(STYLE_ID);
					if (style) style.remove();
				},
				render(now) {
					const snap = engine.snapshot();
					const meta = STATES[snap.state] || STATES.idle;
					const accent = config.accent || meta.color;

					host.dataset.state = snap.state;
					if (snap.burst) host.dataset.burst = '';
					else delete host.dataset.burst;

					if (cache.accent !== accent) {
						cache.accent = accent;
						host.style.setProperty('--hb-accent', accent);
					}

					const pulseDistance = Math.abs(engine.phase - 0.302);
					const wrapped = pulseDistance > 0.5 ? 1 - pulseDistance : pulseDistance;
					const pulse = wrapped < 0.16 ? (1 - wrapped / 0.16) ** 2 : 0;
					host.style.setProperty('--hb-pulse', pulse.toFixed(3));

					const bpmText = String(Math.round(snap.bpm));
					setText(bpmEl, 'bpm', bpmText);
					setText(railBpm, 'railBpm', bpmText);
					setText(stateEl, 'state', zh ? meta.zh : meta.en);
					setText(modelEl, 'model', snap.model || snap.provider || '—');

					setText(metricRefs.rate, 'rate', snap.rate >= 1 ? snap.rate.toFixed(0) : (snap.rateRaw > 0 ? '<1' : '0'));
					const ttftText =
						snap.ttftMs < 0
							? '—'
							: snap.ttftMs < 1
								? '<1ms'
								: snap.ttftMs < 1000
									? `${Math.round(snap.ttftMs)}ms`
									: `${(snap.ttftMs / 1000).toFixed(1)}s`;
					setText(metricRefs.ttft, 'ttft', ttftText);
					setText(metricRefs.tokens, 'tokens', snap.tokensSession >= 1000 ? `${(snap.tokensSession / 1000).toFixed(1)}k` : String(snap.tokensSession));
					setText(metricRefs.tools, 'tools', String(snap.toolCalls));

					host.setAttribute('aria-label', `${zh ? '心率' : 'Heart rate'} ${bpmText} BPM, ${zh ? '状态' : 'state'} ${zh ? meta.zh : meta.en}`);
					host.title = `${zh ? meta.zh : meta.en} · ${bpmText} BPM · ${snap.rate.toFixed(0)} tok/s`;

					if (config.showEcg) ecg.draw(engine, accent);
				},
			};
		}

		/* ══════════════════════════════════════════════════════════════════
		 * 客户端插件体
		 * ══════════════════════════════════════════════════════════════════ */

		/** 只依赖这三个稳定服务；不再要求 slots（槽表跨版本会删键）。 */
		const inject = ['connection', 'sessions', 'remote'];

		function normalizeConfig(raw) {
			const c = raw && typeof raw === 'object' ? raw : {};
			return {
				enabled: c.enabled !== false,
				mode: c.mode === 'rail' ? 'rail' : 'card',
				scale: num(c.scale, 0.8, 1.6, 1),
				opacity: num(c.opacity, 0.4, 1, 1),
				showEcg: c.showEcg !== false,
				showHud: c.showHud !== false,
				position: ['top-left', 'top-right', 'bottom-left', 'bottom-right'].indexOf(c.position) >= 0 ? c.position : 'bottom-right',
				accent: typeof c.accent === 'string' && c.accent !== '' ? c.accent : '',
			};
		}

		/**
		 * @param ctx - 客户端根 context。
		 * @param config - insert 条目上的 config。
		 */
		function apply(ctx, config) {
			const cfg = normalizeConfig(config);
			if (!cfg.enabled) return;
			if (typeof document === 'undefined' || !document.body) return;

			injectStyle();

			const engine = createEngine();
			const view = createView(cfg, engine);
			view.host.style.setProperty('--hb-scale', String(cfg.scale));
			view.host.style.setProperty('--hb-opacity', String(cfg.opacity));

			/* 恢复上次的形态（配置给的初始值只在没有历史记忆时生效）。 */
			const savedMode = readStorage(STORAGE_MODE);
			if (savedMode === 'rail' || savedMode === 'card') view.host.dataset.mode = savedMode;

			let disposed = false;
			const streamAborts = new Map();
			const startedIds = new Set();

			/* 两种取法都试：cordis 的 ctx.get(name)，以及个别装配下直接挂在 ctx 上的属性。 */
			const connection = (ctx.get && ctx.get('connection')) || ctx.connection;
			const sessions = (ctx.get && ctx.get('sessions')) || ctx.sessions;
			const remote = (ctx.get && ctx.get('remote')) || ctx.remote;

			/* ── 连接状态 ─────────────────────────────────────────── */
			let offState = () => {};
			let lastState = '';
			if (connection && connection.state && typeof connection.state.subscribe === 'function') {
				try {
					lastState = connection.state.getSnapshot();
					engine.connected = lastState === 'connected';
					offState = connection.state.subscribe((state) => {
						lastState = state;
						engine.connected = state === 'connected';
						if (state !== 'connected') abortAll();
						else syncStreams();
					});
				} catch {
					/* 连接服务形态变了也不该让组件消失。 */
				}
			}

			/* ── 会话流：只跟"正在跑"的会话，逐 token 喂引擎 ────────── */
			function abortAll() {
				for (const ac of streamAborts.values()) {
					try {
						ac.abort();
					} catch {}
				}
				streamAborts.clear();
				startedIds.clear();
			}

			/* 诊断用：流失败只在控制台提示一次，不打扰界面。 */
			let lastWarnAt = 0;
			function warnOnce(message, error) {
				const now = Date.now();
				if (now - lastWarnAt < 10000) return;
				lastWarnAt = now;
				try {
					console.warn(`[dsh-heartbeat] ${message}`, error);
				} catch {
					/* 控制台不可用就算了。 */
				}
			}

			function runStream(address, signal) {
				const key = address.kind === 'session' ? address.sessionId : address.childSessionId;
				(async () => {
					try {
						if (!remote || !remote.session || typeof remote.session.follow !== 'function') {
							warnOnce('remote.session.follow 不可用，无法测量 token 速度');
							return;
						}
						/*
						 * assistantStream: true 是关键：0.2.x 的实时 token 走 process-local 的
						 * assistant-stream 帧，不显式请求就一帧都不下发，心率会一直停在冬息档。
						 */
						for await (const frame of remote.session.follow({ address, assistantStream: true }, signal)) {
							if (disposed || signal.aborted) break;
							if (!frame) continue;
							if (frame.type === 'event' && frame.event) {
								engine.handleEvent(frame.event, performance.now());
							} else if (frame.type === 'assistant-stream') {
								engine.handleAssistantFrame(frame.frame, performance.now());
							} else if (frame.type === 'snapshot') {
								engine.connected = true;
								engine.seedFromSnapshot(frame);
							}
						}
					} catch (error) {
						/* 主动 abort 是正常收尾；其它错误记一次，方便排查"不跳"的问题。 */
						if (!signal.aborted) warnOnce('follow 流中断', error);
					} finally {
						startedIds.delete(key);
						streamAborts.delete(key);
						if (!disposed && !signal.aborted) setTimeout(syncStreams, 1500);
					}
				})();
			}

			function syncStreams() {
				if (disposed || !sessions || !sessions.list) return;
				let snap;
				try {
					snap = sessions.list.getSnapshot();
				} catch {
					return;
				}
				if (!snap || !snap.ids) return;

				let anyRunning = false;
				for (const id of snap.ids) {
					const row = snap.byId ? snap.byId[id] : undefined;
					if (!row || row.running !== true) continue;
					anyRunning = true;
					if (startedIds.has(id)) continue;

					let address = { kind: 'session', sessionId: id };
					if (row.origin === 'subagent') {
						let addr;
						try {
							addr = sessions.subagentAddress ? sessions.subagentAddress(id) : undefined;
						} catch {
							addr = undefined;
						}
						if (!addr) continue;
						address = addr;
					}
					startedIds.add(id);
					const ac = new AbortController();
					streamAborts.set(id, ac);
					runStream(address, ac.signal);
				}
				engine.anyRunning = anyRunning;

				/* 已经不在跑的会话，把流收掉。 */
				for (const [id, ac] of [...streamAborts]) {
					const row = snap.byId ? snap.byId[id] : undefined;
					if (!row || row.running !== true) {
						try {
							ac.abort();
						} catch {}
						startedIds.delete(id);
						streamAborts.delete(id);
					}
				}
			}

			let offList = () => {};
			if (sessions && sessions.list && typeof sessions.list.subscribe === 'function') {
				try {
					offList = sessions.list.subscribe(syncStreams);
				} catch {}
			}
			syncStreams();

			/* 宿主重连后重开流。 */
			let offReset = () => {};
			if (typeof ctx.on === 'function') {
				try {
					offReset = ctx.on('connection/reset', () => {
						engine.connected = true;
						syncStreams();
					});
				} catch {}
			}

			/* ── 动画循环：rAF 推进引擎 + 画 ECG ───────────────────── */
			let raf = 0;

			function frame(now) {
				if (disposed) return;
				if (!document.hidden) {
					if (!view.paused) {
						engine.advance(now);
						try {
							view.render(now);
						} catch {
							/* 单帧渲染异常不该杀死整个循环。 */
						}
					}
				}
				raf = requestAnimationFrame(frame);
			}
			raf = requestAnimationFrame(frame);

			/* 页面隐藏时 rAF 会被浏览器掐掉，回来时重置帧基准避免心率跳变。 */
			function onVisibility() {
				if (!document.hidden) engine.lastFrameAt = 0;
			}
			document.addEventListener('visibilitychange', onVisibility);

			/* ── 收尾：cordis 的 effect 级联卸载 ──────────────────── */
			const cleanup = () => {
				if (disposed) return;
				disposed = true;
				cancelAnimationFrame(raf);
				document.removeEventListener('visibilitychange', onVisibility);
				try {
					offList();
				} catch {}
				try {
					offReset();
				} catch {}
				try {
					offState();
				} catch {}
				abortAll();
				view.dispose();
			};

			if (typeof ctx.effect === 'function') {
				ctx.effect(() => cleanup, 'heartbeat: widget lifecycle');
			} else {
				window.addEventListener('beforeunload', cleanup, { once: true });
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
