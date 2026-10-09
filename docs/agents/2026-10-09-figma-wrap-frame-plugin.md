# Figma：一键把设计稿区块搬到自己的文件并包裹成 Frame

## 背景

设计师交付的需求区块通常是「背景 rect + 标题 text + 若干手机屏 frame」，它们是同一层的兄弟节点，没有共同的父容器。复制到自己的 dev 文件（下文称**目标文件**）后，需要手动包一层 Frame，Dev Mode 才能把它当成一个整体来查看；还要手动把它摆到文件底部、和已有的区块对齐。这一套操作要切文件、粘贴、对齐、运行插件，步骤很长。

目标结构：

```
Frame                      与背景 rect 同尺寸（例：2682×2499），无填充，不裁切
├─ RECTANGLE  背景         (0,0)，保留为子层
├─ TEXT       标题
├─ FRAME      屏 1
├─ FRAME      屏 2
└─ ...
```

## 方案总览

| 部分 | 文件 | 职责 |
|---|---|---|
| Figma 插件 Wrap in Frame | `manifest.json`、`code.js` | 在目标文件里，把选中的图层包进 Frame，放到页面最底部并左对齐 |
| Hammerspoon 宏 | `hammerspoon/figma_wrap.lua`、`hammerspoon/config.lua` | 在设计稿里按 `⌘⇧P`：复制 → 切到目标文件 → 粘贴 → 运行插件 → 还原模式 |
| 回归测试 | `test/wrap.test.js` | 用模拟的 figma 对象验证插件逻辑 |

## 为什么插件不能自己跨文件

| 途径 | 结论 | 原因 |
|---|---|---|
| 插件里选择目标文件 / 写死目标文件 | ❌ | Plugin API 只能访问当前打开的文件，没有打开或写入其他文件的接口 |
| REST API 写节点 | ❌ | REST API 不支持创建或修改节点，只能写评论、变量、dev resources 等 |
| 插件中转：A 文件把节点序列化到 `clientStorage`，B 文件再重建 | ❌ | 等于重写 Figma 的复制粘贴：图片、字体、组件实例、矢量、效果、自动布局都要自己处理，代码量大还会丢信息；而且设计稿通常是 view-only，Design 插件根本跑不起来 |
| 原生 `Cmd+C` / `Cmd+V` | ✅ | 无损 |
| Hammerspoon 按键宏，把复制、切标签、粘贴、运行插件串起来 | ✅ | 每一步都有可以检测的信号 |

结论：跨文件靠剪贴板，插件只负责「包裹 + 放置」，Hammerspoon 负责把整个流程串成一键。

**view-only 的设计稿里看不到插件**：Design 插件需要编辑权限。Dev Mode 插件能在 view-only 文件里运行，但只读，不能新建或移动图层。这不影响流程，因为设计稿那边只需要 `Cmd+C`。插件只在目标文件里运行；如果在设计稿里运行，它只会在设计稿里原地包裹。

## 插件逻辑（`code.js`，无 UI，运行完自动关闭）

1. 读取 `figma.currentPage.selection`。如果为空，或者选中的节点不在同一个父节点下，提示后退出
2. **尺寸来源（box）**：选区中面积最大的 `RECTANGLE` 的 x/y/w/h；没有 rect 时，退化为整个选区的外接范围。两种情况共用后面所有代码，只有这一处不同
3. `figma.createFrame()`，设置 `fills = []`（去掉默认白底），`clipsContent = false`（超出 rect 的内容不会被裁掉看不见），`resize(box.w, box.h)`。Frame 创建在当前页的最外层：如果粘贴时选中了某个 Frame，内容会被粘进那个 Frame 里，这样做可以避免新 Frame 被嵌套在别的区块里面
4. 选中的节点按原 z 序逐个 `frame.appendChild`。**移动前先记下 x/y，移动后显式设置 `x = 原x - box.x`、`y = 原y - box.y`**，不依赖 `appendChild` 对坐标的处理方式（官方文档没写明）
5. **放置**：在当前页最外层的节点里（排除新 Frame 自己），找底边（y + height）最大的那个作为锚点，设 `frame.x = 锚点.x`（左对齐）、`frame.y = 锚点底边 + GAP`（`GAP` 默认 1000）。页面上没有其他节点时，Frame 留在 box 原来的位置
6. 选中新 Frame，`scrollAndZoomIntoView` 把视图移过去，然后提示「已包裹 N 个图层 → W×H」

`manifest.json`：`documentAccess: "dynamic-page"` 是官方规定新插件必填的；`networkAccess.allowedDomains: ["none"]`。`id` 用的是占位值，作为开发插件导入时实测可以正常使用。

## 一键宏（Hammerspoon）

### 调研结论（Figma Desktop 126.9.13 实测）

