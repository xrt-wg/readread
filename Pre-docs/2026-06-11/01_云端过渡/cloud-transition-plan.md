# 云端过渡实施方案

## 概述

将 ReadRead 从"本地+云端混合"架构过渡为"纯云端优先"，移除迁移功能的用户可见入口，
同时保留迁移相关代码（暂不删除文件）。新用户通过受限试用体验核心阅读功能，
高级功能需注册/登录后解锁。

## 核心变更

### 1. AuthProvider — 移除 `pending_migration` 状态

**文件**: `src/providers/AuthProvider.jsx`

**变更**:
- `buildAuthenticatedState()`: 移除 `shouldEnterPendingMigration` 判断逻辑
- session 有效 + profile active → 直接 `status: 'authenticated'`
- session 有效 + profile disabled → `status: 'restricted'`
- 不再暴露 `isPendingMigration`、`hasBlockedLocalMigrationData`、`localMigrationMeta`
- `canUseCloudLibrary` 仅当 `status === 'authenticated'` 时为 true

**不删除**: `getLocalMigrationState()` 函数定义保留，`claimLocalMigrationData` 导入保留，仅不再调用。

### 2. App.jsx — 移除 pending_migration 渲染分支

**文件**: `src/App.jsx`

**变更**:
- 移除 `status === 'pending_migration'` 对应的 JSX 分支（约 12 行）
- MigrationPanel 和 AdminPage 的 import 保留（代码不删，仅不渲染）

### 3. ImportPage — 新用户首页精简 + 功能门控

**文件**: `src/components/ImportPage.jsx`

**变更**:

#### 3.1 Hero 区域（匿名用户 + 无文章时）
- **保留**: 「立即体验」按钮（加载 SAMPLE_TEXT）
- **移除**: 「导入」按钮、「导入备份」按钮、隐藏的 file input
- **新增**: 一个微妙的登录提示文字，如 "注册账号以解锁导入和回顾功能"

#### 3.2 导入面板（匿名用户全局）
- featured articles tab: **可见**，可浏览推荐内容
- 「加入文章库」按钮: 匿名用户点击 → 触发 auth prompt（展开 AuthPanel 注册表单）
- URL 导入 tab: 可见输入框，但提交时 → 触发 auth prompt
- 手动上传 tab: 可见编辑区，但提交时 → 触发 auth prompt
- **实现方式**: 在各提交路径开头检查 `isAuthenticated`，未登录则设置 `authPrompt` state

#### 3.3 文章库区域
- 匿名用户读了示例文章后返回，库中可见该文章（从 localStorage 加载）
- 「导入」「回顾」「导出」「导入备份」按钮对匿名用户隐藏或触发 auth prompt
- **回顾按钮**: 匿名用户点击 → 触发 auth prompt

#### 3.4 登录后数据迁移
- 用户注册/登录成功后，App.jsx 的 `useEffect([status, userId])` 触发
- 检测条件: `status === 'authenticated'` + localStorage 有 `rr_articles` 数据 + Supabase articles 表为空
- 满足条件时: 静默将 localStorage 文章复制到 Supabase（不展示迁移 UI）
- 复制完成后: 清理 localStorage 旧数据（`rr_articles`, `rr_bookmarks`, `rr_reading_marks`, `rr_local_migration_meta`）

### 4. ReaderPage — 阅读器功能门控

**文件**: `src/components/ReaderPage.jsx`

**变更**:

#### 4.1 门控操作清单
| 操作 | 匿名用户行为 |
|------|------------|
| 阅读正文 | ✅ 正常 |
| 划词翻译 | ✅ 正常（纯前端+API，无需持久化） |
| 字体调节 | ✅ 正常 |
| 收藏划选 (handleBookmark) | 🔒 设置 `authPrompt` state |
| 阅读标记 (handleSetReadingMark) | 🔒 设置 `authPrompt` state |
| 标记已读完 (handleMarkCompleted) | 🔒 设置 `authPrompt` state |
| 删除收藏 (handleDeleteBookmark) | 🔒 防御性门控 |

