(function () {
"use strict";

/* ================= constants ================= */
const STATUS_C = {
  lead:    { t: "潜在", c: "s-lead",    col: "var(--info)" },
  active:  { t: "活跃", c: "s-active",  col: "var(--good)" },
  dormant: { t: "沉睡", c: "s-dormant", col: "var(--warn)" },
  lost:    { t: "流失", c: "s-lost",    col: "var(--bad)" },
};
const LEVELS = { master: "总代理", l1: "一级代理", l2: "二级代理" };
const AG_STATUS = { on: { t: "启用", c: "s-active" }, off: { t: "停用", c: "s-off" } };

const cfg = window.APP_CONFIG || {};
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);

const S = {
  screen: "loading",          // loading | auth | noaccess | recovery | app
  authMode: "login",          // login | signup | forgot
  authMsg: null,              // {ok:boolean, text}
  session: null,
  view: "overview",
  customers: [], agents: [],
  loaded: false, syncOk: true,
  q: "", fAgent: "", fStatus: "", sort: { key: "created_at", dir: "desc" },
  aq: "", aLevel: "",
  drawer: null,
};
try { const v = localStorage.getItem("cab-view"); if (v) S.view = v; } catch (e) {}

/* ================= helpers ================= */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rm = n => "RM " + (Number(n) || 0).toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const daysSince = s => { if (!s) return null; const t = Date.parse(s); if (isNaN(t)) return null; return Math.floor((Date.now() - t) / 86400000); };
const agentById = id => S.agents.find(a => a.id === id);
const initial = n => (n || "?").trim().slice(0, 1).toUpperCase();

function agentStats(id) {
  const cs = S.customers.filter(c => c.agentId === id);
  const sales = cs.reduce((s, c) => s + (Number(c.spend) || 0), 0);
  const a = agentById(id);
  return { count: cs.length, sales, commission: sales * ((Number(a?.rate) || 0) / 100), list: cs };
}
function toast(msg) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

/* ================= data layer (Supabase) ================= */
const fromAgent = r => ({ id: r.id, name: r.name, phone: r.phone || "", level: r.level, parentId: r.parent_id || "", region: r.region || "", rate: Number(r.rate) || 0, status: r.status, joined: r.joined || "", notes: r.notes || "", created_at: r.created_at });
const fromCustomer = r => ({ id: r.id, name: r.name, phone: r.phone || "", contact: r.contact || "", agentId: r.agent_id || "", status: r.status, spend: Number(r.spend) || 0, lastContact: r.last_contact || "", joined: r.joined || "", notes: r.notes || "", created_at: r.created_at });
const toAgent = o => ({ name: o.name, phone: o.phone || "", level: o.level || "l1", parent_id: o.parentId || null, region: o.region || "", rate: Math.min(100, Math.max(0, Number(o.rate) || 0)), status: o.status || "on", joined: o.joined || null, notes: o.notes || "" });
const toCustomer = o => ({ name: o.name, phone: o.phone || "", contact: o.contact || "", agent_id: o.agentId || null, status: o.status || "lead", spend: Math.max(0, Number(o.spend) || 0), last_contact: o.lastContact || null, joined: o.joined || null, notes: o.notes || "" });

async function fetchAll(table) {
  const out = []; const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await sb.from(table).select("*").order("created_at", { ascending: true }).range(from, from + page - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < page) break;
  }
  return out;
}
async function loadData() {
  try {
    const [a, c] = await Promise.all([fetchAll("agents"), fetchAll("customers")]);
    S.agents = a.map(fromAgent); S.customers = c.map(fromCustomer);
    S.loaded = true; S.syncOk = true;
  } catch (e) {
    console.error(e); S.syncOk = false; toast("读取资料失败，请刷新页面");
  }
  if (S.screen === "app") render();
}
let reloadTimer = null;
function scheduleReload() { clearTimeout(reloadTimer); reloadTimer = setTimeout(loadData, 300); }
let channel = null;
function subscribe() {
  if (channel) return;
  channel = sb.channel("admin-data")
    .on("postgres_changes", { event: "*", schema: "public", table: "agents" }, scheduleReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, scheduleReload)
    .subscribe(status => { if (status === "SUBSCRIBED") { S.syncOk = true; renderSync(); } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { S.syncOk = false; renderSync(); } });
}
function unsubscribe() { if (channel) { sb.removeChannel(channel); channel = null; } }

async function saveRow(kind, id, o) {
  const table = kind === "customer" ? "customers" : "agents";
  const row = kind === "customer" ? toCustomer(o) : toAgent(o);
  const q = id ? sb.from(table).update(row).eq("id", id) : sb.from(table).insert(row);
  const { error } = await q;
  if (error) throw error;
  await loadData();
}
async function deleteRow(kind, id) {
  const { error } = await sb.from(kind === "customer" ? "customers" : "agents").delete().eq("id", id);
  if (error) throw error;
  await loadData();
}