| 环节 | 方式 | 实测结果 |
|---|---|---|
| 切到目标文件的标签页 | `hs.urlevent.openURL("figma://file/<key>")` | ✅ 0.5 秒内完成，**会复用已经打开的标签页，不会重复打开** |
| 确认已经切过去 | `app:mainWindow():title()` | ✅ 窗口标题就是当前标签页的文件名 |
| 判断当前模式 | View 菜单里有「Switch to Design」说明在 Dev Mode，有「Switch to Dev Mode」说明在 Design 模式 | ✅ 菜单会随模式实时更新 |
| 切换模式 | 按键 `Shift+D` | ✅ 用按键可以切换；**`selectMenuItem` 点菜单项不起作用** |
| 清空选区 | 按键 `Esc` | ✅ |
| 运行插件 | `Cmd+K` 打开搜索面板，输入 `Wrap in Frame`，回车 | ✅ 搜索结果第一条就是 `Wrap in Frame [Development]` |
| 「Run last plugin」（`Cmd+Opt+P`） | — | ❌ 会话里还没跑过插件时这一项是灰的；上次跑的如果是别的插件会运行错 |
| 在原生菜单里直接点插件 | — | ❌ Plugins → Development 菜单里不列出开发中的插件 |
| 按名字点击标签页 | — | ❌ 标签栏是网页内容，辅助功能接口读不到 |
| 按键发给不在前台的 Figma | — | ⚠️ 不生效。宏是在 Figma 里按快捷键触发的，满足条件 |
| 判断剪贴板里是不是 Figma 图层 | `public.html` 里有没有 `figmeta` | ✅ 真实运行时判断通过 |

### 流程（快捷键 `⌘⇧P`，在设计稿里选中图层后按）

`⌘⇧P` 在 Figma 里原本是 Pixel Preview，在 VS Code / Cursor 里是命令面板。所以快捷键**只在 Figma 处于前台时启用**：用 `hs.application.watcher` 监听 Figma 的激活和失去焦点，自动启用或停用。

0. **等修饰键松开**：否则按 `Cmd+C` 时 Shift 还按着，会变成 `⌘⇧C`（Copy as PNG）
1. **前置检查**：当前标签页已经是目标文件时，提示后中止
2. **复制**：记下剪贴板的 `changeCount`，按 `Cmd+C`，最多等 1.5 秒，直到剪贴板有变化、且里面是 Figma 图层数据。没等到就中止，**避免把剪贴板里的旧内容粘贴进去**
3. **切标签**：打开 `figma://file/<targetKey>`，最多等 10 秒，直到窗口标题变成 `targetTitle`，之后再多等 500ms
4. **切到 Design 模式**：如果当前是 Dev Mode，按 `Shift+D`，并通过菜单确认已经切换。记下原来的模式
5. **清空选区**：按 3 次 `Esc`，防止内容被粘贴进当前选中的 Frame
6. **粘贴**：`Cmd+V`。Figma 按顺序处理按键事件，粘贴完成之后才会处理下一步的 `Cmd+K`
7. **运行插件**：临时切到 ABC 键盘（防止中文输入法拦截打字）→ `Cmd+K` → 输入 `Wrap in Frame` → 等 900ms → 回车
8. 插件完成包裹、放置、视图跳转和提示
9. **还原模式**：如果第 4 步是从 Dev Mode 切过来的，固定等 1.5 秒后按 `Shift+D` 切回，并通过菜单确认。拿不到插件跑完的信号，所以只能固定等待；插件是同步执行的，1.5 秒足够。以后插件变慢的话，改成让插件发出完成信号
10. 不管成功还是中途出错，最后都会切回原来的输入法

任何一步超时都会用 `hs.alert` 提示卡在哪一步，然后停下，不会接着往下执行。

### 配置

- `hammerspoon/config.lua`（加入了 `.gitignore`，不提交）：`targetKey` 是目标文件 URL 里 `/design/` 后面那一段，`targetTitle` 是目标文件名。从 `config.example.lua` 复制一份来改
- 要支持多个目标文件，可以把配置换成一个列表，再用 `hs.chooser` 选择，大约多 10 行。目前只有一个目标文件，先不做
- 用 `hs -c 'hs.reload()'` 重新加载配置会把 CLI 卡住，因为重新加载会断开 IPC 连接。改用 `hs -c 'hs.timer.doAfter(0.3, hs.reload)'`，或者从菜单栏点 Reload Config

### 已知限制

- 目标文件最好一直开着一个标签页。如果没开，`figma://` 会新开一个标签，文件加载时间不确定，第一次可能失败，再按一次就行
- 第 9 步的固定等待见上文

## 不做（YAGNI）

- 选区里只有一个 Group 时自动展开：设计稿的区块都是同一层平铺的
- 自动用标题 text 给 Frame 命名：没有这个需求，需要时大约加 1 行
- 父节点是 auto-layout 的情况：宏会先清空选区，粘贴后内容在页面最外层
- 根据已有区块之间的间距自动推算 GAP：现有间距并不统一，用固定常量就够了

## 验证

- `node test/wrap.test.js`：6 个用例，覆盖页面最外层粘贴、粘进别的 Frame、没有 rect、空页面、空选区、跨父节点
- 真实运行（2026-10-09）：目标文件中新 Frame 为 2682×2499、无填充、不裁切；rect 在 (0,0)，其余子节点的相对位置与设计稿一致；y = 上一个区块的底边 + 1000，x 与上一个区块对齐；跑完后目标文件回到了 Dev Mode
