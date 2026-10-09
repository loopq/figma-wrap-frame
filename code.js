// Wrap in Frame：把选中的同级图层包进一个无底色 Frame，放到当前页最下方。
// Frame 尺寸取选区内面积最大的 rect（设计稿的背景板）；没有 rect 时取选区外接范围。

const GAP = 1000; // 与当前页最下方那个块的垂直间距

// 注意：x/y/width/height 没有考虑旋转。设计稿最外层的元素一般不会旋转，真遇到旋转的再改用 absoluteBoundingBox
function backgroundBox(nodes) {
  const area = (n) => n.width * n.height;
  const rects = nodes.filter((n) => n.type === 'RECTANGLE');
  const src = rects.length ? [rects.reduce((a, b) => (area(b) > area(a) ? b : a))] : nodes;
  const x = Math.min(...src.map((n) => n.x));
  const y = Math.min(...src.map((n) => n.y));
  return {
    x,
    y,
    width: Math.max(...src.map((n) => n.x + n.width)) - x,
    height: Math.max(...src.map((n) => n.y + n.height)) - y,
  };
}

// 放到当前页最外层里底边最靠下的那个节点下方，并与它左对齐
function place(frame, box) {
  frame.x = box.x;
  frame.y = box.y;
  const others = figma.currentPage.children.filter((n) => n.id !== frame.id);
  if (!others.length) return;
  const bottom = (n) => n.y + n.height;
  const anchor = others.reduce((a, b) => (bottom(b) > bottom(a) ? b : a));
  frame.x = anchor.x;
  frame.y = bottom(anchor) + GAP;
}

function run() {
  const sel = figma.currentPage.selection;
  if (!sel.length) return '先选中要包裹的图层';
  const parent = sel[0].parent;
  if (sel.some((n) => n.parent.id !== parent.id)) return '选中的图层必须在同一层级';

  const ids = new Set(sel.map((n) => n.id));
  const ordered = parent.children.filter((n) => ids.has(n.id)); // 保持原 z 序
  const box = backgroundBox(ordered);

  const frame = figma.createFrame(); // 创建在当前页最外层
  frame.fills = [];
  frame.clipsContent = false;
  frame.resize(box.width, box.height);

  // 坐标先记再设，不依赖 appendChild 对坐标的处理
  for (const n of ordered) {
    const x = n.x;
    const y = n.y;
    frame.appendChild(n);
    n.x = x - box.x;
    n.y = y - box.y;
  }

  place(frame, box);
  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);
  return `已包裹 ${ordered.length} 个图层 → ${Math.round(box.width)}×${Math.round(box.height)}`;
}

try {
  figma.closePlugin(run());
} catch (e) {
  figma.closePlugin(`包裹失败（可 Cmd+Z 撤销）：${e.message}`);
}
