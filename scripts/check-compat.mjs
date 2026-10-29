#!/usr/bin/env node
/**
 * check-compat.mjs —— 用当前安装的 DSH 版本，校验本仓库每个插件声明的兼容区间。
 *
 * 每个插件的 package.json 里有一条 `dshCompat`：
 *   {
 *     "tested": ["0.2.1-rc.3"],      // 真的跑过、界面正常的版本（精确字符串）
 *     "range":  ">=0.2.0 <0.3.0",    // 作者认为可以用的区间（可能没实测）
 *     "verifiedAt": "2026-10-29"     // 最后一次实测的日期
 *   }
 *
 * 三种结论：
 *   ✓ 已实测   —— 版本在 tested 里
 *   !  未实测   —— 落在 range 里，但没在这一版上跑过；升级后请先跑插件自带的回归台
 *   ✗ 不兼容   —— 落在 range 外，说明这版 DSH 动了它依赖的东西，需要适配
 *
 * 用法：
 *   node scripts/check-compat.mjs                  # 自动探测 dsh 版本
 *   node scripts/check-compat.mjs --version 0.2.1-rc.3
 *   node scripts/check-compat.mjs --strict         # 未实测也算失败（CI 用）
 *   node scripts/check-compat.mjs --json           # 机器可读
 *
 * 退出码：0 全部可接受；1 有不兼容（或 --strict 下有未实测）。
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

/* ── 极简 semver（只做本仓库需要的那点事，不引依赖） ─────────────── */

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(text) {
	const m = VERSION_RE.exec(String(text).trim());
	if (m === null) return null;
	return {
		major: Number(m[1]),
		minor: Number(m[2]),
		patch: Number(m[3]),
		pre: m[4] === undefined ? [] : m[4].split('.'),
	};
}

function comparePre(a, b) {
	if (a.length === 0 && b.length === 0) return 0;
	if (a.length === 0) return 1; // 正式版 > 预发布版
	if (b.length === 0) return -1;
	const n = Math.max(a.length, b.length);
	for (let i = 0; i < n; i += 1) {
		const x = a[i];
		const y = b[i];
		if (x === undefined) return -1;
		if (y === undefined) return 1;
		const nx = /^\d+$/.test(x);
		const ny = /^\d+$/.test(y);
		if (nx && ny) {
			const d = Number(x) - Number(y);
			if (d !== 0) return d < 0 ? -1 : 1;
			continue;
		}
		if (nx) return -1; // 数字标识符 < 字母标识符
		if (ny) return 1;
		if (x !== y) return x < y ? -1 : 1;
	}
	return 0;
}

function compareVersions(a, b) {
	for (const key of ['major', 'minor', 'patch']) {
		if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
	}
	return comparePre(a.pre, b.pre);
}

/** 把 ^ / ~ 展开成上下界；其余比较符原样返回。 */
function expandComparator(token) {
	const m = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(token.trim());
	if (m === null) return null;
	const op = m[1] === undefined ? '=' : m[1];
	const version = parseVersion(m[2]);
	if (version === null) return null;

	if (op === '^') {
		let upper;
		if (version.major > 0) upper = { major: version.major + 1, minor: 0, patch: 0, pre: [] };
		else if (version.minor > 0) upper = { major: 0, minor: version.minor + 1, patch: 0, pre: [] };
		else upper = { major: 0, minor: 0, patch: version.patch + 1, pre: [] };
		return [{ op: '>=', version }, { op: '<', version: upper }];
	}
	if (op === '~') {
		const upper = { major: version.major, minor: version.minor + 1, patch: 0, pre: [] };
		return [{ op: '>=', version }, { op: '<', version: upper }];
	}
	return [{ op, version }];
}

/**
 * 区间比较只看 major.minor.patch —— rc/beta 这类预发布标签只在 tested 里做精确匹配。
 * 否则 `0.3.0-rc.1` 会因为 semver 的预发布排序规则被算进 `<0.3.0`，
 * 把一个已经换了次版本的新版本误报成"未实测"，那就失去了告警的意义。
 */
