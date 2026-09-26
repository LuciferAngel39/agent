// Supabase 连接设置。
// 这里用的是「publishable key」，本来就是公开给浏览器用的；
// 真正保护资料的是数据库里的 RLS 规则（只有 admins 表里的邮箱能读写）。
window.APP_CONFIG = {
  SUPABASE_URL: "https://jwmzzrlpyrmqpkaptmlp.supabase.co",
  SUPABASE_KEY: "sb_publishable_QhTQ03bAIZHL1wGWEkJ5_g_B7tqwRAP",
};
