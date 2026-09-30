'use strict';
/**
 * dsh-model-collapse — 浏览器半体。
 *
 * 让 DSH 网页端模型选择菜单(composer 的模型 seat,由
 * @deepseek-ai/dsh-client-ui-model-selection 渲染)里按 provider 分组的列表
 * 默认全部收起,点击分组标题才展开;标题上显示折叠箭头和模型数量,
 * 展开状态记入浏览器 localStorage,下次打开保持用户的选择。
 *
 * v1.2:官方模型菜单自带搜索框(4 个以上模型即显示),插件自己的筛选输入框
 * 变成重复入口,已移除,只保留分组操作。
 * 菜单顶部常驻快捷条(菜单是 flex 列,快捷条是 .groups 滚动区的兄弟节点,
 * 天然钉在顶部,滚动列表时始终可见),四个图标按钮,无文字:
 *  - 全部展开 / 全部收起:一键展开 / 收起所有 provider 分组;
 *  - 定位当前:只展开"当前选中模型"所在分组,其余全部收起(provider 多时
 *    一眼定位当前模型归属);
 *  - 重置记忆:清空展开状态记忆,回到初始(选中组展开、其余收起)。
 *  - 键盘:Alt+E 全部展开 / Alt+C 全部收起 / Alt+F 定位当前模型。
 *
 * 实现仍然是完全的 DOM 增强层,不替换、不包裹任何 React 管理的节点:
 *  - 唯一新增的节点是快捷条本身,prepend 在菜单根部;React 更新时只操作
 *    自己持有引用的子节点,prepend 的外来节点会保留;若菜单整体卸载,
 *    快捷条随之消失,下一轮 rescan 会重新装上;
 *  - 隐藏/显示模型行用 CSS 规则(display:none),不增删任何 React 节点;
 *  - 点击/键盘交互用 document 级事件委托,不持有组件内部引用;
 *  - 选择器刻意只用 ARIA 语义(role="menu" / role="group" / aria-checked),
 *    不碰 CSS-modules 哈希类名,DSH 升级换类名也不受影响。
 *
 * 键盘:Enter/空格 切换分组;↑/↓ 只在"可见"的菜单项之间移动焦点,
 * 跳过被收起的行(原生实现在隐藏项上会静默失败,这里在捕获阶段接管)。
 */

