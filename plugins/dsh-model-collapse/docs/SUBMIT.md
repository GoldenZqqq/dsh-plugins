# 上架 awesome-dsh-plugin 步骤

1. 确认本仓库满足硬性门槛:
   - 创建满 1 天、提交数 ≥ 10(CI 自动检查)
   - package.json 声明了 `dsh.bundle` manifest ✅
   - 仓库加了 `dsh-plugin` topic ✅(创建时已加)
2. 在 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 仓库
   新建文件 `data/plugins/GoldenZqqq__dsh-model-collapse.yml`,
   内容见同目录 `awesome-dsh-plugin-entry.yml`。
3. 提 PR。CI 通过后维护者会读仓库评审,合并后市场(dshmarket)、
   awesome-dsh-plugin.com、DSH Get 会自动收录,通常一天内生效。

## 本地安装验证(上架前自测)

```sh
dsh plugin --profile web add GoldenZqqq/dsh-model-collapse
# 或从 npm(发布后):
dsh plugin --profile web add dsh-model-collapse
```

## 发布 npm(可选,市场会优先用经仓库验证的 npm 包)

```sh
npm publish --access public
```