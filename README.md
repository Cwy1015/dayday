# 备考局 · 公考学习控制台

一个无需构建工具的静态网页原型，适合直接部署到 GitHub Pages、Vercel、Netlify 或任意静态服务器。

## 本地运行

在项目目录执行：

```bash
python3 -m http.server 4173
```

然后访问 <http://127.0.0.1:4173>。

## 当前功能

- 今日完成度、正确率、本周刷题量和最弱项概览
- 能力走势和近 7 天 / 近 30 天切换入口
- 今日训练计划，勾选后自动计算完成度并保存到浏览器
- 错题复盘队列和错误类型分组
- 开始训练、能力分析、备考计划等导航视图
- 桌面端和移动端响应式布局

## 接入云端数据

1. 在 Supabase 项目的 SQL Editor 中执行 `supabase-schema.sql`。
2. `supabase-config.js` 已配置项目 URL 和 publishable key，网页会优先写入 `training_sessions`，失败时暂存到当前浏览器。
3. 当前表策略按登录用户隔离；接入正式环境前，建议在网页中增加 Supabase Auth 登录。
