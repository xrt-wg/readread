# Cleanup Migration SQL 审核报告

> 审核文件：`supabase/migrations/20260712000000_cleanup_old_tables_and_rename_columns.sql`
> 审核日期：2026-07-12
> 审核人：Claude（独立审核）
> 审核方法：逐行审查 + 与第一轮 migration (`20260711000000`) 的 RPC 函数体交叉验证

---

## 一、问题汇总

| # | 严重度 | 位置 | 问题 |
|---|---|---|---|
| B1 | 🔴 阻塞 | Step 3 整体 | 4 个 RPC 函数体引用的列被改名，函数将运行时报错 |
| I1 | 🟡 重要 | Step 3a/3b | 列重命名后 DROP+ADD FK 是多余的——`RENAME COLUMN` 自动保持 FK 完整性 |
| I2 | 🟡 重要 | Step 3c | `get_reading_for_recommendation` 函数引用了被改名的列 |

---

## 二、详细分析

### 🔴 B1 · 列重命名导致 4 个 RPC 函数体引用断裂（Step 3）

PostgreSQL 函数体以**文本形式**存储（`pg_proc.prosrc`），列重命名时 PostgreSQL **不会**扫描和更新函数体中的列引用。当列被重命名后，函数体中的旧列名在运行时无法解析，函数调用将失败。

Step 3 执行三个列重命名：
- 3a: `bookmarks.article_id → reading_id`
- 3b: `reading_marks.article_id → reading_id`
- 3c: `recommendation_submissions.import_item_id → reading_id`

第一轮 migration (`20260711000000`) 创建的 7 个 RPC 中，有 **4 个**在函数体中引用了这些将被改名的列：

| RPC | 引用位置 | 旧列名 | 改名的表 | 状态 |
|---|---|---|---|---|
| `soft_delete_bookmarks_for_reading` | 行 234 | `article_id` | bookmarks → `reading_id` | ❌ 将断裂 |
| `delete_reading` | 行 250 | `article_id` | bookmarks → `reading_id` | ❌ 将断裂 |
| `delete_reading` | 行 256 | `article_id` | reading_marks → `reading_id` | ❌ 将断裂 |
| `check_reading_completed` | 行 287 | `article_id` | reading_marks → `reading_id` | ❌ 将断裂 |
| `get_reading_for_recommendation` | 行 317 | `import_item_id` | recommendation_submissions → `reading_id` | ❌ 将断裂（详见 I2） |

**不影响的 RPC**（函数体未引用被改名的列）：
- `soft_delete_reading`：只用 `readings` 表
- `increment_recommendation_add_count`：只用 `readings` + `recommendation_submissions`（不引用 `import_item_id` 列）
- `start_reading`：只用 `readings` 表

**修正**：在 Step 3 之后新增 Step 4，用 `CREATE OR REPLACE FUNCTION` 重新定义这 4 个受影响的函数（保留完整的函数体，代码不变，只是让 PostgreSQL 用新的列名重新解析函数体文本）：

```sql
-- ============================================================================
-- Step 4: 重建受列重命名影响的 RPC 函数
-- RENAME COLUMN 不会更新函数体中的列引用，必须重新编译
-- ============================================================================

-- 4.1 soft_delete_bookmarks_for_reading（bookmarks.article_id → reading_id）
CREATE OR REPLACE FUNCTION public.soft_delete_bookmarks_for_reading(p_reading_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.bookmarks
  SET deleted_at = now()
  WHERE reading_id = p_reading_id        -- ← 列名已更新
    AND user_id = auth.uid()
    AND deleted_at IS NULL;
END;
$$;

-- 4.2 delete_reading（bookmarks.reading_id + reading_marks.reading_id）
CREATE OR REPLACE FUNCTION public.delete_reading(p_reading_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.bookmarks
  SET deleted_at = now()
  WHERE reading_id = p_reading_id        -- ← 列名已更新
    AND user_id = auth.uid()
    AND deleted_at IS NULL;

  DELETE FROM public.reading_marks
  WHERE reading_id = p_reading_id;       -- ← 列名已更新（原 article_id）

  UPDATE public.readings
  SET deleted_at = now()
  WHERE id = p_reading_id
    AND user_id = auth.uid()
    AND deleted_at IS NULL;
END;
$$;

-- 4.3 check_reading_completed（reading_marks.reading_id）
CREATE OR REPLACE FUNCTION public.check_reading_completed(p_reading_id text, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_completed boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'cannot query on behalf of another user';
  END IF;

  SELECT rm.completed INTO v_completed
  FROM public.reading_marks rm
  WHERE rm.reading_id = p_reading_id     -- ← 列名已更新
    AND rm.user_id = p_user_id;

  RETURN COALESCE(v_completed, false);
END;
$$;

-- 4.4 get_reading_for_recommendation（recommendation_submissions.reading_id）
CREATE OR REPLACE FUNCTION public.get_reading_for_recommendation(p_reading_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', r.id,
    'title', r.title,
    'author', r.author,
    'source_url', r.source_url,
    'sections', r.sections,
    'format', r.format,
    'kind', r.kind
  ) INTO v_result
  FROM public.readings r
  WHERE r.id = p_reading_id
    AND r.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.recommendation_submissions rs
      WHERE rs.reading_id = p_reading_id AND rs.status = 'active'  -- ← 列名已更新
    );

  RETURN v_result;
END;
$$;
```

