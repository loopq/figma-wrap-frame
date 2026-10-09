# figma-wrap-frame

figma 插件，一键复制选中元素转换包裹成Frame复制到目标文件

## 背景

设计师交付的需求区块，通常是一块背景 rect 上摆着标题和若干手机屏 frame。它们看起来是一个整体，实际上是**平铺在同一层的兄弟节点，没有共同的父容器**。

把这样的区块搬到自己的 dev 文件里，每次都要手动做一连串操作：

1. 在设计稿里选中背景和所有屏，复制
2. 切到自己的文件，粘贴
3. 包一层 Frame，Dev Mode 才能把它当成一个整体来查看和标注；还要去掉 Frame 默认的白底、调到和背景一样的尺寸
4. 拖到文件最底部，和已有的区块对齐

自动化有两个限制：

- 设计稿一般是 **view-only**，Design 插件在里面根本跑不起来
- Figma 插件**只能操作当前打开的文件**，没法从一个文件写到另一个文件

所以拆成两部分：

| 部分 | 负责 |
|---|---|
| Figma 插件 **Wrap in Frame**（`manifest.json`、`code.js`） | 在目标文件里，把粘贴进来的图层包进一个**与背景 rect 同尺寸、无填充**的 Frame，放到页面最底部并和上一个区块左对齐 |
| Hammerspoon 宏（`hammerspoon/figma_wrap.lua`） | 在设计稿里按 `⌘⇧P`，自动复制 → 切到目标文件 → 粘贴 → 运行插件；如果目标文件原来在 Dev Mode，跑完再切回去 |

设计思路和实测记录见 [docs/agents/2026-10-09-figma-wrap-frame-plugin.md](docs/agents/2026-10-09-figma-wrap-frame-plugin.md)。

## 使用

### 首次安装

需要：macOS、Figma Desktop、[Hammerspoon](https://www.hammerspoon.org/)。

1. **导入插件**：Figma Desktop → Plugins → Development → Import plugin from manifest… → 选择本仓库的 `manifest.json`
2. **配置目标文件**：

   ```sh
   cp hammerspoon/config.example.lua hammerspoon/config.lua
   ```

   编辑 `config.lua`：`targetKey` 填目标文件 URL 里 `/design/` 后面那一段，`targetTitle` 填目标文件名
3. **加载宏**：在仓库根目录执行

   ```sh
   echo "dofile(\"$PWD/hammerspoon/figma_wrap.lua\")" >> ~/.hammerspoon/init.lua
   ```

   在系统设置 → 隐私与安全性 → 辅助功能里允许 Hammerspoon，然后从菜单栏图标点 Reload Config

### 日常使用

1. 目标文件**保持一个标签页开着**，Dev Mode 或 Design 模式都可以
2. 在设计稿里选中背景 rect、标题和所有屏
3. 按 **`⌘⇧P`**，大约 3 秒内不要操作键盘鼠标
4. 完成后：
   - Figma 停在目标文件
   - 新 Frame 在页面最底部，和上一个区块左对齐，视图自动跳过去
   - 左下角提示「已包裹 N 个图层 → W×H」
   - 如果目标文件原来在 Dev Mode，已经切回 Dev Mode

`⌘⇧P` 只在 Figma 处于前台时生效，会覆盖 Figma 自带的 Pixel Preview，不影响其他 App。

### 只用插件

不用宏也可以：在目标文件里粘贴之后，右键 → Plugins → Development → **Wrap in Frame**。

### 常见提示

| 提示 | 原因 | 处理 |
|---|---|---|
| figma_wrap：缺少 hammerspoon/config.lua… | 还没有创建配置文件，出现在 Reload Config 时 | 按「首次安装」第 2 步创建后重新 Reload Config |
| 复制失败：没有选中图层，或者文件禁止复制 | 没选中图层，或者设计稿的所有者关闭了复制权限 | 选中后重试；禁止复制的文件没有办法处理 |
| 当前已经在 目标文件，请在设计稿里按快捷键 | 在目标文件里按了 `⌘⇧P` | 回到设计稿再按 |
| 切换到 目标文件 超时 | 目标文件没开着，或者加载太慢 | 先打开目标文件，再按一次 |
| 切换到 Design 模式失败 / 已完成搬运，但切回 Dev Mode 失败 | Figma 没及时响应模式切换 | 按 `Shift+D` 手动切换 |
| 先选中要包裹的图层 / 选中的图层必须在同一层级 | 插件运行时选区为空，或者选中的图层不在同一层 | 检查选区；如果粘贴错了，按 `Cmd+Z` 撤销 |

## 配置项

| 位置 | 项 | 说明 |
|---|---|---|
| `hammerspoon/config.lua` | `targetKey` / `targetTitle` | 目标文件，本地文件，不提交 |
| `hammerspoon/figma_wrap.lua` | `HOTKEY_MODS` / `HOTKEY_KEY` | 快捷键，默认 `⌘⇧P` |
| `code.js` | `GAP` | 新 Frame 与上一个区块的垂直间距，默认 1000 |

## 测试

```sh
node test/wrap.test.js
```

用模拟的 figma 对象验证插件的包裹和放置逻辑，不需要打开 Figma。
