-- Figma 一键搬运：在设计稿里选中图层后按 ⌘⇧P，自动复制、切到 Remote_Dev、粘贴，并运行 Wrap in Frame 插件。
-- 方案与实测记录：docs/agents/2026-10-09-figma-wrap-frame-plugin.md
-- 加载方式：在 ~/.hammerspoon/init.lua 里 dofile 本文件；目标文件配置放在同目录的 config.lua（不提交到 git）

local DIR = debug.getinfo(1, "S").source:match("^@(.*/)")
local loaded, CONFIG = pcall(dofile, DIR .. "config.lua")
if not loaded then
  hs.alert.show("figma_wrap：缺少 hammerspoon/config.lua，请从 config.example.lua 复制一份并填写", 5)
  return
end

local TARGET_KEY   = CONFIG.targetKey
local TARGET_TITLE = CONFIG.targetTitle
local PLUGIN_NAME  = "Wrap in Frame"
local HOTKEY_MODS, HOTKEY_KEY = { "cmd", "shift" }, "p" -- 只在 Figma 前台时生效，会覆盖 Figma 的 Pixel Preview
local FIGMA_ID     = "com.figma.Desktop"
local ABC_LAYOUT   = "com.apple.keylayout.ABC"  -- 输入插件名时临时切到 ABC，防止被中文输入法拦截

local function waitFor(pred, timeout)
  local deadline = hs.timer.secondsSinceEpoch() + timeout
  repeat
    if pred() then return true end
    hs.timer.usleep(100000)
  until hs.timer.secondsSinceEpoch() > deadline
  return false
end

local function press(app, mods, key) hs.eventtap.keyStroke(mods, key, 0, app) end

local function modifiersReleased()
  local m = hs.eventtap.checkKeyboardModifiers()
  return not (m.cmd or m.shift or m.alt or m.ctrl)
end

local function clipboardHasFigmaLayers()
  local html = hs.pasteboard.readDataForUTI(nil, "public.html") or ""
  return html:find("figmeta", 1, true) ~= nil
end

-- View 菜单里有「Switch to Design」说明当前在 Dev Mode。点菜单项不起作用，只能用按键 ⇧D 切换
local function isDevMode(app) return app:findMenuItem({ "View", "Switch to Design" }) ~= nil end

local function toggleMode(app)
  local wasDev = isDevMode(app)
  press(app, { "shift" }, "d")
  return waitFor(function() return isDevMode(app) ~= wasDev end, 2)
end

local function run(app)
  local function title() local w = app:mainWindow(); return w and w:title() end
  if title() == TARGET_TITLE then return "当前已经在 " .. TARGET_TITLE .. "，请在设计稿里按快捷键" end

  -- 等 ⌘⇧ 松开，否则 ⌘C 会变成 ⌘⇧C（Copy as PNG）
  waitFor(modifiersReleased, 2)

  local count = hs.pasteboard.changeCount()
  press(app, { "cmd" }, "c")
  if not waitFor(function() return hs.pasteboard.changeCount() ~= count and clipboardHasFigmaLayers() end, 1.5) then
    return "复制失败：没有选中图层，或者文件禁止复制"
  end

  hs.urlevent.openURL("figma://file/" .. TARGET_KEY)
  if not waitFor(function() return title() == TARGET_TITLE end, 10) then return "切换到 " .. TARGET_TITLE .. " 超时" end
  hs.timer.usleep(500000)

  local wasDev = isDevMode(app)
  if wasDev and not toggleMode(app) then return "切换到 Design 模式失败" end

  for _ = 1, 3 do press(app, {}, "escape") end -- 清空选区，防止内容被粘贴进当前选中的 Frame
  press(app, { "cmd" }, "v")
  hs.timer.usleep(300000)

  -- Plugins 菜单里不列出开发中的插件，「Run last plugin」又可能是灰的，所以通过 ⌘K 搜索面板运行
  hs.keycodes.currentSourceID(ABC_LAYOUT) -- 由调用方负责切回原来的输入法
  press(app, { "cmd" }, "k")
  hs.timer.usleep(600000)
  hs.eventtap.keyStrokes(PLUGIN_NAME, app)
  hs.timer.usleep(900000)
  press(app, {}, "return")

  if not wasDev then return end
  -- 拿不到插件跑完的信号，只能固定等待。插件是同步执行的，1.5 秒足够；
  -- 如果以后插件变慢、被切模式打断，就改成让插件发出完成信号
  hs.timer.usleep(1500000)
  if not toggleMode(app) then return "已完成搬运，但切回 Dev Mode 失败" end
end

-- 存进全局变量，避免 hotkey 和 watcher 被垃圾回收
FigmaWrap = {}
FigmaWrap.hotkey = hs.hotkey.new(HOTKEY_MODS, HOTKEY_KEY, function()
  local app = hs.application.frontmostApplication()
  local source = hs.keycodes.currentSourceID()
  local ok, err = pcall(run, app)
  hs.keycodes.currentSourceID(source) -- 无论成功还是出错，都切回原来的输入法
  if not ok or err then hs.alert.show("Figma 搬运：" .. tostring(err), 3) end
end)
FigmaWrap.watcher = hs.application.watcher.new(function(_, event, app)
  if not app or app:bundleID() ~= FIGMA_ID then return end
  if event == hs.application.watcher.activated then FigmaWrap.hotkey:enable()
  elseif event == hs.application.watcher.deactivated then FigmaWrap.hotkey:disable() end
end)
FigmaWrap.watcher:start()

local front = hs.application.frontmostApplication()
if front and front:bundleID() == FIGMA_ID then FigmaWrap.hotkey:enable() end