/* ================= auth ================= */
async function onSession(session) {
  S.session = session;
  if (!session) { unsubscribe(); S.agents = []; S.customers = []; S.loaded = false; S.screen = "auth"; render(); return; }
  if (S.screen === "recovery") { render(); return; }
  const { data, error } = await sb.rpc("is_admin");
  if (error || !data) { S.screen = "noaccess"; render(); return; }
  S.screen = "app"; render();
  await loadData(); subscribe();
}
sb.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY") { S.session = session; S.screen = "recovery"; render(); return; }
  if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "INITIAL_SESSION") {
    // run outside the auth callback to avoid deadlocks inside supabase-js
    setTimeout(() => onSession(session), 0);
  }
});

function viewAuth() {
  const m = S.authMode, msg = S.authMsg;
  return `<div class="auth"><form class="auth-card" id="auth-form" novalidate>
    <div class="brand" style="padding:0"><div class="brand-mark">客</div><div><b>客户代理后台</b><small>顾客 · 代理 · 业绩</small></div></div>
    ${m === "forgot" ? `<h1>重设密码</h1><p>输入注册邮箱，我们会寄一封重设密码的邮件给你。</p>` :
      `<div class="auth-tabs"><button type="button" data-auth="login" aria-pressed="${m === "login"}">登录</button><button type="button" data-auth="signup" aria-pressed="${m === "signup"}">注册</button></div>`}
    <div class="field"><label for="a-email">邮箱</label><input class="f" id="a-email" type="email" autocomplete="email" required></div>
    ${m !== "forgot" ? `<div class="field"><label for="a-pass">密码${m === "signup" ? "（至少 6 位）" : ""}</label><input class="f" id="a-pass" type="password" autocomplete="${m === "signup" ? "new-password" : "current-password"}" required minlength="6"></div>` : ""}
    ${msg ? `<div class="msg ${msg.ok ? "ok" : "bad"}">${esc(msg.text)}</div>` : ""}
    <button class="btn primary" type="submit" id="a-submit">${m === "login" ? "登录" : m === "signup" ? "注册账号" : "寄出重设邮件"}</button>
    ${m === "login" ? `<button type="button" class="link" data-auth="forgot">忘记密码？</button>` : ""}
    ${m === "forgot" ? `<button type="button" class="link" data-auth="login">返回登录</button>` : ""}
    ${m === "signup" ? `<p>注册后需到邮箱点确认链接。只有管理员名单里的邮箱才能看到资料。</p>` : ""}
  </form></div>`;
}
function viewRecovery() {
  return `<div class="auth"><form class="auth-card" id="recovery-form">
    <h1>设置新密码</h1>
    <div class="field"><label for="r-pass">新密码（至少 6 位）</label><input class="f" id="r-pass" type="password" autocomplete="new-password" required minlength="6"></div>
    ${S.authMsg ? `<div class="msg ${S.authMsg.ok ? "ok" : "bad"}">${esc(S.authMsg.text)}</div>` : ""}
    <button class="btn primary" type="submit">保存新密码</button>
  </form></div>`;
}
function viewNoAccess() {
  return `<div class="auth"><div class="auth-card">
    <h1>此账号没有权限</h1>
    <p>你已用 <b>${esc(S.session?.user?.email)}</b> 登录，但这个邮箱不在管理员名单里。请联系后台负责人把你的邮箱加进去。</p>
    <button class="btn" data-act="logout">换个账号登录</button>
  </div></div>`;
}
function authError(e) {
  const m = (e && e.message) || "";
  if (/Invalid login credentials/i.test(m)) return "邮箱或密码不正确。";
  if (/Email not confirmed/i.test(m)) return "邮箱还没确认，请先到邮箱点确认链接。";
  if (/already registered/i.test(m)) return "这个邮箱已经注册过，请直接登录。";
  if (/Password should be/i.test(m)) return "密码至少需要 6 位。";
  if (/rate limit/i.test(m)) return "操作太频繁，请稍后再试。";
  return "出错了：" + m;
}
async function submitAuth() {
  const email = $("#a-email").value.trim(), pass = $("#a-pass")?.value || "";
  if (!email) { S.authMsg = { ok: false, text: "请输入邮箱。" }; render(); return; }
  const btn = $("#a-submit"); btn.disabled = true;
  try {
    if (S.authMode === "login") {
      const { error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
      S.authMsg = null;
    } else if (S.authMode === "signup") {
      const { data, error } = await sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: location.origin } });
      if (error) throw error;
      if (!data.session) { S.authMode = "login"; S.authMsg = { ok: true, text: "注册成功！请到邮箱点确认链接，然后回来登录。" }; render(); }
    } else {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
      if (error) throw error;
      S.authMsg = { ok: true, text: "已寄出，请查看邮箱。" }; render();
    }
  } catch (e) { S.authMsg = { ok: false, text: authError(e) }; render(); const em = $("#a-email"); if (em) em.value = email; }
  finally { const b = $("#a-submit"); if (b) b.disabled = false; }
}

