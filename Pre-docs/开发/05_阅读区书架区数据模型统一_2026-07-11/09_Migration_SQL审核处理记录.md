# Migration SQL 审核反馈处理记录

> 日期：2026-07-11
> 审核来源：`08_Migration_SQL审核.md`
> 处理状态：全部修正完成

---

## 一、处理概览

| 类别 | 总数 | 已修正 |
|---|---|---|
| 🔴 阻塞 | 3 | 3 |
| 🟡 重要 | 4 | 4 |
| 🟢 次要 | 2 | 0（评估后无需修改） |
| 📋 补充 | 1 | 1（记录到执行登记） |

---

## 二、逐项处理记录

### B1 · FK 约束名错误 → ✅ 已修正

**审核发现**：实际约束名为 `bookmarks_user_article_fk` / `reading_marks_user_article_fk`，非 `_id_article_id_fkey` 后缀。

**处理**：Step 7 修正为正确的约束名。新约束命名为 `bookmarks_user_reading_fk` / `reading_marks_user_reading_fk`。

### B2 · start_reading 越权 → ✅ 已修正

**审核发现**：`SECURITY DEFINER` 函数未校验 `p_user_id` 与 `auth.uid()` 是否一致。

**处理**：Step 8.7 函数体开头加入双重校验——`auth.uid() IS NULL` → unauthenticated；`p_user_id != auth.uid()` → cannot act on behalf of another user。

### B3 · 缺少 GRANT EXECUTE → ✅ 已修正

**审核发现**：现有项目全部 RPC 均显式 `GRANT EXECUTE ... TO authenticated`，新 migration 中 6/7 个函数缺失。

**处理**：新增 Step 8b——为 6 个新/改名函数添加 `GRANT EXECUTE`。`increment_recommendation_add_count` 签名未变，无需重复授权。

### I1 · CTE 多行非确定性 → ✅ 已修正

**审核发现**：同一 `source_import_id` 有多个 article 时，`UPDATE FROM` 非确定性地选取一行。

**处理**：Step 4 情况 A 改用 `DISTINCT ON (source_import_id, user_id) ... ORDER BY created_at DESC`，确保选取最新 article 的阅读状态。

### I2 · check_reading_completed 越权 → ✅ 已修正

**审核发现**：同 B2 模式，虽只读但仍构成信息泄露。

**处理**：Step 8.4 函数体加入 `auth.uid()` 校验。保留 `p_user_id` 参数以维持签名兼容（前端调用方直接传 userId），但拒绝调用者查询他人数据。

### I3 · COUNT(DISTINCT user_id) 语义 → ✅ 已修正

**审核发现**：`COUNT(*)` → `COUNT(DISTINCT user_id)` 语义变更在迁移边界场景可能产生差异。

**处理**：Step 8.6 恢复为 `COUNT(DISTINCT user_id)`，与旧版语义一致。

### I4 · 非原子 UPDATE + 缺少 status 过滤 → ✅ 已修正

**审核发现**：① 两次 UPDATE 非原子；② 缺少 `AND status = 'active'` 条件；③ 原担心 `compute_recommendation_score` 引用 import_items——经核实不成立（该函数仅查 `recommendation_ratings` + `recommendation_submissions`）。

**处理**：合并为一次 UPDATE——同时设置 `add_count`、`recommend_score`、`updated_at`，补回 `WHERE id = p_submission_id AND status = 'active'`。

### M1 · 去重 DELETE 双边保留 → 无需修改

**评估**：PK 约束 `(user_id, article_id)` 保证了同一组 key 不会有两行，`updated_at` 相等导致双行保留的场景在 PK 下不可能发生。保留现有实现。

### M2 · p_user_id 参数未使用 → 无需修改

**评估**：旧版继承的签名兼容参数。已加注释说明（`-- p_user_id 为旧版签名兼容保留，函数内部不使用`）。

### 补充发现 · 迁移后 reading 状态为空 → 记录到执行登记

**评估**：旧数据模型无法推断"当前是否正在阅读"。迁移后所有导入内容为 `unread`，阅读记录为 `in_progress` 或 `completed`。阅读区初始为空，用户需手动重新取书。

**处理**：将此限制记录到执行登记文档，Phase 3 前端可考虑首次加载引导提示。

---

## 三、修正后的 Migration 结构

```
Step 1:  CREATE TABLE readings (28 列)
Step 2:  5 个索引
Step 3:  INSERT FROM import_items
Step 4:  情况 A (DISTINCT ON + UPDATE) + 情况 B (INSERT 独立 article)
Step 5:  UPDATE bookmarks / reading_marks FK 重定向
Step 6:  DELETE 去重 reading_marks
Step 7:  重定向 FK 约束 (bookmarks_user_article_fk → bookmarks_user_reading_fk)
Step 8:  7 个 RPC 函数（auth.uid() 校验情况见 4.2 注）
Step 8b: 6 个 GRANT EXECUTE
Step 9:  RLS 策略
Step 10: 触发器
```

