---
name: deployment-collaboration
description: 生产部署协作模式 — 用户通知部署，Claude 负责指挥，用户执行命令
metadata:
  type: project
---

# 生产部署协作模式

**角色分工：**
- 用户（Kaven）：负责执行具体的 git 命令和操作
- Claude：负责检查状态、给出每步指令、验证结果、决策回滚方案

**触发方式：** 用户说"进行生产部署"或类似表述时，Claude 接手指挥。

**Why:** 用户希望把部署决策和流程管理交给 Claude，自己只做执行者。

**How to apply:** 
1. 先检查 git status、各分支位置、是否有未合并改动
2. 按部署手册的三阶段流程逐步给指令
3. 每步之后确认结果
4. 遇到异常时决策回滚方案
