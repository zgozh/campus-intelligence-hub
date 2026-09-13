import { vi } from "vitest";
import "@testing-library/jest-dom";

// ---------------------------------------------------------------------------
// jsdom 缺口统一补桩（REFACTOR_PLAN_V2_2 B9）
//
// 原先各测试文件各自打补丁（例如临时补 `Element.prototype.scrollTo`），
// 同类缺口反复出现。这里集中补齐，测试里**不要再**自己补这些桩。
// ---------------------------------------------------------------------------

// Mock window.matchMedia for jsdom environment（antd 响应式与主题依赖）
Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})),
});

// ResizeObserver：antd Tabs/Table/Select 等组件会用到，jsdom 未实现
class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}
Object.defineProperty(globalThis, "ResizeObserver", {
	writable: true,
	value: ResizeObserverStub,
});
Object.defineProperty(window, "ResizeObserver", {
	writable: true,
	value: ResizeObserverStub,
});

// Element.prototype.scrollTo / scrollIntoView：弹层、抽屉、时间线滚动定位会调用
if (!Element.prototype.scrollTo) {
	Object.defineProperty(Element.prototype, "scrollTo", {
		writable: true,
		value: vi.fn(),
	});
}
if (!Element.prototype.scrollIntoView) {
	Object.defineProperty(Element.prototype, "scrollIntoView", {
		writable: true,
		value: vi.fn(),
	});
}

// getComputedStyle 的伪元素调用（antd 波浪/动画在 jsdom 下会抛未实现警告）
const originalGetComputedStyle = window.getComputedStyle;
window.getComputedStyle = ((element: Element, pseudoElt?: string | null) =>
	originalGetComputedStyle(element, pseudoElt ?? undefined)) as typeof window.getComputedStyle;
