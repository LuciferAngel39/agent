# 房间出租后台

管理出租房间、租约、收费与合伙人分成的后台网站。

- 网址：https://customer-agent-admin-seven.vercel.app
- 前端：纯 HTML / CSS / JS，不需要打包（build）
- 数据库与登录：Supabase（项目 `customer-agent-admin`，新加坡区）
- 部署：Vercel，Root Directory = `customer-agent-admin`，push 到 `main` 自动上线

## 功能

| 页面 | 内容 |
| --- | --- |
| 概览 | 出租率、空房、本月实收 / 未收、合伙人应分、我的盈利、30 天内到期租约、逾期未收 |
| 房间 | 房号、位置、房型、默认月租 / 日租、合伙人与分成 %；批量新增、从 Excel 导入 |
| 租约 | 月租或日租，自动计算天数、剩余天数和合约总额；可同时建立第一笔租金和押金账单 |
| 收费 | 租金、押金、退押金、电费、水费、网络、清洁、迟交罚款、其他；一键收款；一键生成整月月租账单 |
| 开销 | 选填。维修、水电等，按房间或公共开销记录 |
| 月报表 | 每间房：应收、实收、未收、开销、净利、合伙人分、我的；合伙人汇总；导出 CSV |
| 租客 / 合伙人 / 代理 | 资料管理 |

## 计算方式

- **净利润**（每间房、每月）= 该月已收款项（不含押金 / 退押金）− 该房间该月开销
- **合伙人分** = 净利润 × 该房间的合伙人分成 %
- **我的盈利** = 所有房间的「我的」部分 − 公共开销
- 月份按每笔收费 / 开销的「归属月份」计算

## 权限

只有 `admins` 表里的邮箱登录后能看到和修改资料（数据库 RLS 规则控制）。
新增管理员：在 Supabase → SQL Editor 执行

```sql
insert into public.admins(email) values ('someone@example.com');
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
