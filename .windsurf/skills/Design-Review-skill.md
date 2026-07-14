Design Review Skill（DRS）—— 设计优化方案审核
目标（Objective）

审核的对象不是视觉效果，而是设计决策的质量。

判断一份设计优化分析报告与优化方案是否：

问题定义正确
推理过程完整
决策依据充分
方案能够解决问题
能够验证效果
能够沉淀长期价值

最终输出一份设计审核报告（Design Review Report）。

审核原则（Review Principles）

始终遵循以下原则：

证据优于观点（Evidence over Opinion）
问题优于方案（Problem before Solution）
逻辑优于审美（Reasoning before Preference）
系统优于局部（System over Page）
可验证优于主观评价（Validation over Assumption）

任何评价都必须能够说明：

为什么这样判断？

审核流程（Review Flow）

按照下面顺序审核。

任何一层存在重大问题，都不要继续评价视觉细节。

Phase 1：问题定义（Problem Definition）

审核内容：

是否真正定义了问题。

检查：

优化目标是否明确
问题是否具体
是否区分：
用户问题
业务问题
体验问题
品牌问题
技术限制

继续追问：

为什么认为这是问题？

依据是什么？

输出：

Problem Review

包括：

是否成立
是否缺少依据
是否存在错误定义
Phase 2：分析质量（Analysis Quality）

审核分析是否完整。

至少覆盖：

当前状态分析

当前设计是什么？

用户行为分析

用户实际如何使用？

根因分析

真正原因是什么？

有没有一直分析到 Root Cause？

约束分析

有哪些不能改变？

目标分析

到底想提升什么？

输出：

Analysis Review

指出：

分析是否完整。

哪里跳步。

哪里存在推断。

Phase 3：方案合理性（Solution Review）

逐项审核。

对于每一个设计修改，都回答：

它解决什么问题？

为什么这样解决？

有没有证据？

有没有副作用？

是否符合设计原则？

如果回答不了：

说明这是无依据修改。

输出：

Solution Mapping：

| 修改 | 对应问题 | 是否成立 | 风险 |

Phase 4：方案比较（Alternative Review）

审核：

有没有探索其他方案。

检查：

是否比较：

A

B

C

为什么不用其它方案？

为什么最终方案最好？

如果没有：

说明方案探索不足。

Phase 5：系统价值（System Review）

审核：

是否只是修改页面。

还是形成：

Pattern

Component

Design Token

Design Rule

Interaction Rule

Information Pattern

输出：

哪些可以进入：

Design System。

哪些只是一次性设计。

Phase 6：验证计划（Validation Review）

审核：

上线以后如何证明成功。

检查：

是否说明：

验证指标

观察周期

AB Test

用户测试

埋点

回滚方案

如果没有：

说明方案不可验证。

输出格式（Output Format）

审核结束后统一输出。

一、总体评价（Executive Summary）

一句话评价：

例如：

设计方向正确，但问题定义与方案论证不足，目前不建议直接进入实施阶段。

给出：

整体评分：

⭐⭐⭐⭐☆

二、分项审核（Section Review）

按照：

Problem

Analysis

Solution

Alternative

System

Validation

分别说明：

优点

问题

建议

三、关键问题（Critical Issues）

列出：

影响最大的几个问题。

例如：

P1：

没有找到真正 Root Cause。

P2：

方案无法证明有效。

P3：

没有考虑长期一致性。

四、优化建议（Recommendations）

按照：

High Priority

Medium

Low

排序。

只给真正影响决策的问题。

不要纠结像素级意见。

五、是否建议实施（Decision）

最后必须明确：

✅ 可以实施

⚠ 可以实施，但建议修改

❌ 不建议实施

并说明原因。

审核要求（Mandatory Rules）

审核过程中必须遵守：

不评价个人能力。
不讨论个人审美。
不使用"我喜欢""我觉得"等主观表达。
所有评价必须指出依据。
所有建议必须说明解决的问题。
不因为方案漂亮而降低审核标准。
优先发现逻辑问题，而非视觉细节。
优先保证设计决策正确，再讨论视觉表现。
核心审核思维（Mental Model）

整个审核过程始终围绕同一条设计决策链展开：

Evidence
    ↓
Problem
    ↓
Root Cause
    ↓
Goal
    ↓
Design Principles
    ↓
Alternative Exploration
    ↓
Final Decision
    ↓
Validation
    ↓
Knowledge / Design System

审核的任务不是判断"设计是否好看"，而是检查这条链是否完整、是否存在断裂，以及每一个设计决策能否追溯到充分的证据与明确的目标。