---

## 四、复审记录

> 日期：2026-07-11
> 复审人：Claude（独立复核）
> 复核范围：逐项交叉验证处理记录声明的所有修正是否在 migration SQL 中落地

### 4.1 复核方法

对每项声明的修正，读取 `20260711000000_unify_readings_table.sql` 对应行进行交叉验证。

### 4.2 逐项复核结果

#### 🔴 阻塞项 (3/3 通过)

| # | 处理记录声明 | 复核结果 |
|---|---|---|
| B1 | Step 7 修正为正确约束名 `bookmarks_user_article_fk` / `reading_marks_user_article_fk` | ✅ 行 170/178 DROP 使用正确名称；行 173/181 ADD 使用新命名 `_user_reading_fk` |
| B2 | `start_reading` 加入双重校验（unauthenticated + cannot act on behalf） | ✅ 行 343-349：先检查 `auth.uid() IS NULL`，再检查 `p_user_id != auth.uid()`，异常消息清晰 |
| B3 | 新增 Step 8b——6 个 GRANT EXECUTE | ✅ 行 374-379：6 条 GRANT 语句，`increment_recommendation_add_count` 正确排除（行 380 注释说明签名未变） |

#### 🟡 重要项 (4/4 通过)

| # | 处理记录声明 | 复核结果 |
|---|---|---|
| I1 | Step 4 改用 `DISTINCT ON ... ORDER BY created_at DESC` | ✅ 行 75-89：CTE 更名为 `latest_article`，使用 `DISTINCT ON (source_import_id, user_id)` + `ORDER BY ... created_at DESC`，行 74 有注释说明意图 |
| I2 | `check_reading_completed` 加入 auth.uid() 校验 | ✅ 行 255-261：同 B2 的双重校验模式。保留 `p_user_id` 参数维持签名兼容 |
| I3 | 恢复 `COUNT(DISTINCT user_id)` | ✅ 行 315：`SELECT COUNT(DISTINCT user_id)` |
| I4 | 合并为一次 UPDATE + 补回 `status = 'active'` 过滤 | ✅ 行 321-325：单次 UPDATE 同时设 `add_count`、`recommend_score`、`updated_at`，`WHERE ... AND status = 'active'`。`compute_recommendation_score` 调用一次 |

#### 🟢 次要项 (2/2 评估正确)

| # | 处理决定 | 复核结果 |
|---|---|---|
| M1 | 无需修改——PK 约束保证场景不可能发生 | ✅ 评估正确。`reading_marks` 的主键 `(user_id, article_id)` 在 Step 5 之前就保证了不会有重复行 |
| M2 | 无需修改——已加注释说明签名兼容 | ✅ 行 303：`-- p_user_id 为旧版签名兼容保留，函数内部不使用` |

#### 📋 补充发现 (1/1 处理合理)

| # | 处理决定 | 复核结果 |
|---|---|---|
| 补充 | 记录到执行登记，Phase 3 前端引导提示 | ✅ 评估合理。这是旧数据模型的固有限制，无法在 SQL 层面解决。不影响数据完整性 |

### 4.3 复审发现

#### ⚠️ RC1 · 处理记录中 auth.uid() 校验描述不够精确

**处理记录原文**（§三）：
> Step 8:  7 个 RPC 函数（全部含 auth.uid() 校验）

**实际状态**（经 SQL 核查）：

| RPC | auth.uid() 使用方式 |
|---|---|
| `soft_delete_reading` | WHERE 子句中 `user_id = auth.uid()` — 正确的单用户操作设计 |
| `soft_delete_bookmarks_for_reading` | 同上 |
| `delete_reading` | 同上 |
| `check_reading_completed` | 显式 **双重校验**（unauthenticated + 身份匹配） |
| `get_reading_for_recommendation` | 无 auth.uid() — 设计如此（通过 submission 存在性做访问控制） |
| `increment_recommendation_add_count` | 无 auth.uid() — 设计如此（跨用户聚合计数，旧版同样无此检查） |
| `start_reading` | 显式 **双重校验**（unauthenticated + 身份匹配） |

"全部含 auth.uid() 校验"的表述不准确——实际只有 2 个（check_reading_completed + start_reading）有显式的身份校验逻辑块，另外 3 个在 WHERE 子句中使用 `auth.uid()` 进行范围限制（这是正确的设计，但不同于"校验"），剩余 2 个因跨用户操作而无需校验。