window.__ModuleLoader__.load({
	id: 'dsh-model-collapse',
	factory: () => {
		var module = { exports: {} };
		var exports = module.exports;

		/** localStorage 键:保存"处于展开状态的分组标题"数组。 */
		const STORE_KEY = 'dsh-model-collapse:expanded-v1';
		/** 注入 <style> 的节点 id(防重复注入)。 */
		const STYLE_ID = 'dsh-model-collapse-style';

		const CSS = [
			'/* ===== dsh-model-collapse ===== */',
			'/* 分组标题 = 可点击的折叠开关 */',
			'[role="menu"] [role="group"] > [data-dshmc] { cursor: pointer; user-select: none; }',
			'[role="menu"] [role="group"] > [data-dshmc]:hover { opacity: 0.8; }',
			'[role="menu"] [role="group"] > [data-dshmc]:focus-visible { outline: 2px solid var(--dsw-alias-border-l3, rgba(127,127,127,.6)); outline-offset: 1px; border-radius: 4px; }',
			'/* 折叠箭头(展开 ▾ / 收起 ▸) */',
			'[role="menu"] [role="group"] > [data-dshmc]::before { content: "\\25BE"; display: inline-block; width: 11px; font-size: 9px; line-height: 1; opacity: 0.55; transition: transform 0.12s ease; }',
			'[role="menu"] [role="group"][data-dshmc-collapsed] > [data-dshmc]::before { transform: rotate(-90deg); }',
			'/* 分组内模型数量角标 */',
			'[role="menu"] [role="group"] > [data-dshmc]::after { content: "(" attr(data-dshmc-count) ")"; margin-left: 6px; font-size: 11px; font-weight: 400; opacity: 0.45; }',
			'/* 收起的分组:隐藏其模型行(display:none 同时把它们移出 Tab 焦点序) */',
			'[role="menu"] [role="group"][data-dshmc-collapsed] > button { display: none !important; }',
			'/* 面板宽度钉死:官方菜单是 width:max-content,长模型名会把面板顶到 420px,',
			'   快捷条(右对齐)随之横跳。这里锁成恒定宽度,展开收起不再改变尺寸。 */',
			'[role="menu"]:has([data-dshmc]) { width: 300px; min-width: 300px; max-width: 300px; }',
			'/* 模型名与分组标题超长时省略,而不是撑开面板。标题是 flex 行,min-width:0 才能让省略生效。 */',
			'[role="menu"] [role="group"] > button { min-width: 0; max-width: 100%; }',
			'[role="menu"] [role="group"] > button * { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
			'[role="menu"] [role="group"] > [data-dshmc] { display: flex; align-items: center; min-width: 0; max-width: 100%; overflow: hidden; }',
			'[role="menu"] [role="group"] > [data-dshmc]::after { flex: 0 0 auto; }',
			'/* ===== 顶部快捷条:菜单 flex 列的直子节,在列表滚动区之外,永不遮挡任何模型行 ===== */',
			'/* 视觉对齐官方菜单:同一套 1px 描边图标、24px 圆形按钮、caption 色,无边框无底。 */',
			'[data-dshmc-quickbar] { flex: 0 0 auto; display: flex; align-items: center; gap: 1px; width: auto; align-self: flex-end; box-sizing: border-box; margin: 0 0 1px; padding: 0 2px 1px; border: none; border-radius: 0; background: transparent; }',
			'[data-dshmc-quickbar] button { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: none; border-radius: 50%; background: transparent; color: var(--dsw-alias-label-caption, #9aa0a6); cursor: pointer; transition: background .12s ease, color .12s ease; }',
			'[data-dshmc-quickbar] button:hover, [data-dshmc-quickbar] button:focus-visible { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08)); color: var(--dsw-alias-label-primary, #f9fafb); outline: none; }',
			'[data-dshmc-quickbar] button:active { background: var(--dsw-alias-interactive-bg-active, rgba(255,255,255,.14)); }',
			'[data-dshmc-quickbar] svg { display: block; }',
			'/* 快捷条钉在滚动区之外,列表滚动/焦点导航要把行滚到它下方才可见。 */',
			'*:has(> [data-dshmc-quickbar]) { scroll-padding-top: 30px; }',
		].join('\n');

		function injectStyle() {
			if (typeof document === 'undefined') return;
			if (document.getElementById(STYLE_ID) !== null) return;
			const tag = document.createElement('style');
			tag.id = STYLE_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		/* ---------- 展开状态的存取 ---------- */

		let storedExpanded; // undefined = 未读;null = 从未存储(首跑);否则是 Set<分组标题>
		function expandedTitles() {
			if (storedExpanded !== undefined) return storedExpanded;
			try {
				const raw = localStorage.getItem(STORE_KEY);
				if (raw === null) {
					storedExpanded = null;
					return null;
				}
				const parsed = JSON.parse(raw);
				storedExpanded = Array.isArray(parsed)
					? new Set(parsed.filter((item) => typeof item === 'string'))
					: null;
			} catch {
				storedExpanded = null;
			}
			return storedExpanded;
		}

		/** 把当前页面上所有分组的可见状态整体存回 localStorage。 */
		function persistCurrentState() {
			const titles = [];
			for (const section of document.querySelectorAll('[role="menu"] [role="group"]')) {
				const title = section.querySelector(':scope > [data-dshmc]');
				if (title !== null && !section.hasAttribute('data-dshmc-collapsed')) {
					titles.push((title.textContent || '').trim());
				}
			}
			try {
				localStorage.setItem(STORE_KEY, JSON.stringify(titles));
			} catch {
				/* 无痕模式等场景下写入失败不影响功能 */
			}
			storedExpanded = new Set(titles);
		}

		/* ---------- 基础折叠动作 ---------- */

		const decorated = new WeakSet();
		/** 当前菜单会话里已决定过初始折叠的分组标题 id;React 重建出同名分组的新 DOM
		    后不再重复决定初始状态(否则用户刚展开的分组会被悄悄收回)。 */
		const seededTitles = new Set();
		/** 用户手动切换过分组开关的分组标题 id;延迟的初始折叠要跳过它们。 */
		const userDriven = new Set();
		/** 当前受管菜单;它的卸载意味着一次菜单会话结束,seededTitles 整体失效。 */
		let liveMenu = null;
		/** apply() 时记下的配置,供动作函数(可能晚于 apply 触发)读取。 */
		let currentOpts = { expandSelectedGroup: true, quickBar: true, accordion: false };

		function setCollapsed(section, collapsed) {
			if (collapsed) {
				section.setAttribute('data-dshmc-collapsed', '');
				/* 保护焦点:0.1.7 菜单的行一旦被 display:none 隐藏,浏览器会对
				   当前焦点行触发 blur,组件 onBlur 视作"点击外部"而关闭菜单
				   (表现就是"打开即秒关")。折叠前先把焦点挪到同组标题,让
				   relatedTarget 留在菜单内,避免把菜单带崩。 */
				if (section.contains(document.activeElement)) {
					const title = section.querySelector(':scope > [data-dshmc]');
					if (title !== null && title !== document.activeElement) title.focus({ preventScroll: true });
				}
			} else {
				section.removeAttribute('data-dshmc-collapsed');
			}
		}

		/** 一个分组是否归本插件管(有分组标题)。 */
		function isOurs(section) {
			return section.querySelector(':scope > [data-dshmc]') !== null;
		}

		function allSections() {
			return [...document.querySelectorAll('[role="menu"] [role="group"]')].filter(isOurs);
		}

		function expandAll() {
			for (const section of allSections()) setCollapsed(section, false);
			persistCurrentState();
			syncToggle();
		}

		function collapseAll() {
			for (const section of allSections()) setCollapsed(section, true);
			persistCurrentState();
			syncToggle();
		}

		/** 只展开"当前选中模型"所在的分组,其余全部收起。 */
		function focusCurrent() {
			const active = document.querySelector('[role="menu"] [role="group"] > button[aria-checked="true"]');
			const sections = allSections();
			if (active === null) {
				collapseAll();
				return;
			}
			const group = active.closest('[role="group"]');
			for (const section of sections) setCollapsed(section, section !== group);
			if (group !== null) group.scrollIntoView({ block: 'nearest' });
			persistCurrentState();
			syncToggle();
		}

		/** 清空展开状态记忆,回到初始判定(首跑逻辑)。 */
		function resetMemory() {
			try {
				localStorage.removeItem(STORE_KEY);
			} catch {
				/* 忽略 */
			}
			storedExpanded = null;
			for (const section of allSections()) {
				section.removeAttribute('data-dshmc-collapsed');
				setCollapsed(section, initialCollapse(section, currentOpts));
			}
			syncToggle();
		}

		/* ---------- 装饰与初始状态判定 ---------- */

		function initialCollapse(section, opts) {
			const saved = expandedTitles();
			const title = section.querySelector(':scope > [data-dshmc]');
			const name = title === null ? '' : (title.textContent || '').trim();
			if (saved !== null) return !saved.has(name);
			if (opts.expandSelectedGroup && section.querySelector(':scope > button[aria-checked="true"]') !== null) {
				return false; /* 首跑:当前选中模型所在的分组默认展开。 */
			}
			return true; /* 其余一律默认收起。 */
		}

		/** 初始折叠按组暂存,等菜单定位稳定后再施加(见 flushPendingCollapse)。 */
		let pendingCollapse = [];
		let pendingScheduled = false;

		/**
		 * 把暂存的初始折叠一次性施加。
		 *
		 * 0.1.7 的模型菜单在 createPortal 里渲染,commit 后还要用 useLayoutEffect
		 * 测量定位;React 的 commit/measure 交错期里给分组挂 data-dshmc-collapsed
		 * (配合 display:none 规则)会把行瞬间清空,导致菜单"打开即秒关"。这里在
		 * 双重 requestAnimationFrame 之后施加:此时菜单已完成定位、布局稳定。若菜单
		 * 仍被压塌(高度坍缩到 0),则撤销折叠、保持全展开,保证菜单永远可用。
		 */
		function flushPendingCollapse() {
			window.__dshmc_flushLog = window.__dshmc_flushLog || [];
			if (pendingCollapse.length === 0) return;
			const entries = pendingCollapse;
			pendingCollapse = [];
			let applied = false;
			const rect0 = document.querySelector('[role="menu"]');
			const rb0 = rect0 ? rect0.getBoundingClientRect() : null;
			for (const entry of entries) {
				const section = entry.section;
				if (!section.isConnected || userDriven.has(entry.titleId)) continue;
				setCollapsed(section, entry.collapsed);
				applied = true;
			}
			const rb1 = rect0 ? rect0.getBoundingClientRect() : null;
			window.__dshmc_flushLog.push({ n: entries.length, applied, menuRectBefore: rb0 ? { w: Math.round(rb0.width), h: Math.round(rb0.height) } : null, menuRectAfter: rb1 ? { w: Math.round(rb1.width), h: Math.round(rb1.height) } : null, at: Date.now() });
			if (!applied) return;
			const menu = document.querySelector('[role="menu"]');
			if (menu !== null && menu.querySelector('[data-dshmc]') !== null) {
				const rect = menu.getBoundingClientRect();
				if (rect.height < 16 || rect.width < 16) {
					/* 折叠把菜单面板压塌了:恢复全展开,保菜单可用。 */
					for (const section of allSections()) setCollapsed(section, false);
				}
			}
			syncToggle();
		}

		function scheduleFlush() {
			if (pendingScheduled) return;
			pendingScheduled = true;
			/* 双重 rAF:让 React 的 commit → useLayoutEffect 定位全部落定后再改 DOM。
			   部分环境(隐藏页/后台)rAF 可能被压,setTimeout 兜底。 */
			const flush = () => {
				pendingScheduled = false;
				flushPendingCollapse();
			};
			let to = setTimeout(flush, 120);
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					clearTimeout(to);
					flush();
				});
			});
		}

		function decorate(section, opts) {
			const title = section.querySelector(':scope > [id]');
			if (title === null) return;
			title.setAttribute('data-dshmc', '');
			title.setAttribute('tabindex', '0');

			/* 模型数量每次都刷新(目录可能热更新)。 */
			const countStr = String(section.querySelectorAll(':scope > button').length);
			if (title.getAttribute('data-dshmc-count') !== countStr) {
				title.setAttribute('data-dshmc-count', countStr);
			}

				/* 初始折叠(seededTitles)只按分组标题 id 决定一次:挂 data-dshmc-collapsed 会
			   改变菜单尺寸,DSH 在 createPortal 里按新尺寸重渲染、整段替换分组 DOM;若对
			   替换出的新 DOM 再按记忆重新折叠,用户刚手动展开的分组会被悄悄收回
			   (表现为"点分组没反应")。 */
			if (!seededTitles.has(title.id)) {
				seededTitles.add(title.id);
				pendingCollapse.push({ section, titleId: title.id, collapsed: initialCollapse(section, opts) });
				scheduleFlush();
			}

			if (decorated.has(section)) return;
			decorated.add(section);
		}

		/* ---------- 顶部快捷条 ---------- */

		/**
		 * 图标与官方图标同一套语言:16 viewBox、14px 渲染、1px 描边、round cap/join、
		 * currentColor,按钮自身不带文字。
		 */
		const ICONS = {
			'toggle-all': '<path d="M4 6.25 8 9.75 12 6.25"/><path d="M4 9.75 8 13.25 12 9.75"/>',
			'focus-current': '<circle cx="8" cy="8" r="2.6"/><path d="M8 2.6v2.1M8 11.3v2.1M2.6 8h2.1M11.3 8h2.1"/>',
			'reset-memory': '<path d="M3.4 8a4.6 4.6 0 1 0 1.05-2.95"/><path d="M3.2 2.9v2.5h2.5"/>',
		};

		/** 全部收起时箭头朝下(下一步是展开),否则朝上(下一步是收起)。 */
		function paintToggle(button, collapsed) {
			const svg = button.querySelector('svg');
			if (svg !== null) svg.style.transform = collapsed ? '' : 'rotate(180deg)';
			const label = collapsed ? '展开全部分组 (Alt+E)' : '收起全部分组 (Alt+C)';
			button.setAttribute('aria-label', label);
			button.title = label;
			button.setAttribute('data-dshmc-collapsed-all', collapsed ? '' : null);
		}

		/** 按当前分组状态刷新切换按钮:有任一分组展开就显示"收起"。 */
		function syncToggle() {
			const button = document.querySelector('[data-dshmc-quickbar] [data-dshmc-action="toggle-all"]');
			if (button === null) return;
			const sections = allSections();
			const collapsed = sections.length > 0 && sections.every((section) => section.hasAttribute('data-dshmc-collapsed'));
			paintToggle(button, collapsed);
		}

		function iconSvg(action) {
			const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			svg.setAttribute('width', '14');
			svg.setAttribute('height', '14');
			svg.setAttribute('viewBox', '0 0 16 16');
			svg.setAttribute('fill', 'none');
			svg.setAttribute('aria-hidden', 'true');
			svg.innerHTML = ICONS[action];
			for (const node of svg.querySelectorAll('path, circle')) {
				node.setAttribute('stroke', 'currentColor');
				node.setAttribute('stroke-width', '1');
				node.setAttribute('stroke-linecap', 'round');
				node.setAttribute('stroke-linejoin', 'round');
			}
			return svg;
		}

		function buildQuickbar() {
			const bar = document.createElement('div');
			bar.setAttribute('data-dshmc-quickbar', '');
			bar.setAttribute('role', 'presentation');

			const mk = (action, label) => {
				const button = document.createElement('button');
				button.type = 'button';
				button.setAttribute('data-dshmc-action', action);
				button.setAttribute('aria-label', label);
				button.title = label;
				button.appendChild(iconSvg(action));
				return button;
			};
			bar.appendChild(mk('toggle-all', '展开全部分组 (Alt+E)'));
			bar.appendChild(mk('focus-current', '只展开当前选中模型所在分组 (Alt+F)'));
			bar.appendChild(mk('reset-memory', '清空展开状态记忆,回到默认'));

			return bar;
		}

		function installQuickbar(menu) {
			/* 快捷条做「模型滚动容器(.groups)」的兄弟,由菜单 flex 列直接排布、钉在列表
			   上方:模型行在独立滚动区里,永远不被快捷条遮挡;列表滚动(容器自身 scroll)
			   时快捷条不动。若分组直接挂在菜单下,则快捷条就是菜单的第一个 flex 子项。 */
			const firstGroup = menu.querySelector('[role="group"]');
			if (!(firstGroup instanceof Element)) return;
			const groupsWrap = firstGroup.parentElement;    /* 滚动容器 */
			if (!(groupsWrap instanceof Element)) return;
			const parent = groupsWrap.parentElement;        /* 菜单自身,flex 列 */
			if (!(parent instanceof Element)) return;
			if (parent.querySelector(':scope > [data-dshmc-quickbar]') !== null) return;

			const bar = buildQuickbar();
			parent.insertBefore(bar, groupsWrap);
			/* 菜单整体卸载时快捷条随容器消失,无需额外回收。 */
		}

		/* ---------- 动作分发 ---------- */

		function runAction(action) {
			if (action === 'toggle-all') {
				const sections = allSections();
				const allCollapsed = sections.length > 0 && sections.every((section) => section.hasAttribute('data-dshmc-collapsed'));
				if (allCollapsed) expandAll();
				else collapseAll();
			} else if (action === 'focus-current') focusCurrent();
			else if (action === 'reset-memory') resetMemory();
			syncToggle();
		}

		function toggleFrom(target) {
			if (!(target instanceof Element)) return false;
			const title = target.closest('[data-dshmc]');
			if (title === null) return false;
			const section = title.parentElement;
			if (section === null || section.getAttribute('role') !== 'group') return false;
			userDriven.add(title.id);
			const expanding = section.hasAttribute('data-dshmc-collapsed');
			setCollapsed(section, !expanding);
			/* 手风琴模式:展开某一组时自动收起其他组(可配置)。 */
			if (expanding && currentOpts.accordion) {
				const parent = section.parentElement;
				if (parent !== null) {
					for (const sibling of parent.querySelectorAll(':scope > [role="group"]')) {
						if (sibling !== section && isOurs(sibling)) setCollapsed(sibling, true);
					}
				}
			}
			persistCurrentState();
			syncToggle();
			return true;
		}

		function installListeners() {
			/* 0.1.7 新菜单有两道“点快捷条就关菜单”的闸:
			   1) mousedown 冒泡到 document 的 closeOutside(菜单在 portal 里挂在 body,
			      root/menu 都不含快捷条 → setOpen(false));
			   2) 焦点逃逸到 body 里的快捷条 → React onBlur close()。
			   都在 document 捕获阶段拦截:目标落在快捷条内就 stopPropagation,
			   两层委托点都收不到,菜单保持打开,mousedown 的默认聚焦仍生效。 */
			document.addEventListener(
				'mousedown',
				(event) => {
					if (!(event.target instanceof Element)) return;
					if (event.target.closest('[data-dshmc-quickbar]') !== null) event.stopPropagation();
				},
				true,
			);

			document.addEventListener(
				'focusout',
				(event) => {
					const next = event.relatedTarget;
					if (!(next instanceof Element)) return;
					if (next.closest('[data-dshmc-quickbar]') === null) return;
					event.stopPropagation();
				},
				true,
			);

			document.addEventListener(
				'click',
				(event) => {
					if (!(event.target instanceof Element)) return;

					/* 快捷条按钮:展开/收起/聚焦/重置。 */
					const actionEl = event.target.closest('[data-dshmc-quickbar] [data-dshmc-action]');
					if (actionEl !== null) {
						event.preventDefault();
						event.stopPropagation();
						runAction(actionEl.getAttribute('data-dshmc-action'));
						return;
					}

					if (toggleFrom(event.target)) {
						event.preventDefault();
						event.stopPropagation();
					}
				},
				true,
			);

			document.addEventListener(
				'keydown',
				(event) => {
					if (!(event.target instanceof Element)) return;

					/* Alt+E 全部展开 / Alt+C 全部收起 / Alt+F 定位当前模型 */
					if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.isComposing) {
						const key = event.key.toLowerCase();
						if (key === 'e') {
							expandAll();
							event.preventDefault();
							event.stopPropagation();
							return;
						}
						if (key === 'c') {
							collapseAll();
							event.preventDefault();
							event.stopPropagation();
							return;
						}
						if (key === 'f') {
							focusCurrent();
							event.preventDefault();
							event.stopPropagation();
							return;
						}
					}

					if ((event.key === 'Enter' || event.key === ' ') && toggleFrom(event.target)) {
						event.preventDefault();
						event.stopPropagation();
						return;
					}
					if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
						const menu = event.target.closest('[role="menu"]');
						if (menu === null || menu.querySelector('[role="group"]') === null) return;
						const items = [...menu.querySelectorAll('button:not([disabled])')].filter(
							(button) => button.offsetParent !== null && button.closest('[data-dshmc-quickbar]') === null,
						);
						if (items.length === 0) return;
						const at = items.indexOf(document.activeElement);
						const step = event.key === 'ArrowDown' ? 1 : -1;
						const next = items[(((at < 0 ? 0 : at) + step) % items.length + items.length) % items.length];
						event.preventDefault();
						event.stopPropagation();
						next.focus();
					}
				},
				true,
			);
		}

		/** 客户端插件面。 */
		const inject = []; // 纯 DOM 增强,不依赖任何客户端服务。

		function rescan(opts) {
			/* 菜单会话结束:上次观测的菜单已被卸载(用户关掉了菜单)之后,再出现的
			   菜单节点是新一轮会话,分组全为新 DOM;seededTitles/userDriven 都是会话级
			   判定,应清空,让新分组重新按记忆决定初始折叠(否则新会话的分组不再
			   触发初始折叠,会全部停在 React 的"展开"默认态)。 */
			if (liveMenu !== null && liveMenu.isConnected === false) {
				liveMenu = null;
				seededTitles.clear();
				userDriven.clear();
			}
			for (const menu of document.querySelectorAll('[role="menu"]')) {
				/* 记录当前受管的菜单节点(React 重渲染会复用同一节点,只有整体卸载
				   再出现才会换实例,从而触发上面的会话重置)。 */
				if (liveMenu === null) liveMenu = menu;
				/* 菜单被 React 整体重建后,旧快捷条随菜单消失;这里补装。 */
				installQuickbar(menu);
				for (const section of menu.querySelectorAll('[role="group"]')) {
					try {
						decorate(section, opts);
					} catch {
						/* 单个分组异常不拖垮整页 */
					}
				}
			}
			syncToggle();
		}

		function apply(_ctx, config = {}) {
			if (config && config.enabled === false) return;
			const opts = {
				expandSelectedGroup: !(config && config.expandSelectedGroup === false),
				quickBar: config ? config.quickBar !== false : true,
				accordion: Boolean(config && config.accordion),
			};
			currentOpts = opts;

			injectStyle();
			installListeners();

			/* React 每次(重)渲染菜单都会产生 childList 变更;微任务合并同一批,
			   对新出现的分组补装饰。已装饰过的节点不动,避免与 React 抢状态。 */
			let scheduled = false;
			const schedule = () => {
				if (scheduled) return;
				scheduled = true;
				queueMicrotask(() => {
					scheduled = false;
					rescan(opts);
				});
			};

			if (typeof MutationObserver !== 'undefined' && document.documentElement !== null) {
				new MutationObserver(schedule).observe(document.documentElement, {
					childList: true,
					subtree: true,
				});
			} else {
				setInterval(() => rescan(opts), 800);
			}
			schedule();
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
