# 云端过渡实施方案 — 审核反馈处理记录

## 文档信息

| 项目 | 内容 |
|------|------|
| 审核反馈 | `Pre-docs/2026-06-11/云端过渡/cloud-transition-review-feedback.md` |
| 处理日期 | 2026-06-11 |
| 分支 | `internal-test` |
| 处理人 | Kaven |

---

## 处理摘要

| 编号 | 级别 | 标题 | 处理结果 |
|------|------|------|---------|
| BUG-1 | 🔴 必须修复 | App.jsx 中 `error` 未解构 | ✅ 已修复 |
| SUG-1 | 🟡 建议修复 | 保留的死代码应清理或注释 | ✅ 已添加 `@deprecated` 注释 |
| SUG-2 | 🟡 建议修复 | AuthPanel 中 `pending_migration` 状态检查是死代码 | ✅ 已清理 + 注释 |
| SUG-3 | 🟡 建议修复 | 静默导入只导入 articles | ✅ 已添加设计决策注释（无需修改逻辑） |
| SUG-4 | 🟡 建议修复 | 静默导入无数据量限制 | ✅ 已添加上限 50 篇 + 注释 |
| 边界-6 | 🟢 评估项 | Supabase 未配置时匿名用户无法试用 | ⏸️ 已知限制，当前阶段接受 |

---

## 逐项处理详情

### BUG-1: App.jsx 中 `error` 未解构 → ✅ 已修复

**问题**: 重构 `useAuth()` 解构时遗漏了 `error` 字段，导致 `error?.message` 始终为 `undefined`。

**修复**: [App.jsx:16](src/App.jsx#L16) — 在解构中添加 `error` 字段。

```diff
- const { canUseCloudLibrary, isReady, isAuthenticated, status, userId, refreshAuthState } = useAuth()
+ const { canUseCloudLibrary, error, isReady, isAuthenticated, status, userId, refreshAuthState } = useAuth()
```

---

### SUG-1: 保留的死代码应清理或注释 → ✅ 已添加注释

**问题**: `getLocalMigrationState` 函数（44 行）和 `claimLocalMigrationData` 导入不再被调用，但保留在代码中。

**处理**: 选择方案 A——添加 `@deprecated` 注释标记，不删除代码。

**变更**:
- [AuthProvider.jsx:13-16](src/providers/AuthProvider.jsx#L13-L16): 在 `getLocalMigrationState` 前添加 JSDoc `@deprecated` 注释
- [AuthProvider.jsx:9](src/providers/AuthProvider.jsx#L9): 在 `claimLocalMigrationData` 导入前添加行注释说明保留原因

---

### SUG-2: AuthPanel 中 `pending_migration` 状态检查是死代码 → ✅ 已清理

**问题**: 两处对 `pending_migration` 的引用永远无法匹配，造成阅读困惑。

**处理**: 移除死代码分支，添加注释说明。

**变更**:
- [AuthPanel.jsx:129-131](src/components/AuthPanel.jsx#L129-L131): `status !== 'pending_migration'` 条件移除，添加行注释说明
- [AuthPanel.jsx:175](src/components/AuthPanel.jsx#L175): 迁移状态三元表达式中的 `status === 'pending_migration' ? '待迁移' :` 分支移除

---

### SUG-3: 静默导入只导入 articles，不导入 bookmarks/readingMarks → ✅ 已添加注释

**问题**: `runSilentImport` 仅导入文章，bookmarks 和 readingMarks 在导入后被清理但不导入到云端。

**处理**: **无需修改逻辑**。匿名用户试用期间，收藏和阅读标记已被功能门控拦截，无法创建。localStorage 中即使存在 bookmarks/readingMarks 数据，也仅是旧版本遗留的历史数据，不应自动导入。在代码中添加了设计决策注释。

**变更**: [App.jsx:43-46](src/App.jsx#L43-L46) — 在导入循环前添加 4 行注释说明设计意图。

---

### SUG-4: 静默导入无数据量限制 → ✅ 已添加上限

**问题**: `for (const art of localArticles)` 无上限，极端情况下可能导致长时间阻塞。

**处理**: 添加 `localArticles.slice(0, 50)` 上限，并加注释说明。

**变更**: [App.jsx:48-49](src/App.jsx#L48-L49) — 添加 `slice(0, 50)` + 行注释。

---

### 边界-6: Supabase 未配置时匿名用户无法试用 → ⏸️ 已知限制

**审核意见**: `misconfigured` 状态下应用完全不可用，与"新用户一键体验"目标矛盾。

**处理决策**: 当前阶段接受此限制。"向云端完全过渡"是既定架构方向，Supabase 配置是运行前提。后续可考虑在 `misconfigured` 条件下提供仅本地试用模式，但不在本次范围。

---

## 修复后构建验证

```
npx vite build
✓ 1846 modules transformed.
✓ built in 4.61s
```

无编译错误，构建通过。

---

## 审核结论更新

原结论: ⚠️ 有条件批准（BUG-1 修复后执行）
**现结论: ✅ 已通过** — BUG-1 已修复，SUG-1~4 均已处理，边界-6 已评估并接受。
