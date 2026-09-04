'use strict';
/**
 * dsh-workspace-collapse — 浏览器半体。
 *
 * 在 DSH 网页端左侧边栏的「工作区 / Workspaces」区头加一枚切换按钮:
 * - 当前只要有任一工作区分组处于展开状态,点一下就把**所有**工作区分组收起;
 * - 当前全部都已收起时,点一下就把**所有**工作区分组展开。
 *
 * 实现原则与 dsh-model-collapse 一致,是纯 DOM 增强层:
 * - 不 fork、不修改任何 React 组件;不读内部 store、不抓 React fiber。
 * - 只新增一个按钮(挂在区头 actions 容器里)和一条 <style>。
 * - 实际折叠/展开通过给 DSH 自己渲染的工作区行
 *   (`div[role="treeitem"][aria-expanded]`)派发真实 click 完成,
 *   展开状态仍由 DSH 官方 store 持久化,刷新后和手动点击行为完全一致。
 * - MutationObserver 监听 childList 与 aria-expanded 变化,树重建后自动补按钮/刷新图标。
 *
 * 兼容当前英文/中文界面;分组视图才有工作区行,平铺列表或搜索模式下自动隐藏按钮。
 */

window.__ModuleLoader__.load({
	id: 'dsh-workspace-collapse',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const BTN_SELECTOR = '[data-dshwc-toggle]';
		const ACTIONS_SELECTOR = '[data-dshwc-actions]';
		const STYLE_ID = 'dsh-workspace-collapse-style';

		/* 展开全部:双下箭头;折叠全部:双上箭头。随按钮动作切换。 */
		const ICON_EXPAND =
			'<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
			'<path d="M4 5.5L8 9.5L12 5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
			'<path d="M4 9.5L8 13.5L12 9.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
			'</svg>';

		const ICON_COLLAPSE =
			'<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
			'<path d="M4 6.5L8 2.5L12 6.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
			'<path d="M4 10.5L8 6.5L12 10.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
			'</svg>';

		const CSS = [
			'/* dsh-workspace-collapse:放开的 actions 容器,容纳新增按钮 */',
			'[data-dshwc-actions] { max-width: none !important; }',
			'[data-dshwc-actions] [data-dshwc-toggle] { flex: 0 0 auto; }',
		].join('\n');

		function injectStyle() {
			if (typeof document === 'undefined') return;
			if (document.getElementById(STYLE_ID) !== null) return;
			const tag = document.createElement('style');
			tag.id = STYLE_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		/* ---------- 工具 ---------- */

		function isChineseUi() {
			if (typeof document === 'undefined') return false;
			const htmlLang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
			if (/^zh/.test(htmlLang)) return true;
			return (
				document.querySelector('button[aria-label="添加工作区"]') !== null ||
				[...document.querySelectorAll('span')].some(
					(el) => (el.textContent || '').trim() === '工作区',
				)
			);
		}

		function uiTexts() {
			const zh = isChineseUi();
			return zh
				? {
						expand: '展开全部工作区',
						collapse: '折叠全部工作区',
						expandTip: '展开全部工作区 (当前全部已收起)',
						collapseTip: '折叠全部工作区 (有工作区已展开)',
					}
				: {
						expand: 'Expand all workspaces',
						collapse: 'Collapse all workspaces',
						expandTip: 'Expand all workspaces (all are collapsed)',
						collapseTip: 'Collapse all workspaces (some are expanded)',
					};
		}

		function buttonByLabels(labels) {
			return [...document.querySelectorAll('button')].find((button) => {
				const label = (button.getAttribute('aria-label') || '').trim();
				return labels.includes(label);
			});
		}

		/** 左侧工作区树的容器:含工作区分组行的 [role="tree"]。 */
		function workspaceTrees() {
			return [...document.querySelectorAll('[role="tree"]')].filter((tree) =>
				tree.querySelector('[role="treeitem"][aria-expanded]') !== null,
			);
		}

		/** 所有可折叠的工作区分组行。 */
		function workspaceRows() {
			const rows = [];
			for (const tree of workspaceTrees()) {
				rows.push(...tree.querySelectorAll(':scope [role="treeitem"][aria-expanded]'));
			}
			return rows;
		}

		function anyWorkspaceExpanded() {
			return workspaceRows().some((row) => row.getAttribute('aria-expanded') === 'true');
		}

		/** 找到区头右侧 actions 容器(挂 View options / Add workspace 的 div)。 */
		function findHeaderActions() {
			const add = buttonByLabels(['Add workspace', '添加工作区']);
			if (add !== null && add.parentElement !== null) {
				// Add workspace 按钮的父节点就是 actions 容器。
				return add.parentElement;
			}
			const view = buttonByLabels(['View options', '视图选项']);
			if (view !== null) {
				// View options 外面常包一层 Tooltip span,第一个 div 祖先即 actions。
				const actions = view.closest('div');
				if (actions !== null) return actions;
			}
			// 兜底:按区头文字找父容器里的 actions(某些组合没有 View/Add)。
			const labelSpan = [...document.querySelectorAll('span')].find((el) => {
				const text = (el.textContent || '').trim();
				return text === 'Workspaces' || text === '工作区';
			});
			if (labelSpan !== null && labelSpan.parentElement !== null) {
				const header = labelSpan.parentElement;
				const candidates = [...header.querySelectorAll(':scope > div')].filter(
					(div) => div.querySelector('[role="treeitem"]') === null && div.children.length > 0,
				);
				if (candidates.length > 0) return candidates[candidates.length - 1];
			}
			return null;
		}

		/* ---------- 按钮 ---------- */

		function makeButton() {
			const button = document.createElement('button');
			button.type = 'button';
			button.setAttribute(BTN_SELECTOR.slice(1, -1), '');
			button.setAttribute('aria-label', '');
			const add = buttonByLabels(['Add workspace', '添加工作区']);
			const view = buttonByLabels(['View options', '视图选项']);
			const base = add || view;
			if (base !== null) {
				// 复用官方 iconButton 样式;宽侧边栏时同样带 wide 修饰。
				button.className = base.className;
			}
			button.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				void toggleAll();
			});
			return button;
		}

		function installButton() {
			if (document.querySelector(BTN_SELECTOR) !== null) return;
			if (workspaceRows().length === 0) return;
			const actions = findHeaderActions();
			if (actions === null || actions.querySelector(BTN_SELECTOR) !== null) return;

			const button = makeButton();
			actions.setAttribute(ACTIONS_SELECTOR.slice(1, -1), '');
			// 插在最前面,与 View options / Add workspace 同排。
			actions.insertBefore(button, actions.firstChild);
			updateButtonVisual();
		}

		function removeButtonIfIrrelevant() {
			const button = document.querySelector(BTN_SELECTOR);
			if (button === null) return;
			/* 平铺列表 / 搜索 / 空工作区时没有可折叠行,隐藏按钮。 */
			if (workspaceRows().length === 0) {
				const actions = button.parentElement;
				button.remove();
				if (actions !== null && actions.querySelectorAll(':scope > *').length === 0) {
					actions.removeAttribute(ACTIONS_SELECTOR.slice(1, -1));
				}
			}
		}

		function updateButtonVisual() {
			const button = document.querySelector(BTN_SELECTOR);
			if (button === null) return;
			const rows = workspaceRows();
			const texts = uiTexts();
			/* 有任一展开 -> 下一次点击应折叠全部;全部收起 -> 应展开全部。 */
			const expanding = rows.length === 0 || !anyWorkspaceExpanded();
			const state = expanding ? 'expand' : 'collapse';
			/* 避免每次 rescan 都重写 innerHTML:重写会触发 childList 变更,
			   而本插件的 MutationObserver 又监听 childList,容易变成死循环。 */
			if (button.getAttribute('data-dshwc-state') === state) return;
			button.setAttribute('data-dshwc-state', state);
			button.innerHTML = expanding ? ICON_EXPAND : ICON_COLLAPSE;
			button.setAttribute('aria-label', expanding ? texts.expand : texts.collapse);
			button.title = expanding ? texts.expandTip : texts.collapseTip;
		}

		function toggleAll() {
			const rows = workspaceRows();
			if (rows.length === 0) return;
			/* 展开全部 = 点击所有当前收起行;收起全部 = 点击所有当前展开行。 */
			const expanding = !anyWorkspaceExpanded();

			/* 关键:把这一批 click 放进 ReactDOM.unstable_batchedUpdates(),
			   让 React 把全部展开/收起合成一次提交,视觉上一次性完成,
			   而不是每点一行就重渲染一次。 */
			const applyClicks = () => {
				for (const row of rows) {
					const isExpanded = row.getAttribute('aria-expanded') === 'true';
					if (expanding ? !isExpanded : isExpanded) row.click();
				}
			};

			let ReactDOM = null;
			try {
				ReactDOM = typeof require === 'function' ? require('react-dom') : null;
			} catch {
				/* 极少数情况下拿不到 react-dom,退回逐行点击(功能仍可用)。 */
			}
			if (ReactDOM && typeof ReactDOM.unstable_batchedUpdates === 'function') {
				ReactDOM.unstable_batchedUpdates(applyClicks);
			} else {
				applyClicks();
			}

			/* ReactDOM.batchedUpdates 会在回调结束时同步 flush,直接刷新按钮即可;
			维护一个 rAF 兜底路径。 */
			if (ReactDOM && typeof ReactDOM.unstable_batchedUpdates === 'function') {
				updateButtonVisual();
			} else if (typeof requestAnimationFrame === 'function') {
				requestAnimationFrame(() => requestAnimationFrame(() => updateButtonVisual()));
			} else {
				setTimeout(updateButtonVisual, 0);
			}
		}

		/* ---------- 插件面 ---------- */

		const inject = []; // 纯 DOM 增强,不依赖客户端服务。

		function rescan() {
			removeButtonIfIrrelevant();
			installButton();
			updateButtonVisual();
		}

		function apply(_ctx, config = {}) {
			if (config && config.enabled === false) return;

			injectStyle();

			let scheduled = false;
			const schedule = () => {
				if (scheduled) return;
				scheduled = true;
				queueMicrotask(() => {
					scheduled = false;
					rescan();
				});
			};

			if (typeof MutationObserver !== 'undefined' && document.documentElement !== null) {
				new MutationObserver(schedule).observe(document.documentElement, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: ['aria-expanded'],
				});
			} else {
				setInterval(rescan, 800);
			}
			schedule();
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