#### 4.2 Auth Prompt 展示
- 页面顶部（header 下方）渲染一条琥珀色提示条：
  "登录后即可收藏词句、保存阅读进度 — 你的阅读数据将安全同步到云端"
- 提示条右侧有一个「注册/登录」按钮
- 点击按钮 → 自动展开右下角 AuthPanel 并切换到注册模式
- **需要新增 prop 或通过 context 传递展开 AuthPanel 的能力**

### 5. AuthPanel — 支持外部触发展开

**文件**: `src/components/AuthPanel.jsx`

**变更**:
- 新增可选 prop: `initialOpen` 或通过 ref 暴露 `open(mode)` 方法
- 实际采用更简单的方案: 新增 `triggerOpen` prop（一个递增的数字，变化时自动打开面板）
- 默认 mode 切换为 `sign_up`（注册优先）

### 6. 登录后静默数据导入

**文件**: `src/App.jsx`（或在 AuthProvider 登录回调中）

**变更**:
- 监听 `status` 从 `anonymous` → `authenticated` 的转换
- 在转换时执行一次性静默导入:
  1. 读取 localStorage `rr_articles`
  2. 若 Supabase articles 表为空 → 逐条 saveArticle 到云端
  3. 清理 localStorage 所有 `rr_*` 和 `rr_local_migration_meta` key
  4. 刷新 library 状态

---

## 有效性原理

### 为什么这个方案有效

1. **渐进式转化**: 用户先体验核心价值（阅读），再被自然引导注册。研究表明"先试后买"可将注册转化率提升 2-5 倍。

2. **数据连续性**: 试用期的示例文章写入 localStorage，登录时静默导入到 Supabase。用户注册后不会感觉"丢失了什么"——他们刚才读的文章还在。

3. **门控而非阻断**: 功能门控使用内联提示条 + 展开注册表单，而非 `alert()` 弹窗或硬阻断页面。用户始终知道"下一步该做什么"。

4. **代码安全**: 不删除迁移相关代码，仅移除功能入口。如果后续需要回滚或重新启用迁移，只需恢复渲染分支即可。

### 预期效果

- **新用户**: 看到简洁的 Hero（仅"立即体验"），点击后进入阅读器，可以翻译、调节字体。尝试收藏时看到友好提示 → 注册。
- **老用户（已登录）**: 体验完全不变，Hero 不出现，直接看到文章库。
- **老用户（未登录但 localStorage 有数据）**: 登录后数据自动导入云端，无感知。
- **管理员**: 无变化。

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| 静默导入失败（网络问题） | catch 错误后保留 localStorage 数据，不清理，下次登录重试 |
| 匿名用户清除浏览器数据后丢失试用进度 | 提示条中说明"登录后可永久保存" |
| AuthPanel 展开逻辑与现有 click-outside 冲突 | 使用 `triggerOpen` 计数模式，不修改现有关闭逻辑 |

---

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/providers/AuthProvider.jsx` | 修改 | 移除 pending_migration 状态路径 |
| `src/App.jsx` | 修改 | 移除迁移分支 + 新增静默导入逻辑 |
| `src/components/ImportPage.jsx` | 修改 | Hero 精简 + import panel 门控 + 回顾门控 |
| `src/components/ReaderPage.jsx` | 修改 | 收藏/标记门控 + auth prompt 提示条 |
| `src/components/AuthPanel.jsx` | 修改 | 支持外部触发展开 |

## 不删除的文件（保留但不调用）

| 文件 | 说明 |
|------|------|
| `src/components/MigrationPanel.jsx` | 迁移 UI 组件 |
| `src/services/migration/localMigration.js` | 本地迁移逻辑 |
| `src/services/migration/remoteMigration.js` | 远程迁移逻辑 |
| `src/store/storage.js` 中的 migration 相关函数 | claim/mark/touch migration meta |

---

## 待确认决策

1. ✅ 试用文章写 localStorage，登录后静默导入云端
2. ✅ 推荐阅读对匿名用户可见，但加入文章库需登录
3. ✅ 登录后清理 localStorage 的 rr_* 和 migration meta
4. ✅ 门控使用内联提示条 + 自动展开 AuthPanel
5. ✅ 暂不删除迁移相关代码文件