function satisfies(version, range) {
	const tokens = String(range).trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return true;
	const comparators = [];
	for (const token of tokens) {
		const expanded = expandComparator(token);
		if (expanded === null) throw new Error(`无法解析的版本区间片段：${token}`);
		comparators.push(...expanded);
	}
	const base = { major: version.major, minor: version.minor, patch: version.patch, pre: [] };
	return comparators.every(({ op, version: bound }) => {
		const d = compareVersions(base, bound);
		switch (op) {
			case '>=':
				return d >= 0;
			case '>':
				return d > 0;
			case '<=':
				return d <= 0;
			case '<':
				return d < 0;
			default:
				return d === 0;
		}
	});
}

/* ── 版本探测 ────────────────────────────────────────────────────── */

function parseArgs(argv) {
	const args = { json: false, strict: false, version: '', dshPackage: '' };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--json') args.json = true;
		else if (arg === '--strict') args.strict = true;
		else if (arg === '--version') args.version = argv[++i] || '';
		else if (arg === '--dsh-package') args.dshPackage = argv[++i] || '';
		else if (arg === '--help' || arg === '-h') args.help = true;
	}
	return args;
}

function detectVersion(args) {
	const reasons = [];
	const accept = (raw, source) => {
		const parsed = parseVersion(raw);
		if (parsed === null) {
			reasons.push(`${source} 给出的版本无法解析：${raw}`);
			return null;
		}
		return { text: String(raw).trim().replace(/^v/, ''), parsed, source };
	};

	if (args.version !== '') {
		const hit = accept(args.version, '--version');
		if (hit !== null) return hit;
	}

	if (args.dshPackage !== '') {
		const manifest = join(args.dshPackage, 'package.json');
		if (existsSync(manifest)) {
			const hit = accept(JSON.parse(readFileSync(manifest, 'utf8')).version, '--dsh-package');
			if (hit !== null) return hit;
		} else {
			reasons.push(`--dsh-package 指向的目录里没有 package.json：${manifest}`);
		}
	}

	if (process.env.DSH_VERSION !== undefined && process.env.DSH_VERSION !== '') {
		const hit = accept(process.env.DSH_VERSION, '环境变量 DSH_VERSION');
		if (hit !== null) return hit;
	}

	/* 直接跑 `dsh --version`。有些受限环境不让抓子进程输出，所以整段兜住。 */
	try {
		const out = execFileSync('dsh', ['--version'], { encoding: 'utf8', timeout: 8000 }).trim();
		const hit = accept(out.split(/\s+/).pop(), 'dsh --version');
		if (hit !== null) return hit;
	} catch (error) {
		reasons.push(`运行 dsh --version 失败：${error && error.message ? error.message : error}`);
	}

	return { error: reasons };
}

/* ── 读插件 ──────────────────────────────────────────────────────── */

function loadPlugins() {
	const root = join(REPO, 'plugins');
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => {
			const dir = join(root, entry.name);
			const manifestPath = join(dir, 'package.json');
			if (!existsSync(manifestPath)) return null;
			let manifest;
			try {
				manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
			} catch (error) {
				return { dir: entry.name, name: entry.name, version: '?', error: `package.json 解析失败：${error.message}` };
			}
			return {
				dir: entry.name,
				name: manifest.name || entry.name,
				version: manifest.version || '0.0.0',
				compat: manifest.dshCompat && typeof manifest.dshCompat === 'object' ? manifest.dshCompat : null,
			};
		})
		.filter((plugin) => plugin !== null);
}

/* ── 判定 ────────────────────────────────────────────────────────── */

function judge(plugin, current) {
	if (plugin.error !== undefined) return { verdict: 'error', detail: plugin.error };
	if (plugin.compat === null) return { verdict: 'undeclared', detail: 'package.json 没有 dshCompat 声明' };

	const tested = Array.isArray(plugin.compat.tested) ? plugin.compat.tested : [];
	const range = typeof plugin.compat.range === 'string' ? plugin.compat.range : '';

	const isTested = tested.some((entry) => {
		const parsed = parseVersion(entry);
		return parsed !== null && compareVersions(parsed, current.parsed) === 0;
	});
	if (isTested) return { verdict: 'tested', detail: '已实测', range };

	if (range !== '') {
		try {
			if (satisfies(current.parsed, range)) {
				const newest = tested[0] === undefined ? '（未声明）' : tested[0];
				return { verdict: 'untested', detail: `区间内但未在本版实测（最后实测 ${newest}）`, range };
			}
			return { verdict: 'incompatible', detail: `不在声明区间 ${range} 内`, range };
		} catch (error) {
			return { verdict: 'error', detail: `区间解析失败：${error.message}`, range };
		}
	}
	return { verdict: 'incompatible', detail: `没有声明兼容区间，且本版不在 tested 里`, range: '' };
}

