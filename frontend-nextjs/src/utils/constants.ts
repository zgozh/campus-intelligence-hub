/**
 * 展示层共享常量（单一出口）
 *
 * 背景：同一份「通知分类 → 中文名」映射曾在 `components/AdminLayout.tsx` 与
 * `views/Notifications.tsx` 各写一份，两处迟早漂移（改一处忘另一处），故收敛到本文件。
 *
 * 命名约定：
 * - `KIND_ZH`：全称文案，用于通知中心列表 / 分类页等横向空间充足处；
 * - `KIND_ZH_COMPACT`：简称文案，用于后台铃铛 Drawer 的紧凑列表。
 *   两者文案差异是**既有产品语义**（窄抽屉放不下 4 字标签），迁移时原样保留，
 *   不合并成一份，避免悄改用户可见文案。
 *
 * 判定规则见 `src/utils/format.ts` 文件头（标题类清洗 / 正文类渲染）。
 */

/** 通知分类 → 中文名（全称，通知中心等处使用） */
export const KIND_ZH: Record<string, string> = {
  brief: "校务快讯",
  insight: "校务洞察",
  alert: "告警",
  expiring: "临期提醒",
  system: "系统",
};

/** 通知分类 → 中文名（简称，后台铃铛 Drawer 紧凑列表使用） */
export const KIND_ZH_COMPACT: Record<string, string> = {
  brief: "快讯",
  insight: "洞察",
  alert: "告警",
  expiring: "临期",
  system: "系统",
};
