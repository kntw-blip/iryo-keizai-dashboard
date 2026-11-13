/* 医療経済実態調査ダッシュボード（病院）
   data/mes.json  … 系列（表の種類×病院種別×集計×国公立×区分）ごとに、回→{n, beds, v:{項目:[金額前々年,金額前年,構成比前々年,構成比前年]}}
   data/hosp.json … 自院検索用の病院マスタ */
"use strict";
const $ = (id) => document.getElementById(id);
const S = { h: null, round: null, fy: 1, shukei: 1, scope: "all", ind: "pl", axis: "owner", axisSub: "", plKey: "", charts: {}, hide: new Set(),
            prof: { htype: "一般病院", owner: "", bed: "", nyuin: "", func: "", ryo: "" } };
let D, H, IDX = {}, ROUNDS = [];

const OWNERS = ["医療法人", "国立", "公立", "公的", "社会保険関係法人", "その他", "個人"];
const RYO = { ryo60: "療養病床60％以上", ryo0: "療養病床なし", zaishi: "在宅療養支援病院" };
const AXES = [["owner", "開設者"], ["beds", "病床規模"], ["nyuin", "入院基本料"], ["func", "病院機能"], ["ryo", "療養病床・在宅"], ["region", "地域加算の級地"]];
const ratio = (k) => (e, i) => (e.v[k] ? e.v[k][2 + i] : null);
const bedsOf = (e, i) => (e.beds ? (e.beds[i] ?? e.beds[0]) : null);
const IND = [
  { k: "pl", l: "損益率", u: "％", d: 1, f: ratio("pl") },
  { k: "tpl", l: "総損益率（補助金等を含む）", u: "％", d: 1, f: ratio("tpl") },
  { k: "c_salary", l: "給与費比率", u: "％", d: 1, f: ratio("c_salary") },
  { k: "c_drug", l: "医薬品費比率", u: "％", d: 1, f: ratio("c_drug") },
  { k: "c_material", l: "診療材料費比率", u: "％", d: 1, f: ratio("c_material") },
  { k: "c_outsource", l: "委託費比率", u: "％", d: 1, f: ratio("c_outsource") },
  { k: "c_dep", l: "減価償却費比率", u: "％", d: 1, f: ratio("c_dep") },
  { k: "c_fac", l: "設備関係費比率", u: "％", d: 1, f: ratio("c_fac") },
  { k: "c_exp", l: "経費比率", u: "％", d: 1, f: ratio("c_exp") },
  { k: "rev_in", l: "入院診療収益の割合", u: "％", d: 1, f: ratio("rev_in") },
  { k: "rev_out", l: "外来診療収益の割合", u: "％", d: 1, f: ratio("rev_out") },
  { k: "rev", l: "医業収益（1施設当たり）", u: "百万円", d: 0, f: (e, i) => (e.v.rev && e.v.rev[i] != null ? e.v.rev[i] / 1000 : null) },
  { k: "revbed", l: "1床当たり医業収益", u: "千円", d: 0, f: (e, i) => (e.v.rev && e.v.rev[i] != null && bedsOf(e, i) ? e.v.rev[i] / bedsOf(e, i) : null) },
  { k: "beds", l: "平均病床数", u: "床", d: 0, f: (e, i) => bedsOf(e, i) },
  { k: "n", l: "施設数", u: "施設", d: 0, f: (e) => e.n },
];
const indOf = (k) => IND.find((x) => x.k === k) || IND[0];
const PEER_COLS = ["n", "beds", "rev", "revbed", "pl", "tpl", "c_salary", "c_drug", "c_material", "c_outsource", "c_dep"];

