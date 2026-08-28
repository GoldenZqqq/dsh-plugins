'use strict';
/**
 * dsh-model-collapse — 浏览器半体。
 *
 * 让 DSH 网页端模型选择菜单(composer 的模型 seat,由
 * @deepseek-ai/dsh-client-ui-model-selection 渲染)里按 provider 分组的列表
 * 默认全部收起,点击分组标题才展开;标题上显示折叠箭头和模型数量,
 * 展开状态记入浏览器 localStorage,下次打开保持用户的选择。
 *
 * v1.1 新增:菜单顶部常驻快捷条(菜单是 flex 列,快捷条是 .groups 滚动区的
 * 兄弟节点,天然钉在顶部,滚动列表时始终可见):
 *  - 「展开」/「收起」:一键展开 / 收起所有 provider 分组;
 *  - 「聚焦」:只展开"当前选中模型"所在分组,其余全部收起(provider 多时
 *    一眼定位当前模型归属);
 *  - 「↺」:清空展开状态记忆,回到初始(选中组展开、其余收起);
 *  - 筛选输入框:按关键字实时过滤模型,命中的分组自动展开、未命中的
 *    分组整组隐藏,数量角标变成 命中/总数;Esc 清空、Enter 跳到首个匹配。
 *  - 键盘:Alt+E 全部展开 / Alt+C 全部收起 / Alt+F 聚焦筛选框。
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
			'/* ===== 顶部快捷条:菜单是 flex 列,快捷条是 .groups 滚动区的兄弟节点,天然钉在顶部,无需 sticky ===== */',
			'[role="menu"] > [data-dshmc-quickbar] { display: flex; align-items: center; gap: 4px; padding: 5px 6px 6px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.06)); background: var(--dsw-specific-menu, #353638); box-shadow: 0 6px 10px -10px rgba(0,0,0,.5); }',
			'[role="menu"] > [data-dshmc-quickbar] button { flex: 0 0 auto; display: inline-flex; align-items: center; height: 28px; font: inherit; font-size: 12px; font-weight: 500; line-height: 1; padding: 0 9px; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #cfd3d6); cursor: pointer; transition: background .12s ease, color .12s ease; }',
			'[role="menu"] > [data-dshmc-quickbar] button:hover, [role="menu"] > [data-dshmc-quickbar] button:focus-visible { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08)); color: var(--dsw-alias-label-primary, #f9fafb); outline: none; }',
			'[role="menu"] > [data-dshmc-quickbar] input { flex: 1 1 auto; min-width: 0; height: 28px; box-sizing: border-box; font: inherit; font-size: 12px; line-height: 1; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12)); border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08)); color: var(--dsw-alias-label-primary, #f9fafb); outline: none; transition: border-color .12s ease, background .12s ease; }',
			'[role="menu"] > [data-dshmc-quickbar] input::placeholder { color: var(--dsw-alias-label-tertiary, #adb2b8); }',
			'[role="menu"] > [data-dshmc-quickbar] input:focus { border-color: var(--dsw-alias-border-l3, rgba(255,255,255,.16)); background: var(--dsw-alias-interactive-bg-active, rgba(255,255,255,.14)); }',
			'/* ===== 筛选模式:未命中的行/分组隐藏,命中分组强制展开 ===== */',
			'[role="menu"] [role="group"][data-dshmc-hidden] { display: none !important; }',
			'[role="menu"][data-dshmc-filtering] [role="group"] > button:not([data-dshmc-hit]) { display: none !important; }',
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

		/** 筛选进行中时不写记忆(临时强制展开不是用户意图)。 */
		let filterActive = false;

		/** 把当前页面上所有分组的可见状态整体存回 localStorage。 */
		function persistCurrentState() {
			if (filterActive) return;
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
		/** apply() 时记下的配置,供动作函数(可能晚于 apply 触发)读取。 */
		let currentOpts = { expandSelectedGroup: true, quickBar: true, accordion: false };

		function setCollapsed(section, collapsed) {
			if (collapsed) section.setAttribute('data-dshmc-collapsed', '');
			else section.removeAttribute('data-dshmc-collapsed');
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
		}

		function collapseAll() {
			for (const section of allSections()) setCollapsed(section, true);
			persistCurrentState();
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

			if (decorated.has(section)) return;
			decorated.add(section);

			/* 初始状态只在节点首次出现时决定一次,之后完全由用户点击驱动。 */
			setCollapsed(section, initialCollapse(section, opts));
		}

		/* ---------- 顶部快捷条 ---------- */

		const toolbarMenus = new WeakSet();

		function buildQuickbar(menu) {
			const bar = document.createElement('div');
			bar.setAttribute('data-dshmc-quickbar', '');
			bar.setAttribute('role', 'presentation');

			const mk = (label, action, title) => {
				const button = document.createElement('button');
				button.type = 'button';
				button.textContent = label;
				button.setAttribute('data-dshmc-action', action);
				button.title = title;
				return button;
			};
			bar.appendChild(mk('展开', 'expand-all', '展开全部分组 (Alt+E)'));
			bar.appendChild(mk('收起', 'collapse-all', '收起全部分组 (Alt+C)'));
			bar.appendChild(mk('聚焦', 'focus-current', '只展开"当前选中模型"所在分组'));
			bar.appendChild(mk('↺', 'reset-memory', '清空展开状态记忆,回到默认'));

			const input = document.createElement('input');
			input.type = 'text';
			input.placeholder = '筛选模型…';
			input.title = '按关键字筛选模型;Enter 跳到第一个匹配项;Esc 清空 (Alt+F 聚焦)';
			input.setAttribute('data-dshmc-filter-input', '');
			input.setAttribute('autocomplete', 'off');
			input.setAttribute('spellcheck', 'false');
			bar.appendChild(input);

			return bar;
		}

		function installQuickbar(menu) {
			if (menu.querySelector(':scope > [data-dshmc-quickbar]') !== null) return;
			/* 只给"按 provider 分组"的菜单(即模型选择菜单)装快捷条。 */
			if (menu.querySelector('[role="group"]') === null) return;
			const bar = buildQuickbar(menu);
			try {
				menu.prepend(bar);
			} catch {
				/* React 竞态导致 prepend 失败:下轮 rescan 重试。 */
			}
		}

		/* ---------- 筛选 ---------- */

		let filterTimer = 0;
		function normalize(text) {
			return (text || '').trim().toLowerCase();
		}

		/** 依据筛选输入框的值,对所有受管菜单应用/撤销过滤。 */
		function applyFilter() {
			const input = document.querySelector('[data-dshmc-filter-input]');
			const query = normalize(input === null ? '' : input.value);
			filterActive = query !== '';

			for (const menu of document.querySelectorAll('[role="menu"]')) {
				if (menu.querySelector('[role="group"]') === null) continue;

				if (query === '') {
					menu.removeAttribute('data-dshmc-filtering');
					for (const section of menu.querySelectorAll('[role="group"]')) {
						section.removeAttribute('data-dshmc-hidden');
						for (const row of section.querySelectorAll(':scope > button')) {
							row.removeAttribute('data-dshmc-hit');
						}
						if (isOurs(section)) {
							/* 撤销筛选期间临时展开的状态,恢复用户记忆(无记忆则回到首跑逻辑)。 */
							const saved = expandedTitles();
							const title = section.querySelector(':scope > [data-dshmc]');
							const name = title === null ? '' : (title.textContent || '').trim();
							setCollapsed(
								section,
								saved === null ? initialCollapse(section, currentOpts) : !saved.has(name),
							);
							const total = String(section.querySelectorAll(':scope > button').length);
							title.setAttribute('data-dshmc-count', total);
						}
					}
					continue;
				}

				menu.setAttribute('data-dshmc-filtering', '');
				for (const section of menu.querySelectorAll('[role="group"]')) {
					const title = section.querySelector(':scope > [id]');
					if (title === null) continue;
					const titleHit = normalize(title.textContent).includes(query);
					let hits = 0;
					const rows = section.querySelectorAll(':scope > button');
					for (const row of rows) {
						const hit = titleHit || normalize(row.textContent).includes(query);
						if (hit) row.setAttribute('data-dshmc-hit', '');
						else row.removeAttribute('data-dshmc-hit');
						if (hit) hits += 1;
					}
					section.removeAttribute('data-dshmc-hidden');
					if (hits > 0) {
						setCollapsed(section, false); /* 命中的分组强制展开 */
					} else {
						section.setAttribute('data-dshmc-hidden', ''); /* 无命中的整组隐藏 */
					}
					title.setAttribute('data-dshmc-count', hits + '/' + rows.length);
				}
			}
		}

		function scheduleFilter() {
			clearTimeout(filterTimer);
			filterTimer = setTimeout(applyFilter, 120);
		}

		function focusFilter() {
			const input = document.querySelector('[role="menu"] [data-dshmc-filter-input]');
			if (input === null) return;
			input.focus();
			if (typeof input.select === 'function') input.select();
		}

		/* ---------- 动作分发 ---------- */

		function runAction(action) {
			if (action === 'expand-all') expandAll();
			else if (action === 'collapse-all') collapseAll();
			else if (action === 'focus-current') focusCurrent();
			else if (action === 'reset-memory') resetMemory();
		}

		function toggleFrom(target) {
			if (!(target instanceof Element)) return false;
			const title = target.closest('[data-dshmc]');
			if (title === null) return false;
			const section = title.parentElement;
			if (section === null || section.getAttribute('role') !== 'group') return false;
			const expanding = section.hasAttribute('data-dshmc-collapsed');
			setCollapsed(section, !expanding);
			/* 手风琴模式:展开某一组时自动收起其他组(可配置)。 */
			if (expanding && currentOpts.accordion && !filterActive) {
				const parent = section.parentElement;
				if (parent !== null) {
					for (const sibling of parent.querySelectorAll(':scope > [role="group"]')) {
						if (sibling !== section && isOurs(sibling)) setCollapsed(sibling, true);
					}
				}
			}
			persistCurrentState();
			return true;
		}

		function installListeners() {
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

			/* 筛选输入框:输入即过滤(防抖)。 */
			document.addEventListener(
				'input',
				(event) => {
					if (!(event.target instanceof Element)) return;
					if (event.target.closest('[data-dshmc-filter-input]') !== null) scheduleFilter();
				},
				true,
			);

			document.addEventListener(
				'keydown',
				(event) => {
					if (!(event.target instanceof Element)) return;

					/* 筛选输入框内:接管按键,不让菜单看到(避免触发菜单的
					   typeahead / Esc 关闭 / 方向键导航)。 */
					if (event.target.closest('[data-dshmc-filter-input]') !== null) {
						event.stopPropagation();
						if (event.isComposing) return;
						if (event.key === 'Escape') {
							event.preventDefault();
							event.target.value = '';
							applyFilter();
						} else if (event.key === 'Enter') {
							event.preventDefault();
							const first = document.querySelector('[role="menu"] [data-dshmc-hit]');
							if (first !== null) {
								first.focus();
								first.scrollIntoView({ block: 'nearest' });
							}
						}
						return;
					}

					/* Alt+E 全部展开 / Alt+C 全部收起 / Alt+F 聚焦筛选框 */
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
							focusFilter();
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
			for (const menu of document.querySelectorAll('[role="menu"]')) {
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
			/* 菜单关闭会带走快捷条;输入框没了就认为筛选已结束。 */
			if (document.querySelector('[data-dshmc-filter-input]') === null && filterActive) {
				filterActive = false;
			}
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