/* ================= app views ================= */
function render() {
  const root = $("#root");
  if (S.screen === "loading") { root.innerHTML = `<div class="auth"><p style="color:var(--muted)">载入中…</p></div>`; $("#layer").innerHTML = ""; return; }
  if (S.screen === "auth") { root.innerHTML = viewAuth(); $("#layer").innerHTML = ""; return; }
  if (S.screen === "recovery") { root.innerHTML = viewRecovery(); return; }
  if (S.screen === "noaccess") { root.innerHTML = viewNoAccess(); return; }

  if (!$(".app", root)) root.innerHTML = shell();
  document.querySelectorAll("#nav button").forEach(b => b.setAttribute("aria-current", b.dataset.view === S.view ? "page" : "false"));
  $("#cnt-c").textContent = S.customers.length; $("#cnt-a").textContent = S.agents.length;
  renderSync();
  const m = $("#main");
  if (!S.loaded) m.innerHTML = `<div class="empty">载入资料中…</div>`;
  else if (S.view === "overview") m.innerHTML = viewOverview();
  else if (S.view === "customers") m.innerHTML = viewCustomers();
  else m.innerHTML = viewAgents();
  bindView();
  if (!S.drawer) $("#layer").innerHTML = "";
}
function renderSync() {
  const d = $("#sync-dot"), t = $("#sync-txt"); if (!d) return;
  d.classList.toggle("off", !S.syncOk); t.textContent = S.syncOk ? "已同步" : "连接中断，请刷新";
}
function shell() {
  return `<div class="app">
  <aside class="side">
    <div class="brand"><div class="brand-mark">客</div><div><b>客户代理后台</b><small>顾客 · 代理 · 业绩</small></div></div>
    <nav class="nav" id="nav">
      <button data-view="overview"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg><span>概览</span></button>
      <button data-view="customers"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.8a3.3 3.3 0 0 1 0 6.4M18 14.8c1.8.7 3 2.4 3.5 5.2"/></svg><span>顾客</span><span class="count" id="cnt-c">0</span></button>
      <button data-view="agents"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M12 7.5v4M12 11.5l-6 4M12 11.5l6 4"/></svg><span>代理</span><span class="count" id="cnt-a">0</span></button>
      <button class="logout-m" data-act="logout" aria-label="退出登录"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/></svg></button>
    </nav>
    <div class="side-user"><span>${esc(S.session?.user?.email)}</span><button class="link" style="text-align:left" data-act="logout">退出登录</button></div>
    <div class="side-foot" style="margin-top:0"><span class="dot" id="sync-dot"></span><span id="sync-txt">连接中…</span></div>
  </aside>
  <main id="main"></main>
</div>`;
}

