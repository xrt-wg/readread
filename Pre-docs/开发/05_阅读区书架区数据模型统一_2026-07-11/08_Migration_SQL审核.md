# Migration SQL 审核报告

> 审核文件：`supabase/migrations/20260711000000_unify_readings_table.sql`
> 审核日期：2026-07-11
> 审核人：Claude（独立审核）
> 审核方法：逐行审查 + 与现有 21 个 migration 交叉验证

---

## 一、审核方式

对 migration SQL 的 10 个 Step 进行了全覆盖审查，并交叉验证了以下外部依赖：
- FK 约束名 vs 源表定义（`20260509170000_create_core_user_tables.sql`）
- RPC 签名 vs 旧版函数（`20260614000000/00003/00006` migration 系列）
- 列引用 vs 实际表结构（含历次 ALTER TABLE ADD COLUMN）
- 触发器函数 vs 现有定义

---

## 二、问题汇总

| # | 严重度 | 位置 | 问题 |
|---|---|---|---|
| B1 | 🔴 阻塞 | Step 7 (行 167-180) | FK 约束名错误：DROP CONSTRAINT 用了不存在的名称 |
| B2 | 🔴 阻塞 | Step 8.7 (行 321-352) | `start_reading` 未验证 `p_user_id = auth.uid()`——SECURITY DEFINER 越权 |
| B3 | 🔴 阻塞 | Step 8 (行 186-352) | 6/7 个 RPC 缺少 GRANT EXECUTE，前端无法调用 |
| I1 | 🟡 重要 | Step 4 (行 73-101) | CTE 对同一 `source_import_id` 可能产生多行，UPDATE 非确定性 |
| I2 | 🟡 重要 | Step 8.4 (行 244-260) | `check_reading_completed` 未验证 `p_user_id = auth.uid()` |
| I3 | 🟡 重要 | Step 8.6 (行 292-319) | `COUNT(DISTINCT user_id)` → `COUNT(*)` 语义变更 |
| I4 | 🟡 重要 | Step 8.6 (行 293-318) | 重复调用 `compute_recommendation_score`，旧版只调一次 |
| M1 | 🟢 次要 | Step 6 (行 156-160) | 相同 `updated_at` 时 DELETE 双边删除 |
| M2 | 🟢 次要 | Step 8.6 (行 294) | `p_user_id` 参数声明但未使用 |

---

## 三、详细分析

### 🔴 B1 · FK 约束名错误（Step 7）

**代码**（行 167-170）：
```sql
ALTER TABLE public.bookmarks
  DROP CONSTRAINT IF EXISTS bookmarks_user_id_article_id_fkey;
```

**实际约束名**（`20260509170000_create_core_user_tables.sql:34`）：
```sql
constraint bookmarks_user_article_fk foreign key (user_id, article_id)
    references public.articles (user_id, id) on delete cascade
```

**实际约束名是 `bookmarks_user_article_fk`，不是 `bookmarks_user_id_article_id_fkey`**。同理 `reading_marks` 的约束名是 `reading_marks_user_article_fk`（行 46），不是 `reading_marks_user_id_article_id_fkey`。

由于 `DROP CONSTRAINT IF EXISTS` 使用了 `IF EXISTS`，错误名称会导致**静默跳过**——旧约束没有被删除。随后 `ADD CONSTRAINT` 会因同名约束已存在而**直接报错**，migration 执行失败。

**修正**：
```sql
-- bookmarks FK
ALTER TABLE public.bookmarks
  DROP CONSTRAINT IF EXISTS bookmarks_user_article_fk;

ALTER TABLE public.bookmarks
  ADD CONSTRAINT bookmarks_user_reading_fk
  FOREIGN KEY (user_id, article_id) REFERENCES public.readings(user_id, id) ON DELETE CASCADE;

-- reading_marks FK
ALTER TABLE public.reading_marks
  DROP CONSTRAINT IF EXISTS reading_marks_user_article_fk;

ALTER TABLE public.reading_marks
  ADD CONSTRAINT reading_marks_user_reading_fk
  FOREIGN KEY (user_id, article_id) REFERENCES public.readings(user_id, id) ON DELETE CASCADE;
```

---

### 🔴 B2 · `start_reading` 越权漏洞（Step 8.7）

