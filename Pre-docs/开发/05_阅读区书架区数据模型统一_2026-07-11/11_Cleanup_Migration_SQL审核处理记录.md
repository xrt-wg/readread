# Cleanup Migration SQL 审核处理记录

> 日期：2026-07-12
> 审核来源：`10_Cleanup_Migration_SQL审核.md`
> 处理状态：全部修正完成

---

## 一、逐项处理

### B1 · 列重命名后 RPC 函数体引用断裂 → ✅ 已修正

**审核发现**：PostgreSQL 函数体以文本存储，`RENAME COLUMN` 不会更新函数体中的列引用。4 个 RPC 函数体中引用了旧列名（`article_id` / `import_item_id`），重命名后运行时报错。

**处理**：在 Step 3 后新增 Step 4，用 `CREATE OR REPLACE FUNCTION` 重建 4 个受影响的函数（`soft_delete_bookmarks_for_reading`、`delete_reading`、`check_reading_completed`、`get_reading_for_recommendation`）。函数逻辑不变，仅列名更新为 `reading_id`。

### I1 · 冗余 FK DROP + ADD → ✅ 已修正

**审核发现**：PostgreSQL 的 `RENAME COLUMN` 使用列内部标识符（attnum）自动保持 FK 完整性。Step 3a/3b 中的 DROP + ADD 是多余操作，且引入短暂 FK 真空窗口。

**处理**：移除 Step 3a 和 3b 中的 FK DROP + ADD 块，仅保留 `RENAME COLUMN` + 索引重命名。

### I2 · 已包含在 B1 的修正中（Step 4.4）

---

## 二、修正后的 Migration 结构

```
Step 1: DROP 5 个旧 RPC 函数
Step 2: DROP 2 张旧表（articles, import_items）
Step 3: 列重命名 + 索引重命名（不含 FK 重建）
  3a: bookmarks.article_id → reading_id
  3b: reading_marks.article_id → reading_id
  3c: recommendation_submissions.import_item_id → reading_id
Step 4: 重建 4 个受影响的 RPC 函数（函数体列名更新）
  4.1 soft_delete_bookmarks_for_reading
  4.2 delete_reading
  4.3 check_reading_completed
  4.4 get_reading_for_recommendation
```

---

## 三、复审记录

> 日期：2026-07-12
> 复审人：Claude（独立复核）
> 复核范围：逐项交叉验证处理记录声明的所有修正是否在 migration SQL 中落地；逐函数对比原始函数体与重建函数体的逻辑一致性

### 3.1 复核方法

对每项声明的修正，读取 `20260712000000_cleanup_old_tables_and_rename_columns.sql` 对应行进行交叉验证。对 Step 4 的 4 个重建函数，逐行对比其与第一轮 migration (`20260711000000`) 中原始函数体的逻辑差异，确保**仅列名更新、逻辑不变**。

### 3.2 逐项复核结果

#### 🔴 B1 · RPC 函数体重建 (1/1 通过)

| 重建函数 | 核实行号 | 列名更新 | 逻辑一致性 |
|---|---|---|---|
| 4.1 `soft_delete_bookmarks_for_reading` | 47-60 | `article_id` → `reading_id` (行 56) ✅ | 与原始函数体 (L234) 逻辑一致 ✅ |
| 4.2 `delete_reading` | 62-85 | bookmarks: `article_id` → `reading_id` (行 71) ✅; reading_marks: `article_id` → `reading_id` (行 76) ✅ | 与原始函数体 (L250/L256) 逻辑一致，`auth.uid()` 校验保留 ✅ |
| 4.3 `check_reading_completed` | 87-111 | `rm.article_id` → `rm.reading_id` (行 106) ✅ | 与原始函数体 (L287) 逻辑一致，双重 auth 校验保留 (行 96-102) ✅ |
| 4.4 `get_reading_for_recommendation` | 113-141 | `rs.import_item_id` → `rs.reading_id` (行 136) ✅ | 与原始函数体 (L317) 逻辑一致 ✅ |

**额外验证**：
- `CREATE OR REPLACE FUNCTION` 保留已有 GRANT EXECUTE 权限——无需重复授权 ✅
- 4 个重建函数签名与第一轮 migration 完全一致 ✅

#### 🟡 I1 · 移除冗余 FK DROP+ADD (1/1 通过)

| 步骤 | 核实行号 | 状态 |
|---|---|---|
| 3a: bookmarks RENAME | 行 28-30 | 仅 `RENAME COLUMN` + index rename，无 FK DROP+ADD ✅ |
| 3b: reading_marks RENAME | 行 32-34 | 同上 ✅ |
| 注释说明 | 行 28 | `-- FK 约束由 RENAME COLUMN 自动保持（使用列内部标识符），无需重建` ✅ |

**验证**：FK 约束 `bookmarks_user_reading_fk` 和 `reading_marks_user_reading_fk` 由第一轮 migration 建立，`RENAME COLUMN` 自动保持——无需在本 migration 中再次操作 ✅

### 3.3 额外检查项

| 检查项 | 结果 |
|---|---|
| Step 1: 5 个 DROP FUNCTION 签名 | ✅ 全部匹配原始 migration 定义 |
| Step 2: CASCADE 影响——确认无意外副作用 | ✅ 入站 FK 已由第一轮 migration 清理 |
| Step 3c: `idx_rec_submissions_import_item` 索引名 | ✅ 存在于 `20260616000002:71` |
| Step 4 注释：解释为什么需要重建函数体 | ✅ 行 43-45 有清晰说明 |
| 4 个重建函数中的 column references 全部更新为 `reading_id` | ✅ 无遗漏 |

### 3.4 总体评价

**处理质量：高。** 两项修正均正确实施：

- **B1**：4 个函数全部重建，列名更新完整无遗漏，逻辑与原始一致，auth.uid() 校验全部保留。注释解释了 PostgreSQL 函数体以文本存储的特性，对后续维护者友好。
- **I1**：冗余 FK DROP+ADD 正确移除。注释说明了 RENAME COLUMN 的内部机制（attnum），解释了为什么不需要重建 FK。

未引入新的 bug，Migration 结构清晰（4 步），每步有明确注释。

**实施准入判断**：cleanup migration SQL 可以安全执行。

