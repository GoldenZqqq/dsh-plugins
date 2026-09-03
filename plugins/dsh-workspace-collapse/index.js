'use strict';

/**
 * dsh-workspace-collapse — DSH 宿主半体(占位)。
 *
 * 全部逻辑在浏览器半体(client.js)。这里只需要一个合法的 cordis 插件面,
 * 让补丁层能把本包作为 Loader 条目挂进 web profile 的组合树 ——
 * 客户端模块系统扫描 Loader 条目时,才会把 client.js 编进
 * window.__DSH_BOOT__ 并在浏览器里执行。
 *
 * config(cordis.patch.yml 里写,可选):
 *   enabled: boolean 总开关(默认 true;false 即整体停用)
 */
module.exports = {
	name: 'dsh-workspace-collapse',
	inject: [],
	apply(_ctx, _config) {
		/* 宿主侧刻意为空:这是纯浏览器 UI 增强。 */
	},
};