**代码**（行 321-352）：
```sql
CREATE OR REPLACE FUNCTION public.start_reading(
  p_reading_id text,
  p_user_id uuid,          -- ← 调用者传入
  p_max_limit integer DEFAULT 5
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER              -- ← 以 OWNER 权限执行
AS $$
...
BEGIN
  SELECT COUNT(*) INTO v_active_count
  FROM public.readings
  WHERE user_id = p_user_id   -- ← 直接使用调用者传入的值！
    AND reading_status = 'reading' AND deleted_at IS NULL
  FOR UPDATE;

  ...
  UPDATE public.readings
  SET reading_status = 'reading', ...
  WHERE id = p_reading_id
    AND user_id = p_user_id;  -- ← 同上
END;
$$;
```

`SECURITY DEFINER` 函数绕过 RLS。由于没有 `IF p_user_id != auth.uid() THEN RAISE EXCEPTION` 检查，攻击者可以：
1. 传入**其他用户**的 `p_user_id`，绕过阅读区上限（用目标用户的配额取书）
2. 传入**其他用户**的 `p_reading_id`，修改他人书籍的 reading_status

**修正**：在函数体开头加入：
```sql
IF auth.uid() IS NULL THEN
  RAISE EXCEPTION 'unauthenticated';
END IF;

IF p_user_id != auth.uid() THEN
  RAISE EXCEPTION 'cannot act on behalf of another user';
END IF;
```

或直接去掉 `p_user_id` 参数，函数内部使用 `auth.uid()` 代替。

---

### 🔴 B3 · 缺少 GRANT EXECUTE（Step 8）

现有系统中有 6 个旧 RPC 全部显式 `GRANT EXECUTE ... TO authenticated`：

| 旧 RPC | GRANT 存在 |
|---|---|
| `soft_delete_article(text)` | ✅ |
| `soft_delete_bookmarks_for_article(text)` | ✅ |
| `delete_import_item(text)` | ✅ |
| `get_import_item_for_recommendation(text)` | ✅ |
| `increment_recommendation_add_count(text, uuid)` | ✅ |
| `check_import_item_reading_completed(text, uuid)` | ✅ |

新 migration 中 7 个 RPC 的 GRANT 状态：

| 新 RPC | 名称/签名 | GRANT 继承? | 状态 |
|---|---|---|---|
| `soft_delete_reading(text)` | 名称变化 | 不继承 | ❌ 缺失 |
| `soft_delete_bookmarks_for_reading(text)` | 名称变化 | 不继承 | ❌ 缺失 |
| `delete_reading(text)` | 名称+返回类型变化 | 不继承 | ❌ 缺失 |
| `check_reading_completed(text, uuid)` | 名称变化 | 不继承 | ❌ 缺失 |
| `get_reading_for_recommendation(text)` | 名称变化 | 不继承 | ❌ 缺失 |
| `increment_recommendation_add_count(text, uuid)` | 名称+签名一致 | ✅ 继承 | ✅ |
| `start_reading(text, uuid, integer)` | 全新函数 | 无 | ❌ 缺失 |

**6/7 个 RPC 缺少 GRANT EXECUTE**。虽然 PostgreSQL 默认将 EXECUTE 授予 PUBLIC，但现有代码库的惯例是显式 `GRANT ... TO authenticated`。如果 Supabase 项目配置了受限的默认权限（如 `ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`），这 6 个函数将无法从前端调用。

**修正**：在 Step 8 末尾为每个新/改名函数添加：
```sql
GRANT EXECUTE ON FUNCTION public.soft_delete_reading(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_bookmarks_for_reading(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_reading(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_reading_completed(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_reading_for_recommendation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_reading(text, uuid, integer) TO authenticated;
```

---

### 🟡 I1 · Step 4 CTE 多行非确定性（Step 4 情况 A）

**场景**：用户将同一本书多次取到阅读区（取书→还书→再取书），产生多条 article 记录指向同一个 `source_import_id`。

**当前代码**（行 74-101）：
```sql
WITH article_info AS (
    SELECT a.source_import_id, a.user_id, ...
    FROM public.articles a
    LEFT JOIN public.reading_marks rm ON ...
    WHERE a.source_import_id IS NOT NULL
)
UPDATE public.readings r
SET
    reading_status = CASE ... END,
    reading_started_at = LEAST(r.created_at, ai.article_created_at),
    ...
FROM article_info ai
WHERE r.id = ai.source_import_id AND r.user_id = ai.user_id;
```

