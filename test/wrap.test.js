// 用模拟的 figma 对象运行 code.js，校验包裹、坐标换算和放置逻辑，不需要打开 Figma。
// 运行：node test/wrap.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'code.js'), 'utf8');
const GAP = 1000;

let seq = 0;
const node = (type, name, x, y, width, height) => ({ id: `n${seq++}`, type, name, x, y, width, height, parent: null, children: [] });
const adopt = (parent, n) => {
  if (n.parent) n.parent.children = n.parent.children.filter((c) => c !== n);
  n.parent = parent;
  parent.children.push(n);
};

// 页面上已有两个块，最靠下的是「旧块 B」：(36, 31717) 2000×2000，底边 33717
function makePage() {
  const page = node('PAGE', 'Page 1', 0, 0, 0, 0);
  adopt(page, node('FRAME', '旧块 A', 36, 26895, 3355, 2000));
  adopt(page, node('FRAME', '旧块 B', 36, 31717, 2000, 2000));
  return page;
}

// 一个需求块：背景 rect 2682×2499，各元素相对背景的偏移取自一次真实运行
const OFFSETS = { 背景: [0, 0], 标题: [95, 110.5], '屏 1': [95, 327.5], '屏 2': [519, 327.5] };
function makeBlock(ox, oy) {
  return [
    node('RECTANGLE', '背景', ox, oy, 2682, 2499),
    node('TEXT', '标题', ox + 95, oy + 110.5, 565, 75),
    node('FRAME', '屏 1', ox + 95, oy + 327.5, 375, 2073),
    node('FRAME', '屏 2', ox + 519, oy + 327.5, 375, 812),
  ];
}

function runPlugin(page, selection) {
  let message;
  const figma = {
    currentPage: { get children() { return page.children; }, selection },
    createFrame() {
      const f = node('FRAME', 'Frame', 0, 0, 100, 100);
      f.fills = [{ type: 'SOLID' }]; // Figma 新建 Frame 默认带白底
      f.clipsContent = true;
      f.resize = (w, h) => { f.width = w; f.height = h; };
      f.appendChild = (n) => adopt(f, n); // 不改 x/y，由插件显式重设
      adopt(page, f);
      return f;
    },
    viewport: { scrollAndZoomIntoView() {} },
    closePlugin(m) { message = m; },
  };
  vm.runInNewContext(SRC, { figma, Set, Math });
  return { message, frame: page.children.find((n) => n.name === 'Frame') };
}

function assertWrapped(frame, page) {
  assert.strictEqual(frame.parent, page, 'Frame 应在页面最外层');
  assert.deepStrictEqual([frame.width, frame.height], [2682, 2499], '尺寸取最大 rect');
  assert.strictEqual(frame.fills.length, 0, '去掉白底'); // 数组来自 vm 沙箱，原型不同，不能用 deepStrictEqual 比 []
  assert.strictEqual(frame.clipsContent, false);
  assert.deepStrictEqual(frame.children.map((c) => c.name), Object.keys(OFFSETS), 'z 序不变');
  for (const c of frame.children) assert.deepStrictEqual([c.x, c.y], OFFSETS[c.name], `${c.name} 相对位置不变`);
}

const cases = {
  '粘贴到页面最外层：包裹并放到最底部、左对齐'() {
    const page = makePage();
    const block = makeBlock(5000, 50000);
    block.forEach((n) => adopt(page, n));
    const { message, frame } = runPlugin(page, [...block].reverse()); // 选区顺序与 z 序无关
    assertWrapped(frame, page);
    assert.deepStrictEqual([frame.x, frame.y], [36, 33717 + GAP]);
    assert.strictEqual(message, '已包裹 4 个图层 → 2682×2499');
  },
  '内容被粘进了别的 Frame：新 Frame 仍放在页面最外层'() {
    const page = makePage();
    const host = node('FRAME', '容器', 0, 0, 9000, 9000);
    adopt(page, host);
    const block = makeBlock(100, 200);
    block.forEach((n) => adopt(host, n));
    const { frame } = runPlugin(page, block);
    assertWrapped(frame, page);
    assert.deepStrictEqual([frame.x, frame.y], [36, 33717 + GAP]);
  },
  '选区里没有 rect：按外接范围包裹'() {
    const page = makePage();
    const block = makeBlock(5000, 50000).slice(1);
    block.forEach((n) => adopt(page, n));
    const { frame } = runPlugin(page, block);
    assert.deepStrictEqual([frame.width, frame.height], [519 + 375 - 95, 327.5 + 2073 - 110.5]);
    assert.deepStrictEqual([frame.children[0].x, frame.children[0].y], [0, 0]);
  },
  '页面上没有其他节点：留在原位置'() {
    const page = node('PAGE', 'Page 1', 0, 0, 0, 0);
    const block = makeBlock(5000, 50000);
    block.forEach((n) => adopt(page, n));
    const { frame } = runPlugin(page, block);
    assert.deepStrictEqual([frame.x, frame.y], [5000, 50000]);
  },
  '空选区：提示并不创建 Frame'() {
    const page = makePage();
    const { message, frame } = runPlugin(page, []);
    assert.strictEqual(message, '先选中要包裹的图层');
    assert.strictEqual(frame, undefined);
  },
  '选中的节点不在同一层级：提示并不创建 Frame'() {
    const page = makePage();
    const host = node('FRAME', '容器', 0, 0, 9000, 9000);
    adopt(page, host);
    const [a, b] = makeBlock(100, 200);
    adopt(page, a);
    adopt(host, b);
    const { message, frame } = runPlugin(page, [a, b]);
    assert.strictEqual(message, '选中的图层必须在同一层级');
    assert.strictEqual(frame, undefined);
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(cases)) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`✗ ${name}\n  ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
