---
name: deployment-setup
description: ReadRead 项目部署架构 — 分支策略、Netlify 自动部署、域名映射
metadata:
  type: reference
---

# 部署架构

**分支流水线（push 即部署）：**
`feat/xxx` → PR → `develop` → `internal-test` → `master`（生产）

| Push 到 | Netlify 自动部署到 |
|---------|-------------------|
| `develop` | `develop--readread.netlify.app` |
| `internal-test` | `internal-test--readread.netlify.app` |
| `master` | 生产域名（Netlify Production） |

**Netlify 配置：**
- Production branch: `master`
- Branch deploys: `develop`, `internal-test`
- Deploy previews: PR 自动生成
- Functions 目录: `netlify/functions/`（4 个：translate, generate-recommendation, proxy, parse-epub）
- SPA 重定向在 `public/_redirects`（不在 netlify.toml）

**三个环境共用一个 Supabase 实例和同一套环境变量。**

**部署文档：** `Pre-docs/运维部署/02_生产部署手册.md`