/* ---------- 共通 ---------- */
const css = (n) => getComputedStyle(document.querySelector(".viz-root")).getPropertyValue(n).trim();
const fmt = (v, d = 1) => (v == null || Number.isNaN(v) ? "–" : v.toLocaleString("ja-JP", { minimumFractionDigits: d, maximumFractionDigits: d }));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nk = (s) => String(s || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
const wareki = (y) => (y >= 2019 ? (y === 2019 ? "令和元" : "令和" + (y - 2018)) : "平成" + (y - 1988));
const fyLabel = (y) => `${y}年度（${wareki(y)}）`;
const keyOf = (s) => [s.topic, s.htype, s.shukei, s.scope, s.sub, s.group].join("|");
const roundOf = (r) => ROUNDS.find((x) => String(x.round) === String(r));

/** 条件 → 系列。国公立を除く集計が無い表は「含む」に戻し、fallback を付ける。 */
function find(spec) {
  const base = { htype: "一般病院", sub: "", shukei: S.shukei, scope: S.scope, ...spec };
  let s = IDX[keyOf(base)];
  if (!s && base.scope === "ex") { s = IDX[keyOf({ ...base, scope: "all" })]; if (s) return { s, fallback: true }; }
  return s ? { s, fallback: false } : null;
}
/** 系列 s の、回 r・年度 i の指標値。秘匿は "*"、無しは null。 */
function val(s, r, i, ind) {
  const e = s && s.r[r];
  if (!e) return null;
  if (e.supp) return "*";
  const v = ind.f(e, i);
  return v == null ? null : v;
}
const cell = (v, ind) => (v === "*" ? "＊" : fmt(v, ind.d));
function setSeg(id, v) { document.querySelectorAll(`#${id} button`).forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v === String(v)))); }
function onSeg(id, fn) { $(id).addEventListener("click", (ev) => { const b = ev.target.closest("button[data-v]"); if (b) { setSeg(id, b.dataset.v); fn(b.dataset.v); } }); }
function fillSel(el, opts, v) { el.innerHTML = opts.map(([val_, lab]) => `<option value="${esc(val_)}">${esc(lab)}</option>`).join(""); el.value = v; if (el.value !== v) el.value = opts.length ? opts[0][0] : ""; return el.value; }
function chart(id) {
  const el = $(id);
  if (!S.charts[id]) S.charts[id] = echarts.init(el, null, { renderer: "svg" });
  return S.charts[id];
}
function baseOpt() {
  const t2 = css("--text-secondary"), grid = css("--grid");
  return {
    animation: false, textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif', color: t2 },
    tooltip: { backgroundColor: css("--surface-1"), borderColor: css("--axis"), textStyle: { color: css("--text-primary"), fontSize: 12 }, extraCssText: "box-shadow:0 6px 20px rgba(0,0,0,.14);border-radius:8px;" },
    _ax: { axisLine: { lineStyle: { color: css("--axis") } }, axisTick: { show: false }, axisLabel: { color: t2, fontSize: 12 }, splitLine: { lineStyle: { color: grid } } },
  };
}
function table(el, head, rows) {
  el.innerHTML = `<thead><tr>${head.map((h, i) => `<th${i === 0 ? ' class="t"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) =>
    `<tr class="${r.cls || ""}">${r.cells.map((c, i) => `<td class="${i === 0 ? "t" : ""}${typeof c === "string" && /^-[\d,.]+$/.test(c) ? " neg" : ""}">${i === 0 ? c : esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>`;
}
function csv(name, head, rows) {
  const q = (c) => `"${String(c ?? "").replace(/<[^>]+>/g, "").replace(/"/g, '""')}"`;
  const text = "﻿" + [head, ...rows.map((r) => r.cells)].map((r) => r.map(q).join(",")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
const condText = () => { const R = roundOf(S.round); return `第${R.round}回・${fyLabel(R.fy[S.fy])}・集計${S.shukei}・国公立を${S.scope === "ex" ? "除く" : "含む"}`; };

/* ---------- 自院 → 比較する病院群 ---------- */
const bedBin = (b) => (b >= 500 ? "500床以上" : b >= 300 ? "300〜499床" : b >= 200 ? "200〜299床" : b >= 100 ? "100〜199床" : b >= 50 ? "50〜99床" : b >= 20 ? "20〜49床" : "");
function profFromHosp(h) {
  const p = { htype: "一般病院", owner: h.owner || "", bed: bedBin(h.beds || 0), nyuin: "", func: "", ryo: "" };
  if (h.beds && h.b_seishin >= h.beds * 0.999) p.htype = "精神科病院";
  if (h.nyuin) p.nyuin = h.nyuin.join("|");
  if ((h.kihon || "").startsWith("特定機能")) p.func = "特定機能病院"; else if (h.type === "DPC") p.func = "DPC対象病院";
  if (h.beds && h.b_ryoyo / h.beds >= 0.6) p.ryo = "ryo60"; else if (h.beds && !h.b_ryoyo) p.ryo = "ryo0";
  return p;
}
/** 比較する病院群（色は群の種類で固定）。 */
function peers() {
  const P = S.prof, out = [];
  const add = (kind, label, spec, color) => { const f = find(spec); if (f) out.push({ kind, label: label + (f.fallback ? "（国公立を含む）" : ""), s: f.s, color }); };
  if (P.htype === "精神科病院") {
    add("all", "精神科病院 全体", { topic: "owner", htype: "精神科病院", scope: "all", group: S.scope === "ex" ? "国公立を除く" : "全体" }, "--other-strong");
    return out;
  }
  add("all", S.scope === "ex" ? "一般病院 全体（国公立を除く）" : "一般病院 全体", { topic: "owner", scope: "all", group: S.scope === "ex" ? "国公立を除く" : "全体" }, "--other-strong");
  if (P.owner) add("owner", `開設者：${P.owner}`, { topic: "owner", scope: "all", group: P.owner }, "--s1");
  if (P.bed) add("bed", `病床規模：${P.bed}`, { topic: "beds", group: P.bed }, "--s2");
  if (P.nyuin) { const [sub, group] = P.nyuin.split("|"); add("nyuin", `入院基本料：${group}${sub.startsWith("一般病棟") ? "" : "（" + sub.replace("算定病院", "") + "）"}`, { topic: "nyuin", htype: "", sub, group }, "--s3"); }
  if (P.func) add("func", `病院機能：${P.func}`, { topic: "func", group: P.func }, "--s4");
  if (P.ryo) {
    const f = P.owner && find({ topic: P.ryo, scope: "all", group: P.owner });
    if (f && f.s.r[S.round] && !f.s.r[S.round].supp) out.push({ kind: "ryo", label: `${RYO[P.ryo]} × ${P.owner}`, s: f.s, color: "--s5" });
    else add("ryo", RYO[P.ryo], { topic: P.ryo, scope: "all", group: S.scope === "ex" ? "国公立を除く" : "全体" }, "--s5");
  }
  return out;
}

/* ---------- 同規模・同機能の病院群 ---------- */
function renderPeer() {
  const ps = peers(), R = roundOf(S.round);
  $("peer-cond").textContent = condText();
  const head = ["病院群", ...PEER_COLS.map((k) => { const x = indOf(k); return `${x.l.replace("（1施設当たり）", "").replace("（補助金等を含む）", "")}（${x.u}）`; })];
  const rows = ps.map((p) => ({ cls: p.kind === "all" ? "" : "self",
    cells: [`<span class="sw" style="background:var(${p.color})"></span>${esc(p.label)}`, ...PEER_COLS.map((k) => cell(val(p.s, S.round, S.fy, indOf(k)), indOf(k)))] }));
  table($("peer-table"), head, rows);
  S._peer = { head, rows };
  const base = ps[0], ind = indOf("pl");
  const parts = ps.filter((p) => p.kind !== "all").map((p) => { const v = val(p.s, S.round, S.fy, ind); return typeof v === "number" ? `${esc(p.label)} <b>${fmt(v, 1)}％</b>` : null; }).filter(Boolean);
  const bv = base ? val(base.s, S.round, S.fy, ind) : null;
  $("peer-hero").innerHTML = (S.h ? `${esc(S.h.name)}と同じ区分の病院群の損益率（${R.fy[S.fy]}年度）：` : `損益率（${R.fy[S.fy]}年度）：`) +
    (parts.length ? parts.join("、") + "。" : "") + (typeof bv === "number" ? `${esc(base.label)}は <b>${fmt(bv, 1)}％</b>。` : "") +
    (!parts.length && !S.h ? " 自院を選ぶか、上の区分を指定すると、該当する病院群が並びます。" : "");
}

/* ---------- 推移 ---------- */
function renderTrend() {
  const ps = peers(), ind = indOf(S.ind), o = baseOpt();
  $("trend-cond").textContent = `集計${S.shukei}・国公立を${S.scope === "ex" ? "除く" : "含む"}`;
  $("trend-title").textContent = `${ind.l}（${ind.u}）の推移`;
  $("trend-legend").innerHTML = ps.map((p) => `<button type="button" class="lg" data-k="${p.kind}" aria-pressed="${!S.hide.has(p.kind)}"><span class="sw" style="background:var(${p.color})"></span>${esc(p.label)}</button>`).join("");
  const narrow = $("ch-trend").clientWidth < 560, shown = ps.filter((p) => !S.hide.has(p.kind));
  const fys = ROUNDS.flatMap((r) => r.fy);
  const series = shown.map((p) => {
    const data = [];
    ROUNDS.forEach((r) => { [0, 1].forEach((i) => { const v = val(p.s, String(r.round), i, ind); data.push([r.fy[i], typeof v === "number" ? v : null]); }); data.push([r.fy[1] + 0.5, null]); });
    const c = css(p.color);
    return { name: p.label, type: "line", data, connectNulls: false, symbol: "circle", symbolSize: narrow ? 6 : 8, lineStyle: { width: p.kind === "all" ? 2 : 2.5, color: c, type: p.kind === "all" ? "dashed" : "solid" },
             itemStyle: { color: c, borderColor: css("--surface-1"), borderWidth: narrow ? 1 : 2 }, emphasis: { focus: "series" } };
  });
  chart("ch-trend").setOption({ ...o, grid: { left: narrow ? 40 : 56, right: narrow ? 8 : 24, top: 16, bottom: 40 },
    tooltip: { ...o.tooltip, trigger: "axis", axisPointer: { type: "line", snap: true, lineStyle: { color: css("--axis") } },
      formatter: (ps_) => { const pts = ps_.filter((p) => p.value[1] != null && Number.isInteger(p.value[0])); if (!pts.length) return ""; const y = pts[0].value[0]; const r = ROUNDS.find((x) => x.fy.includes(y));
        return `<b>${fyLabel(y)}</b> <span style="color:${css("--text-muted")}">第${r.round}回調査</span><br>` + pts.map((p) => `${p.marker}${esc(p.seriesName)}　<b>${fmt(p.value[1], ind.d)}</b>${ind.u}`).join("<br>"); } },
    xAxis: { type: "value", min: fys[0] - 1, max: fys[fys.length - 1] + 1, interval: 1, ...o._ax, splitLine: { show: false }, axisLabel: { ...o._ax.axisLabel, formatter: (v) => (v < fys[0] || v > fys[fys.length - 1] ? "" : !narrow ? String(v) : ROUNDS.some((r) => r.fy[0] === v) ? "'" + String(v).slice(2) : ""), interval: 0, hideOverlap: false }, name: "年度", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: css("--text-muted"), fontSize: 12 } },
    yAxis: { type: "value", scale: true, ...o._ax, axisLine: { show: false }, axisLabel: { ...o._ax.axisLabel, formatter: (v) => fmt(v, ind.u === "％" ? 0 : 0) } },
    series }, true);
  const head = ["病院群", ...fys.map((y) => `${y}`)];
  table($("trend-table"), head, ps.map((p) => ({ cells: [esc(p.label), ...ROUNDS.flatMap((r) => [0, 1].map((i) => cell(val(p.s, String(r.round), i, ind), ind)))] })));
}

/* ---------- 区分別の比較・費用構造 ---------- */
function axisList() {
  const P = S.prof, a = S.axis, own = a === "owner" || a === "ryo";
  const topic = a === "ryo" ? S.axisSub : a;
  let list = D.series.filter((s) => s.topic === topic && s.shukei === S.shukei && (a === "nyuin" ? s.sub === S.axisSub : true) &&
    (a === "owner" ? s.htype === P.htype : a === "nyuin" ? true : s.htype === "一般病院"));
  if (!own) { const ex = list.filter((s) => s.scope === S.scope); list = ex.length ? ex : list.filter((s) => s.scope === "all"); }
  list = list.filter((s) => s.r[S.round]).sort((x, y) => x.ord - y.ord);
  if (a === "func") list = list.filter((s) => !/独立病院型|それ以外/.test(s.group));
  return list;
}
function isSelf(s) { return peers().some((p) => p.kind !== "all" && p.s === s); }
function axisSubOptions() {
  if (S.axis === "nyuin") {
    const subs = [...new Set(D.series.filter((s) => s.topic === "nyuin" && s.shukei === S.shukei && s.r[S.round]).sort((x, y) => x.ord - y.ord).map((s) => s.sub))];
    return subs.map((x) => [x, x.replace("算定病院", "")]);
  }
  if (S.axis === "ryo") return Object.entries(RYO).filter(([k]) => D.series.some((s) => s.topic === k && s.r[S.round]));
  return [];
}
function renderAxis() {
  const opts = axisSubOptions();
  $("axis-sub-wrap").hidden = !opts.length;
  if (opts.length) { const want = S.axis === "nyuin" && S.prof.nyuin && !S._subTouched ? S.prof.nyuin.split("|")[0] : S.axis === "ryo" && S.prof.ryo && !S._subTouched ? S.prof.ryo : S.axisSub; S.axisSub = fillSel($("axis-sub"), opts, want); }
  const list = axisList(), ind = indOf(S.ind), o = baseOpt(), R = roundOf(S.round);
  const axisName = AXES.find((x) => x[0] === S.axis)[1];
  $("axis-cond").textContent = condText(); $("cost-cond").textContent = condText();
  $("axis-title").textContent = `${axisName}別の${ind.l}（${ind.u}）`;
  const selfAny = list.some(isSelf);
  $("axis-legend").innerHTML = selfAny ? `<span><span class="sw sw-self"></span>自院が該当する区分</span><span><span class="sw" style="background:var(--other-strong)"></span>その他の区分</span>` : "";
  const names = list.map((s) => s.group), vals = list.map((s) => val(s, S.round, S.fy, ind));
  const h = Math.max(260, list.length * 38 + 60); $("ch-axis").style.height = h + "px"; $("ch-cost").style.height = h + 20 + "px";
  const selfC = css("--self"), otherC = css("--other-strong"), t1 = css("--text-primary");
  chart("ch-axis").resize(); chart("ch-cost").resize();
  chart("ch-axis").setOption({ ...o, grid: { left: 8, right: 64, top: 8, bottom: 28, containLabel: true },
    tooltip: { ...o.tooltip, trigger: "item", formatter: (p) => { const s = list[p.dataIndex], e = s.r[S.round]; return `<b>${esc(s.group)}</b><br>${esc(ind.l)}　<b>${typeof vals[p.dataIndex] === "number" ? fmt(vals[p.dataIndex], ind.d) + ind.u : "非公表"}</b><br>施設数 ${fmt(e.n, 0)}・平均病床数 ${fmt(bedsOf(e, S.fy), 0)}`; } },
    xAxis: { type: "value", ...o._ax, axisLine: { show: false }, scale: false },
    yAxis: { type: "category", data: names, inverse: true, ...o._ax, splitLine: { show: false }, axisLabel: { color: t1, fontSize: 12, width: $("ch-axis").clientWidth < 560 ? 110 : 190, overflow: "break" } },
    series: [{ type: "bar", barMaxWidth: 20, data: vals.map((v, i) => ({ value: typeof v === "number" ? v : null, itemStyle: { color: isSelf(list[i]) ? selfC : otherC, borderRadius: typeof v === "number" && v < 0 ? [4, 0, 0, 4] : [0, 4, 4, 0] } })),
      label: { show: true, position: "right", color: t1, fontSize: 12, formatter: (p) => (p.value == null ? "" : fmt(p.value, ind.d)) } }] }, true);
  const cols = ["n", "beds", "rev", "pl", "tpl", "c_salary", "c_drug", "c_material", "c_outsource", "c_dep", "rev_in"];
  table($("axis-table"), [axisName, ...cols.map((k) => `${indOf(k).l.replace("（1施設当たり）", "").replace("（補助金等を含む）", "")}（${indOf(k).u}）`)],
    list.map((s) => ({ cls: isSelf(s) ? "self" : "", cells: [esc(s.group), ...cols.map((k) => cell(val(s, S.round, S.fy, indOf(k)), indOf(k)))] })));

  /* 費用構造 */
  const SEG = [["c_salary", "給与費", "--s1"], ["c_drug", "医薬品費", "--s2"], ["c_material", "診療材料費", "--s3"], ["c_outsource", "委託費", "--s4"], ["c_dep", "減価償却費", "--s5"], ["_other", "その他の費用", "--other-strong"]];
  const rv = (s, k) => { const e = s.r[S.round]; if (!e || e.supp || !e.v.cost) return null; if (k !== "_other") return e.v[k] ? e.v[k][2 + S.fy] : null;
    const sum = SEG.slice(0, 5).reduce((a, [kk]) => a + ((e.v[kk] && e.v[kk][2 + S.fy]) || 0), 0); return e.v.cost[2 + S.fy] == null ? null : Math.round((e.v.cost[2 + S.fy] - sum) * 10) / 10; };
  $("cost-legend").innerHTML = SEG.map(([, l, c]) => `<span><span class="sw" style="background:var(${c})"></span>${l}</span>`).join("");
  chart("ch-cost").setOption({ ...o, grid: { left: 8, right: 40, top: 8, bottom: 28, containLabel: true },
    tooltip: { ...o.tooltip, trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(127,127,127,.08)" } },
      formatter: (ps_) => { const s = list[ps_[0].dataIndex], e = s.r[S.round]; return `<b>${esc(s.group)}</b><br>` + ps_.map((p) => `${p.marker}${p.seriesName}　<b>${fmt(p.value, 1)}</b>％`).join("<br>") + (e.v && e.v.cost ? `<br>費用計　<b>${fmt(e.v.cost[2 + S.fy], 1)}</b>％` : ""); } },
    xAxis: { type: "value", ...o._ax, axisLine: { show: false }, axisLabel: { ...o._ax.axisLabel, formatter: "{value}%" } },
    yAxis: { type: "category", data: names, inverse: true, ...o._ax, splitLine: { show: false }, axisLabel: { color: t1, fontSize: 12, width: $("ch-axis").clientWidth < 560 ? 110 : 190, overflow: "break" } },
    series: SEG.map(([k, l, c], si) => ({ name: l, type: "bar", stack: "c", barMaxWidth: 22, data: list.map((s) => rv(s, k)), itemStyle: { color: css(c), borderColor: css("--surface-1"), borderWidth: 1 },
      label: { show: si === 0, position: "inside", color: "#fff", fontSize: 11, formatter: (p) => (p.value == null ? "" : fmt(p.value, 1)) },
      markLine: si === 0 ? { silent: true, symbol: "none", lineStyle: { color: css("--ref"), width: 1.5, type: "solid" }, label: { formatter: "収益=100%", color: css("--text-secondary"), fontSize: 11 }, data: [{ xAxis: 100 }] } : undefined })) }, true);
  renderPL(list);
}

/* ---------- 損益明細 ---------- */
function renderPL(list) {
  const ps = peers();
  const opts = [...ps.map((p) => [keyOf(p.s), p.label]), ...list.filter((s) => !ps.some((p) => p.s === s)).map((s) => [keyOf(s), `${AXES.find((x) => x[0] === S.axis)[1]}：${s.group}`])];
  const def = (ps.find((p) => p.kind !== "all") || ps[0] || {}).s;
  S.plKey = fillSel($("pl-group"), opts, opts.some((x) => x[0] === S.plKey) && S._plTouched ? S.plKey : def ? keyOf(def) : "");
  const s = IDX[S.plKey], R = roundOf(S.round), e = s && s.r[S.round];
  $("pl-cond").textContent = `第${R.round}回・集計${S.shukei}`;
  const head = ["科目", `${R.fy[0]}年度 金額（千円）`, `${R.fy[1]}年度 金額（千円）`, "伸び率（％）", `${R.fy[0]}年度 構成比（％）`, `${R.fy[1]}年度 構成比（％）`];
  let rows = [];
  if (e && !e.supp) {
    rows = D.meta.items.filter((it) => e.v[it.key]).map((it) => { const v = e.v[it.key]; const g = v[0] && v[1] != null && v[0] > 0 ? (v[1] / v[0] - 1) * 100 : null;
      return { cls: "lv" + it.level, cells: [esc(it.label), fmt(v[0], 0), fmt(v[1], 0), g == null ? "–" : fmt(g, 1), fmt(v[2], 1), fmt(v[3], 1)] }; });
    rows.push({ cells: ["施設数", fmt(e.n, 0), fmt(e.n, 0), "–", "–", "–"] }, { cells: ["平均病床数", fmt(e.beds && e.beds[0], 0), fmt(bedsOf(e, 1), 0), "–", "–", "–"] });
  } else rows = [{ cells: [e && e.supp ? "施設数が少ないため非公表です。" : "この回には該当する集計がありません。", "", "", "", "", ""] }];
  table($("pl-table"), head, rows); S._pl = { head, rows, name: s ? s.group : "" };
}

/* ---------- 条件欄 ---------- */
function renderProfSelects() {
  const P = S.prof, sh = S.shukei;
  fillSel($("p-htype"), [["一般病院", "一般病院"], ["精神科病院", "精神科病院"]], P.htype);
  fillSel($("p-owner"), [["", "指定なし"], ...OWNERS.map((x) => [x, x])], P.owner);
  const bins = D.series.filter((s) => s.topic === "beds" && s.shukei === sh && s.scope === "all" && s.group !== "全体").sort((a, b) => a.ord - b.ord).map((s) => [s.group, s.group]);
  fillSel($("p-bed"), [["", "指定なし"], ...bins], P.bed);
  const ny = D.series.filter((s) => s.topic === "nyuin" && s.shukei === sh && s.scope === "all" && s.r[S.round]).sort((a, b) => a.ord - b.ord).map((s) => [`${s.sub}|${s.group}`, `${s.sub.replace("算定病院", "")}：${s.group}`]);
  P.nyuin = fillSel($("p-nyuin"), [["", "指定なし"], ...ny], P.nyuin);
  fillSel($("p-func"), [["", "指定なし"], ["特定機能病院", "特定機能病院"], ["DPC対象病院", "DPC対象病院"], ["こども病院：全体", "こども病院"], ["歯科大学病院", "歯科大学病院"]], P.func);
  fillSel($("p-ryo"), [["", "指定なし"], ...Object.entries(RYO)], P.ryo);
  const g = P.htype === "精神科病院";
  ["p-owner", "p-bed", "p-nyuin", "p-func", "p-ryo"].forEach((id) => { $(id).disabled = g; });
  $("prof-note").textContent = g ? "精神科病院は全体の集計のみ公表されています。" : S.h ? "病院の一覧から自動で入れました。違っていれば直してください。" : "自院を選ぶと自動で入ります。手で指定することもできます。";
}
function renderRound() {
  const R = roundOf(S.round);
  $("fy-seg").innerHTML = [0, 1].map((i) => `<button type="button" role="radio" data-v="${i}" aria-checked="${S.fy === i}">${R.fy[i]}年度</button>`).join("");
}
function renderSelf() {
  $("selfcard").hidden = !S.h; $("filters").classList.toggle("has-self", !!S.h);
  if (!S.h) return;
  const h = S.h;
  $("self-name").textContent = h.name;
  $("self-meta").textContent = [h.pref, h.beds ? `${fmt(h.beds, 0)}床` : null, h.kihon, { DPC: "DPC対象病院", 準備: "DPC準備病院", 出来高: "出来高算定病院" }[h.type], h.corp ? `開設者：${h.corp}` : "開設者不明"].filter(Boolean).join("・");
}
function renderAll() { renderSelf(); renderProfSelects(); renderRound(); renderPeer(); renderTrend(); renderAxis(); syncUrl(); }
function syncUrl() {
  const q = new URLSearchParams();
  if (S.h) q.set("h", S.h.id);
  q.set("round", S.round); q.set("fy", S.fy); q.set("shukei", S.shukei); q.set("scope", S.scope); q.set("ind", S.ind); q.set("axis", S.axis);
  history.replaceState(null, "", "?" + q.toString() + location.hash);
}
function pick(h) { S.h = h; S.prof = h ? profFromHosp(h) : S.prof; S._subTouched = false; S._plTouched = false; $("q").value = h ? h.name : ""; renderAll(); }

function initCombo() {
  const q = $("q"), ul = $("q-list"); let cur = -1, hits = [];
  const close = () => { ul.hidden = true; q.setAttribute("aria-expanded", "false"); };
  const show = () => {
    const k = nk(q.value);
    hits = k ? H.filter((h) => h._k.includes(k)).slice(0, 40) : [];
    cur = -1;
    ul.innerHTML = hits.map((h, i) => `<li role="option" data-i="${i}"><span>${esc(h.name)}</span><span class="m">${esc(h.pref)}・${fmt(h.beds, 0)}床</span></li>`).join("") || (k ? `<li class="muted">該当する病院がありません</li>` : "");
    ul.hidden = !k; q.setAttribute("aria-expanded", String(!!k));
  };
  q.addEventListener("input", show);
  q.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); if (!hits.length) return; cur = (cur + (ev.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length; [...ul.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === cur))); ul.children[cur].scrollIntoView({ block: "nearest" }); }
    else if (ev.key === "Enter" && hits.length) { pick(hits[Math.max(cur, 0)]); close(); }
    else if (ev.key === "Escape") close();
  });
  ul.addEventListener("mousedown", (ev) => { const li = ev.target.closest("li[data-i]"); if (li) { ev.preventDefault(); pick(hits[+li.dataset.i]); close(); } });
  q.addEventListener("blur", () => setTimeout(close, 150));
}