CTE 对同一个 `(source_import_id, user_id)` 返回多行时，PostgreSQL 的 UPDATE FROM 会**非确定性地**选取其中一行来设置 reading_status。这意味着迁移后的 reading_status 可能是 `reading`（如果最后一次阅读未完成）也可能是 `completed`（如果某次阅读完成了），取决于执行计划而非数据语义。

**修正**：使用 `DISTINCT ON` 选取最新 article：
```sql
WITH latest_article AS (
    SELECT DISTINCT ON (a.source_import_id, a.user_id)
        a.source_import_id,
        a.user_id,
        a.created_at AS article_created_at,
        a.updated_at AS article_updated_at,
        rm.completed,
        rm.paragraph_index,
        rm.progress_percent,
        rm.updated_at AS rm_updated_at
    FROM public.articles a
    LEFT JOIN public.reading_marks rm
        ON rm.article_id = a.id AND rm.user_id = a.user_id
    WHERE a.source_import_id IS NOT NULL
    ORDER BY a.source_import_id, a.user_id, a.created_at DESC
)
UPDATE public.readings r SET ...
FROM latest_article ai
WHERE r.id = ai.source_import_id AND r.user_id = ai.user_id;
```

---

### 🟡 I2 · `check_reading_completed` 越权（同 B2 模式）

```sql
CREATE OR REPLACE FUNCTION public.check_reading_completed(p_reading_id text, p_user_id uuid)
...
SECURITY DEFINER
```

参数 `p_user_id` 未与 `auth.uid()` 校验，调用者可传入任意用户的 UUID 来查询其阅读完成状态。虽不如 B2 严重（只读），但仍构成信息泄露。

**修正**：在函数开头加入 `auth.uid()` 校验，或去掉 `p_user_id` 参数改用 `auth.uid()`。

---

### 🟡 I3 · `COUNT(DISTINCT user_id)` → `COUNT(*)` 语义变更（Step 8.6）

**旧版**（`20260616000006`）：
```sql
SELECT COUNT(DISTINCT user_id) INTO true_count
FROM public.import_items
WHERE share_source_id = p_submission_id
  AND origin IN ('featured', 'featured_legacy')
  AND deleted_at IS NULL;
```

**新版**（行 304-308）：
```sql
SELECT COUNT(*) INTO v_add_count
FROM public.readings
WHERE share_source_id = p_submission_id
  AND origin IN ('featured', 'featured_legacy')
  AND deleted_at IS NULL;
```

在统一模型中，同一用户对同一推荐应该只有一条 reading，`COUNT(*)` 与 `COUNT(DISTINCT user_id)` 理论上等价。但以下场景会导致差异：
- 迁移阶段 Case B 产生了与已有 reading 共享 `share_source_id` 的独立行
- 未来可能的去重失败或其他数据异常

`COUNT(DISTINCT user_id)` 是更安全的语义（"有多少人去书架添加了这本书"），`COUNT(*)` 是"这本书产生了多少条添加记录"。建议**恢复为 `COUNT(DISTINCT user_id)`** 以保持旧版语义。

---

### 🟡 I4 · `compute_recommendation_score` 重复调用（Step 8.6）

**旧版**：一次 UPDATE 中同时设置 `add_count` 和 `recommend_score`：
```sql
UPDATE public.recommendation_submissions
SET add_count = true_count,
    recommend_score = public.compute_recommendation_score(p_submission_id)
WHERE id = p_submission_id AND status = 'active';
```

**新版**（行 310-317）：分两次 UPDATE：
```sql
UPDATE public.recommendation_submissions
SET add_count = v_add_count, updated_at = now()
WHERE id = p_submission_id;

UPDATE public.recommendation_submissions
SET recommend_score = public.compute_recommendation_score(id)
WHERE id = p_submission_id;
```

问题：
1. 第二次 UPDATE 调用 `compute_recommendation_score(id)` 时，`add_count` 已经更新——但如果该函数内部查询 `import_items` 表（现在应是 `readings`），数据已经一致，理论上不影响结果。但需确认 `compute_recommendation_score` 函数内部是否查询旧表名。
2. 两次 UPDATE 非原子——中间窗口期 `add_count` 已更新但 `recommend_score` 未更新。
3. 缺少 `AND status = 'active'` 条件（旧版有此过滤）。