**注意**：Step 4 不需要额外的 GRANT EXECUTE——`CREATE OR REPLACE FUNCTION` 保留已有的权限授权。

---

### 🟡 I1 · 列重命名后的 FK DROP + ADD 是多余的（Step 3a/3b）

```sql
ALTER TABLE public.bookmarks RENAME COLUMN article_id TO reading_id;

ALTER TABLE public.bookmarks
  DROP CONSTRAINT IF EXISTS bookmarks_user_reading_fk;

ALTER TABLE public.bookmarks
  ADD CONSTRAINT bookmarks_user_reading_fk
  FOREIGN KEY (user_id, reading_id) REFERENCES public.readings(user_id, id) ON DELETE CASCADE;
```

PostgreSQL 的 `RENAME COLUMN` 自动保持 FK 约束完整性——约束内部使用列的内部标识符（attnum）而非列名。重命名后 FK 仍然有效、约束名不变。

DROP + ADD 的问题：
1. **不必要的操作**：PostgreSQL 已经自动处理了
2. **短暂的 FK 真空窗口**：DROP 到 ADD 之间，有一瞬间没有 FK 保护。在单线程 migration 场景下风险极低，但没有理由引入这个窗口
3. **与 DDL 最佳实践相悖**：重命名后不应重建约束

**建议**：删除两个 Step（3a 和 3b）中的 FK DROP + ADD 块，仅保留 `RENAME COLUMN` 和索引重命名。修正后的 3a：

```sql
-- 3a: bookmarks.article_id → reading_id
ALTER TABLE public.bookmarks RENAME COLUMN article_id TO reading_id;
ALTER INDEX IF EXISTS idx_bookmarks_article_id RENAME TO idx_bookmarks_reading_id;
-- FK bookmarks_user_reading_fk 由 RENAME COLUMN 自动保持，无需重建
```

3b 同理。

---

### 🟡 I2 · 确认：`get_reading_for_recommendation` 受 Step 3c 影响

已在 B1 的修正中一并处理（4.4）。

`compute_recommendation_score` 经核实不引用 `import_item_id` 列（仅查 `recommendation_ratings` + `recommendation_submissions.add_count`），不受影响。✅

---

## 三、补充检查

### Step 1: DROP 旧 RPC 函数

5 个 DROP 签名验证：

| DROP 语句 | 对应旧 migration | 验证 |
|---|---|---|
| `soft_delete_article(text)` | `20260614000000` | ✅ 签名匹配（行 5） |
| `soft_delete_bookmarks_for_article(text)` | `20260614000000` | ✅ 签名匹配（行 37） |
| `delete_import_item(text)` | `20260614000003` | ✅ 签名匹配——返回 `integer` 但 DROP 不需要指定返回类型 |
| `check_import_item_reading_completed(text, uuid)` | `20260616000006` | ✅ 签名匹配（行 77-79） |
| `get_import_item_for_recommendation(text)` | `20260616000006` | ✅ 签名匹配（行 11-12） |

全部正确。✅

### Step 2: DROP 旧表

```sql
DROP TABLE IF EXISTS public.articles CASCADE;
DROP TABLE IF EXISTS public.import_items CASCADE;
```

CASCADE 影响分析：
- `articles` 的入站 FK：`bookmarks_user_article_fk` + `reading_marks_user_article_fk`——已于第一轮 migration 的 Step 4b DROP。CASCADE 无额外影响 ✅
- `import_items` 的入站 FK：无——`recommendation_submissions.import_item_id` 无 FK 约束（R7 确认）。CASCADE 无额外影响 ✅
- RLS 策略、触发器、索引：全部随表 DROP 自动清理 ✅

CASCADE 使用安全。✅

### 索引名称验证

| 重命名语句 | 原始索引名 | 来源 migration | 验证 |
|---|---|---|---|
| `idx_bookmarks_article_id → idx_bookmarks_reading_id` | `idx_bookmarks_article_id` | `20260509170000:52` | ✅ |
| `idx_reading_marks_article_id → idx_reading_marks_reading_id` | `idx_reading_marks_article_id` | `20260509170000:53` | ✅ |
| `idx_rec_submissions_import_item → idx_rec_submissions_reading_id` | `idx_rec_submissions_import_item` | `20260616000002:71` | ✅ |

全部正确。✅

---

## 四、审核结论

### 必须在执行前修复（1 项）

| # | 问题 | 影响 |
|---|---|---|
| B1 | 列重命名后 4 个 RPC 函数体引用断裂 | `soft_delete_bookmarks_for_reading`、`delete_reading`、`check_reading_completed`、`get_reading_for_recommendation` 全部运行时报错 |

### 建议执行前修复（1 项）

| # | 问题 | 影响 |
|---|---|---|
| I1 | 冗余的 FK DROP + ADD | 不必要的操作 + 短暂 FK 真空窗口。不影响功能正确性 |

### 总体判断

Step 1-2 正确，Step 3 的列重命名和索引重命名正确。但 **缺少了关键的一步**：在列重命名之后，必须重建受影响的 RPC 函数，因为 PostgreSQL 不会自动更新函数体中的列引用。

修复方案清晰：在 Step 3 后新增 Step 4，对 4 个受影响的函数执行 `CREATE OR REPLACE FUNCTION`（函数逻辑不变，仅列名更新）。预计修复时间 15 分钟。