function viewOverview() {
  const cs = S.customers, total = cs.reduce((s, c) => s + (Number(c.spend) || 0), 0);
  const monthKey = today().slice(0, 7);
  const newThisMonth = cs.filter(c => (c.joined || "").slice(0, 7) === monthKey).length;
  const activeAgents = S.agents.filter(a => a.status !== "off").length;
  const needFollow = cs.filter(c => c.status !== "lost" && (daysSince(c.lastContact) ?? 999) > 30);
  const ranks = S.agents.map(a => ({ a, ...agentStats(a.id) })).sort((x, y) => y.sales - x.sales).slice(0, 6);
  const maxSales = Math.max(1, ...ranks.map(r => r.sales));
  const counts = Object.keys(STATUS_C).map(k => ({ k, n: cs.filter(c => c.status === k).length }));
  const unassigned = cs.filter(c => !c.agentId || !agentById(c.agentId)).length;
  return `
  <div class="head"><div><h1>概览</h1><p>${today()} · 所有顾客与代理的汇总</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="new-agent">新增代理</button><button class="btn primary" data-act="new-customer">＋ 新增顾客</button></div>
  </div>
  <div class="kpis">
    <div class="kpi"><span>顾客总数</span><b>${cs.length}</b><small>本月新增 ${newThisMonth}</small></div>
    <div class="kpi"><span>代理</span><b>${S.agents.length}</b><small>启用中 ${activeAgents}</small></div>
    <div class="kpi"><span>顾客累计消费</span><b>${rm(total)}</b><small>平均每位 ${rm(cs.length ? total / cs.length : 0)}</small></div>
    <div class="kpi"><span>超过 30 天未联系</span><b style="color:${needFollow.length ? "var(--bad)" : "inherit"}">${needFollow.length}</b><small>不含已流失顾客</small></div>
  </div>
  <div class="grid2">
    <section class="panel"><h2>代理业绩排行 <small>按名下顾客累计消费</small></h2>
      <div class="panel-body">${ranks.length ? `<div class="rank">${ranks.map(r => `
        <div class="rank-row" data-open-agent="${esc(r.a.id)}" style="cursor:pointer">
          <span class="nm">${esc(r.a.name)} <span style="color:var(--faint)">· ${r.count} 位</span></span>
          <div class="bar"><i style="width:${(r.sales / maxSales * 100).toFixed(1)}%"></i></div>
          <span class="num">${rm(r.sales)}</span></div>`).join("")}</div>` : `<div class="empty">还没有代理，先新增一位吧</div>`}
      </div></section>
    <section class="panel"><h2>顾客状态</h2>
      <div class="panel-body">
        <div class="status-split">${counts.map(x => x.n ? `<i style="width:${x.n / cs.length * 100}%;background:${STATUS_C[x.k].col}"></i>` : "").join("")}</div>
        <div class="legend">${counts.map(x => `<div><span class="sw" style="background:${STATUS_C[x.k].col}"></span>${STATUS_C[x.k].t}<b>${x.n}</b></div>`).join("")}
          <div><span class="sw" style="background:var(--line-strong)"></span>未分配代理<b>${unassigned}</b></div></div>
      </div></section>
  </div>
  <section class="panel" style="margin-top:16px"><h2>需要跟进 <small>最久未联系的顾客</small></h2>
    ${needFollow.length ? `<div class="tbl-wrap" style="border:0;border-radius:0 0 10px 10px"><table><thead><tr><th>顾客</th><th>所属代理</th><th>状态</th><th>最近联系</th><th class="r">累计消费</th></tr></thead><tbody>
    ${needFollow.sort((a, b) => (daysSince(b.lastContact) ?? 9999) - (daysSince(a.lastContact) ?? 9999)).slice(0, 6).map(rowCustomerShort).join("")}</tbody></table></div>` : `<div class="empty">${cs.length ? "所有顾客都在 30 天内联系过" : "还没有顾客"}</div>`}
  </section>`;
}
function agentCell(c) {
  const a = agentById(c.agentId);
  return a ? `<span class="tag-agent"><i>${esc(initial(a.name))}</i>${esc(a.name)}</span>` : `<span style="color:var(--faint)">未分配</span>`;
}
function rowCustomerShort(c) {
  const d = daysSince(c.lastContact);
  return `<tr data-open-customer="${esc(c.id)}"><td class="who"><b>${esc(c.name)}</b><small>${esc(c.phone)}</small></td>
  <td>${agentCell(c)}</td>
  <td><span class="pill ${STATUS_C[c.status]?.c || "s-off"}">${STATUS_C[c.status]?.t || "—"}</span></td>
  <td class="num ${d != null && d > 30 ? "overdue" : ""}">${c.lastContact ? esc(c.lastContact) + ` <span style="color:var(--faint)">(${d} 天前)</span>` : "从未"}</td>
  <td class="r num">${rm(c.spend)}</td></tr>`;
}