**建议**：合并为一次 UPDATE，与旧版行为一致：
```sql
UPDATE public.recommendation_submissions
SET add_count = v_add_count,
    recommend_score = public.compute_recommendation_score(p_submission_id),
    updated_at = now()
WHERE id = p_submission_id AND status = 'active';
```

**补充**：需验证 `compute_recommendation_score` 函数内部是否查询 `import_items` 表——若是，在 Phase 4 清理旧表之前必须先行修正，否则旧表 DROP 后该函数会失败。

---

### 🟢 M1 · 去重 DELETE 双边删除风险（Step 6）

```sql
DELETE FROM public.reading_marks rm1
USING public.reading_marks rm2
WHERE rm1.user_id = rm2.user_id
  AND rm1.article_id = rm2.article_id
  AND rm1.updated_at < rm2.updated_at;
```

当两条重复记录的 `updated_at` 完全相等时，双方都不满足 `rm1.updated_at < rm2.updated_at` 条件（`=` 不满足 `<`），两条都保留。这是正确的——不会误删。

但当 `updated_at` 相等且使用严格的 `<` 时，两条都不被删除，保留了重复数据。这会导致 Step 7 FK 建立后 reading_marks 的复合 PK `(user_id, article_id)` 存在重复——但 reading_marks 本身就是以 `(user_id, article_id)` 为主键的，如果有重复，Step 7 之前就应该报错。实际上 reading_marks 的 PK 约束保证了不会有真正的重复。

**结论**：此场景在 PK 约束下不可能发生，实际无风险。建议保留现状或改用 `rm1.ctid < rm2.ctid` 作为 tiebreaker。

---

### 🟢 M2 · `p_user_id` 参数未使用（Step 8.6）

```sql
CREATE OR REPLACE FUNCTION public.increment_recommendation_add_count(
  p_submission_id text,
  p_user_id uuid              -- ← 声明但未使用
)
```

这是从旧版直接继承的（旧版同样未使用该参数）。保留以维持 API 签名兼容性，无需修改，但建议加注释说明。

---

## 四、补充发现

### 📋 迁移 UX 影响：reading 状态无法推断

Step 3 将所有 import_items 设为 `reading_status = 'unread'`，Step 4 根据 reading_marks 推断为 `'completed'` / `'in_progress'` / `'unread'`。**但没有记录会被设为 `'reading'`**。

原因：旧数据模型中没有"当前是否正在阅读"的状态位。`articles` 表里的所有记录都曾是"被取到阅读区"的书，但无法区分"用户正在读"和"用户放下了"。

**影响**：迁移后所有用户的阅读区（`WHERE reading_status = 'reading'`）将是**空的**。用户需要手动从书架的 `in_progress` 列表中重新取书。阅读进度（bookmarks、reading_marks）完整保留，不会丢失。

**建议**：将此作为已知限制文档化，并在前端迁移后首次加载时提供引导提示（如"你的书已放回书架，点击继续阅读"）。

---

## 五、审核结论

### 必须在执行前修复（3 项）

| # | 问题 | 影响 |
|---|---|---|
| B1 | FK 约束名错误 | Migration 在 Step 7 必然失败 |
| B2 | `start_reading` 越权 | 安全漏洞：可操纵其他用户的阅读状态 |
| B3 | 缺少 GRANT EXECUTE | 前端 RPC 调用失败（取决于 Supabase 默认权限配置） |

### 建议执行前修复（4 项）

| # | 问题 | 影响 |
|---|---|---|
| I1 | Step 4 CTE 多行非确定性 | 多阅读历史的用户迁移后 reading_status 随机 |
| I2 | `check_reading_completed` 越权 | 信息泄露：可查询他人阅读状态 |
| I3 | COUNT 语义变更 | add_count 计算方式与旧版不一致 |
| I4 | 重复调用 score 函数 | 非原子更新 + 可能遗漏 status 过滤 |

### 已知限制（1 项）

- 迁移后 reading_status 无法设为 `'reading'`，所有进行中的阅读变为 `'in_progress'`，需用户手动重新取书。不影响阅读数据完整性。

### 总体判断

Migration SQL 结构完整、逻辑正确，但存在 **3 项阻塞性 bug** 必须修复后方可执行。其中 B1（约束名错误）为 100% 必现的语法/逻辑错误，B2 为安全漏洞，B3 为功能性缺陷。修复成本低（均为局部修改），预计 30 分钟内可全部修正。
