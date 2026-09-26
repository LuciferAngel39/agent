(function () {
"use strict";

/* =====================================================================
   房间出租后台 — Supabase + 纯前端
   ===================================================================== */

/* ---------------- 常量 ---------------- */
const CH = { rent: "租金", deposit: "押金", deposit_refund: "退押金", electricity: "电费", water: "水费", internet: "网络费", cleaning: "清洁费", late_fee: "迟交罚款", other: "其他" };
const NON_INCOME = new Set(["deposit", "deposit_refund"]);
const EXC = { repair: "维修", utilities: "水电", internet: "网络", cleaning: "清洁", furniture: "家具/设备", management: "管理费", other: "其他" };
const METHOD = { "": "—", cash: "现金", transfer: "银行转账", ewallet: "电子钱包", other: "其他" };
const RENT_TYPE = { monthly: "月租", daily: "日租" };
const LEASE_ST = { active: "进行中", ended: "已结束", cancelled: "已取消" };
const ROOM_ST = { ok: "正常", maintenance: "维修中" };
const TEN_ST = { lead: "潜在", active: "在租", dormant: "已退租", lost: "黑名单" };
const TEN_CLS = { lead: "s-lead", active: "s-active", dormant: "s-off", lost: "s-lost" };
const LEVELS = { master: "总代理", l1: "一级代理", l2: "二级代理" };
const AG_ST = { on: "启用", off: "停用" };
const STATE = {
  occupied: { t: "已出租", c: "s-active" },
  vacant:   { t: "空置",   c: "s-lead" },
  reserved: { t: "已预订", c: "s-dormant" },
  expired:  { t: "合约过期", c: "s-lost" },
  maint:    { t: "维修中", c: "s-off" },
};

const cfg = window.APP_CONFIG || {};
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);

/* ---------------- 状态 ---------------- */
const S = {
  screen: "loading", authMode: "login", authMsg: null, session: null,
  view: "overview", month: "", loaded: false, syncOk: true,
  d: { rooms: [], partners: [], customers: [], agents: [], leases: [], charges: [], expenses: [] },
  f: { rooms: { q: "", state: "", partner: "" }, leases: { q: "", status: "active", type: "" }, charges: { q: "", cat: "", paid: "", scope: "month" }, expenses: { q: "", cat: "" }, reports: { onlyActive: true }, tenants: { q: "", status: "" }, partners: { q: "" }, agents: { q: "" } },
  drawer: null,
};
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => Number(v) || 0;
const rm = n => (num(n) < 0 ? "−RM " : "RM ") + Math.abs(num(n)).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = n => String(n).padStart(2, "0");
const fmtD = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const today = () => fmtD(new Date());
const thisMonth = () => today().slice(0, 7);
const dayMs = 86400000;
const dDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / dayMs);
const monthStart = m => m + "-01";
const monthEnd = m => { const [y, mo] = m.split("-").map(Number); return fmtD(new Date(y, mo, 0)); };
const monthLabel = m => { const [y, mo] = m.split("-"); return y + " 年 " + Number(mo) + " 月"; };
S.month = thisMonth();
try { const v = localStorage.getItem("rent-view"); if (v) S.view = v; } catch (e) {}

/* ---------------- 索引 ---------------- */
let IX = {};
function buildIndex() {
  const by = arr => Object.fromEntries(arr.map(x => [x.id, x]));
  IX = { room: by(S.d.rooms), partner: by(S.d.partners), cust: by(S.d.customers), agent: by(S.d.agents), lease: by(S.d.leases), curLease: {}, roomLeases: {} };
  const t = today();
  for (const l of S.d.leases) {
    (IX.roomLeases[l.room_id] ||= []).push(l);
  }
  for (const [rid, ls] of Object.entries(IX.roomLeases)) {
    ls.sort((a, b) => (b.start_date || "").localeCompare(a.start_date || ""));
    const act = ls.filter(l => l.status === "active");
    IX.curLease[rid] = act.find(l => l.start_date <= t && (!l.end_date || l.end_date >= t)) || act.find(l => l.end_date && l.end_date < t) || act.find(l => l.start_date > t) || null;
  }
}
function roomState(r) {
  if (r.status === "maintenance") return "maint";
  const l = IX.curLease[r.id];
  if (!l) return "vacant";
  const t = today();
  if (l.start_date > t) return "reserved";
  if (l.end_date && l.end_date < t) return "expired";
  return "occupied";
}
const roomCode = id => IX.room[id]?.code || "—";
const custName = id => IX.cust[id]?.name || "";
function leaseDays(l) { return l.end_date ? dDiff(l.start_date, l.end_date) : null; }
function leaseLeft(l) { return l.end_date ? dDiff(today(), l.end_date) : null; }
function monthsBetween(a, b) {
  const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1); let days = d2 - d1;
  if (days < 0) { months -= 1; days += new Date(y2, m2 - 1, 0).getDate(); }
  return { months, days };
}
function leaseSpan(l) {
  if (!l.end_date) return "不定期";
  const d = leaseDays(l);
  if (l.rent_type === "daily") return d + " 天";
  const { months, days } = monthsBetween(l.start_date, l.end_date);
  return (months ? months + " 个月" : "") + (days ? (months ? " " : "") + days + " 天" : "") + ` (${d} 天)`;
}
function leaseTotal(l) {
  if (!l.end_date) return null;
  if (l.rent_type === "daily") return num(l.rent) * leaseDays(l);
  const { months, days } = monthsBetween(l.start_date, l.end_date);
  return num(l.rent) * months + num(l.rent) / 30 * days;
}

/* ---------------- 财务 ---------------- */
function finance(month) {
  const per = {};
  const get = id => (per[id] ||= { billed: 0, income: 0, unpaid: 0, deposit: 0, exp: 0 });
  for (const c of S.d.charges) {
    if (c.period !== month) continue;
    const f = get(c.room_id);
    if (NON_INCOME.has(c.category)) { f.deposit += (c.category === "deposit" ? 1 : -1) * num(c.amount); continue; }
    f.billed += num(c.amount);
    if (c.paid) f.income += num(c.amount); else f.unpaid += num(c.amount);
  }
  let general = 0;
  for (const e of S.d.expenses) {
    if (e.period !== month) continue;
    if (!e.room_id) { general += num(e.amount); continue; }
    get(e.room_id).exp += num(e.amount);
  }
  for (const [rid, f] of Object.entries(per)) {
    const r = IX.room[rid];
    f.net = f.income - f.exp;
    f.share = r && r.partner_id ? num(r.partner_share) : 0;
    f.partner = f.net * f.share / 100;
    f.mine = f.net - f.partner;
  }
  const tot = { billed: 0, income: 0, unpaid: 0, exp: 0, net: 0, partner: 0, mine: 0 };
  for (const f of Object.values(per)) for (const k of Object.keys(tot)) tot[k] += f[k] || 0;
  tot.general = general; tot.mineAfter = tot.mine - general;
  return { per, tot };
}