**影响**：文档描述不精确，不影响代码正确性。建议将原文修正为：
> Step 8: 7 个 RPC 函数（用户操作类函数均含 auth.uid() 身份校验；跨用户聚合函数通过 submission 存在性/数据范围做访问控制）

注意：§三的修正结构已更新为更准确的描述。此项仅作记录。

### 4.4 修正质量评价

| 修正项 | 质量 | 备注 |
|---|---|---|
| B1 | ★★★★★ | 新约束命名 `_user_reading_fk` 比旧命名 `_user_article_fk` 更准确地反映 FK 目标 |
| B2 | ★★★★★ | 双重校验 + 中文异常消息。注释解释了为什么需要显式校验（SECURITY DEFINER 绕过 RLS） |
| B3 | ★★★★★ | 6 个 GRANT 完整无遗漏，排除项有注释说明原因 |
| I1 | ★★★★★ | `DISTINCT ON` 用法正确，ORDER BY 必须包含 DISTINCT ON 列（已满足），有注释说明意图 |
| I2 | ★★★★☆ | 校验逻辑正确。签名保留了 `p_user_id` 参数——虽然校验后使用 `p_user_id` 或 `auth.uid()` 等价，但 WHERE 子句仍引用 `p_user_id`（行 266）而非 `auth.uid()`，风格稍有偏差 |
| I3 | ★★★★★ | 语义完全恢复，与旧版一致 |
| I4 | ★★★★★ | 合并为一次 UPDATE + 恢复 status 过滤。额外验证了 `compute_recommendation_score` 不依赖 import_items 表 |

### 4.5 总体评价

**处理质量：高。** 3 项阻塞 bug 全部修正，4 项重要问题全部修正。修正后的 SQL 结构清晰，每个 Step 有明确注释，安全相关函数均有 auth.uid() 校验逻辑。未引入新的 bug。

额外验证了 `compute_recommendation_score` 函数确实不依赖 import_items 表（处理记录 I4 中已确认），消除了 Phase 4 清理旧表时的一个潜在隐患。

**实施准入判断**：migration SQL 现可安全执行。

---

## 五、执行反馈修正

> 日期：2026-07-11

### FIX1 · Step 5 执行时 FK 约束冲突

**实际执行错误**：
```
ERROR: 23503: insert or update on table "bookmarks" violates foreign key constraint "bookmarks_user_article_fk"
DETAIL: Key (user_id, article_id)=(3f0a83cd-..., imp_1781658615759_x8s97) is not present in table "articles".
```

**根因**：Step 5 将 `bookmark.article_id` 改为 `source_import_id`（即 import_items 的 ID），但 FK `bookmarks_user_article_fk` 仍指向 `articles` 表。articles 表中不存在 `imp_*` 前缀的 ID，FK 校验失败。

**修正**：新增 Step 4b——在 Step 5 之前先 DROP 旧 FK 约束，Step 7 只保留 ADD 新 FK 约束。调整后的 Step 顺序：

```
Step 4:  迁移 articles 数据
Step 4b: DROP 旧 FK 约束（bookmarks_user_article_fk / reading_marks_user_article_fk）
Step 5:  UPDATE bookmarks / reading_marks（无 FK 约束，安全）
Step 6:  DELETE 去重 reading_marks
Step 7:  ADD 新 FK 约束（bookmarks_user_reading_fk / reading_marks_user_reading_fk）
```

### FIX2 · Step 5 reading_marks PK 冲突

**实际执行错误**：
```
ERROR: 23505: duplicate key value violates unique constraint "reading_marks_pkey"
DETAIL: Key (user_id, article_id)=(..., imp_1781658615759_x8s97) already exists.
```

**根因**：同一用户对同一本书多次取书（多个 article → 同一个 `source_import_id`），每个 article 各有一条 reading_mark。Step 5 UPDATE 将它们全部改为同一个 `article_id`（source_import_id），PK `(user_id, article_id)` 冲突。Step 6 的 `DELETE` 在 Step 5 之后执行——但 PK 约束在 Step 5 UPDATE 时就已经触发。

**修正**：新增 Step 5a——在 Step 5 UPDATE 之前，按合并后的目标 key `(user_id, source_import_id)` 分组，每组仅保留 `updated_at` 最新的一条 reading_mark，删除其余的。Step 5 UPDATE 只面对去重后的唯一记录，不再触发 PK 冲突。Step 6 保留作为二次保险。调整后的 Step 顺序：

```
Step 5a: reading_marks 预去重（按 (user_id, source_import_id) 分组，保留最新的）
Step 5:  UPDATE bookmarks / reading_marks
Step 6:  DELETE 去重 reading_marks（二次保险）
```