function filteredCustomers() {
  const q = S.q.trim().toLowerCase();
  const list = S.customers.filter(c => {
    if (S.fStatus && c.status !== S.fStatus) return false;
    if (S.fAgent === "__none" && c.agentId && agentById(c.agentId)) return false;
    if (S.fAgent && S.fAgent !== "__none" && c.agentId !== S.fAgent) return false;
    if (q && ![c.name, c.phone, c.contact, c.notes].some(v => (v || "").toLowerCase().includes(q))) return false;
    return true;
  });
  const { key, dir } = S.sort, m = dir === "asc" ? 1 : -1;
  list.sort((a, b) => {
    let x = a[key], y = b[key];
    if (key === "spend") { x = Number(x) || 0; y = Number(y) || 0; }
    if (key === "agent") { x = agentById(a.agentId)?.name || ""; y = agentById(b.agentId)?.name || ""; }
    if (x == null || x === "") return 1; if (y == null || y === "") return -1;
    return (x > y ? 1 : x < y ? -1 : 0) * m;
  });
  return list;
}
function th(label, key, cls = "") {
  const on = S.sort.key === key, arrow = on ? (S.sort.dir === "asc" ? "↑" : "↓") : "";
  return `<th class="${cls}"><button data-sort="${key}">${label}<span style="color:var(--accent)">${arrow}</span></button></th>`;
}
const searchIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;
function viewCustomers() {
  const list = filteredCustomers(), sum = list.reduce((s, c) => s + (Number(c.spend) || 0), 0);
  return `
  <div class="head"><div><h1>顾客</h1><p>共 ${S.customers.length} 位顾客，点击任意一行查看或编辑</p></div>
    <div style="display:flex;gap:8px"><button class="btn" data-act="export-c">导出 CSV</button><button class="btn primary" data-act="new-customer">＋ 新增顾客</button></div></div>
  <div class="toolbar">
    <label class="search">${searchIcon}<input id="q" placeholder="搜索姓名、电话、备注" value="${esc(S.q)}"></label>
    <select class="f" id="fAgent" aria-label="按代理筛选"><option value="">全部代理</option><option value="__none" ${S.fAgent === "__none" ? "selected" : ""}>未分配</option>${S.agents.map(a => `<option value="${esc(a.id)}" ${S.fAgent === a.id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select>
    <select class="f" id="fStatus" aria-label="按状态筛选"><option value="">全部状态</option>${Object.entries(STATUS_C).map(([k, v]) => `<option value="${k}" ${S.fStatus === k ? "selected" : ""}>${v.t}</option>`).join("")}</select>
  </div>
  <div class="tbl-wrap"><table><thead><tr>${th("顾客", "name")}${th("所属代理", "agent")}${th("状态", "status")}${th("最近联系", "lastContact")}${th("加入日期", "joined")}${th("累计消费", "spend", "r")}</tr></thead>
  <tbody>${list.length ? list.map(c => {
    const d = daysSince(c.lastContact);
    return `<tr data-open-customer="${esc(c.id)}"><td class="who"><b>${esc(c.name)}</b><small>${esc(c.phone)}</small></td>
    <td>${agentCell(c)}</td>
    <td><span class="pill ${STATUS_C[c.status]?.c || "s-off"}">${STATUS_C[c.status]?.t || "—"}</span></td>
    <td class="num ${d != null && d > 30 && c.status !== "lost" ? "overdue" : ""}">${esc(c.lastContact || "—")}</td>
    <td class="num">${esc(c.joined || "—")}</td>
    <td class="r num">${rm(c.spend)}</td></tr>`;
  }).join("") : `<tr><td colspan="6" class="empty">${S.customers.length ? "没有符合条件的顾客" : "还没有顾客，点击右上角新增"}</td></tr>`}</tbody></table></div>
  <div class="foot-note"><span>显示 ${list.length} / ${S.customers.length} 位</span><span>筛选结果累计消费 <b class="num">${rm(sum)}</b></span></div>`;
}

function viewAgents() {
  const q = S.aq.trim().toLowerCase();
  const list = S.agents.filter(a => (!S.aLevel || a.level === S.aLevel) && (!q || [a.name, a.phone, a.region].some(v => (v || "").toLowerCase().includes(q))))
    .map(a => ({ a, ...agentStats(a.id) })).sort((x, y) => y.sales - x.sales);
  const totComm = list.reduce((s, r) => s + r.commission, 0);
  return `
  <div class="head"><div><h1>代理</h1><p>共 ${S.agents.length} 位代理，佣金按名下顾客累计消费 × 佣金比例估算</p></div>
    <div style="display:flex;gap:8px"><button class="btn" data-act="export-a">导出 CSV</button><button class="btn primary" data-act="new-agent">＋ 新增代理</button></div></div>
  <div class="toolbar">
    <label class="search">${searchIcon}<input id="aq" placeholder="搜索姓名、电话、区域" value="${esc(S.aq)}"></label>
    <select class="f" id="aLevel" aria-label="按等级筛选"><option value="">全部等级</option>${Object.entries(LEVELS).map(([k, v]) => `<option value="${k}" ${S.aLevel === k ? "selected" : ""}>${v}</option>`).join("")}</select>
  </div>
  <div class="tbl-wrap"><table><thead><tr><th>代理</th><th>等级</th><th>上级</th><th>区域</th><th>状态</th><th class="r">顾客数</th><th class="r">名下消费</th><th class="r">佣金比例</th><th class="r">预估佣金</th></tr></thead>
  <tbody>${list.length ? list.map(r => {
    const a = r.a, p = agentById(a.parentId);
    return `<tr data-open-agent="${esc(a.id)}"><td class="who"><b>${esc(a.name)}</b><small>${esc(a.phone)}</small></td>
    <td><span class="lvl">${LEVELS[a.level] || "—"}</span></td>
    <td>${p ? esc(p.name) : `<span style="color:var(--faint)">—</span>`}</td>
    <td>${esc(a.region || "—")}</td>
    <td><span class="pill ${AG_STATUS[a.status]?.c || "s-active"}">${AG_STATUS[a.status]?.t || "启用"}</span></td>
    <td class="r num">${r.count}</td><td class="r num">${rm(r.sales)}</td><td class="r num">${Number(a.rate) || 0}%</td><td class="r num">${rm(r.commission)}</td></tr>`;
  }).join("") : `<tr><td colspan="9" class="empty">${S.agents.length ? "没有符合条件的代理" : "还没有代理，点击右上角新增"}</td></tr>`}</tbody></table></div>
  <div class="foot-note"><span>显示 ${list.length} / ${S.agents.length} 位</span><span>预估佣金合计 <b class="num">${rm(totComm)}</b></span></div>`;
}

/* ================= drawer ================= */
function openDrawer(kind, id) { S.drawer = { kind, id, confirm: false, err: "", busy: false }; renderDrawer(); }
function closeDrawer() { S.drawer = null; renderDrawer(); }
function renderDrawer() {
  const L = $("#layer");
  if (!S.drawer) { L.innerHTML = ""; return; }
  const { kind, id, busy } = S.drawer;
  const dis = busy ? "disabled" : "";
  if (kind === "customer") {
    const c = id ? S.customers.find(x => x.id === id) : null;
    if (id && !c) { S.drawer = null; L.innerHTML = ""; return; }
    const v = c || { name: "", phone: "", contact: "", agentId: S.fAgent && S.fAgent !== "__none" ? S.fAgent : "", status: "lead", spend: 0, lastContact: today(), joined: today(), notes: "" };
    L.innerHTML = `<div class="scrim" data-close></div><div class="drawer" role="dialog" aria-modal="true" aria-labelledby="dt">
      <header><h3 id="dt">${c ? "顾客资料" : "新增顾客"}</h3><button class="btn ghost" data-close aria-label="关闭">✕</button></header>
      <form class="body" id="frm">
        <div class="field"><label for="f-name">姓名 *</label><input class="f" id="f-name" name="name" required value="${esc(v.name)}"></div>
        <div class="row2">
          <div class="field"><label for="f-phone">电话</label><input class="f" id="f-phone" name="phone" inputmode="tel" placeholder="+60 12-345 6789" value="${esc(v.phone)}"></div>
          <div class="field"><label for="f-contact">WhatsApp / 微信</label><input class="f" id="f-contact" name="contact" value="${esc(v.contact)}"></div>
        </div>
        <div class="row2">
          <div class="field"><label for="f-agent">所属代理</label><select class="f" id="f-agent" name="agentId"><option value="">未分配</option>${S.agents.map(a => `<option value="${esc(a.id)}" ${v.agentId === a.id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></div>
          <div class="field"><label for="f-status">状态</label><select class="f" id="f-status" name="status">${Object.entries(STATUS_C).map(([k, s]) => `<option value="${k}" ${v.status === k ? "selected" : ""}>${s.t}</option>`).join("")}</select></div>
        </div>
        <div class="row2">
          <div class="field"><label for="f-spend">累计消费 (RM)</label><input class="f num" id="f-spend" name="spend" type="number" min="0" step="0.01" value="${esc(v.spend)}"></div>
          <div class="field"><label for="f-last">最近联系日期</label><input class="f" id="f-last" name="lastContact" type="date" value="${esc(v.lastContact)}"></div>
        </div>
        <div class="field"><label for="f-joined">加入日期</label><input class="f" id="f-joined" name="joined" type="date" value="${esc(v.joined)}"></div>
        <div class="field"><label for="f-notes">备注</label><textarea class="f" id="f-notes" name="notes" rows="4">${esc(v.notes)}</textarea></div>
        ${S.drawer.err ? `<div class="err">${esc(S.drawer.err)}</div>` : ""}
      </form>
      <footer>${S.drawer.confirm ? `<div class="confirm"><span>删除「${esc(c.name)}」？此操作无法撤销。</span><button class="btn" data-act="cancel-del">取消</button><button class="btn danger solid" data-act="do-del" ${dis}>确认删除</button></div>` :
      `${c ? `<button class="btn danger" data-act="ask-del">删除</button>` : ""}${c && v.status !== "lost" ? `<button class="btn" data-act="touch" ${dis}>今天已联系</button>` : ""}<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn primary" data-act="save" ${dis}>${busy ? "保存中…" : "保存"}</button>`}</footer>
    </div>`;
  } else {
    const a = id ? S.agents.find(x => x.id === id) : null;
    if (id && !a) { S.drawer = null; L.innerHTML = ""; return; }
    const v = a || { name: "", phone: "", level: "l1", parentId: "", region: "", rate: 10, status: "on", joined: today(), notes: "" };
    const st = a ? agentStats(a.id) : null;
    const children = a ? S.agents.filter(x => x.parentId === a.id) : [];
    L.innerHTML = `<div class="scrim" data-close></div><div class="drawer" role="dialog" aria-modal="true" aria-labelledby="dt">
      <header><h3 id="dt">${a ? "代理资料" : "新增代理"}</h3><button class="btn ghost" data-close aria-label="关闭">✕</button></header>
      <form class="body" id="frm">
        ${st ? `<div class="stats3"><div><span>顾客</span><b>${st.count}</b></div><div><span>名下消费</span><b>${rm(st.sales)}</b></div><div><span>预估佣金</span><b>${rm(st.commission)}</b></div></div>` : ""}
        <div class="field"><label for="f-name">姓名 *</label><input class="f" id="f-name" name="name" required value="${esc(v.name)}"></div>
        <div class="row2">
          <div class="field"><label for="f-phone">电话</label><input class="f" id="f-phone" name="phone" inputmode="tel" placeholder="+60 12-345 6789" value="${esc(v.phone)}"></div>
          <div class="field"><label for="f-region">区域</label><input class="f" id="f-region" name="region" placeholder="如 吉隆坡、槟城" value="${esc(v.region)}"></div>
        </div>
        <div class="row2">
          <div class="field"><label for="f-level">等级</label><select class="f" id="f-level" name="level">${Object.entries(LEVELS).map(([k, t]) => `<option value="${k}" ${v.level === k ? "selected" : ""}>${t}</option>`).join("")}</select></div>
          <div class="field"><label for="f-parent">上级代理</label><select class="f" id="f-parent" name="parentId"><option value="">无</option>${S.agents.filter(x => !a || x.id !== a.id).map(x => `<option value="${esc(x.id)}" ${v.parentId === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>
        </div>
        <div class="row2">
          <div class="field"><label for="f-rate">佣金比例 (%)</label><input class="f num" id="f-rate" name="rate" type="number" min="0" max="100" step="0.5" value="${esc(v.rate)}"></div>
          <div class="field"><label for="f-status">状态</label><select class="f" id="f-status" name="status">${Object.entries(AG_STATUS).map(([k, s]) => `<option value="${k}" ${v.status === k ? "selected" : ""}>${s.t}</option>`).join("")}</select></div>
        </div>
        <div class="field"><label for="f-joined">加入日期</label><input class="f" id="f-joined" name="joined" type="date" value="${esc(v.joined)}"></div>
        <div class="field"><label for="f-notes">备注</label><textarea class="f" id="f-notes" name="notes" rows="3">${esc(v.notes)}</textarea></div>
        ${S.drawer.err ? `<div class="err">${esc(S.drawer.err)}</div>` : ""}
        ${st ? `<p class="sec-t">名下顾客（${st.count}）</p>${st.count ? `<div class="sub-list">${st.list.map(c => `<div data-open-customer="${esc(c.id)}" style="cursor:pointer"><span>${esc(c.name)} <span class="pill ${STATUS_C[c.status]?.c}">${STATUS_C[c.status]?.t}</span></span><span class="num">${rm(c.spend)}</span></div>`).join("")}</div>` : `<div style="color:var(--faint);font-size:13px">暂无顾客</div>`}` : ""}
        ${children.length ? `<p class="sec-t">下级代理（${children.length}）</p><div class="sub-list">${children.map(x => `<div data-open-agent="${esc(x.id)}" style="cursor:pointer"><span>${esc(x.name)}</span><span class="lvl">${LEVELS[x.level] || ""}</span></div>`).join("")}</div>` : ""}
      </form>
      <footer>${S.drawer.confirm ? `<div class="confirm"><span>删除代理「${esc(a.name)}」？名下 ${st.count} 位顾客会变成「未分配」。</span><button class="btn" data-act="cancel-del">取消</button><button class="btn danger solid" data-act="do-del" ${dis}>确认删除</button></div>` :
      `${a ? `<button class="btn danger" data-act="ask-del">删除</button>` : ""}<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn primary" data-act="save" ${dis}>${busy ? "保存中…" : "保存"}</button>`}</footer>
    </div>`;
  }
  const first = $("#f-name"); if (first && !S.drawer.id) first.focus();
}
function readForm() {
  const o = {};
  new FormData($("#frm")).forEach((v, k) => o[k] = typeof v === "string" ? v.trim() : v);
  return o;
}
function dbError(e) {
  const m = (e && e.message) || "";
  if (/JWT|not authenticated/i.test(m)) return "登录已过期，请重新登录。";
  if (/row-level security/i.test(m)) return "你的账号没有修改权限。";
  return "保存失败：" + m;
}
async function doSave() {
  if (S.drawer.busy) return;
  const { kind, id } = S.drawer; const o = readForm();
  if (!o.name) { S.drawer.err = "请填写姓名"; renderDrawer(); return; }
  if (kind === "agent" && o.parentId === id) o.parentId = "";
  S.drawer.busy = true; S.drawer.err = ""; renderDrawer(); restoreForm(o);
  try { await saveRow(kind, id, o); toast("已保存"); closeDrawer(); }
  catch (e) { S.drawer.busy = false; S.drawer.err = dbError(e); renderDrawer(); restoreForm(o); }
}
function restoreForm(o) {
  const f = $("#frm"); if (!f) return;
  for (const [k, v] of Object.entries(o)) { const el = f.elements[k]; if (el) el.value = v; }
}
async function doDelete() {
  const { kind, id } = S.drawer;
  S.drawer.busy = true; renderDrawer();
  try { await deleteRow(kind, id); toast("已删除"); closeDrawer(); }
  catch (e) { S.drawer.busy = false; S.drawer.confirm = false; S.drawer.err = dbError(e); renderDrawer(); }
}
async function touchContact() {
  const c = S.customers.find(x => x.id === S.drawer.id); if (!c) return;
  try { await saveRow("customer", c.id, { ...c, lastContact: today() }); toast("已记录今天联系"); closeDrawer(); }
  catch (e) { S.drawer.err = dbError(e); renderDrawer(); }
}

/* ================= export ================= */
function csv(rows) { return "﻿" + rows.map(r => r.map(v => { v = String(v ?? ""); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(",")).join("\n"); }
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportCsv(kind) {
  if (kind === "c") {
    download("顾客-" + today() + ".csv", csv([["姓名", "电话", "WhatsApp/微信", "所属代理", "状态", "累计消费(RM)", "最近联系", "加入日期", "备注"],
      ...filteredCustomers().map(c => [c.name, c.phone, c.contact, agentById(c.agentId)?.name || "", STATUS_C[c.status]?.t || "", c.spend, c.lastContact, c.joined, c.notes])]));
  } else {
    download("代理-" + today() + ".csv", csv([["姓名", "电话", "等级", "上级", "区域", "状态", "顾客数", "名下消费(RM)", "佣金比例(%)", "预估佣金(RM)", "加入日期", "备注"],
      ...S.agents.map(a => { const s = agentStats(a.id); return [a.name, a.phone, LEVELS[a.level] || "", agentById(a.parentId)?.name || "", a.region, AG_STATUS[a.status]?.t || "", s.count, s.sales, a.rate, s.commission.toFixed(2), a.joined, a.notes]; })]));
  }
}

/* ================= events ================= */
function liveInput(sel, key) {
  const el = $(sel); if (!el) return;
  el.addEventListener("input", e => { S[key] = e.target.value; const pos = e.target.selectionStart; render(); const n = $(sel); n.focus(); n.setSelectionRange(pos, pos); });
}
function bindView() {
  liveInput("#q", "q"); liveInput("#aq", "aq");
  [["#fAgent", "fAgent"], ["#fStatus", "fStatus"], ["#aLevel", "aLevel"]].forEach(([sel, key]) => {
    const el = $(sel); if (el) el.addEventListener("change", e => { S[key] = e.target.value; render(); });
  });
}
document.addEventListener("click", e => {
  const au = e.target.closest("[data-auth]");
  if (au) { S.authMode = au.dataset.auth; S.authMsg = null; render(); return; }
  const nav = e.target.closest("#nav button[data-view]");
  if (nav) { S.view = nav.dataset.view; try { localStorage.setItem("cab-view", S.view); } catch (_) {} render(); window.scrollTo(0, 0); return; }
  const srt = e.target.closest("[data-sort]");
  if (srt) { const k = srt.dataset.sort; S.sort = S.sort.key === k ? { key: k, dir: S.sort.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "name" || k === "agent" ? "asc" : "desc" }; render(); return; }
  if (e.target.closest("[data-close]")) { closeDrawer(); return; }
  const oc = e.target.closest("[data-open-customer]"); if (oc) { openDrawer("customer", oc.dataset.openCustomer); return; }
  const oa = e.target.closest("[data-open-agent]"); if (oa) { openDrawer("agent", oa.dataset.openAgent); return; }
  const act = e.target.closest("[data-act]"); if (!act) return;
  const a = act.dataset.act;
  if (a === "new-customer") openDrawer("customer", null);
  else if (a === "new-agent") openDrawer("agent", null);
  else if (a === "save") doSave();
  else if (a === "ask-del") { S.drawer.confirm = true; renderDrawer(); }
  else if (a === "cancel-del") { S.drawer.confirm = false; renderDrawer(); }
  else if (a === "do-del") doDelete();
  else if (a === "touch") touchContact();
  else if (a === "export-c") exportCsv("c");
  else if (a === "export-a") exportCsv("a");
  else if (a === "logout") { S.drawer = null; sb.auth.signOut(); }
});
document.addEventListener("submit", async e => {
  e.preventDefault();
  if (e.target.id === "frm") doSave();
  else if (e.target.id === "auth-form") submitAuth();
  else if (e.target.id === "recovery-form") {
    const p = $("#r-pass").value;
    const { error } = await sb.auth.updateUser({ password: p });
    if (error) { S.authMsg = { ok: false, text: authError(error) }; render(); return; }
    S.authMsg = null; S.screen = "loading"; toast("密码已更新"); onSession((await sb.auth.getSession()).data.session);
  }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && S.drawer) closeDrawer(); });

render();
})();
