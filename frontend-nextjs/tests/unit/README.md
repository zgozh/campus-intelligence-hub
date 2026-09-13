# 前端测试约定（unit / jsdom）

> 本文件是**测试编写约定**，不是规范说教；照做可以少踩坑。与 `scripts/lib/cdp.mjs` 的真机口径并不冲突：
> **jsdom 是回归护栏，真机探针（`scripts/browser_smoke.mjs`）才是"用户是否真能用"的交付判定**。

## 1. 两种测试的分工（重要）

| | jsdom（vitest + RTL） | 真机（browser_smoke.mjs / browser_probe.mjs） |
|---|---|---|
| 能证明 | 组件树、事件处理器挂载、状态流转、文案与格式 | 真实布局/命中测试/遮挡、弹层定位、真实点击与滚动、运行时异常、构建版本 |
| 不能证明 | 元素是否**看得见/点得到**（无布局引擎、无命中测试） | — |
| 何时用 | 每次改动都跑（快、稳定） | 涉及用户可见交互的验收、交付前 |

**真实教训**：通知铃铛"点了没反应"在 jsdom 里一直是 PASS —— 真实原因是 antd 把弹层定位到 `-1000vh`（视口外几千像素），
jsdom 结构性测不出。因此弹层类断言请以真机为准，jsdom 只断言"内容渲染出来了"。

## 2. 弹层"可见"的判定口径（真机侧，写死在 `scripts/lib/cdp.mjs`）
1. `getComputedStyle(el).display !== "none"`
2. `getBoundingClientRect()` 宽高均 > 0
3. **与视口有足够交集**：可见高度占比 > 0.5

只判前两条会假阳性（本项目实际发生过：尺寸正常但 `rect.top = -6760`）。

## 3. 已统一补桩（`tests/setup.ts`，不要再自己补）
- `window.matchMedia`
- `ResizeObserver` / `window.ResizeObserver`
- `Element.prototype.scrollTo` / `scrollIntoView`
- `getComputedStyle` 伪元素调用

若你发现新的 jsdom 缺口，**加在 `tests/setup.ts`**，不要散落在各测试文件里。

## 4. 常见坑
- **antd 两个中文字的按钮会自动插空格**：`重试` → `重 试`、`采集` → `采 集`。文本断言请用宽松匹配（如 `/^重\s*试$/`）。
- **antd Modal 关闭后内容不卸载**（rc 动画在 jsdom 不结束），同名文案可能命中多处：用 `within(screen.getByRole("dialog"))` 或 `within(getByTestId(...))` 限定作用域；需要"关闭后消失"的断言优先让组件用 `destroyOnClose`。
- **`react-router-dom` 是自研 shim**（`src/router/react-router-dom.tsx`），**没有 `MemoryRouter`**。测试统一 mock 掉：
  ```ts
  vi.mock("react-router-dom", () => ({
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: "/overview", search: "" }),
  }));
  ```
- **mock 整个 `src/services/api` 时要把组件用到的每个方法都列上**（含 `getVersion` 这类"顺带调用"），否则会因 undefined 崩溃。
- **按钮文案含空格/大小写**：断言前先 `screen.debug()` 看真实文本，别凭印象写。
- 时间断言不要依赖运行时区：用 `formatDateTime(输入)` 计算期望值，或正则断言 `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$`。

## 5. 渲染测试最少要覆盖什么
- 用户最初报的缺陷**必须**留一条渲染护栏（例如"标题不含 `**`"、"时间不是原始 ISO 串"）。
- 列表/表格：断言"标题列已清洗"而不是只断言"渲染成功"。
- 涉及 Markdown 的正文：断言 `<strong>`/`<h2>` 等**真渲染节点**存在，且 `body` 内无裸 `**`。
