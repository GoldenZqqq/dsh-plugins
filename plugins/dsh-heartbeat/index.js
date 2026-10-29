'use strict';

/**
 * dsh-heartbeat — DSH 宿主半体(占位)。
 *
 * 全部逻辑在浏览器半体(client.js)。这里只需要一个合法的 cordis 插件面,
 * 让补丁层能把本包作为 Loader 条目挂进 profile 的组合树 ——
 * 客户端模块系统扫描 Loader 条目时,才会把 client.js 编进
 * window.__DSH_BOOT__ 并在浏览器里执行。
 *
 * config(cordis.patch.yml 里写,可选):
 *   enabled:   boolean  总开关(默认 true;false 即不挂载)
 *   mode:      'card' | 'rail'   初始形态(默认 card;rail 是只留 ♥+数字的迷你条)
 *   scale:     number   整体缩放 0.8–1.6(默认 1)
 *   opacity:   number   不透明度 0.4–1(默认 1,悬停时自动回满)
 *   showEcg:   boolean  显示 ECG 波形(默认 true)
 *   showHud:   boolean  显示 tok/s、TTFT、tokens、工具数(默认 true)
 *   position:  'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
 *                       首次出现的落位(默认 bottom-right;之后记住拖动位置)
 *   accent:    string   自定义强调色(CSS 颜色;留空则跟随状态色)
 */
module.exports = {
	name: 'dsh-heartbeat',
	inject: [],
	apply(_ctx, _config) {
		/* 宿主侧刻意为空:这是纯浏览器 UI 增强。 */
	},
};
