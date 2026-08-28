'use strict';

/**
 * dsh-model-collapse — DSH 宿主半体(占位)。
 *
 * 全部逻辑都在浏览器半体(client.js)。这里只需要一个合法的 cordis 插件面,
 * 让补丁层能把本包作为 Loader 条目挂进 web profile 的组合树 ——
 * 客户端模块系统扫描 Loader 条目时,才会把 client.js 编进
 * window.__DSH_BOOT__ 并在浏览器里执行。
 *
 * config(cordis.patch.yml 里写,可选):
 *   enabled:             boolean  总开关(默认 true)
 *   expandSelectedGroup: boolean  首次使用时是否默认展开"当前选中模型"所在
 *                                 分组(默认 true;false 则全部收起)
 *   quickBar:            boolean  菜单顶部常驻快捷条:展开/收起/聚焦/重置/筛选
 *                                 (默认 true;false 关闭)
 *   accordion:           boolean  手风琴模式:展开某分组时自动收起其他分组
 *                                 (默认 false)
 */
module.exports = {
	name: 'dsh-model-collapse',
	inject: [],
	apply(_ctx, _config) {
		/* 宿主侧刻意为空:这是纯浏览器 UI 增强。 */
	},
};