/* ---------------- 数据读写 ---------------- */
async function fetchAll(table, build) {
  const out = []; const page = 1000;
  for (let from = 0; ; from += page) {
    let q = sb.from(table).select("*");
    if (build) q = build(q);
    const { data, error } = await q.order("created_at", { ascending: true }).range(from, from + page - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < page) break;
  }
  return out;
}
let loading = null;
async function loadData() {
  if (loading) { loading.again = true; return; }
  loading = { again: false };
  try {
    const m = S.month;
    const [rooms, partners, customers, agents, leases, charges, expenses] = await Promise.all([
      fetchAll("rooms"), fetchAll("partners"), fetchAll("customers"), fetchAll("agents"), fetchAll("leases"),
      fetchAll("charges", q => q.or(`period.eq.${m},paid.eq.false`)),
      fetchAll("expenses", q => q.eq("period", m)),
    ]);
    Object.assign(S.d, { rooms, partners, customers, agents, leases, charges, expenses });
    S.loaded = true; S.syncOk = true; buildIndex();
  } catch (e) { console.error(e); S.syncOk = false; toast("读取资料失败：" + (e.message || "请刷新页面")); }
  const again = loading.again; loading = null;
  if (S.screen === "app") render();
  if (again) loadData();
}
let reloadTimer = null;
function scheduleReload() { clearTimeout(reloadTimer); reloadTimer = setTimeout(loadData, 400); }
let channel = null;
function subscribe() {
  if (channel) return;
  channel = sb.channel("rent-data");
  for (const t of ["rooms", "partners", "customers", "agents", "leases", "charges", "expenses"]) channel.on("postgres_changes", { event: "*", schema: "public", table: t }, scheduleReload);
  channel.subscribe(st => { if (st === "SUBSCRIBED") S.syncOk = true; else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT") S.syncOk = false; renderSync(); });
}
function unsubscribe() { if (channel) { sb.removeChannel(channel); channel = null; } }
function dbError(e) {
  const m = (e && e.message) || "", code = e && e.code;
  if (code === "23505") return "这个房号已经存在。";
  if (code === "23503") return "还有租约或收费记录连着它，不能删除。房间可以改成「维修中」代替删除。";
  if (code === "23514") return "有栏位的数值不符合要求（例如金额不能是负数、结束日期不能早于开始日期）。";
  if (/JWT|not authenticated/i.test(m)) return "登录已过期，请重新登录。";
  if (/row-level security/i.test(m)) return "你的账号没有修改权限。";
  return "操作失败：" + m;
}
function toast(msg) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

/* =====================================================================
   实体定义（表单栏位）
   ===================================================================== */
const opt = o => Object.entries(o).map(([v, t]) => ({ v, t }));
const refOpts = {
  rooms: () => [...S.d.rooms].sort((a, b) => a.code.localeCompare(b.code, "zh", { numeric: true })).map(r => ({ v: r.id, t: r.code + (r.location ? " · " + r.location : "") })),
  partners: () => S.d.partners.map(p => ({ v: p.id, t: p.name })),
  customers: () => [...S.d.customers].sort((a, b) => a.name.localeCompare(b.name, "zh")).map(c => ({ v: c.id, t: c.name + (c.phone ? " · " + c.phone : "") })),
  agents: () => S.d.agents.map(a => ({ v: a.id, t: a.name })),
};
const ENT = {
  rooms: { title: "房间", table: "rooms", fields: [
    { k: "code", l: "房号 *", t: "text", req: true, ph: "如 A-101" },
    { k: "status", l: "状态", t: "select", o: opt(ROOM_ST), def: "ok" },
    { k: "location", l: "位置 / 地址", t: "text", full: true, ph: "如 Jalan Ampang 12 号 3 楼" },
    { k: "room_type", l: "房型", t: "text", ph: "如 主人房 / 中房 / 小房" },
    { k: "monthly_rent", l: "默认月租 (RM)", t: "number", def: 0 },
    { k: "daily_rent", l: "默认日租 (RM)", t: "number", def: 0 },
    { k: "partner_id", l: "合伙人", t: "ref", ref: "partners", empty: "无（全归自己）" },
    { k: "partner_share", l: "合伙人分成 (%)", t: "number", def: 30, min: 0, max: 100, step: 1, hint: "通常 25–50" },
    { k: "notes", l: "备注", t: "textarea", full: true },
  ] },
  partners: { title: "合伙人", table: "partners", fields: [
    { k: "name", l: "名称 *", t: "text", req: true },
    { k: "phone", l: "电话", t: "text", ph: "+60 12-345 6789" },
    { k: "bank_info", l: "银行资料（转账分成用）", t: "text", full: true, ph: "如 Maybank 1234 5678 9012" },
    { k: "notes", l: "备注", t: "textarea", full: true },
  ] },
  customers: { title: "租客", table: "customers", fields: [
    { k: "name", l: "姓名 *", t: "text", req: true },
    { k: "phone", l: "电话", t: "text", ph: "+60 12-345 6789" },
    { k: "contact", l: "WhatsApp / 微信", t: "text" },
    { k: "id_no", l: "IC / 护照号码", t: "text" },
    { k: "agent_id", l: "介绍代理", t: "ref", ref: "agents", empty: "无" },
    { k: "status", l: "状态", t: "select", o: opt(TEN_ST), def: "active" },
    { k: "joined", l: "登记日期", t: "date", def: () => today() },
    { k: "notes", l: "备注", t: "textarea", full: true },
  ] },
  agents: { title: "代理", table: "agents", fields: [
    { k: "name", l: "姓名 *", t: "text", req: true },
    { k: "phone", l: "电话", t: "text" },
    { k: "level", l: "等级", t: "select", o: opt(LEVELS), def: "l1" },
    { k: "parent_id", l: "上级代理", t: "ref", ref: "agents", empty: "无", notSelf: true },
    { k: "region", l: "区域", t: "text" },
    { k: "rate", l: "佣金比例 (%)", t: "number", def: 10, min: 0, max: 100, step: 0.5 },
    { k: "status", l: "状态", t: "select", o: opt(AG_ST), def: "on" },
    { k: "joined", l: "加入日期", t: "date", def: () => today() },
    { k: "notes", l: "备注", t: "textarea", full: true },
  ] },
  leases: { title: "租约", table: "leases", fields: [
    { k: "room_id", l: "房间 *", t: "ref", ref: "rooms", req: true },
    { k: "tenant_id", l: "租客", t: "ref", ref: "customers", empty: "未选择" },
    { k: "rent_type", l: "收租方式", t: "select", o: opt(RENT_TYPE), def: "monthly" },
    { k: "rent", l: "租金 (RM / 月或天)", t: "number", def: 0 },
    { k: "start_date", l: "开始日期 *", t: "date", req: true, def: () => today() },
    { k: "end_date", l: "结束日期", t: "date" },
    { k: "deposit", l: "押金 (RM)", t: "number", def: 0 },
    { k: "status", l: "状态", t: "select", o: opt(LEASE_ST), def: "active" },
    { k: "notes", l: "备注", t: "textarea", full: true },
  ] },
  charges: { title: "收费", table: "charges", fields: [
    { k: "room_id", l: "房间 *", t: "ref", ref: "rooms", req: true },
    { k: "category", l: "项目", t: "select", o: opt(CH), def: "rent" },
    { k: "amount", l: "金额 (RM) *", t: "number", req: true, def: "" },
    { k: "period", l: "归属月份 *", t: "month", req: true, def: () => S.month },
    { k: "tenant_id", l: "租客", t: "ref", ref: "customers", empty: "未选择" },
    { k: "due_date", l: "应付日期", t: "date" },
    { k: "paid", l: "已收款", t: "checkbox", def: false },
    { k: "paid_date", l: "收款日期", t: "date" },
    { k: "method", l: "收款方式", t: "select", o: opt(METHOD), def: "" },
    { k: "notes", l: "备注", t: "textarea", full: true },
  ] },
  expenses: { title: "开销", table: "expenses", fields: [
    { k: "room_id", l: "房间", t: "ref", ref: "rooms", empty: "公共开销（不属于某间房）" },
    { k: "category", l: "类别", t: "select", o: opt(EXC), def: "repair" },
    { k: "amount", l: "金额 (RM) *", t: "number", req: true, def: "" },
    { k: "period", l: "归属月份 *", t: "month", req: true, def: () => S.month },
    { k: "expense_date", l: "日期", t: "date", def: () => today() },
    { k: "notes", l: "备注", t: "textarea", full: true },
  ] },
};

function fieldHtml(f, v, row) {
  const id = "f-" + f.k, val = v ?? "";
  let inp;
  if (f.t === "select") inp = `<select class="f" id="${id}" name="${f.k}">${f.o.map(o => `<option value="${esc(o.v)}" ${String(val) === o.v ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select>`;
  else if (f.t === "ref") {
    const os = refOpts[f.ref]().filter(o => !(f.notSelf && row && o.v === row.id));
    inp = `<select class="f" id="${id}" name="${f.k}" ${f.req ? "required" : ""}>${f.req ? `<option value="">请选择</option>` : `<option value="">${esc(f.empty || "无")}</option>`}${os.map(o => `<option value="${esc(o.v)}" ${val === o.v ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select>`;
  }
  else if (f.t === "textarea") inp = `<textarea class="f" id="${id}" name="${f.k}" rows="3">${esc(val)}</textarea>`;
  else if (f.t === "checkbox") inp = `<label class="chk"><input type="checkbox" id="${id}" name="${f.k}" ${val ? "checked" : ""}> ${esc(f.l)}</label>`;
  else inp = `<input class="f ${f.t === "number" ? "num" : ""}" id="${id}" name="${f.k}" type="${f.t}" value="${esc(val)}" ${f.req ? "required" : ""} ${f.ph ? `placeholder="${esc(f.ph)}"` : ""} ${f.t === "number" ? `min="${f.min ?? 0}" ${f.max != null ? `max="${f.max}"` : ""} step="${f.step ?? 0.01}"` : ""}>`;
  if (f.t === "checkbox") return `<div class="field ${f.full ? "full" : ""}"><span class="lbl-sp">&nbsp;</span>${inp}</div>`;
  return `<div class="field ${f.full ? "full" : ""}"><label for="${id}">${esc(f.l)}</label>${inp}${f.hint ? `<small class="hint">${esc(f.hint)}</small>` : ""}</div>`;
}
function defaults(ent) {
  const o = {};
  for (const f of ENT[ent].fields) o[f.k] = typeof f.def === "function" ? f.def() : (f.def ?? (f.t === "number" ? 0 : ""));
  return o;
}
function readEntity(ent) {
  const form = $("#frm"), o = {};
  for (const f of ENT[ent].fields) {
    const el = form.elements[f.k]; if (!el) continue;
    if (f.t === "checkbox") o[f.k] = el.checked;
    else if (f.t === "number") o[f.k] = el.value === "" ? (f.req ? null : 0) : Number(el.value);
    else if (f.t === "ref" || f.t === "date") o[f.k] = el.value || null;
    else o[f.k] = el.value.trim();
  }
  return o;
}
function validate(ent, o) {
  for (const f of ENT[ent].fields) if (f.req && (o[f.k] == null || o[f.k] === "")) return "请填写「" + f.l.replace(" *", "").replace(/ \(.+\)/, "") + "」";
  if (ent === "leases" && o.end_date && o.end_date < o.start_date) return "结束日期不能早于开始日期";
  if (ent === "rooms" && (o.partner_share < 0 || o.partner_share > 100)) return "分成比例要在 0–100 之间";
  if ((ent === "charges" || ent === "expenses") && !(o.amount >= 0)) return "请填写金额";
  return "";
}

/* =====================================================================
   登录
   ===================================================================== */
async function onSession(session) {
  S.session = session;
  if (!session) { unsubscribe(); S.loaded = false; S.screen = "auth"; render(); return; }
  if (S.screen === "recovery") { render(); return; }
  const { data, error } = await sb.rpc("is_admin");
  if (error || !data) { S.screen = "noaccess"; render(); return; }
  S.screen = "app"; render();
  await loadData(); subscribe();
}
sb.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY") { S.session = session; S.screen = "recovery"; render(); return; }
  if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "INITIAL_SESSION") setTimeout(() => onSession(session), 0);
});
function authError(e) {
  const m = (e && e.message) || "";
  if (/Invalid login credentials/i.test(m)) return "邮箱或密码不正确。";
  if (/Email not confirmed/i.test(m)) return "邮箱还没确认，请先到邮箱点确认链接。";
  if (/already registered/i.test(m)) return "这个邮箱已经注册过，请直接登录。";
  if (/Password should be/i.test(m)) return "密码至少需要 6 位。";
  if (/rate limit/i.test(m)) return "操作太频繁，请稍后再试。";
  return "出错了：" + m;
}
const brandHtml = `<div class="brand"><div class="brand-mark">租</div><div><b>房间出租后台</b><small>房间 · 租约 · 分成</small></div></div>`;
function viewAuth() {
  const m = S.authMode, msg = S.authMsg;
  return `<div class="auth"><form class="auth-card" id="auth-form" novalidate>
    ${brandHtml.replace('class="brand"', 'class="brand" style="padding:0"')}
    ${m === "forgot" ? `<h1>重设密码</h1><p>输入注册邮箱，我们会寄一封重设密码的邮件给你。</p>` :
      `<div class="auth-tabs"><button type="button" data-auth="login" aria-pressed="${m === "login"}">登录</button><button type="button" data-auth="signup" aria-pressed="${m === "signup"}">注册</button></div>`}
    <div class="field"><label for="a-email">邮箱</label><input class="f" id="a-email" type="email" autocomplete="email" required></div>
    ${m !== "forgot" ? `<div class="field"><label for="a-pass">密码${m === "signup" ? "（至少 6 位）" : ""}</label><input class="f" id="a-pass" type="password" autocomplete="${m === "signup" ? "new-password" : "current-password"}" required minlength="6"></div>` : ""}
    ${msg ? `<div class="msg ${msg.ok ? "ok" : "bad"}">${esc(msg.text)}</div>` : ""}
    <button class="btn primary" type="submit" id="a-submit">${m === "login" ? "登录" : m === "signup" ? "注册账号" : "寄出重设邮件"}</button>
    ${m === "login" ? `<button type="button" class="link" data-auth="forgot">忘记密码？</button>` : ""}
    ${m === "forgot" ? `<button type="button" class="link" data-auth="login">返回登录</button>` : ""}
    ${m === "signup" ? `<p>只有管理员名单里的邮箱才能看到资料。</p>` : ""}
  </form></div>`;
}
async function submitAuth() {
  const email = $("#a-email").value.trim(), pass = $("#a-pass")?.value || "";
  if (!email) { S.authMsg = { ok: false, text: "请输入邮箱。" }; render(); return; }
  $("#a-submit").disabled = true;
  try {
    if (S.authMode === "login") {
      const { error } = await sb.auth.signInWithPassword({ email, password: pass }); if (error) throw error; S.authMsg = null;
    } else if (S.authMode === "signup") {
      const { data, error } = await sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: location.origin } });
      if (error) throw error;
      if (!data.session) { S.authMode = "login"; S.authMsg = { ok: true, text: "注册成功！如果收到确认邮件请先点确认，然后回来登录。" }; render(); }
    } else {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin }); if (error) throw error;
      S.authMsg = { ok: true, text: "已寄出，请查看邮箱。" }; render();
    }
  } catch (e) { S.authMsg = { ok: false, text: authError(e) }; render(); const em = $("#a-email"); if (em) em.value = email; }
  finally { const b = $("#a-submit"); if (b) b.disabled = false; }
}