const LABEL = {
	tested: '✓ 已实测',
	untested: '!  未实测',
	incompatible: '✗ 不兼容',
	undeclared: '?  未声明',
	error: '✗ 声明有误',
};

/* ── 主流程 ──────────────────────────────────────────────────────── */

const args = parseArgs(process.argv.slice(2));

if (args.help === true) {
	console.log(`用法：node scripts/check-compat.mjs [选项]

  --version <ver>     指定 DSH 版本（不指定则依次尝试环境变量 DSH_VERSION、dsh --version）
  --dsh-package <dir> 指向 @deepseek-ai/dsh 包目录，从其 package.json 读版本
  --strict            "未实测"也算失败，适合放进 CI
  --json              输出机器可读结果
  -h, --help          显示这段说明

区间语义：只看 major.minor.patch；rc/beta 标签只在 tested 里做精确匹配。`);
	process.exit(0);
}

const current = detectVersion(args);
if (current.error !== undefined) {
	console.error('探测 DSH 版本失败：');
	for (const reason of current.error) console.error(`  - ${reason}`);
	console.error('\n请显式指定版本，例如：node scripts/check-compat.mjs --version 0.2.1-rc.3');
	process.exit(2);
}

const plugins = loadPlugins();
const rows = plugins.map((plugin) => ({ plugin, ...judge(plugin, current) }));

const failed = rows.filter((row) => row.verdict === 'incompatible' || row.verdict === 'error');
const untested = rows.filter((row) => row.verdict === 'untested' || row.verdict === 'undeclared');

if (args.json === true) {
	console.log(JSON.stringify({
		dshVersion: current.text,
		source: current.source,
		plugins: rows.map((row) => ({
			name: row.plugin.name,
			version: row.plugin.version,
			verdict: row.verdict,
			detail: row.detail,
			range: row.range === undefined ? null : row.range,
			tested: row.plugin.compat === null ? [] : row.plugin.compat.tested || [],
		})),
		ok: failed.length === 0 && (!args.strict || untested.length === 0),
	}, null, 2));
	process.exit(failed.length > 0 || (args.strict && untested.length > 0) ? 1 : 0);
}

const nameWidth = Math.max(8, ...rows.map((row) => row.plugin.name.length));
const rangeWidth = Math.max(6, ...rows.map((row) => (row.range || '-').length));

console.log(`\nDSH 兼容性检查   当前版本 ${current.text}   （来源：${current.source}）\n`);
console.log(
	`${'插件'.padEnd(nameWidth)}  ${'版本'.padEnd(7)}  ${'声明区间'.padEnd(rangeWidth)}  结论`,
);
console.log('-'.repeat(nameWidth + rangeWidth + 26));
for (const row of rows) {
	console.log(
		`${row.plugin.name.padEnd(nameWidth)}  ${row.plugin.version.padEnd(7)}  ${(row.range || '-').padEnd(rangeWidth)}  ${LABEL[row.verdict]}`,
	);
}
console.log('');

if (failed.length > 0) {
	console.log(`${failed.length} 个插件与 DSH ${current.text} 不兼容：`);
	for (const row of failed) console.log(`  - ${row.plugin.name}：${row.detail}`);
	console.log('');
}
if (untested.length > 0) {
	console.log(`${untested.length} 个插件在本版上未实测，升级后建议先跑各自的回归台：`);
	for (const row of untested) console.log(`  - ${row.plugin.name}：${row.detail}`);
	console.log('');
}
if (failed.length === 0 && untested.length === 0) {
	console.log(`全部 ${rows.length} 个插件在 DSH ${current.text} 上已实测兼容。\n`);
}

process.exit(failed.length > 0 || (args.strict && untested.length > 0) ? 1 : 0);
