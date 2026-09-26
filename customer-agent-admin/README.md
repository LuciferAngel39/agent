# 客户代理后台

管理顾客与代理的后台网站：顾客资料、代理层级、名下业绩与预估佣金。

- 前端：纯 HTML / CSS / JS，不需要打包（build）
- 数据库与登录：Supabase（项目 `customer-agent-admin`，新加坡区）
- 部署：Vercel，Root Directory 设为 `customer-agent-admin`

## 权限

只有 `admins` 表里的邮箱登录后能看到和修改资料（数据库 RLS 规则控制）。
新增管理员：在 Supabase → SQL Editor 执行

```sql
insert into public.admins(email) values ('someone@example.com');
```

移除管理员：

```sql
delete from public.admins where email = 'someone@example.com';
```

## 文件

| 文件 | 用途 |
| --- | --- |
| `index.html` | 页面入口 |
| `styles.css` | 样式（自动跟随浅色 / 深色模式） |
| `app.js` | 登录、读写资料、页面逻辑 |
| `config.js` | Supabase 网址与 publishable key（公开 key，安全靠 RLS） |
| `vendor/` | supabase-js 浏览器版本 |
| `supabase/migrations/` | 数据库结构记录 |

## 本地预览

```bash
npx serve customer-agent-admin
```