async function main() {
  const [d, hp] = await Promise.all([fetch("data/mes.json").then((r) => r.json()), fetch("data/hosp.json").then((r) => r.json()).catch(() => ({ cols: [], rows: [] }))]);
  D = d; ROUNDS = D.meta.rounds; D.series.forEach((s) => { IDX[keyOf(s)] = s; });
  H = hp.rows.map((r) => { const o = Object.fromEntries(hp.cols.map((c, i) => [c, r[i]])); o._k = nk(o.name); return o; });
  const last = ROUNDS[ROUNDS.length - 1], q = new URLSearchParams(location.search);
  S.round = ROUNDS.some((r) => String(r.round) === q.get("round")) ? q.get("round") : String(last.round);
  S.fy = q.get("fy") === "0" ? 0 : 1; S.shukei = q.get("shukei") === "2" ? 2 : 1; S.scope = q.get("scope") === "ex" ? "ex" : "all";
  S.ind = IND.some((x) => x.k === q.get("ind")) ? q.get("ind") : "pl"; S.axis = AXES.some((x) => x[0] === q.get("axis")) ? q.get("axis") : "owner";
  $("latest-round").textContent = `第${last.round}回`; $("foot-latest").textContent = `第${last.round}回`; $("fy-range").textContent = `${ROUNDS[0].fy[0]}〜${last.fy[1]}`;
  $("foot-built").textContent = `データ作成日：${D.meta.built}`;
  fillSel($("round"), ROUNDS.slice().reverse().map((r) => [String(r.round), `第${r.round}回（${r.year}年実施）`]), S.round);
  fillSel($("ind"), IND.map((x) => [x.k, `${x.l}（${x.u}）`]), S.ind);
  $("axis-seg").innerHTML = AXES.map(([k, l]) => `<button type="button" role="radio" data-v="${k}" aria-checked="${k === S.axis}">${l}</button>`).join("");
  setSeg("shukei-seg", S.shukei); setSeg("scope-seg", S.scope);
  $("round").addEventListener("change", (e) => { S.round = e.target.value; renderAll(); });
  $("ind").addEventListener("change", (e) => { S.ind = e.target.value; renderAll(); });
  onSeg("fy-seg", (v) => { S.fy = +v; renderAll(); });
  onSeg("shukei-seg", (v) => { S.shukei = +v; renderAll(); });
  onSeg("scope-seg", (v) => { S.scope = v; renderAll(); });
  onSeg("axis-seg", (v) => { S.axis = v; S._subTouched = false; S.axisSub = ""; renderAll(); });
  $("axis-sub").addEventListener("change", (e) => { S.axisSub = e.target.value; S._subTouched = true; renderAxis(); });
  $("trend-legend").addEventListener("click", (ev) => { const b = ev.target.closest("button[data-k]"); if (!b) return; const k = b.dataset.k; if (S.hide.has(k)) S.hide.delete(k); else S.hide.add(k); renderTrend(); });
  $("pl-group").addEventListener("change", (e) => { S.plKey = e.target.value; S._plTouched = true; renderPL(axisList()); });
  [["p-htype", "htype"], ["p-owner", "owner"], ["p-bed", "bed"], ["p-nyuin", "nyuin"], ["p-func", "func"], ["p-ryo", "ryo"]].forEach(([id, k]) => $(id).addEventListener("change", (e) => { S.prof[k] = e.target.value; S._subTouched = false; S._plTouched = false; renderAll(); }));
  $("self-clear").addEventListener("click", () => { S.h = null; $("q").value = ""; renderAll(); });
  $("peer-csv").addEventListener("click", () => csv("peer_groups.csv", S._peer.head, S._peer.rows));
  $("pl-csv").addEventListener("click", () => csv(`pl_${S._pl.name}.csv`, S._pl.head, S._pl.rows));
  $("theme-btn").addEventListener("click", () => { const dark = getComputedStyle(document.querySelector(".viz-root")).colorScheme === "dark"; document.documentElement.dataset.theme = dark ? "light" : "dark"; renderAll(); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);
  addEventListener("resize", () => Object.values(S.charts).forEach((c) => c.resize()));
  initCombo();
  const h0 = q.get("h") && H.find((h) => h.id === q.get("h"));
  if (h0) pick(h0); else renderAll();
}
main().catch((e) => { document.querySelector(".lead").textContent = "データを読み込めませんでした：" + e.message; console.error(e); });