/* =====================================================================
   外壳 & 路由
   ===================================================================== */
const ICON = {
  overview: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  rooms: '<path d="M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16"/><path d="M2 21h20"/><circle cx="15" cy="12" r="1"/>',
  leases: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  charges: '<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20M6 15h4"/>',
  expenses: '<path d="M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6"/>',
  reports: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  tenants: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.8a3.3 3.3 0 0 1 0 6.4M18 14.8c1.8.7 3 2.4 3.5 5.2"/>',
  partners: '<path d="M8 12l2.5 2.5a1.5 1.5 0 0 0 2 0L17 10"/><path d="M3 8l4-3 4 2 4-2 4 3 2 5-4 4H7l-4-4z"/>',
  agents: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M12 7.5v4M12 11.5l-6 4M12 11.5l6 4"/>',
};
const NAV = [["overview", "概览"], ["rooms", "房间"], ["leases", "租约"], ["charges", "收费"], ["expenses", "开销"], ["reports", "月报表"], ["tenants", "租客"], ["partners", "合伙人"], ["agents", "代理"]];
function shell() {
  return `<div class="app">
  <aside class="side">
    ${brandHtml}
    <nav class="nav" id="nav">${NAV.map(([k, t]) => `<button data-view="${k}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg><span>${t}</span><span class="count" id="cnt-${k}"></span></button>`).join("")}
      <button class="logout-m" data-act="logout" aria-label="退出登录"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/></svg><span>退出</span></button>
    </nav>
    <div class="side-user"><span>${esc(S.session?.user?.email)}</span><button class="link" style="text-align:left" data-act="logout">退出登录</button></div>
    <div class="side-foot"><span class="dot" id="sync-dot"></span><span id="sync-txt">连接中…</span></div>
  </aside>
  <main id="main"></main>
</div>`;
}
function renderSync() { const d = $("#sync-dot"), t = $("#sync-txt"); if (!d) return; d.classList.toggle("off", !S.syncOk); t.textContent = S.syncOk ? "已同步" : "连接中断，请刷新"; }
const VIEWS = {};
function render() {
  const root = $("#root");
  if (S.screen === "loading") { root.innerHTML = `<div class="auth"><p style="color:var(--muted)">载入中…</p></div>`; return; }
  if (S.screen === "auth") { root.innerHTML = viewAuth(); $("#layer").innerHTML = ""; return; }
  if (S.screen === "recovery") { root.innerHTML = `<div class="auth"><form class="auth-card" id="recovery-form"><h1>设置新密码</h1><div class="field"><label for="r-pass">新密码（至少 6 位）</label><input class="f" id="r-pass" type="password" autocomplete="new-password" required minlength="6"></div>${S.authMsg ? `<div class="msg ${S.authMsg.ok ? "ok" : "bad"}">${esc(S.authMsg.text)}</div>` : ""}<button class="btn primary" type="submit">保存新密码</button></form></div>`; return; }
  if (S.screen === "noaccess") { root.innerHTML = `<div class="auth"><div class="auth-card"><h1>此账号没有权限</h1><p>你已用 <b>${esc(S.session?.user?.email)}</b> 登录，但这个邮箱不在管理员名单里。请联系后台负责人把你的邮箱加进去。</p><button class="btn" data-act="logout">换个账号登录</button></div></div>`; return; }
  if (!$(".app", root)) root.innerHTML = shell();
  document.querySelectorAll("#nav button[data-view]").forEach(b => b.setAttribute("aria-current", b.dataset.view === S.view ? "page" : "false"));
  const cnt = { rooms: S.d.rooms.length, leases: S.d.leases.filter(l => l.status === "active").length, tenants: S.d.customers.length, partners: S.d.partners.length, agents: S.d.agents.length };
  for (const [k] of NAV) { const el = $("#cnt-" + k); if (el) el.textContent = cnt[k] ?? ""; }
  renderSync();
  const m = $("#main");
  m.innerHTML = S.loaded ? VIEWS[S.view]() : `<div class="empty">载入资料中…</div>`;
  if (!S.drawer) $("#layer").innerHTML = "";
}
/* 保留搜索框焦点的重绘 */
function rerenderKeep(id) {
  const el = $("#" + id); const pos = el ? el.selectionStart : null;
  render();
  const n = $("#" + id); if (n && pos != null) { n.focus(); n.setSelectionRange(pos, pos); }
}

/* ---------------- 小组件 ---------------- */
const monthPicker = () => `<label class="month-pick"><span>月份</span><input type="month" id="month" value="${S.month}"></label>`;
const head = (title, sub, actions = "", withMonth = false) => `<div class="head"><div><h1>${title}</h1><p>${sub}</p></div><div class="head-act">${withMonth ? monthPicker() : ""}${actions}</div></div>`;
const searchBox = (id, val, ph) => `<label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="${id}" data-filter="${id}" placeholder="${ph}" value="${esc(val)}"></label>`;
const sel = (id, val, opts, all) => `<select class="f" id="${id}" data-filter="${id}" aria-label="${esc(all)}"><option value="">${esc(all)}</option>${opts.map(o => `<option value="${esc(o.v)}" ${val === o.v ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select>`;
const pill = (t, c) => `<span class="pill ${c}">${esc(t)}</span>`;
const kpi = (label, value, sub = "", tone = "") => `<div class="kpi"><span>${label}</span><b class="${tone}">${value}</b><small>${sub}</small></div>`;
const table = (heads, rows, emptyText, cols) => `<div class="tbl-wrap"><table><thead><tr>${heads.map(h => `<th class="${h[1] || ""}">${h[0]}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${cols || heads.length}" class="empty">${emptyText}</td></tr>`}</tbody></table></div>`;
const MAX_ROWS = 300;
function capRows(list, render) {
  const shown = list.slice(0, MAX_ROWS).map(render);
  return { rows: shown, note: list.length > MAX_ROWS ? `只显示前 ${MAX_ROWS} 条，请用搜索或筛选缩小范围` : "" };
}
const leftBadge = l => {
  const left = leaseLeft(l);
  if (left == null) return `<span class="muted">不定期</span>`;
  if (l.status !== "active") return `<span class="muted">—</span>`;
  if (left < 0) return `<span class="overdue">已过 ${-left} 天</span>`;
  if (left <= 30) return `<span class="warn-t">剩 ${left} 天</span>`;
  return `<span class="num">剩 ${left} 天</span>`;
};

/* =====================================================================
   概览
   ===================================================================== */
VIEWS.overview = () => {
  const rooms = S.d.rooms, st = { occupied: 0, vacant: 0, reserved: 0, expired: 0, maint: 0 };
  for (const r of rooms) st[roomState(r)]++;
  const rentable = rooms.length - st.maint;
  const occ = rentable ? (st.occupied + st.expired) / rentable * 100 : 0;
  const { tot } = finance(S.month);
  const t = today();
  const expiring = S.d.leases.filter(l => l.status === "active" && l.end_date && l.end_date >= t && dDiff(t, l.end_date) <= 30).sort((a, b) => a.end_date.localeCompare(b.end_date));
  const expired = S.d.leases.filter(l => l.status === "active" && l.end_date && l.end_date < t).sort((a, b) => a.end_date.localeCompare(b.end_date));
  const overdue = S.d.charges.filter(c => !c.paid && (c.due_date ? c.due_date < t : c.period < thisMonth())).sort((a, b) => (a.due_date || a.period).localeCompare(b.due_date || b.period));
  const overdueSum = overdue.reduce((s, c) => s + (c.category === "deposit_refund" ? 0 : num(c.amount)), 0);
  const leaseRow = l => `<tr data-open="leases:${esc(l.id)}"><td><b>${esc(roomCode(l.room_id))}</b></td><td>${esc(custName(l.tenant_id) || "—")}</td><td class="num">${esc(l.end_date)}</td><td>${leftBadge(l)}</td></tr>`;
  return head("概览", `${monthLabel(S.month)} · 共 ${rooms.length} 间房`, `<button class="btn" data-act="new:charges">记一笔收费</button><button class="btn primary" data-act="new:leases">＋ 新租约</button>`, true) + `
  <div class="kpis">
    ${kpi("房间", rooms.length, `可出租 ${rentable} · 维修 ${st.maint}`)}
    ${kpi("出租率", occ.toFixed(1) + "%", `已出租 ${st.occupied + st.expired} · 预订 ${st.reserved}`)}
    ${kpi("空置", st.vacant, st.vacant ? `<button class="link" data-goto="rooms" data-set="rooms.state=vacant">查看空房</button>` : "全部租出")}
    ${kpi("合约已过期未处理", expired.length, "需要续约或结束", expired.length ? "bad-t" : "")}
  </div>
  <div class="kpis">
    ${kpi(`${S.month.slice(5)} 月实收`, rm(tot.income), `应收 ${rm(tot.billed)}`)}
    ${kpi(`${S.month.slice(5)} 月未收`, rm(tot.unpaid), "本月账单中未付的", tot.unpaid ? "bad-t" : "")}
    ${kpi("合伙人应分", rm(tot.partner), `房间开销 ${rm(tot.exp)}`)}
    ${kpi("我的盈利", rm(tot.mineAfter), `已扣公共开销 ${rm(tot.general)}`, tot.mineAfter < 0 ? "bad-t" : "good-t")}
  </div>
  <div class="grid2">
    <section class="panel"><h2>30 天内到期 <small>${expiring.length} 份</small></h2>
      ${expiring.length ? table([["房号"], ["租客"], ["结束"], ["剩余"]], expiring.slice(0, 10).map(leaseRow)) : `<div class="empty">30 天内没有到期的租约</div>`}</section>
    <section class="panel"><h2>逾期未收 <small>${overdue.length} 笔 · ${rm(overdueSum)}</small></h2>
      ${overdue.length ? table([["房号"], ["项目"], ["月份"], ["金额", "r"]], overdue.slice(0, 10).map(c => `<tr data-open="charges:${esc(c.id)}"><td><b>${esc(roomCode(c.room_id))}</b> <span class="muted">${esc(custName(c.tenant_id))}</span></td><td>${esc(CH[c.category])}</td><td class="num">${esc(c.period)}</td><td class="r num">${rm(c.amount)}</td></tr>`)) : `<div class="empty">没有逾期未收的款项</div>`}</section>
  </div>
  ${expired.length ? `<section class="panel" style="margin-top:16px"><h2>合约已过期但仍是「进行中」 <small>请续约或结束</small></h2>${table([["房号"], ["租客"], ["结束"], ["状态"]], expired.slice(0, 10).map(leaseRow))}</section>` : ""}
  ${rooms.length ? "" : `<section class="panel" style="margin-top:16px"><div class="panel-body onboard"><b>开始使用</b><p>先建立房间：可以用「批量新增」一次建好整排房号，或从 Excel 复制贴上导入。</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-act="bulk-rooms">批量新增房间</button><button class="btn" data-act="import-rooms">从 Excel 导入</button></div></div></section>`}`;
};

/* =====================================================================
   房间
   ===================================================================== */
function filteredRooms() {
  const f = S.f.rooms, q = f.q.trim().toLowerCase();
  return S.d.rooms.filter(r => {
    if (f.state && roomState(r) !== f.state) return false;
    if (f.partner === "__none" && r.partner_id) return false;
    if (f.partner && f.partner !== "__none" && r.partner_id !== f.partner) return false;
    if (q) { const l = IX.curLease[r.id]; if (![r.code, r.location, r.room_type, r.notes, l && custName(l.tenant_id)].some(v => (v || "").toLowerCase().includes(q))) return false; }
    return true;
  }).sort((a, b) => a.code.localeCompare(b.code, "zh", { numeric: true }));
}
VIEWS.rooms = () => {
  const f = S.f.rooms, list = filteredRooms(), fin = finance(S.month).per;
  const { rows, note } = capRows(list, r => {
    const s = roomState(r), l = IX.curLease[r.id], p = IX.partner[r.partner_id], fi = fin[r.id];
    return `<tr data-open="rooms:${esc(r.id)}"><td class="who"><b>${esc(r.code)}</b><small>${esc([r.location, r.room_type].filter(Boolean).join(" · "))}</small></td>
    <td>${pill(STATE[s].t, STATE[s].c)}</td>
    <td>${l ? esc(custName(l.tenant_id) || "未填租客") : `<span class="muted">—</span>`}</td>
    <td>${l ? leftBadge(l) : `<span class="muted">—</span>`}</td>
    <td class="r num">${l ? rm(l.rent) + `<span class="muted">/${l.rent_type === "daily" ? "天" : "月"}</span>` : rm(r.monthly_rent) + `<span class="muted">/月</span>`}</td>
    <td>${p ? esc(p.name) + ` <span class="muted num">${num(r.partner_share)}%</span>` : `<span class="muted">—</span>`}</td>
    <td class="r num ${fi && fi.net < 0 ? "bad-t" : ""}">${fi ? rm(fi.net) : `<span class="muted">—</span>`}</td></tr>`;
  });
  return head("房间", `共 ${S.d.rooms.length} 间 · 净利按 ${monthLabel(S.month)} 计算`, `<button class="btn" data-act="export-rooms">导出</button><button class="btn" data-act="import-rooms">导入</button><button class="btn" data-act="bulk-rooms">批量新增</button><button class="btn primary" data-act="new:rooms">＋ 新增房间</button>`, true) + `
  <div class="toolbar">${searchBox("rooms.q", f.q, "搜索房号、位置、租客")}
    ${sel("rooms.state", f.state, Object.entries(STATE).map(([v, o]) => ({ v, t: o.t })), "全部状态")}
    ${sel("rooms.partner", f.partner, [{ v: "__none", t: "无合伙人" }, ...refOpts.partners()], "全部合伙人")}</div>
  ${table([["房号"], ["状态"], ["租客"], ["到期"], ["租金", "r"], ["合伙人"], ["本月净利", "r"]], rows, S.d.rooms.length ? "没有符合条件的房间" : "还没有房间，点右上角「批量新增」")}
  <div class="foot-note"><span>显示 ${list.length} / ${S.d.rooms.length} 间 ${note ? "· " + note : ""}</span></div>`;
};

/* =====================================================================
   租约
   ===================================================================== */
function filteredLeases() {
  const f = S.f.leases, q = f.q.trim().toLowerCase(), t = today();
  return S.d.leases.filter(l => {
    if (f.status === "expiring") { if (!(l.status === "active" && l.end_date && dDiff(t, l.end_date) <= 30)) return false; }
    else if (f.status && l.status !== f.status) return false;
    if (f.type && l.rent_type !== f.type) return false;
    if (q && ![roomCode(l.room_id), custName(l.tenant_id), l.notes].some(v => (v || "").toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => (a.end_date || "9999").localeCompare(b.end_date || "9999"));
}
VIEWS.leases = () => {
  const f = S.f.leases, list = filteredLeases();
  const { rows, note } = capRows(list, l => `<tr data-open="leases:${esc(l.id)}"><td><b>${esc(roomCode(l.room_id))}</b></td><td>${esc(custName(l.tenant_id) || "—")}</td>
    <td><span class="lvl">${RENT_TYPE[l.rent_type]}</span></td><td class="r num">${rm(l.rent)}</td>
    <td class="num">${esc(l.start_date)}</td><td class="num">${esc(l.end_date || "—")}</td><td class="num">${esc(leaseSpan(l))}</td>
    <td>${l.status === "active" ? leftBadge(l) : pill(LEASE_ST[l.status], l.status === "ended" ? "s-off" : "s-lost")}</td></tr>`);
  return head("租约", `进行中 ${S.d.leases.filter(l => l.status === "active").length} 份 · 共 ${S.d.leases.length} 份`, `<button class="btn" data-act="export-leases">导出</button><button class="btn primary" data-act="new:leases">＋ 新租约</button>`) + `
  <div class="toolbar">${searchBox("leases.q", f.q, "搜索房号、租客")}
    ${sel("leases.status", f.status, [{ v: "active", t: "进行中" }, { v: "expiring", t: "30 天内到期 / 已过期" }, { v: "ended", t: "已结束" }, { v: "cancelled", t: "已取消" }], "全部状态")}
    ${sel("leases.type", f.type, opt(RENT_TYPE), "月租和日租")}</div>
  ${table([["房号"], ["租客"], ["方式"], ["租金", "r"], ["开始"], ["结束"], ["天数"], ["状态"]], rows, "没有符合条件的租约")}
  <div class="foot-note"><span>显示 ${list.length} 份 ${note ? "· " + note : ""}</span></div>`;
};

/* =====================================================================
   收费
   ===================================================================== */
function filteredCharges() {
  const f = S.f.charges, q = f.q.trim().toLowerCase();
  return S.d.charges.filter(c => {
    if (f.scope === "month" && c.period !== S.month) return false;
    if (f.scope === "unpaid" && c.paid) return false;
    if (f.cat && c.category !== f.cat) return false;
    if (f.paid === "paid" && !c.paid) return false;
    if (f.paid === "unpaid" && c.paid) return false;
    if (q && ![roomCode(c.room_id), custName(c.tenant_id), c.notes].some(v => (v || "").toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => b.period.localeCompare(a.period) || roomCode(a.room_id).localeCompare(roomCode(b.room_id), "zh", { numeric: true }));
}
VIEWS.charges = () => {
  const f = S.f.charges, list = filteredCharges();
  let paid = 0, unpaid = 0;
  for (const c of list) { if (NON_INCOME.has(c.category)) continue; if (c.paid) paid += num(c.amount); else unpaid += num(c.amount); }
  const { rows, note } = capRows(list, c => `<tr data-open="charges:${esc(c.id)}"><td class="who"><b>${esc(roomCode(c.room_id))}</b><small>${esc(custName(c.tenant_id))}</small></td>
    <td>${esc(CH[c.category])}${NON_INCOME.has(c.category) ? ` <span class="muted">(不计收入)</span>` : ""}</td><td class="num">${esc(c.period)}</td><td class="num">${esc(c.due_date || "—")}</td>
    <td class="r num">${c.category === "deposit_refund" ? "−" : ""}${rm(c.amount)}</td>
    <td>${c.paid ? pill("已收", "s-active") + ` <span class="muted num">${esc(c.paid_date || "")}</span>` : `${pill("未收", "s-lost")} <button class="btn sm" data-act="pay:${esc(c.id)}">收款</button>`}</td></tr>`);
  return head("收费", "租金、押金和向租客收的各种杂费", `<button class="btn" data-act="export-charges">导出</button><button class="btn" data-act="gen-rent">生成月租账单</button><button class="btn primary" data-act="new:charges">＋ 新增收费</button>`, true) + `
  <div class="toolbar">${searchBox("charges.q", f.q, "搜索房号、租客、备注")}
    <select class="f" id="charges.scope" data-filter="charges.scope" aria-label="范围"><option value="month" ${f.scope === "month" ? "selected" : ""}>${monthLabel(S.month)}</option><option value="unpaid" ${f.scope === "unpaid" ? "selected" : ""}>所有未收（不分月份）</option></select>
    ${sel("charges.cat", f.cat, opt(CH), "全部项目")}
    ${sel("charges.paid", f.paid, [{ v: "paid", t: "已收" }, { v: "unpaid", t: "未收" }], "已收和未收")}</div>
  ${table([["房号 / 租客"], ["项目"], ["月份"], ["应付日期"], ["金额", "r"], ["状态"]], rows, "没有收费记录")}
  <div class="foot-note"><span>${list.length} 笔 ${note ? "· " + note : ""}</span><span>已收 <b class="num">${rm(paid)}</b> · 未收 <b class="num bad-t">${rm(unpaid)}</b> <span class="muted">(不含押金)</span></span></div>`;
};

/* =====================================================================
   开销
   ===================================================================== */
VIEWS.expenses = () => {
  const f = S.f.expenses, q = f.q.trim().toLowerCase();
  const list = S.d.expenses.filter(e => e.period === S.month && (!f.cat || e.category === f.cat) && (!q || [e.room_id ? roomCode(e.room_id) : "公共", e.notes].some(v => (v || "").toLowerCase().includes(q))))
    .sort((a, b) => (b.expense_date || "").localeCompare(a.expense_date || ""));
  const sum = list.reduce((s, e) => s + num(e.amount), 0);
  const rows = list.map(e => `<tr data-open="expenses:${esc(e.id)}"><td class="num">${esc(e.expense_date || "—")}</td><td><b>${e.room_id ? esc(roomCode(e.room_id)) : `<span class="muted">公共开销</span>`}</b></td><td>${esc(EXC[e.category])}</td><td>${esc(e.notes)}</td><td class="r num">${rm(e.amount)}</td></tr>`);
  return head("开销", "维修、水电、网络等你付出的费用（选填，会从净利润扣除）", `<button class="btn primary" data-act="new:expenses">＋ 新增开销</button>`, true) + `
  <div class="toolbar">${searchBox("expenses.q", f.q, "搜索房号、备注")}${sel("expenses.cat", f.cat, opt(EXC), "全部类别")}</div>
  ${table([["日期"], ["房间"], ["类别"], ["备注"], ["金额", "r"]], rows, `${monthLabel(S.month)} 没有开销记录`)}
  <div class="foot-note"><span>${list.length} 笔</span><span>合计 <b class="num">${rm(sum)}</b></span></div>`;
};

/* =====================================================================
   月报表
   ===================================================================== */
function reportRows() {
  const { per, tot } = finance(S.month);
  const rooms = [...S.d.rooms].sort((a, b) => a.code.localeCompare(b.code, "zh", { numeric: true }));
  const rows = rooms.map(r => ({ r, f: per[r.id] || { billed: 0, income: 0, unpaid: 0, exp: 0, net: 0, share: r.partner_id ? num(r.partner_share) : 0, partner: 0, mine: 0 } }))
    .filter(x => !S.f.reports.onlyActive || x.f.billed || x.f.exp);
  const byPartner = {};
  for (const r of rooms) {
    if (!r.partner_id) continue;
    const f = per[r.id]; const p = (byPartner[r.partner_id] ||= { rooms: 0, net: 0, amt: 0 });
    p.rooms++; if (f) { p.net += f.net; p.amt += f.partner; }
  }
  return { rows, tot, byPartner };
}
VIEWS.reports = () => {
  const { rows, tot, byPartner } = reportRows();
  const body = rows.map(({ r, f }) => `<tr data-open="rooms:${esc(r.id)}"><td><b>${esc(r.code)}</b></td><td>${IX.partner[r.partner_id] ? esc(IX.partner[r.partner_id].name) : `<span class="muted">—</span>`}</td>
    <td class="r num">${f.share ? f.share + "%" : "—"}</td><td class="r num">${rm(f.billed)}</td><td class="r num">${rm(f.income)}</td><td class="r num ${f.unpaid ? "bad-t" : ""}">${rm(f.unpaid)}</td>
    <td class="r num">${rm(f.exp)}</td><td class="r num"><b>${rm(f.net)}</b></td><td class="r num">${rm(f.partner)}</td><td class="r num">${rm(f.mine)}</td></tr>`);
  if (rows.length) body.push(`<tr class="total"><td colspan="3">合计（${rows.length} 间）</td><td class="r num">${rm(tot.billed)}</td><td class="r num">${rm(tot.income)}</td><td class="r num">${rm(tot.unpaid)}</td><td class="r num">${rm(tot.exp)}</td><td class="r num">${rm(tot.net)}</td><td class="r num">${rm(tot.partner)}</td><td class="r num">${rm(tot.mine)}</td></tr>`);
  const pRows = Object.entries(byPartner).map(([pid, p]) => `<tr data-open="partners:${esc(pid)}"><td><b>${esc(IX.partner[pid]?.name)}</b></td><td class="r num">${p.rooms}</td><td class="r num">${rm(p.net)}</td><td class="r num"><b>${rm(p.amt)}</b></td></tr>`);
  return head("月报表", `${monthLabel(S.month)} · 净利润 = 实收（不含押金）− 房间开销；合伙人按各房间比例分`, `<button class="btn" data-act="export-report">导出报表</button>`, true) + `
  <div class="kpis">
    ${kpi("实收", rm(tot.income), `应收 ${rm(tot.billed)} · 未收 ${rm(tot.unpaid)}`)}
    ${kpi("房间净利润", rm(tot.net), `房间开销 ${rm(tot.exp)}`)}
    ${kpi("合伙人合计应分", rm(tot.partner), `${Object.keys(byPartner).length} 位合伙人`)}
    ${kpi("我的盈利", rm(tot.mineAfter), `房间部分 ${rm(tot.mine)} − 公共开销 ${rm(tot.general)}`, tot.mineAfter < 0 ? "bad-t" : "good-t")}
  </div>
  <section class="panel" style="margin-bottom:16px"><h2>合伙人分成 <small>按「实收 − 开销」× 分成比例</small></h2>
    ${pRows.length ? table([["合伙人"], ["房间数", "r"], ["名下房间净利", "r"], ["应分给合伙人", "r"]], pRows) : `<div class="empty">还没有房间设定合伙人</div>`}</section>
  <div class="toolbar"><label class="chk"><input type="checkbox" id="rep-only" ${S.f.reports.onlyActive ? "checked" : ""}> 只显示本月有收费或开销的房间</label></div>
  ${table([["房号"], ["合伙人"], ["分成", "r"], ["应收", "r"], ["实收", "r"], ["未收", "r"], ["开销", "r"], ["净利", "r"], ["合伙人分", "r"], ["我的", "r"]], body, "本月没有收费或开销记录")}`;
};

/* =====================================================================
   租客 / 合伙人 / 代理
   ===================================================================== */
VIEWS.tenants = () => {
  const f = S.f.tenants, q = f.q.trim().toLowerCase();
  const curRoom = {};
  for (const l of S.d.leases) if (l.status === "active" && l.tenant_id) (curRoom[l.tenant_id] ||= []).push(roomCode(l.room_id));
  const list = S.d.customers.filter(c => (!f.status || c.status === f.status) && (!q || [c.name, c.phone, c.contact, c.id_no, c.notes, (curRoom[c.id] || []).join(" ")].some(v => (v || "").toLowerCase().includes(q))))
    .sort((a, b) => a.name.localeCompare(b.name, "zh"));
  const { rows, note } = capRows(list, c => `<tr data-open="customers:${esc(c.id)}"><td class="who"><b>${esc(c.name)}</b><small>${esc(c.phone)}</small></td><td class="num">${esc(c.id_no || "—")}</td>
    <td>${curRoom[c.id] ? esc(curRoom[c.id].join("、")) : `<span class="muted">—</span>`}</td><td>${IX.agent[c.agent_id] ? esc(IX.agent[c.agent_id].name) : `<span class="muted">—</span>`}</td>
    <td>${pill(TEN_ST[c.status] || "—", TEN_CLS[c.status] || "s-off")}</td></tr>`);
  return head("租客", `共 ${S.d.customers.length} 位`, `<button class="btn" data-act="export-tenants">导出</button><button class="btn primary" data-act="new:customers">＋ 新增租客</button>`) + `
  <div class="toolbar">${searchBox("tenants.q", f.q, "搜索姓名、电话、IC、房号")}${sel("tenants.status", f.status, opt(TEN_ST), "全部状态")}</div>
  ${table([["租客"], ["IC / 护照"], ["当前房间"], ["介绍代理"], ["状态"]], rows, "还没有租客")}
  <div class="foot-note"><span>显示 ${list.length} 位 ${note ? "· " + note : ""}</span></div>`;
};
VIEWS.partners = () => {
  const q = S.f.partners.q.trim().toLowerCase(), { per } = finance(S.month);
  const list = S.d.partners.filter(p => !q || [p.name, p.phone].some(v => (v || "").toLowerCase().includes(q)));
  const rows = list.map(p => {
    const rs = S.d.rooms.filter(r => r.partner_id === p.id);
    const net = rs.reduce((s, r) => s + (per[r.id]?.net || 0), 0), amt = rs.reduce((s, r) => s + (per[r.id]?.partner || 0), 0);
    const shares = [...new Set(rs.map(r => num(r.partner_share)))].sort((a, b) => a - b);
    return `<tr data-open="partners:${esc(p.id)}"><td class="who"><b>${esc(p.name)}</b><small>${esc(p.phone)}</small></td><td class="r num">${rs.length}</td><td class="num">${shares.length ? shares.join("% / ") + "%" : "—"}</td><td class="r num">${rm(net)}</td><td class="r num"><b>${rm(amt)}</b></td></tr>`;
  });
  return head("合伙人", `分成按 ${monthLabel(S.month)} 计算`, `<button class="btn primary" data-act="new:partners">＋ 新增合伙人</button>`, true) + `
  <div class="toolbar">${searchBox("partners.q", S.f.partners.q, "搜索名称、电话")}</div>
  ${table([["合伙人"], ["房间数", "r"], ["分成比例"], ["名下净利", "r"], ["本月应分", "r"]], rows, "还没有合伙人")}`;
};
VIEWS.agents = () => {
  const q = S.f.agents.q.trim().toLowerCase();
  const rentPaid = {};
  for (const c of S.d.charges) if (c.period === S.month && c.paid && c.category === "rent" && c.tenant_id) { const a = IX.cust[c.tenant_id]?.agent_id; if (a) rentPaid[a] = (rentPaid[a] || 0) + num(c.amount); }
  const list = S.d.agents.filter(a => !q || [a.name, a.phone, a.region].some(v => (v || "").toLowerCase().includes(q)));
  const rows = list.map(a => {
    const n = S.d.customers.filter(c => c.agent_id === a.id).length, rp = rentPaid[a.id] || 0;
    return `<tr data-open="agents:${esc(a.id)}"><td class="who"><b>${esc(a.name)}</b><small>${esc(a.phone)}</small></td><td><span class="lvl">${LEVELS[a.level] || "—"}</span></td><td>${esc(IX.agent[a.parent_id]?.name || "—")}</td><td>${esc(a.region || "—")}</td>
      <td>${pill(AG_ST[a.status] || "启用", a.status === "off" ? "s-off" : "s-active")}</td><td class="r num">${n}</td><td class="r num">${rm(rp)}</td><td class="r num">${num(a.rate)}%</td><td class="r num">${rm(rp * num(a.rate) / 100)}</td></tr>`;
  });
  return head("代理", `佣金按介绍租客 ${monthLabel(S.month)} 已付租金 × 佣金比例估算`, `<button class="btn primary" data-act="new:agents">＋ 新增代理</button>`, true) + `
  <div class="toolbar">${searchBox("agents.q", S.f.agents.q, "搜索姓名、电话、区域")}</div>
  ${table([["代理"], ["等级"], ["上级"], ["区域"], ["状态"], ["介绍租客", "r"], ["本月租金", "r"], ["比例", "r"], ["预估佣金", "r"]], rows, "还没有代理")}`;
};

/* =====================================================================
   抽屉（新增 / 编辑）
   ===================================================================== */
function openDrawer(ent, id, preset) { S.drawer = { ent, id, preset: preset || null, confirm: false, err: "", busy: false }; renderDrawer(); }
function closeDrawer() { S.drawer = null; renderDrawer(); }
function rowOf(ent, id) { return (ent === "customers" ? S.d.customers : S.d[ent]).find(x => x.id === id); }
function renderDrawer(keep) {
  const L = $("#layer"), D = S.drawer;
  if (!D) { L.innerHTML = ""; return; }
  if (D.ent === "bulk-rooms") return renderBulk();
  if (D.ent === "import-rooms") return renderImport();
  if (D.ent === "gen-rent") return renderGenRent();
  const E = ENT[D.ent], row = D.id ? rowOf(D.ent, D.id) : null;
  if (D.id && !row) { S.drawer = null; L.innerHTML = ""; return; }
  const v = keep || row || Object.assign(defaults(D.ent), D.preset || {});
  const dis = D.busy ? "disabled" : "";
  L.innerHTML = `<div class="scrim" data-close></div><div class="drawer" role="dialog" aria-modal="true" aria-labelledby="dt">
    <header><h3 id="dt">${row ? E.title + "资料" : "新增" + E.title}</h3><button class="btn ghost" data-close aria-label="关闭">✕</button></header>
    <form class="body" id="frm" novalidate>
      ${extraTop(D.ent, row)}
      <div class="fgrid">${E.fields.map(f => fieldHtml(f, v[f.k], row)).join("")}</div>
      ${D.ent === "leases" && !row ? `<div class="gen-box"><b>租客还没登记？</b>在这里填写，保存时会一起建立（上面「租客」请留空）<div class="fgrid"><div class="field"><label for="nt-name">新租客姓名</label><input class="f" id="nt-name" value="${esc(D.nt?.name || "")}"></div><div class="field"><label for="nt-phone">电话</label><input class="f" id="nt-phone" value="${esc(D.nt?.phone || "")}"></div><div class="field full"><label for="nt-id">IC / 护照号码</label><input class="f" id="nt-id" value="${esc(D.nt?.id_no || "")}"></div></div></div>` : ""}
      ${D.ent === "leases" ? `<div class="calc" id="lease-calc">${leaseCalcHtml(v)}</div>${row ? "" : `<div class="gen-box"><label class="chk"><input type="checkbox" id="gen-rent-ck" checked> 同时建立第一笔租金账单</label><label class="chk"><input type="checkbox" id="gen-dep-ck" checked> 同时建立押金账单（押金 &gt; 0 时）</label></div>`}` : ""}
      ${D.err ? `<div class="err">${esc(D.err)}</div>` : ""}
      ${extraBottom(D.ent, row)}
    </form>
    <footer>${D.confirm ? `<div class="confirm"><span>${esc(deleteText(D.ent, row))}</span><button class="btn" data-act="cancel-del">取消</button><button class="btn danger solid" data-act="do-del" ${dis}>确认删除</button></div>` :
      `${row ? `<button class="btn danger" data-act="ask-del">删除</button>` : ""}${extraActions(D.ent, row)}<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn primary" data-act="save" ${dis}>${D.busy ? "保存中…" : "保存"}</button>`}</footer>
  </div>`;
  if (!D.id && !keep) { const first = $("#frm .f"); if (first) first.focus(); }
}
function deleteText(ent, row) {
  if (ent === "rooms") return `删除房间「${row.code}」？有租约或收费记录的房间不能删除。`;
  if (ent === "agents") return `删除代理「${row.name}」？他介绍的租客会变成「无代理」。`;
  if (ent === "partners") return `删除合伙人「${row.name}」？他名下的房间会变成「无合伙人」。`;
  if (ent === "customers") return `删除租客「${row.name}」？相关租约和收费会保留，但不再显示租客名。`;
  return "确定删除这条记录？此操作无法撤销。";
}
function leaseCalcHtml(v) {
  if (!v.start_date) return "";
  const l = { ...v, rent: num(v.rent) };
  if (!v.end_date) return `<span>不定期租约</span>`;
  if (v.end_date < v.start_date) return `<span class="bad-t">结束日期早于开始日期</span>`;
  const tot = leaseTotal(l);
  return `<span>合约 <b>${esc(leaseSpan(l))}</b></span><span>合约总额约 <b class="num">${rm(tot)}</b></span>${v.status === "active" ? `<span>${leftBadge(l)}</span>` : ""}`;
}
function extraTop(ent, row) {
  if (!row) return "";
  if (ent === "rooms") {
    const s = roomState(row), l = IX.curLease[row.id], fi = finance(S.month).per[row.id];
    return `<div class="stats3"><div><span>状态</span><b>${STATE[s].t}</b></div><div><span>${S.month.slice(5)} 月实收</span><b>${rm(fi?.income)}</b></div><div><span>${S.month.slice(5)} 月净利</span><b>${rm(fi?.net)}</b></div></div>
      ${l ? `<div class="cur-lease" data-open="leases:${esc(l.id)}"><div><b>${esc(custName(l.tenant_id) || "未填租客")}</b> · ${RENT_TYPE[l.rent_type]} ${rm(l.rent)}</div><div class="muted num">${esc(l.start_date)} → ${esc(l.end_date || "不定期")} · ${leftBadge(l)}</div></div>` : ""}`;
  }
  if (ent === "partners") {
    const rs = S.d.rooms.filter(r => r.partner_id === row.id), per = finance(S.month).per;
    const amt = rs.reduce((s, r) => s + (per[r.id]?.partner || 0), 0);
    return `<div class="stats3"><div><span>房间</span><b>${rs.length}</b></div><div><span>名下净利</span><b>${rm(rs.reduce((s, r) => s + (per[r.id]?.net || 0), 0))}</b></div><div><span>${S.month.slice(5)} 月应分</span><b>${rm(amt)}</b></div></div>`;
  }
  return "";
}
function extraBottom(ent, row) {
  if (!row) return "";
  if (ent === "rooms") {
    const ls = IX.roomLeases[row.id] || [];
    const cs = S.d.charges.filter(c => c.room_id === row.id && (c.period === S.month || !c.paid));
    return `<p class="sec-t">收费（${monthLabel(S.month)} 及未收）</p>${subCharges(cs)}
      <p class="sec-t">租约记录（${ls.length}）</p>${ls.length ? `<div class="sub-list">${ls.map(l => `<div data-open="leases:${esc(l.id)}"><span>${esc(custName(l.tenant_id) || "未填租客")} <span class="muted num">${esc(l.start_date)} → ${esc(l.end_date || "不定期")}</span></span><span>${pill(LEASE_ST[l.status], l.status === "active" ? "s-active" : "s-off")}</span></div>`).join("")}</div>` : `<div class="muted">还没有租约</div>`}`;
  }
  if (ent === "leases") {
    const cs = S.d.charges.filter(c => c.lease_id === row.id);
    return `<p class="sec-t">这份租约的收费（${monthLabel(S.month)} 及未收）</p>${subCharges(cs)}`;
  }
  if (ent === "customers") {
    const ls = S.d.leases.filter(l => l.tenant_id === row.id);
    const unpaid = S.d.charges.filter(c => c.tenant_id === row.id && !c.paid);
    return `<p class="sec-t">租约（${ls.length}）</p>${ls.length ? `<div class="sub-list">${ls.map(l => `<div data-open="leases:${esc(l.id)}"><span><b>${esc(roomCode(l.room_id))}</b> <span class="muted num">${esc(l.start_date)} → ${esc(l.end_date || "不定期")}</span></span><span>${pill(LEASE_ST[l.status], l.status === "active" ? "s-active" : "s-off")}</span></div>`).join("")}</div>` : `<div class="muted">还没有租约</div>`}
      <p class="sec-t">未收款项（${unpaid.length}）</p>${subCharges(unpaid)}`;
  }
  if (ent === "partners") {
    const rs = S.d.rooms.filter(r => r.partner_id === row.id).sort((a, b) => a.code.localeCompare(b.code, "zh", { numeric: true })), per = finance(S.month).per;
    return `<p class="sec-t">名下房间（${rs.length}）</p>${rs.length ? `<div class="sub-list">${rs.map(r => `<div data-open="rooms:${esc(r.id)}"><span><b>${esc(r.code)}</b> <span class="muted num">${num(r.partner_share)}%</span></span><span class="num">${rm(per[r.id]?.partner || 0)}</span></div>`).join("")}</div>` : `<div class="muted">在房间资料里选择这位合伙人，就会出现在这里</div>`}`;
  }
  return "";
}
function subCharges(cs) {
  if (!cs.length) return `<div class="muted">没有记录</div>`;
  return `<div class="sub-list">${cs.sort((a, b) => b.period.localeCompare(a.period)).map(c => `<div data-open="charges:${esc(c.id)}"><span>${esc(CH[c.category])} <span class="muted num">${esc(c.period)}</span></span><span class="num">${rm(c.amount)} ${c.paid ? pill("已收", "s-active") : pill("未收", "s-lost")}</span></div>`).join("")}</div>`;
}
function extraActions(ent, row) {
  if (!row) return "";
  if (ent === "rooms") return `<button class="btn" data-act="room-lease">新租约</button><button class="btn" data-act="room-charge">记收费</button>`;
  if (ent === "leases") return `<button class="btn" data-act="lease-charge">记收费</button>${row.status === "active" ? `<button class="btn" data-act="lease-end">结束租约</button>` : ""}`;
  if (ent === "charges" && !row.paid) return `<button class="btn" data-act="pay:${esc(row.id)}">标记已收</button>`;
  return "";
}
/* 表单联动 */
function onFormChange(e) {
  const D = S.drawer; if (!D || !$("#frm")) return;
  const form = $("#frm"), name = e.target.name;
  if (D.ent === "leases") {
    if (name === "room_id" || name === "rent_type") {
      const r = IX.room[form.elements.room_id.value];
      if (r && (!num(form.elements.rent.value) || name === "rent_type" || name === "room_id")) {
        const def = form.elements.rent_type.value === "daily" ? r.daily_rent : r.monthly_rent;
        if (num(def)) form.elements.rent.value = def;
      }
    }
    const o = readEntity("leases"); const c = $("#lease-calc"); if (c) c.innerHTML = leaseCalcHtml(o);
  }
  if (D.ent === "charges") {
    if (name === "room_id") {
      const l = IX.curLease[form.elements.room_id.value];
      if (l && l.tenant_id) form.elements.tenant_id.value = l.tenant_id;
      if (l && form.elements.category.value === "rent" && !form.elements.amount.value && l.rent_type === "monthly") form.elements.amount.value = l.rent;
    }
    if (name === "paid" && e.target.checked && !form.elements.paid_date.value) form.elements.paid_date.value = today();
  }
}

async function doSave() {
  const D = S.drawer; if (D.busy) return;
  const o = readEntity(D.ent);
  const err = validate(D.ent, o);
  if (err) { D.err = err; renderDrawer(o); return; }
  if (D.ent === "charges") {
    if (o.paid && !o.paid_date) o.paid_date = today();
    if (!o.paid) o.paid_date = null;
    const l = D.preset?.lease_id || (D.id ? rowOf("charges", D.id)?.lease_id : null) || IX.curLease[o.room_id]?.id || null;
    o.lease_id = (l && IX.lease[l]?.room_id === o.room_id) ? l : null;
  }
  if (D.ent === "agents" && o.parent_id === D.id) o.parent_id = null;
  const genRent = $("#gen-rent-ck")?.checked, genDep = $("#gen-dep-ck")?.checked;
  if (D.ent === "leases" && !D.id) D.nt = { name: ($("#nt-name")?.value || "").trim(), phone: ($("#nt-phone")?.value || "").trim(), id_no: ($("#nt-id")?.value || "").trim() };
  D.busy = true; D.err = ""; renderDrawer(o);
  const table = ENT[D.ent].table;
  try {
    let saved;
    if (D.ent === "leases" && !D.id && !o.tenant_id && D.nt.name) {
      const { data, error } = await sb.from("customers").insert({ name: D.nt.name, phone: D.nt.phone, id_no: D.nt.id_no, status: "active" }).select().single();
      if (error) throw error;
      o.tenant_id = data.id; D.nt = null;
    }
    if (D.id) { const { error } = await sb.from(table).update(o).eq("id", D.id); if (error) throw error; }
    else { const { data, error } = await sb.from(table).insert(o).select().single(); if (error) throw error; saved = data; }
    if (saved && D.ent === "leases") {
      try { await createLeaseCharges(saved, genRent, genDep); }
      catch (e2) { toast("租约已保存，但账单没有建立：" + dbError(e2)); closeDrawer(); await loadData(); return; }
    }
    toast("已保存"); closeDrawer(); await loadData();
  } catch (e) {
    if (o.tenant_id && !IX.cust[o.tenant_id]) await loadData();
    D.busy = false; D.err = dbError(e); renderDrawer(o);
  }
}
async function createLeaseCharges(l, genRent, genDep) {
  const rows = [], period = l.start_date.slice(0, 7);
  if (genRent && num(l.rent)) {
    const amt = l.rent_type === "daily" ? (l.end_date ? num(l.rent) * Math.max(1, leaseDays(l)) : num(l.rent)) : num(l.rent);
    rows.push({ room_id: l.room_id, lease_id: l.id, tenant_id: l.tenant_id, category: "rent", amount: Math.round(amt * 100) / 100, period, due_date: l.start_date, notes: l.rent_type === "daily" && l.end_date ? `日租 ${leaseDays(l)} 天` : "" });
  }
  if (genDep && num(l.deposit)) rows.push({ room_id: l.room_id, lease_id: l.id, tenant_id: l.tenant_id, category: "deposit", amount: num(l.deposit), period, due_date: l.start_date });
  if (rows.length) { const { error } = await sb.from("charges").insert(rows); if (error) throw error; }
}
async function doDelete() {
  const D = S.drawer; D.busy = true; renderDrawer();
  try { const { error } = await sb.from(ENT[D.ent].table).delete().eq("id", D.id); if (error) throw error; toast("已删除"); closeDrawer(); await loadData(); }
  catch (e) { D.busy = false; D.confirm = false; D.err = dbError(e); renderDrawer(); }
}
async function markPaid(id) {
  const { error } = await sb.from("charges").update({ paid: true, paid_date: today() }).eq("id", id);
  if (error) { toast(dbError(error)); return; }
  toast("已记录收款"); if (S.drawer && S.drawer.id === id) closeDrawer(); await loadData();
}
async function endLease() {
  const D = S.drawer, l = rowOf("leases", D.id);
  const patch = { status: "ended" }; if (!l.end_date || l.end_date > today()) patch.end_date = today() < l.start_date ? l.start_date : today();
  const { error } = await sb.from("leases").update(patch).eq("id", l.id);
  if (error) { D.err = dbError(error); renderDrawer(); return; }
  toast("租约已结束"); closeDrawer(); await loadData();
}

/* ---------------- 批量新增房间 ---------------- */
function bulkCodes(o) {
  const a = parseInt(o.from, 10), b = parseInt(o.to, 10);
  if (!(a >= 0) || !(b >= a) || b - a > 999) return [];
  const w = Math.max(0, parseInt(o.pad, 10) || 0), out = [];
  for (let i = a; i <= b; i++) out.push(o.prefix + String(i).padStart(w, "0") + o.suffix);
  return out;
}
function readBulk() { const f = $("#frm").elements; return { prefix: f.prefix.value.trim(), suffix: f.suffix.value.trim(), from: f.from.value, to: f.to.value, pad: f.pad.value, location: f.location.value.trim(), room_type: f.room_type.value.trim(), monthly_rent: num(f.monthly_rent.value), daily_rent: num(f.daily_rent.value), partner_id: f.partner_id.value || null, partner_share: num(f.partner_share.value) }; }
function bulkPreview(o) {
  const codes = bulkCodes(o); if (!codes.length) return `<span class="bad-t">请填写正确的起止号码（一次最多 1000 间）</span>`;
  const exist = new Set(S.d.rooms.map(r => r.code)); const dup = codes.filter(c => exist.has(c)).length;
  return `将建立 <b>${codes.length - dup}</b> 间：<span class="num">${esc(codes[0])}</span> … <span class="num">${esc(codes[codes.length - 1])}</span>${dup ? `（${dup} 个房号已存在，会跳过）` : ""}`;
}
function renderBulk(keep) {
  const D = S.drawer, v = keep || { prefix: "A-", suffix: "", from: 101, to: 120, pad: 0, location: "", room_type: "", monthly_rent: 0, daily_rent: 0, partner_id: "", partner_share: 30 };
  $("#layer").innerHTML = `<div class="scrim" data-close></div><div class="drawer" role="dialog" aria-modal="true" aria-labelledby="dt">
    <header><h3 id="dt">批量新增房间</h3><button class="btn ghost" data-close aria-label="关闭">✕</button></header>
    <form class="body" id="frm" novalidate>
      <p class="muted">用前缀加连续号码一次建立多间房，例如 A-101 到 A-120。</p>
      <div class="fgrid">
        <div class="field"><label for="b-prefix">前缀</label><input class="f" id="b-prefix" name="prefix" value="${esc(v.prefix)}"></div>
        <div class="field"><label for="b-suffix">后缀（选填）</label><input class="f" id="b-suffix" name="suffix" value="${esc(v.suffix)}"></div>
        <div class="field"><label for="b-from">起始号码</label><input class="f num" id="b-from" name="from" type="number" min="0" value="${esc(v.from)}"></div>
        <div class="field"><label for="b-to">结束号码</label><input class="f num" id="b-to" name="to" type="number" min="0" value="${esc(v.to)}"></div>
        <div class="field"><label for="b-pad">补零位数</label><input class="f num" id="b-pad" name="pad" type="number" min="0" max="6" value="${esc(v.pad)}"><small class="hint">3 → 001, 002…；0 = 不补</small></div>
        <div class="field"><label for="b-type">房型</label><input class="f" id="b-type" name="room_type" value="${esc(v.room_type)}"></div>
        <div class="field full"><label for="b-loc">位置 / 地址</label><input class="f" id="b-loc" name="location" value="${esc(v.location)}"></div>
        <div class="field"><label for="b-m">默认月租 (RM)</label><input class="f num" id="b-m" name="monthly_rent" type="number" min="0" step="0.01" value="${esc(v.monthly_rent)}"></div>
        <div class="field"><label for="b-d">默认日租 (RM)</label><input class="f num" id="b-d" name="daily_rent" type="number" min="0" step="0.01" value="${esc(v.daily_rent)}"></div>
        <div class="field"><label for="b-p">合伙人</label><select class="f" id="b-p" name="partner_id"><option value="">无</option>${refOpts.partners().map(o => `<option value="${esc(o.v)}" ${v.partner_id === o.v ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select></div>
        <div class="field"><label for="b-s">分成 (%)</label><input class="f num" id="b-s" name="partner_share" type="number" min="0" max="100" value="${esc(v.partner_share)}"></div>
      </div>
      <div class="calc" id="bulk-prev">${bulkPreview(v)}</div>
      ${D.err ? `<div class="err">${esc(D.err)}</div>` : ""}
    </form>
    <footer><span class="sp"></span><button class="btn" data-close>取消</button><button class="btn primary" data-act="bulk-save" ${D.busy ? "disabled" : ""}>${D.busy ? "建立中…" : "建立房间"}</button></footer></div>`;
}
async function saveBulk() {
  const D = S.drawer, o = readBulk();
  const exist = new Set(S.d.rooms.map(r => r.code));
  const codes = bulkCodes(o).filter(c => !exist.has(c));
  if (!codes.length) { D.err = "没有可以建立的新房号"; renderBulk(o); return; }
  if (o.partner_share < 0 || o.partner_share > 100) { D.err = "分成比例要在 0–100 之间"; renderBulk(o); return; }
  D.busy = true; D.err = ""; renderBulk(o);
  try {
    const rows = codes.map(code => ({ code, location: o.location, room_type: o.room_type, monthly_rent: o.monthly_rent, daily_rent: o.daily_rent, partner_id: o.partner_id, partner_share: o.partner_id ? o.partner_share : 0 }));
    for (let i = 0; i < rows.length; i += 200) { const { error } = await sb.from("rooms").insert(rows.slice(i, i + 200)); if (error) throw error; }
    toast(`已建立 ${rows.length} 间房`); closeDrawer(); await loadData();
  } catch (e) { D.busy = false; D.err = dbError(e); renderBulk(o); }
}

/* ---------------- 导入房间 (从 Excel 复制) ---------------- */
function parseTable(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim());
  const delim = lines.some(l => l.includes("\t")) ? "\t" : ",";
  return lines.map(l => {
    if (delim === "\t") return l.split("\t").map(s => s.trim());
    const out = []; let cur = "", q = false;
    for (let i = 0; i < l.length; i++) { const ch = l[i]; if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === "," && !q) { out.push(cur.trim()); cur = ""; } else cur += ch; }
    out.push(cur.trim()); return out;
  });
}
function importRows(text) {
  let rows = parseTable(text); if (!rows.length) return [];
  if (/房号|code/i.test(rows[0][0] || "")) rows = rows.slice(1);
  return rows.filter(r => r[0]).map(r => ({ code: r[0], location: r[1] || "", room_type: r[2] || "", monthly_rent: num(String(r[3] || "").replace(/[^\d.]/g, "")), daily_rent: num(String(r[4] || "").replace(/[^\d.]/g, "")), partner: (r[5] || "").trim(), partner_share: num(String(r[6] || "").replace(/[^\d.]/g, "")) }));
}
function importPreview(text) {
  const rows = importRows(text); if (!rows.length) return `<span class="muted">贴上资料后会显示预览</span>`;
  const exist = new Set(S.d.rooms.map(r => r.code)); const dup = rows.filter(r => exist.has(r.code)).length;
  const newP = [...new Set(rows.map(r => r.partner).filter(p => p && !S.d.partners.some(x => x.name === p)))];
  return `读到 <b>${rows.length}</b> 行，将新增 <b>${rows.length - dup}</b> 间${dup ? `，${dup} 个房号已存在会跳过` : ""}${newP.length ? `，并新建合伙人：${esc(newP.join("、"))}` : ""}。<br><span class="muted">第一行：${esc(rows[0].code)} · ${esc(rows[0].location)} · 月租 ${rm(rows[0].monthly_rent)} · ${esc(rows[0].partner || "无合伙人")} ${rows[0].partner_share || ""}${rows[0].partner ? "%" : ""}</span>`;
}
function renderImport(text = "") {
  const D = S.drawer;
  $("#layer").innerHTML = `<div class="scrim" data-close></div><div class="drawer" role="dialog" aria-modal="true" aria-labelledby="dt">
    <header><h3 id="dt">从 Excel 导入房间</h3><button class="btn ghost" data-close aria-label="关闭">✕</button></header>
    <form class="body" id="frm" novalidate>
      <p class="muted">在 Excel / Google Sheets 选取资料后复制，贴到下面。栏位顺序：</p>
      <div class="cols-hint num">房号 · 位置 · 房型 · 月租 · 日租 · 合伙人 · 分成%</div>
      <div class="field"><label for="imp">资料</label><textarea class="f num" id="imp" rows="10" placeholder="A-101	Jalan Ampang 12	主人房	650	60	陈先生	30">${esc(text)}</textarea></div>
      <div class="calc" id="imp-prev">${importPreview(text)}</div>
      ${D.err ? `<div class="err">${esc(D.err)}</div>` : ""}
    </form>
    <footer><span class="sp"></span><button class="btn" data-close>取消</button><button class="btn primary" data-act="import-save" ${D.busy ? "disabled" : ""}>${D.busy ? "导入中…" : "导入"}</button></footer></div>`;
}
async function saveImport() {
  const D = S.drawer, text = $("#imp").value, rows = importRows(text);
  const exist = new Set(S.d.rooms.map(r => r.code)); const seen = new Set();
  const fresh = rows.filter(r => !exist.has(r.code) && !seen.has(r.code) && seen.add(r.code));
  if (!fresh.length) { D.err = "没有可以导入的新房间"; renderImport(text); return; }
  D.busy = true; D.err = ""; renderImport(text);
  try {
    const pmap = Object.fromEntries(S.d.partners.map(p => [p.name, p.id]));
    const newP = [...new Set(fresh.map(r => r.partner).filter(p => p && !pmap[p]))];
    if (newP.length) { const { data, error } = await sb.from("partners").insert(newP.map(name => ({ name }))).select(); if (error) throw error; for (const p of data) pmap[p.name] = p.id; }
    const ins = fresh.map(r => ({ code: r.code, location: r.location, room_type: r.room_type, monthly_rent: r.monthly_rent, daily_rent: r.daily_rent, partner_id: r.partner ? pmap[r.partner] : null, partner_share: r.partner ? Math.min(100, r.partner_share) : 0 }));
    for (let i = 0; i < ins.length; i += 200) { const { error } = await sb.from("rooms").insert(ins.slice(i, i + 200)); if (error) throw error; }
    toast(`已导入 ${ins.length} 间房`); closeDrawer(); await loadData();
  } catch (e) { D.busy = false; D.err = dbError(e); renderImport(text); }
}

/* ---------------- 生成月租账单 ---------------- */
function rentCandidates() {
  const ms = monthStart(S.month), me = monthEnd(S.month);
  const has = new Set(S.d.charges.filter(c => c.period === S.month && c.category === "rent" && c.lease_id).map(c => c.lease_id));
  return S.d.leases.filter(l => l.status === "active" && l.rent_type === "monthly" && l.start_date <= me && (!l.end_date || l.end_date >= ms) && !has.has(l.id) && num(l.rent) > 0);
}
function renderGenRent() {
  const D = S.drawer, list = rentCandidates(), sum = list.reduce((s, l) => s + num(l.rent), 0);
  $("#layer").innerHTML = `<div class="scrim" data-close></div><div class="drawer" role="dialog" aria-modal="true" aria-labelledby="dt">
    <header><h3 id="dt">生成 ${monthLabel(S.month)} 月租账单</h3><button class="btn ghost" data-close aria-label="关闭">✕</button></header>
    <div class="body">
      <p class="muted">为这个月份所有「进行中」的月租租约建立一笔未收的租金账单。已经有本月租金账单的租约会跳过，所以重复按也不会重复建立。</p>
      <div class="stats3"><div><span>租约</span><b>${list.length}</b></div><div><span>合计</span><b>${rm(sum)}</b></div><div><span>月份</span><b>${S.month}</b></div></div>
      ${list.length ? `<div class="sub-list">${list.slice(0, 50).map(l => `<div><span><b>${esc(roomCode(l.room_id))}</b> ${esc(custName(l.tenant_id))}</span><span class="num">${rm(l.rent)}</span></div>`).join("")}${list.length > 50 ? `<div class="muted">…还有 ${list.length - 50} 份</div>` : ""}</div>` : `<div class="empty">这个月份没有需要生成的租金账单</div>`}
      ${D.err ? `<div class="err">${esc(D.err)}</div>` : ""}
    </div>
    <footer><span class="sp"></span><button class="btn" data-close>取消</button><button class="btn primary" data-act="gen-rent-save" ${!list.length || D.busy ? "disabled" : ""}>${D.busy ? "建立中…" : `建立 ${list.length} 笔账单`}</button></footer></div>`;
}
async function saveGenRent() {
  const D = S.drawer, list = rentCandidates(); if (!list.length) return;
  D.busy = true; renderGenRent();
  try {
    const [y, m] = S.month.split("-").map(Number), last = new Date(y, m, 0).getDate();
    const rows = list.map(l => ({ room_id: l.room_id, lease_id: l.id, tenant_id: l.tenant_id, category: "rent", amount: num(l.rent), period: S.month, due_date: `${S.month}-${pad(Math.min(Number(l.start_date.slice(8)), last))}` }));
    for (let i = 0; i < rows.length; i += 200) { const { error } = await sb.from("charges").insert(rows.slice(i, i + 200)); if (error) throw error; }
    toast(`已建立 ${rows.length} 笔租金账单`); closeDrawer(); await loadData();
  } catch (e) { D.busy = false; D.err = dbError(e); renderGenRent(); }
}

/* =====================================================================
   导出 CSV
   ===================================================================== */
function csv(rows) { return "﻿" + rows.map(r => r.map(v => { v = String(v ?? ""); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(",")).join("\n"); }
function download(name, rows) {
  const url = URL.createObjectURL(new Blob([csv(rows)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const n2 = v => num(v).toFixed(2);
const EXPORTS = {
  rooms: () => download(`房间-${today()}.csv`, [["房号", "位置", "房型", "状态", "租客", "租约结束", "月租", "日租", "合伙人", "分成%", "备注"], ...filteredRooms().map(r => { const l = IX.curLease[r.id]; return [r.code, r.location, r.room_type, STATE[roomState(r)].t, l ? custName(l.tenant_id) : "", l ? l.end_date || "" : "", n2(r.monthly_rent), n2(r.daily_rent), IX.partner[r.partner_id]?.name || "", r.partner_id ? num(r.partner_share) : "", r.notes]; })]),
  leases: () => download(`租约-${today()}.csv`, [["房号", "租客", "方式", "租金", "押金", "开始", "结束", "天数", "合约总额", "状态", "备注"], ...filteredLeases().map(l => [roomCode(l.room_id), custName(l.tenant_id), RENT_TYPE[l.rent_type], n2(l.rent), n2(l.deposit), l.start_date, l.end_date || "", leaseDays(l) ?? "", leaseTotal(l) != null ? n2(leaseTotal(l)) : "", LEASE_ST[l.status], l.notes])]),
  charges: () => download(`收费-${S.f.charges.scope === "month" ? S.month : "未收"}.csv`, [["房号", "租客", "项目", "月份", "应付日期", "金额", "已收", "收款日期", "方式", "备注"], ...filteredCharges().map(c => [roomCode(c.room_id), custName(c.tenant_id), CH[c.category], c.period, c.due_date || "", n2(c.amount), c.paid ? "是" : "否", c.paid_date || "", METHOD[c.method] || "", c.notes])]),
  tenants: () => download(`租客-${today()}.csv`, [["姓名", "电话", "WhatsApp/微信", "IC/护照", "介绍代理", "状态", "备注"], ...S.d.customers.map(c => [c.name, c.phone, c.contact, c.id_no, IX.agent[c.agent_id]?.name || "", TEN_ST[c.status] || "", c.notes])]),
  report: () => { const { rows, tot, byPartner } = reportRows(); download(`月报表-${S.month}.csv`, [["房号", "合伙人", "分成%", "应收", "实收", "未收", "开销", "净利", "合伙人分", "我的"], ...rows.map(({ r, f }) => [r.code, IX.partner[r.partner_id]?.name || "", f.share || "", n2(f.billed), n2(f.income), n2(f.unpaid), n2(f.exp), n2(f.net), n2(f.partner), n2(f.mine)]), ["合计", "", "", n2(tot.billed), n2(tot.income), n2(tot.unpaid), n2(tot.exp), n2(tot.net), n2(tot.partner), n2(tot.mine)], ["公共开销", "", "", "", "", "", n2(tot.general), "", "", n2(-tot.general)], ["我的盈利（扣公共开销后）", "", "", "", "", "", "", "", "", n2(tot.mineAfter)], [], ["合伙人", "房间数", "", "", "", "", "", "名下净利", "应分"], ...Object.entries(byPartner).map(([pid, p]) => [IX.partner[pid]?.name || "", p.rooms, "", "", "", "", "", n2(p.net), n2(p.amt)])]); },
};

/* =====================================================================
   事件
   ===================================================================== */
document.addEventListener("click", e => {
  const t = e.target;
  const au = t.closest("[data-auth]"); if (au) { S.authMode = au.dataset.auth; S.authMsg = null; render(); return; }
  const nav = t.closest("#nav button[data-view]");
  if (nav) { S.view = nav.dataset.view; try { localStorage.setItem("rent-view", S.view); } catch (_) {} render(); window.scrollTo(0, 0); return; }
  const go = t.closest("[data-goto]");
  if (go) { const [path, val] = (go.dataset.set || "").split("="); if (path) { const [v, k] = path.split("."); S.f[v][k] = val; } S.view = go.dataset.goto; render(); return; }
  if (t.closest("[data-close]")) { closeDrawer(); return; }
  const act = t.closest("[data-act]");
  if (act) {
    e.preventDefault();
    const a = act.dataset.act;
    if (a.startsWith("new:")) openDrawer(a.slice(4), null);
    else if (a.startsWith("pay:")) markPaid(a.slice(4));
    else if (a === "save") doSave();
    else if (a === "ask-del") { S.drawer.confirm = true; renderDrawer(); }
    else if (a === "cancel-del") { S.drawer.confirm = false; renderDrawer(); }
    else if (a === "do-del") doDelete();
    else if (a === "bulk-rooms") { S.drawer = { ent: "bulk-rooms", err: "", busy: false }; renderBulk(); }
    else if (a === "bulk-save") saveBulk();
    else if (a === "import-rooms") { S.drawer = { ent: "import-rooms", err: "", busy: false }; renderImport(); }
    else if (a === "import-save") saveImport();
    else if (a === "gen-rent") { S.drawer = { ent: "gen-rent", err: "", busy: false }; renderGenRent(); }
    else if (a === "gen-rent-save") saveGenRent();
    else if (a === "room-lease") { const r = rowOf("rooms", S.drawer.id); openDrawer("leases", null, { room_id: r.id, rent: r.monthly_rent }); }
    else if (a === "room-charge") { const r = rowOf("rooms", S.drawer.id), l = IX.curLease[r.id]; openDrawer("charges", null, { room_id: r.id, tenant_id: l?.tenant_id || null, lease_id: l?.id || null, category: "electricity" }); }
    else if (a === "lease-charge") { const l = rowOf("leases", S.drawer.id); openDrawer("charges", null, { room_id: l.room_id, tenant_id: l.tenant_id, lease_id: l.id, category: "electricity" }); }
    else if (a === "lease-end") endLease();
    else if (a.startsWith("export-")) EXPORTS[a.slice(7)]();
    else if (a === "logout") { S.drawer = null; closeDrawer(); sb.auth.signOut(); }
    return;
  }
  const op = t.closest("[data-open]");
  if (op) { const [ent, id] = op.dataset.open.split(":"); openDrawer(ent, id); }
});
document.addEventListener("input", e => {
  const t = e.target;
  if (t.dataset && t.dataset.filter && t.tagName === "INPUT") { const [v, k] = t.dataset.filter.split("."); S.f[v][k] = t.value; rerenderKeep(t.id.replace(/\./g, "\\.")); return; }
  if (S.drawer?.ent === "bulk-rooms" && t.closest("#frm")) { $("#bulk-prev").innerHTML = bulkPreview(readBulk()); return; }
  if (S.drawer?.ent === "import-rooms" && t.id === "imp") { $("#imp-prev").innerHTML = importPreview(t.value); return; }
  if (t.closest("#frm") && S.drawer?.ent === "leases") onFormChange(e);
});
document.addEventListener("change", e => {
  const t = e.target;
  if (t.id === "month") { if (/^\d{4}-\d{2}$/.test(t.value)) { S.month = t.value; S.loaded = S.loaded && true; render(); loadData(); } return; }
  if (t.id === "rep-only") { S.f.reports.onlyActive = t.checked; render(); return; }
  if (t.dataset && t.dataset.filter && t.tagName === "SELECT") { const [v, k] = t.dataset.filter.split("."); S.f[v][k] = t.value; render(); return; }
  if (t.closest("#frm")) onFormChange(e);
});
document.addEventListener("submit", async e => {
  e.preventDefault();
  if (e.target.id === "frm") { const D = S.drawer; if (!D) return; if (D.ent === "bulk-rooms") saveBulk(); else if (D.ent === "import-rooms") saveImport(); else doSave(); }
  else if (e.target.id === "auth-form") submitAuth();
  else if (e.target.id === "recovery-form") {
    const { error } = await sb.auth.updateUser({ password: $("#r-pass").value });
    if (error) { S.authMsg = { ok: false, text: authError(error) }; render(); return; }
    S.authMsg = null; S.screen = "loading"; toast("密码已更新"); onSession((await sb.auth.getSession()).data.session);
  }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && S.drawer) closeDrawer(); });

render();
})();
