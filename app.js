"use strict";

/* ---------- 数据表 ---------- */
// BV 铜芯线明敷载流量（环境 35℃ 基准），单位 A
const WIRE_BASE = [
  { mm2: 1.5, amps: 24 },
  { mm2: 2.5, amps: 32 },
  { mm2: 4, amps: 42 },
  { mm2: 6, amps: 55 },
  { mm2: 10, amps: 75 },
  { mm2: 16, amps: 100 },
  { mm2: 25, amps: 132 },
  { mm2: 35, amps: 162 },
  { mm2: 50, amps: 200 }
];

const MODE_FACTOR = {
  exposed: 1.0,  // 明敷
  pipe2: 0.80,   // 穿管 2 根
  pipe3: 0.72,   // 穿管 3 根
  pipe4: 0.65    // 穿管 4 根及以上
};

const TEMP_FACTOR = {
  25: 1.15,
  30: 1.07,
  35: 1.00,
  40: 0.92,
  45: 0.84
};

const BREAKERS = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250];

const MODE_NAMES = {
  exposed: "明敷",
  pipe2: "穿管 2 根",
  pipe3: "穿管 3 根",
  pipe4: "穿管 4 根+"
};

const MATERIAL_NAMES = {
  bvr: "BVR 软线",
  bv: "BV 硬线",
  al: "铝线"
};

const PRESETS = [
  { name: "冰箱", kw: 0.2, phase: 1, cos: 1, load: "resistive" },
  { name: "抽油烟机", kw: 0.25, phase: 1, cos: 1, load: "resistive" },
  { name: "电磁炉", kw: 2.2, phase: 1, cos: 1, load: "resistive" },
  { name: "电热水器", kw: 2.5, phase: 1, cos: 1, load: "resistive" },
  { name: "挂机空调 1.5匹", kw: 1.2, phase: 1, cos: 0.85, load: "inductive" },
  { name: "柜机空调 3匹", kw: 2.7, phase: 1, cos: 0.85, load: "inductive" },
  { name: "6kW 淋浴", kw: 6, phase: 1, cos: 1, load: "resistive" },
  { name: "9kW 即热热水器", kw: 9, phase: 1, cos: 1, load: "resistive" },
  { name: "7kW 充电桩", kw: 7, phase: 1, cos: 1, load: "resistive" },
  { name: "7.5kW 三相电机", kw: 7.5, phase: 3, cos: 0.85, load: "inductive" },
  { name: "11kW 三相电机", kw: 11, phase: 3, cos: 0.85, load: "inductive" },
  { name: "15kW 三相动力", kw: 15, phase: 3, cos: 0.85, load: "inductive" },
  { name: "22kW 三相电机", kw: 22, phase: 3, cos: 0.85, load: "inductive" },
  { name: "63A 进线", mode: "current", amps: 63, phase: 3, cos: 1, load: "resistive" },
  { name: "100A 进线", mode: "current", amps: 100, phase: 3, cos: 1, load: "resistive" }
];

/* ---------- 状态 ---------- */
const state = {
  mode: "power",       // power | current
  phase: 1,            // 1 | 3
  cos: 1,
  powerUnit: "kw",     // kw | w | hp
  material: "bvr",     // bvr 多股铜线 | bv 单股铜线 | al 铝线
  load: "resistive",
  install: "pipe2",
  temp: "35"
};

let lastResult = null;

/* ---------- 工具 ---------- */
const $ = (id) => document.getElementById(id);

function fmt(n, digits = 1) {
  const v = Number(n);
  if (!isFinite(v)) return "—";
  return String(Math.round(v * 10 ** digits) / 10 ** digits);
}

function adjustedAmpacity(mm2, install, temp, material) {
  const base = WIRE_BASE.find((w) => w.mm2 === mm2);
  if (!base) return 0;
  const materialFactor = material === "al" ? 0.78 : 1.0;
  return base.amps * materialFactor * MODE_FACTOR[install] * TEMP_FACTOR[temp];
}

/* ---------- 计算核心 ---------- */
function calculate() {
  let I = 0, kW = null;

  if (state.mode === "power") {
    const raw = parseFloat($("power").value);
    if (!(raw > 0)) return null;
    const factor = state.powerUnit === "w" ? 0.001 : state.powerUnit === "hp" ? 0.7355 : 1;
    kW = raw * factor;
    I = state.phase === 3
      ? kW * 1000 / (Math.sqrt(3) * 380 * state.cos)
      : kW * 1000 / (220 * state.cos);
  } else if (state.mode === "current") {
    const amps = parseFloat($("current").value);
    if (!(amps > 0)) return null;
    I = amps;
    kW = state.phase === 3
      ? I * Math.sqrt(3) * 380 * state.cos / 1000
      : I * 220 / 1000;
  } else {
    // 按线径算：给线径 + 敷设条件 → 最大载流量、可带功率、建议空开
    const area = parseFloat($("wire-area").value);
    if (!(area > 0)) return null;
    const ampacity = adjustedAmpacity(area, state.install, state.temp, state.material);
    let breaker = null;
    for (const b of BREAKERS) {
      if (b <= ampacity) breaker = b;
    }
    const kW1 = ampacity * 220 * state.cos / 1000;
    const kW3 = ampacity * Math.sqrt(3) * 380 * state.cos / 1000;
    return {
      wireMode: true,
      I: ampacity,
      kW: state.phase === 3 ? kW3 : kW1,
      kW1,
      kW3,
      need: ampacity,
      wire: { mm2: area },
      breaker,
      margin: 1,
      ampacity
    };
  }

  // 选线裕量：感性负载 ×1.25，阻性 ×1.0
  const margin = state.load === "inductive" ? 1.25 : 1.0;
  const need = I * margin;

  // 1) 找最小截面积：载流量 ≥ 需要值
  let wire = null;
  for (const w of WIRE_BASE) {
    if (adjustedAmpacity(w.mm2, state.install, state.temp, state.material) >= need) {
      wire = w;
      break;
    }
  }

  // 2) 空开：最小标准额定值 ≥ 需要值，且不能超过电线载流量（否则升线径）
  let breaker = null;
  if (wire) {
    for (const b of BREAKERS) {
      if (b < need) continue;
      let w = wire;
      while (adjustedAmpacity(w.mm2, state.install, state.temp, state.material) < b) {
        const idx = WIRE_BASE.indexOf(w);
        if (idx < WIRE_BASE.length - 1) w = WIRE_BASE[idx + 1];
        else break;
      }
      breaker = b;
      wire = w;
      break;
    }
  }

  return {
    I,
    kW,
    need,
    wire,
    breaker,
    margin,
    ampacity: wire ? adjustedAmpacity(wire.mm2, state.install, state.temp, state.material) : null
  };
}

/* ---------- 渲染 ---------- */
function renderPresets() {
  const box = $("presets");
  box.innerHTML = "";
  PRESETS.forEach((p) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = p.name;
    b.onclick = () => applyPreset(p);
    box.appendChild(b);
  });
  $("preset-more").onclick = () => {
    const expanded = $("preset-more").dataset.open === "1";
    box.classList.toggle("collapsed", expanded);
    $("preset-more").dataset.open = expanded ? "" : "1";
    $("preset-more").textContent = expanded ? "更多 ∨" : "收起 ∧";
  };
  $("preset-card").hidden = false;
}

function applyPreset(p) {
  state.mode = p.mode || "power";
  state.phase = p.phase || 1;
  state.cos = p.cos || 1;
  state.load = p.load || "resistive";
  state.powerUnit = "kw";
  syncControls();
  $("power").value = p.kw || "";
  $("current").value = p.amps || "";
  $("wire-area").value = "4";
  doCalculate();
}

function syncControls() {
  document.querySelectorAll("#mode-seg .seg-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === state.mode));
  document.querySelectorAll("#phase-seg .seg-btn").forEach((b) =>
    b.classList.toggle("active", Number(b.dataset.phase) === state.phase));
  $("power-field").hidden = state.mode !== "power";
  $("current-field").hidden = state.mode !== "current";
  $("wire-field").hidden = state.mode !== "wire";
  $("cos-field").hidden = state.mode === "current";
  $("cos").value = state.cos;
  $("cos-val").textContent = state.cos.toFixed(2);
  $("power-unit").value = state.powerUnit;
  $("load-type").value = state.load;
  $("material").value = state.material;
  $("install-mode").value = state.install;
  $("temp").value = state.temp;
  updateCosFill();
}

function recalc() {
  const r = calculate();
  lastResult = r;
  const card = $("result-card");
  if (!r) {
    card.hidden = true;
    renderVdrop();
    return;
  }
  card.hidden = false;
  updateFavBtn(r);

  const adv = $("r-advice");
  const parts = [];
  if (r.wireMode) {
    // 按线径算：最大载流量 / 可带功率 / 建议空开
    $("r-current-label").textContent = "最大可带功率（三相）";
    $("r-current-unit").textContent = "kW";
    $("r-current").textContent = fmt(r.kW3);
    $("r-quick").textContent = `载流量约 ${fmt(r.ampacity, 0)}A · 单相约 ${fmt(r.kW1, 1)}kW / 三相约 ${fmt(r.kW3, 1)}kW（cosφ ${fmt(state.cos, 2)}）`;
    $("r-wire").innerHTML = `${fmt(r.ampacity, 0)} <small>A</small>`;
    $("r-wire-sub").textContent = `${MATERIAL_NAMES[state.material]} ${r.wire.mm2}mm² · ${MODE_NAMES[state.install]}`;
    $("r-breaker").innerHTML = r.breaker ? `${r.breaker} <small>A</small>` : "—";
    $("r-rcd").innerHTML = "按回路用途选 30mA / 300mA";
    adv.className = "advice ok";
    parts.push(`${r.wire.mm2}mm² 载流量约 ${fmt(r.ampacity, 0)}A，建议空开 ${r.breaker || "—"}A（≤载流量，能保护电线）。`);
    parts.push(`按 cosφ ${fmt(state.cos, 2)}：单相 220V 可带约 ${fmt(r.kW1, 1)}kW，三相 380V 可带约 ${fmt(r.kW3, 1)}kW。`);
    if (state.material === "al") {
      parts.push("铝线载流量按铜线约 78% 折算，接头务必压接，必要时搪锡或涂导电膏防氧化。");
    }
  } else if (r.wire && r.breaker) {
    $("r-current-label").textContent = "工作电流";
    $("r-current-unit").textContent = "A";
    $("r-current").textContent = fmt(r.I);
    if (state.mode === "current") {
      $("r-quick").textContent = `反算：约 ${fmt(r.kW, 1)}kW（${state.phase === 3 ? "三相" : "单相"}）`;
    } else {
      const kwPart = state.powerUnit !== "kw" ? `约 ${fmt(r.kW, 1)}kW · ` : "";
      $("r-quick").textContent = state.phase === 3
        ? `${kwPart}速查：约 ${fmt(r.kW * 2, 1)}A（1kW ≈ 2A）`
        : `${kwPart}速查：约 ${fmt(r.kW * 4.5, 1)}A（1kW ≈ 4.5A）`;
    }
    $("r-wire").innerHTML = `${r.wire.mm2} <small>mm²</small>`;
    $("r-wire-sub").textContent = `载流量约 ${fmt(r.ampacity, 0)}A · ${MATERIAL_NAMES[state.material]} · ${MODE_NAMES[state.install]}`;
    $("r-breaker").innerHTML = `${r.breaker} <small>A</small>`;
    $("r-rcd").innerHTML = state.phase === 1
      ? "30mA 漏保"
      : "末端 30mA / 总开 300mA";
    if (r.margin > 1) {
      parts.push(`感性负载已按 ×${fmt(r.margin, 2)} 裕量选线选开。`);
    }
    if (r.breaker >= r.ampacity) {
      adv.className = "advice danger";
      parts.push(`注意：空开 ${r.breaker}A 已接近电线载流量，线径建议再升一档更保险。`);
    } else {
      adv.className = "advice ok";
      parts.push(`空开 ${r.breaker}A ≤ 电线载流量 ${fmt(r.ampacity, 0)}A，能可靠保护电线。`);
    }
    parts.push("家装穿管优先 BV 硬线，弯多穿线用 BVR 软线；大电流或室外可换 YJV 电缆。");
    if (state.material === "al") {
      parts.push("铝线载流量按铜线约 78% 折算，接头务必压接，必要时搪锡或涂导电膏防氧化。");
    }
  } else if (!r.wire) {
    $("r-current-label").textContent = "工作电流";
    $("r-current-unit").textContent = "A";
    adv.className = "advice danger";
    parts.push(`单路需要 ${fmt(r.need, 0)}A 以上载流量，超出常用单线范围。建议：分多路供电，或改用 YJV 电缆并核对敷设条件。`);
  }
  adv.textContent = parts.join("\n");

  saveHistory(r);
  renderHistory();
  renderVdrop();
}

/* ---------- 开始计算 ---------- */
function doCalculate() {
  // 以界面上当前显示的值重新读取，保证点按钮时用的是最新参数
  state.cos = parseFloat($("cos").value) || 1;
  state.load = $("load-type").value;
  state.install = $("install-mode").value;
  state.temp = $("temp").value;
  state.powerUnit = $("power-unit").value;
  state.material = $("material").value;
  updateCosFill();

  recalc();
  const hint = $("input-hint");
  if (lastResult) {
    hint.hidden = true;
    showResultPage();
  } else {
    hint.hidden = false;
    (state.mode === "power" ? $("power") : $("current")).focus();
  }
}

function showResultPage() {
  $("page-input").hidden = true;
  $("page-result").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showInputPage() {
  $("page-result").hidden = true;
  $("page-input").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateCosFill() {
  const pct = Math.round(((state.cos - 0.5) / 0.5) * 100);
  $("cos").style.setProperty("--fill", pct + "%");
}

/* ---------- 电压降（可选） ---------- */
function renderVdrop() {
  const box = $("vdrop-result");
  if (!lastResult || !lastResult.wire) { box.hidden = true; return; }
  const len = parseFloat($("vdrop-len").value);
  if (!(len > 0)) { box.hidden = true; return; }
  box.hidden = false;

  const RHO = state.material === "al" ? 0.0283 : 0.018; // Ω·mm²/m，铜/铝
  const I = lastResult.I;
  const S = lastResult.wire.mm2;
  const dU = state.phase === 3
    ? Math.sqrt(3) * I * len * RHO / S
    : 2 * I * len * RHO / S;
  const pct = dU / (state.phase === 3 ? 380 : 220) * 100;
  const ok = pct <= 5;
  box.className = "vdrop-result " + (ok ? "ok" : "danger");
  box.textContent = `电压降 ${dU.toFixed(1)}V（${pct.toFixed(2)}%）· ${I.toFixed(1)}A × ${len}m × ${S}mm²`
    + (ok
      ? "，在 5% 限值内。"
      : `，已超过 5%（照明回路建议控制在 3% 内）。建议：升一档线径或缩短供电距离。`);
}

/* ---------- 历史记录 ---------- */
const HISTORY_KEY = "sdx_history";

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { return []; }
}

function saveHistory(r) {
  if (!r.wire) return;
  const item = Object.assign({ ts: Date.now() }, currentSnapshot(r));
  const list = loadHistory().filter((h) =>
    !(h.mode === item.mode && h.phase === item.phase && h.value === item.value));
  list.unshift(item);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 8))); } catch {}
}

function renderHistory() {
  const list = loadHistory();
  const card = $("history-card");
  const ul = $("history");
  if (!list.length) { card.hidden = true; return; }
  card.hidden = false;
  ul.innerHTML = "";
  list.forEach((h) => {
    const li = document.createElement("li");
    const left = document.createElement("div");
    const right = document.createElement("div");
    left.className = "h-main";
    right.className = "h-right";
    const unitLabel = h.mode === "wire" ? "mm²"
      : h.mode === "power" ? ({ kw: "kW", w: "W", hp: "HP" }[h.unit] || "kW") : "A";
    left.textContent = `${h.value}${unitLabel} · ${h.phase === 3 ? "三相" : "单相"}`
      + (h.mode === "power" ? ` · ${MODE_NAMES[h.install]}` : "");
    const sub = document.createElement("div");
    sub.className = "h-sub";
    sub.textContent = `${MATERIAL_NAMES[h.material] || "BVR"} · ${MODE_NAMES[h.install]} · `
      + new Date(h.ts).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    left.appendChild(sub);
    right.textContent = `${h.wire}mm² / ${h.breaker}A`;
    li.append(left, right);
    li.onclick = () => {
      state.mode = h.mode;
      state.phase = h.phase;
      state.cos = h.cos;
      state.load = h.load;
      state.powerUnit = h.unit || "kw";
      state.material = h.material || "bvr";
      state.install = h.install;
      state.temp = h.temp;
      syncControls();
      if (h.mode === "power") { $("power").value = h.value; $("current").value = ""; }
      else if (h.mode === "wire") { $("wire-area").value = h.value; $("power").value = ""; $("current").value = ""; }
      else { $("current").value = h.value; $("power").value = ""; }
      doCalculate();
    };
    ul.appendChild(li);
  });
}

/* ---------- 事件绑定 ---------- */
function bindEvents() {
  document.querySelectorAll("#mode-seg .seg-btn").forEach((b) => {
    b.onclick = () => {
      state.mode = b.dataset.mode;
      syncControls();
    };
  });

  document.querySelectorAll("#phase-seg .seg-btn").forEach((b) => {
    b.onclick = () => {
      state.phase = Number(b.dataset.phase);
      syncControls();
    };
  });

  $("calc-btn").onclick = doCalculate;
  $("back-btn").onclick = showInputPage;
  $("recalc-btn").onclick = showInputPage;
  ["power", "current", "vdrop-len"].forEach((id) => {
    $(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doCalculate();
      }
    });
  });
  $("cos").addEventListener("input", () => {
    state.cos = parseFloat($("cos").value);
    $("cos-val").textContent = state.cos.toFixed(2);
    updateCosFill();
  });
  $("power-unit").addEventListener("change", (e) => { state.powerUnit = e.target.value; });
  $("material").addEventListener("change", (e) => { state.material = e.target.value; });
  $("load-type").addEventListener("change", (e) => { state.load = e.target.value; });
  $("install-mode").addEventListener("change", (e) => { state.install = e.target.value; });
  $("temp").addEventListener("change", (e) => { state.temp = e.target.value; });
  $("vdrop-len").addEventListener("input", renderVdrop);
  $("clear-history").onclick = () => {
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
    renderHistory();
  };
}

/* ============================================================
 * 底部导航 / 提示
 * ============================================================ */
const TABS = ["home", "calc", "data", "formula", "fav", "settings"];

function switchTab(tab) {
  document.querySelectorAll("#tabbar .tab-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tab));
  TABS.forEach((t) => { $("tab-" + t).hidden = t !== tab; });
  window.scrollTo({ top: 0 });
  if (tab === "fav") renderFavorites();
  if (tab === "formula") {
    $("formula-list").dataset.rendered = "";
    renderFormulas();
  }
}

let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

function maybeShowInstallHint() {
  try {
    if (localStorage.getItem("sdx_install_hint")) return;
  } catch {}
  const isStandalone = navigator.standalone === true
    || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  if (isStandalone) return;
  const ua = navigator.userAgent || "";
  if (!/Android|iPhone|iPad|iPod/i.test(ua)) return;
  $("install-hint").hidden = false;
  $("install-close").onclick = () => {
    $("install-hint").hidden = true;
    try { localStorage.setItem("sdx_install_hint", "1"); } catch {}
  };
}

/* ============================================================
 * 收藏（数据）
 * ============================================================ */
const FAV_KEY = "sdx_favs";

function currentSnapshot(r) {
  return {
    mode: state.mode,
    phase: state.phase,
    cos: state.cos,
    powerUnit: state.powerUnit,
    unit: state.powerUnit,
    material: state.material,
    load: state.load,
    install: state.install,
    temp: state.temp,
    vdropLen: parseFloat($("vdrop-len").value) || null,
    value: state.mode === "power" ? parseFloat($("power").value)
      : state.mode === "wire" ? parseFloat($("wire-area").value)
        : parseFloat($("current").value),
    I: r.I,
    kW1: r.kW1 || null,
    kW3: r.kW3 || null,
    wire: r.wire ? r.wire.mm2 : null,
    breaker: r.breaker
  };
}

function snapshotKey(s) {
  return [s.mode, s.phase, s.value, s.material, s.install, s.temp, s.cos].join("|");
}

function loadFavs() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch { return []; }
}

function saveFavs(list) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch {}
}

function isSameFav(a, b) {
  if (a.type !== b.type) return false;
  if (a.type === "formula") return a.formulaId === b.formulaId;
  return snapshotKey(a.snapshot || {}) === snapshotKey(b.snapshot || {});
}

function updateFavBtn(r) {
  const btn = $("fav-btn");
  if (!r || !r.wire) {
    btn.textContent = "☆ 收藏";
    btn.classList.remove("faved");
    return;
  }
  const key = snapshotKey(currentSnapshot(r));
  const faved = loadFavs().some((f) => f.type === "calc" && snapshotKey(f.snapshot || {}) === key);
  btn.textContent = faved ? "★ 已收藏" : "☆ 收藏";
  btn.classList.toggle("faved", faved);
}

function toggleFavCalc() {
  if (!lastResult || !lastResult.wire) { toast("请先完成计算再收藏"); return; }
  const snap = currentSnapshot(lastResult);
  const favs = loadFavs();
  const key = snapshotKey(snap);
  const idx = favs.findIndex((f) => f.type === "calc" && snapshotKey(f.snapshot || {}) === key);
  if (idx >= 0) {
    favs.splice(idx, 1);
    toast("已取消收藏");
  } else {
    favs.unshift({ type: "calc", ts: Date.now(), snapshot: snap });
    toast("已收藏到收藏页");
  }
  saveFavs(favs);
  updateFavBtn(lastResult);
  renderFavorites();
}

/* ============================================================
 * 公式库
 * ============================================================ */
const FORMULAS = [
  { id: "q3", group: "选配速算", name: "三相电流速算", formula: "I ≈ 2 × P(kW)", desc: "380V 感性负载 1kW ≈ 2A，选空开/计量最常用。", go: "calc" },
  { id: "q1", group: "选配速算", name: "单相电流速算", formula: "I ≈ 4.5 × P(kW)", desc: "220V 阻性负载 1kW ≈ 4.5A。", go: "calc" },
  { id: "i3", group: "选配速算", name: "三相电流反算", formula: "I = P ÷ (√3 × U × cosφ)", desc: "380V 现场估：1kW ≈ 2A。", go: "calc" },
  { id: "i1", group: "选配速算", name: "单相电流反算", formula: "I = P ÷ (U × cosφ)", desc: "220V 现场估：1kW ≈ 4.5A。", go: "calc" },
  { id: "p3", group: "选配速算", name: "三相功率", formula: "P = √3 × U × I × cosφ", desc: "线电压 380V 时常用。", go: "calc" },
  { id: "p1", group: "选配速算", name: "单相功率", formula: "P = U × I × cosφ", desc: "有功功率 = 电压 × 电流 × 功率因数。", go: "calc" },
  { id: "select", group: "选配速算", name: "选线条件", formula: "载流量 ≥ 计算电流 × 裕量", desc: "感性负载按 ×1.25 留裕量，再配不超过载流量的空开。", go: "calc" },
  { id: "vd3", group: "选配速算", name: "三相电压降", formula: "ΔU = √3 × I × L × ρ ÷ S", desc: "长线路校核用。", go: "data" },
  { id: "vd1", group: "选配速算", name: "单相电压降", formula: "ΔU = 2 × I × L × ρ ÷ S", desc: "零火两根线，长度按单程算。", go: "data" },
  { id: "vdp", group: "选配速算", name: "压降百分比", formula: "ΔU% = ΔU ÷ U × 100%", desc: "一般 ≤5%，照明建议 ≤3%。", go: "data" },
  { id: "koujue", group: "选配速算", name: "载流量口诀", formula: "十下五，百上二；二五三五，四三界…", desc: "口诀快速估算载流量，适合现场粗算，最终以表格/规范为准。", go: "calc" },
  { id: "ohm", group: "电学基础", name: "欧姆定律", formula: "U = I × R", desc: "电压 = 电流 × 电阻。单位：V、A、Ω。", go: "data" },
  { id: "res", group: "电学基础", name: "导体电阻", formula: "R = ρ × L ÷ S", desc: "铜 ρ≈0.0175，铝 ρ≈0.0283 Ω·mm²/m（20℃）。", go: "data" },
  { id: "cond", group: "电学基础", name: "电导", formula: "G = 1 ÷ R", desc: "电导是电阻的倒数，单位 S（西门子）。", go: "data" },
  { id: "joule", group: "电学基础", name: "焦耳定律", formula: "Q = I² × R × t", desc: "导体发热量，判断温升用。", go: "" }
];

function renderFormulas() {
  const box = $("formula-list");
  if (box.dataset.rendered) return;
  box.dataset.rendered = "1";
  const favs = loadFavs();
  let html = "";
  let lastGroup = "";
  for (const f of FORMULAS) {
    if (f.group !== lastGroup) {
      html += `<div class="formula-group-title">${f.group}</div>`;
      lastGroup = f.group;
    }
    const faved = favs.some((x) => x.type === "formula" && x.formulaId === f.id);
    const mc = MINI_CALCS[f.id];
    const mcHtml = mc ? `
      <div class="mini-calc" data-mc="${f.id}" hidden>
        ${mc.inputs.map((inp, i) => `
          <label class="mini-field">
            <span>${inp.label}</span>
            <div class="input-wrap">
              <input type="number" step="any" data-mc-input="${i}" value="${inp.def}">
              <span class="unit">${inp.unit}</span>
            </div>
          </label>`).join("")}
        <button class="mini-btn" data-mc-run="${f.id}" type="button">计算</button>
        <div class="mini-out" data-mc-out="${f.id}" hidden></div>
      </div>` : "";
    html += `
      <div class="formula-item">
        <div class="formula-head">
          <span class="formula-name">${f.name}</span>
          <button class="mini-btn ${faved ? "faved" : ""}" data-fav-formula="${f.id}" type="button">${faved ? "★ 已收藏" : "☆ 收藏"}</button>
        </div>
        <div class="formula-expr">${f.formula}</div>
        <div class="formula-desc">${f.desc}</div>
        <div class="formula-actions">
          ${f.go ? `<button class="mini-btn" data-go="${f.go}" type="button">去计算</button>` : ""}
          ${mc ? `<button class="mini-btn" data-mc-toggle="${f.id}" type="button">试试算</button>` : ""}
        </div>
        ${mcHtml}
      </div>`;
  }
  box.innerHTML = html;
  box.querySelectorAll("[data-fav-formula]").forEach((b) => {
    b.onclick = () => toggleFavFormula(b.dataset.favFormula, b);
  });
  box.querySelectorAll("[data-go]").forEach((b) => {
    b.onclick = () => switchTab(b.dataset.go === "data" ? "data" : "calc");
  });
  box.querySelectorAll("[data-mc-toggle]").forEach((b) => {
    b.onclick = () => {
      const mc = box.querySelector(`[data-mc="${b.dataset.mcToggle}"]`);
      if (mc) mc.hidden = !mc.hidden;
    };
  });
  box.querySelectorAll("[data-mc-run]").forEach((b) => {
    b.onclick = () => runMiniCalc(b.dataset.mcRun);
  });
}

function runMiniCalc(id) {
  const f = FORMULAS.find((x) => x.id === id);
  const cfg = MINI_CALCS[id];
  if (!f || !cfg) return;
  const mc = document.querySelector(`[data-mc="${id}"]`);
  if (!mc) return;
  const vals = {};
  mc.querySelectorAll("[data-mc-input]").forEach((inp) => {
    vals[cfg.inputs[Number(inp.dataset.mcInput)].k] = parseFloat(inp.value) || 0;
  });
  const out = mc.querySelector(`[data-mc-out="${id}"]`);
  out.textContent = cfg.out(vals);
  out.hidden = false;
}

const MINI_CALCS = {
  ohm: {
    inputs: [
      { k: "I", label: "电流 I", unit: "A", def: "10" },
      { k: "R", label: "电阻 R", unit: "Ω", def: "2" }
    ],
    out: (v) => `U = ${v.I} × ${v.R} = ${(v.I * v.R).toFixed(2)} V`
  },
  p1: {
    inputs: [
      { k: "U", label: "电压 U", unit: "V", def: "220" },
      { k: "I", label: "电流 I", unit: "A", def: "10" },
      { k: "cos", label: "cosφ", unit: "", def: "1" }
    ],
    out: (v) => {
      const p = v.U * v.I * v.cos;
      return `P = ${v.U}×${v.I}×${v.cos} = ${fmt(p, 0)} W（${fmt(p / 1000, 2)} kW）`;
    }
  },
  p3: {
    inputs: [
      { k: "U", label: "线电压 U", unit: "V", def: "380" },
      { k: "I", label: "电流 I", unit: "A", def: "10" },
      { k: "cos", label: "cosφ", unit: "", def: "0.85" }
    ],
    out: (v) => {
      const p = Math.sqrt(3) * v.U * v.I * v.cos;
      return `P = √3×${v.U}×${v.I}×${v.cos} = ${fmt(p, 0)} W（${fmt(p / 1000, 2)} kW）`;
    }
  },
  i1: {
    inputs: [
      { k: "P", label: "功率 P", unit: "W", def: "2200" },
      { k: "U", label: "电压 U", unit: "V", def: "220" },
      { k: "cos", label: "cosφ", unit: "", def: "1" }
    ],
    out: (v) => `I = ${v.P}÷(${v.U}×${v.cos}) = ${fmt(v.P / (v.U * v.cos), 2)} A`
  },
  i3: {
    inputs: [
      { k: "P", label: "功率 P", unit: "W", def: "15000" },
      { k: "U", label: "线电压 U", unit: "V", def: "380" },
      { k: "cos", label: "cosφ", unit: "", def: "0.85" }
    ],
    out: (v) => `I = ${v.P}÷(√3×${v.U}×${v.cos}) = ${fmt(v.P / (Math.sqrt(3) * v.U * v.cos), 2)} A`
  },
  joule: {
    inputs: [
      { k: "I", label: "电流 I", unit: "A", def: "10" },
      { k: "R", label: "电阻 R", unit: "Ω", def: "2" },
      { k: "t", label: "时间 t", unit: "s", def: "3600" }
    ],
    out: (v) => {
      const q = v.I * v.I * v.R * v.t;
      return `Q = ${v.I}²×${v.R}×${v.t} = ${fmt(q, 0)} J（约 ${fmt(q / 3600000, 3)} kWh）`;
    }
  },
  res: {
    inputs: [
      { k: "rho", label: "电阻率 ρ", unit: "Ω·mm²/m", def: "0.0175" },
      { k: "L", label: "长度 L", unit: "m", def: "100" },
      { k: "S", label: "截面积 S", unit: "mm²", def: "4" }
    ],
    out: (v) => `R = ${v.rho}×${v.L}÷${v.S} = ${(v.rho * v.L / v.S).toFixed(4)} Ω`
  },
  vd1: {
    inputs: [
      { k: "I", label: "电流 I", unit: "A", def: "27" },
      { k: "L", label: "长度 L", unit: "m", def: "50" },
      { k: "rho", label: "电阻率 ρ", unit: "Ω·mm²/m", def: "0.018" },
      { k: "S", label: "截面积 S", unit: "mm²", def: "4" }
    ],
    out: (v) => `ΔU = 2×${v.I}×${v.L}×${v.rho}÷${v.S} = ${fmt(2 * v.I * v.L * v.rho / v.S, 1)} V`
  },
  vd3: {
    inputs: [
      { k: "I", label: "电流 I", unit: "A", def: "27" },
      { k: "L", label: "长度 L", unit: "m", def: "50" },
      { k: "rho", label: "电阻率 ρ", unit: "Ω·mm²/m", def: "0.018" },
      { k: "S", label: "截面积 S", unit: "mm²", def: "4" }
    ],
    out: (v) => `ΔU = √3×${v.I}×${v.L}×${v.rho}÷${v.S} = ${fmt(Math.sqrt(3) * v.I * v.L * v.rho / v.S, 1)} V`
  },
  vdp: {
    inputs: [
      { k: "dU", label: "压降 ΔU", unit: "V", def: "12" },
      { k: "U", label: "系统电压 U", unit: "V", def: "220" }
    ],
    out: (v) => `ΔU% = ${v.dU}÷${v.U}×100% = ${fmt(v.dU / v.U * 100, 2)}%`
  }
};

function toggleFavFormula(id, btn) {
  const favs = loadFavs();
  const idx = favs.findIndex((x) => x.type === "formula" && x.formulaId === id);
  const nowFaved = idx < 0;
  if (nowFaved) {
    favs.unshift({ type: "formula", formulaId: id, ts: Date.now() });
    toast("已收藏公式");
  } else {
    favs.splice(idx, 1);
    toast("已取消收藏");
  }
  saveFavs(favs);
  btn.textContent = nowFaved ? "★ 已收藏" : "☆ 收藏";
  btn.classList.toggle("faved", nowFaved);
}

/* ============================================================
 * 收藏（渲染 / 导出 / 分享）
 * ============================================================ */
function renderFavorites() {
  const favs = loadFavs();
  const calcs = favs.filter((f) => f.type === "calc");
  const formulas = favs.filter((f) => f.type === "formula");
  $("fav-empty").hidden = favs.length > 0;
  const ulC = $("fav-calcs");
  const ulF = $("fav-formulas");
  ulC.innerHTML = "";
  ulF.innerHTML = "";
  for (const f of calcs) renderFavCalc(f, ulC);
  for (const f of formulas) renderFavFormula(f, ulF);
}

function favUnitLabel(h) {
  if (h.mode === "wire") return "mm²";
  return h.mode === "power" ? ({ kw: "kW", w: "W", hp: "HP" }[h.unit || h.powerUnit] || "kW") : "A";
}

function mkMini(label, fn) {
  const b = document.createElement("button");
  b.className = "mini-btn";
  b.type = "button";
  b.textContent = label;
  b.onclick = fn;
  return b;
}

function removeFav(f) {
  saveFavs(loadFavs().filter((x) => !isSameFav(x, f)));
  renderFavorites();
  toast("已删除");
}

function renderFavCalc(f, ul) {
  const h = f.snapshot || {};
  const li = document.createElement("li");
  li.className = "fav-item";
  const main = document.createElement("div");
  main.className = "fav-main";
  main.textContent = `${h.value}${favUnitLabel(h)} · ${h.phase === 3 ? "三相" : "单相"} · ${h.wire}mm² / ${h.breaker}A`;
  const sub = document.createElement("div");
  sub.className = "fav-sub";
  sub.textContent = `${MATERIAL_NAMES[h.material] || "BVR 软线"} · ${MODE_NAMES[h.install] || "穿管 2 根"} · `
    + new Date(f.ts).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const row = document.createElement("div");
  row.className = "fav-actions-row";
  row.append(mkMini("打开计算", () => openFavCalc(h)), mkMini("分享", () => shareText(calcShareText(h))), mkMini("删除", () => removeFav(f)));
  li.append(main, sub, row);
  ul.appendChild(li);
}

function renderFavFormula(f, ul) {
  const fo = FORMULAS.find((x) => x.id === f.formulaId);
  if (!fo) return;
  const li = document.createElement("li");
  li.className = "fav-item";
  const main = document.createElement("div");
  main.className = "fav-main";
  main.textContent = fo.name;
  const expr = document.createElement("div");
  expr.className = "fav-formula";
  expr.textContent = fo.formula;
  const row = document.createElement("div");
  row.className = "fav-actions-row";
  row.append(mkMini("查看", () => switchTab("formula")), mkMini("复制", () => { copyText(`${fo.name}：${fo.formula}`); toast("已复制"); }), mkMini("删除", () => removeFav(f)));
  li.append(main, expr, row);
  ul.appendChild(li);
}

function openFavCalc(h) {
  state.mode = h.mode || "power";
  state.phase = h.phase;
  state.cos = h.cos;
  state.load = h.load;
  state.powerUnit = h.unit || h.powerUnit || "kw";
  state.material = h.material || "bvr";
  state.install = h.install;
  state.temp = h.temp;
  syncControls();
  if (state.mode === "power") { $("power").value = h.value; $("current").value = ""; }
  else if (state.mode === "wire") { $("wire-area").value = h.value; $("power").value = ""; $("current").value = ""; }
  else { $("current").value = h.value; $("power").value = ""; }
  switchTab("calc");
  doCalculate();
}

function calcShareText(h) {
  if (h.mode === "wire") {
    return `电工计算：${h.value}mm²（${MATERIAL_NAMES[h.material] || "BVR 软线"}·${MODE_NAMES[h.install] || "穿管 2 根"}）载流量约 ${fmt(h.I, 0)}A，可带单相约 ${fmt(h.kW1, 1)}kW / 三相约 ${fmt(h.kW3, 1)}kW，建议空开 ${h.breaker}A。`;
  }
  return `电工计算：${h.value}${favUnitLabel(h)}（${h.phase === 3 ? "三相" : "单相"}）→ 电流约 ${fmt(h.I, 1)}A，最小线径 ${h.wire}mm²，建议空开 ${h.breaker}A（${MATERIAL_NAMES[h.material] || "BVR 软线"}·${MODE_NAMES[h.install] || "穿管 2 根"}）`;
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return fallbackCopy(text);
}

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch {}
  ta.remove();
}

function shareText(text) {
  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
  } else {
    copyText(text);
    toast("已复制到剪贴板");
  }
}

function exportFavs() {
  const favs = loadFavs();
  if (!favs.length) { toast("暂无收藏可导出"); return; }
  const data = { app: "电工计算", version: "1.1", exportedAt: new Date().toISOString(), items: favs };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "电工计算收藏.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("已导出收藏 JSON");
}

function copyAllFavs() {
  const favs = loadFavs();
  if (!favs.length) { toast("暂无收藏可复制"); return; }
  const lines = [];
  for (const f of favs) {
    if (f.type === "calc") lines.push(calcShareText(f.snapshot || {}));
    else {
      const fo = FORMULAS.find((x) => x.id === f.formulaId);
      if (fo) lines.push(`【公式】${fo.name}：${fo.formula}`);
    }
  }
  shareText(lines.join("\n"));
}

/* ============================================================
 * 设置（默认参数）
 * ============================================================ */
const DEFAULTS_KEY = "sdx_defaults";

function loadDefaults() {
  try {
    const d = JSON.parse(localStorage.getItem(DEFAULTS_KEY));
    if (!d) return;
    if (d.material) state.material = d.material;
    if (d.install) state.install = d.install;
    if (d.temp) state.temp = d.temp;
  } catch {}
}

function saveDefaults() {
  try {
    localStorage.setItem(DEFAULTS_KEY, JSON.stringify({ material: state.material, install: state.install, temp: state.temp }));
  } catch {}
}

function syncSettingsControls() {
  $("set-material").value = state.material;
  $("set-install").value = state.install;
  $("set-temp").value = state.temp;
}

/* ============================================================
 * 资料页计算器
 * ============================================================ */
const AREAS = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240];

function fillAreaSelect(sel, selected) {
  sel.innerHTML = "";
  for (const a of AREAS) {
    const o = document.createElement("option");
    o.value = a;
    o.textContent = a + " mm²";
    sel.appendChild(o);
  }
  sel.value = String(selected || 4);
}

function calcMaterialR() {
  const rho = parseFloat($("mat-r-material").value);
  const len = parseFloat($("mat-r-len").value);
  const area = parseFloat($("mat-r-area").value);
  const box = $("mat-r-result");
  if (!(len > 0) || !(area > 0)) {
    box.hidden = false;
    box.className = "vdrop-result danger";
    box.textContent = "请填写长度和截面积。";
    return;
  }
  const R = rho * len / area;
  box.hidden = false;
  box.className = "vdrop-result ok";
  box.textContent = `R = ${R.toFixed(4)} Ω（约 ${(R / len * 1000).toFixed(3)} Ω/km），G = ${(1 / R).toFixed(3)} S。温度升高电阻增大，现场以实测为准。`;
}

let vdPhase = 1;

function calcVd() {
  const I = parseFloat($("vd-current").value);
  const L = parseFloat($("vd-len").value);
  const rho = parseFloat($("vd-material").value);
  const S = parseFloat($("vd-area").value);
  const U = parseFloat($("vd-voltage").value);
  const box = $("vd-result");
  if (!(I > 0) || !(L > 0) || !(S > 0)) {
    box.hidden = false;
    box.className = "vdrop-result danger";
    box.textContent = "请填写电流、长度和截面积。";
    return;
  }
  const k = vdPhase === 3 ? Math.sqrt(3) : 2;
  const dU = k * I * L * rho / S;
  const pct = dU / U * 100;
  const lmax5 = 0.05 * U * S / (k * I * rho);
  const lmax3 = 0.03 * U * S / (k * I * rho);
  box.hidden = false;
  box.className = "vdrop-result " + (pct <= 5 ? "ok" : "danger");
  box.textContent = `电压降 ${dU.toFixed(1)}V（${pct.toFixed(2)}%）`
    + (pct <= 5 ? "，在 5% 限值内。" : "，已超过 5%。")
    + `\n反算：5% 限值最大 ${Math.floor(lmax5)}m；3% 限值最大 ${Math.floor(lmax3)}m。`;
}

function calcCable() {
  const type = $("cable-type").value;
  const cores = parseInt($("cable-cores").value, 10);
  const area = parseFloat($("cable-area").value);
  const len = parseFloat($("cable-len").value);
  const box = $("cable-result");
  if (!(area > 0)) {
    box.hidden = false;
    box.className = "vdrop-result danger";
    box.textContent = "请选择截面积。";
    return;
  }
  const r = Math.sqrt(area / Math.PI);
  const cond = area * (type === "YJLV" ? 2.70 : 8.89) * 1.02;
  let insT, insDens;
  if (type === "BV" || type === "BVR") {
    insT = area <= 16 ? 0.8 : area <= 50 ? 1.0 : 1.2;
    insDens = 1.40;
  } else {
    insT = Math.min(2.5, Math.max(0.7, 0.8 + area / 160));
    insDens = 0.92;
  }
  const insArea = Math.PI * ((r + insT) ** 2 - r * r);
  const perCore = cond + insArea * insDens;
  let D, weight;
  if (type === "BV" || type === "BVR") {
    D = 2 * (r + insT);
    weight = perCore;
  } else {
    const pack = { 3: 2.16, 4: 2.41, 5: 2.70 }[cores] || 2.16;
    const bundleR = pack * (r + insT);
    const sheathT = 2.0;
    D = 2 * (bundleR + sheathT);
    weight = cores * perCore * 1.08 + Math.PI * ((bundleR + sheathT) ** 2 - bundleR * bundleR) * 1.40;
  }
  const total = len > 0 ? weight * len / 1000 : null;
  box.hidden = false;
  box.className = "vdrop-result ok";
  box.textContent = `${type} ${cores}×${area}mm²：外径约 ${fmt(D, 1)}mm，重量约 ${fmt(weight, 0)} kg/km`
    + (total ? `；${fmt(len, 0)}m 总重约 ${fmt(total, 1)} kg` : "")
    + "（密度法估算，供参考）。";
}

/* ============================================================
 * 额外事件
 * ============================================================ */
function bindExtraEvents() {
  document.querySelectorAll("#tabbar .tab-btn").forEach((b) => {
    b.onclick = () => switchTab(b.dataset.tab);
  });

  document.querySelectorAll(".home-item").forEach((b) => {
    b.onclick = () => {
      if (b.dataset.goTool === "wire") {
        state.mode = "wire";
        syncControls();
      }
      switchTab(b.dataset.goTab);
      if (b.dataset.goTool && b.dataset.goTool !== "wire") {
        const target = document.getElementById(b.dataset.goTool);
        if (target) {
          setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
        }
      }
    };
  });

  document.querySelectorAll("#tool-nav button").forEach((b) => {
    b.onclick = () => {
      const target = document.getElementById(b.dataset.tool);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  });

  $("fav-btn").onclick = toggleFavCalc;

  document.querySelectorAll("#vd-phase-seg .seg-btn").forEach((b) => {
    b.onclick = () => {
      vdPhase = Number(b.dataset.vdPhase);
      document.querySelectorAll("#vd-phase-seg .seg-btn").forEach((x) => x.classList.toggle("active", x === b));
      $("vd-voltage").value = vdPhase === 3 ? "380" : "220";
    };
  });

  $("mat-r-btn").onclick = calcMaterialR;
  $("vd-btn").onclick = calcVd;
  $("cable-btn").onclick = calcCable;
  $("cable-type").addEventListener("change", () => {
    const type = $("cable-type").value;
    const isWire = type === "BV" || type === "BVR";
    $("cable-cores").value = isWire ? "1" : "4";
    $("cable-cores").disabled = isWire;
  });

  $("fav-export").onclick = exportFavs;
  $("fav-copy").onclick = copyAllFavs;
  $("fav-clear").onclick = () => {
    if (confirm("确定清空全部收藏？")) {
      saveFavs([]);
      renderFavorites();
      toast("已清空收藏");
    }
  };

  $("set-material").addEventListener("change", (e) => { state.material = e.target.value; saveDefaults(); syncControls(); syncSettingsControls(); });
  $("set-install").addEventListener("change", (e) => { state.install = e.target.value; saveDefaults(); syncControls(); syncSettingsControls(); });
  $("set-temp").addEventListener("change", (e) => { state.temp = e.target.value; saveDefaults(); syncControls(); syncSettingsControls(); });
  $("set-export").onclick = exportFavs;
  $("set-clear-history").onclick = () => {
    if (confirm("确定清空历史记录？")) {
      try { localStorage.removeItem(HISTORY_KEY); } catch {}
      renderHistory();
      toast("已清空历史");
    }
  };
  $("set-clear-favs").onclick = () => {
    if (confirm("确定清空全部收藏？")) {
      saveFavs([]);
      renderFavorites();
      toast("已清空收藏");
    }
  };

  // ---- 一档功能：配电箱标注卡 ----
  $("label-btn").onclick = copyLabelCard;

  // ---- 一档功能：载流量速查表 ----
  ["amp-material", "amp-install", "amp-temp"].forEach((id) => {
    $(id).addEventListener("change", renderAmpTable);
  });

  // ---- 一档功能：电机选型 ----
  $("motor-btn").onclick = calcMotor;

  // ---- 二档功能：总负荷统计 ----
  $("load-add").onclick = () => {
    loadRows.push({ name: "", kw: 0, phase: "1" });
    renderLoadRows();
  };
  $("load-kx").addEventListener("input", () => {
    $("load-kx-val").textContent = Number($("load-kx").value).toFixed(2);
  });
  $("load-btn").onclick = calcLoad;

  // ---- 二档功能：显示设置 ----
  $("set-large").addEventListener("change", (e) => {
    uiSettings.largeText = e.target.checked;
    saveUISettings();
    applyUISettings();
  });
  $("set-contrast").addEventListener("change", (e) => {
    uiSettings.highContrast = e.target.checked;
    saveUISettings();
    applyUISettings();
  });

  // ---- 二档功能：全量备份 ----
  $("set-export-all").onclick = exportAllData;
  $("set-import-all").onclick = () => $("import-file").click();
  $("import-file").addEventListener("change", (e) => {
    importAllData(e.target.files && e.target.files[0]);
    e.target.value = "";
  });

  // ---- 单位换算 ----
  $("conv-type").addEventListener("change", fillConvFrom);
  $("conv-from").addEventListener("change", updateConvUnit);
  $("conv-value").addEventListener("input", convertValue);

  // ---- 简易计算器 ----
  $("calc-pad").querySelectorAll("button").forEach((b) => {
    b.onclick = () => calcPress(b.dataset.k);
  });
  $("calc-apply").onclick = applyCalcToMain;
}

/* ============================================================
 * 单位换算
 * ============================================================ */
const CONV_TYPES = {
  power: {
    units: [{ k: "kw", name: "kW" }, { k: "w", name: "W" }, { k: "hp", name: "HP（公制）" }],
    toBase: { kw: (v) => v * 1000, w: (v) => v, hp: (v) => v * 735.5 },
    fromBase: { kw: (v) => v / 1000, w: (v) => v, hp: (v) => v / 735.5 }
  },
  length: {
    units: [{ k: "m", name: "米 m" }, { k: "cm", name: "厘米 cm" }, { k: "mm", name: "毫米 mm" }, { k: "ft", name: "英尺 ft" }, { k: "in", name: "英寸 in" }],
    toBase: { m: (v) => v * 1000, cm: (v) => v * 10, mm: (v) => v, ft: (v) => v * 304.8, in: (v) => v * 25.4 },
    fromBase: { m: (v) => v / 1000, cm: (v) => v / 10, mm: (v) => v, ft: (v) => v / 304.8, in: (v) => v / 25.4 }
  },
  temp: {
    units: [{ k: "c", name: "℃" }, { k: "f", name: "℉" }]
  },
  awg: {
    units: [{ k: "mm2", name: "截面积 mm²" }, { k: "awg", name: "AWG 号" }]
  }
};

const CONV_UNIT_LABEL = {
  power: { kw: "kW", w: "W", hp: "HP" },
  length: { m: "m", cm: "cm", mm: "mm", ft: "ft", in: "in" },
  temp: { c: "℃", f: "℉" },
  awg: { mm2: "mm²", awg: "AWG" }
};

function fillConvFrom() {
  const type = $("conv-type").value;
  const units = CONV_TYPES[type].units;
  const from = $("conv-from");
  const cur = from.value;
  from.innerHTML = "";
  for (const u of units) {
    const o = document.createElement("option");
    o.value = u.k;
    o.textContent = u.name;
    from.appendChild(o);
  }
  from.value = units.some((u) => u.k === cur) ? cur : units[0].k;
  updateConvUnit();
}

function updateConvUnit() {
  const type = $("conv-type").value;
  const from = $("conv-from").value;
  $("conv-unit").textContent = CONV_UNIT_LABEL[type][from] || "—";
  convertValue();
}

function fmtConv(v) {
  if (!isFinite(v)) return "—";
  if (Math.abs(v) >= 100000 || (Math.abs(v) < 0.001 && v !== 0)) return v.toExponential(3);
  return String(Math.round(v * 10000) / 10000);
}

function mm2toAWG(area) {
  const d = 2 * Math.sqrt(area / Math.PI);
  let awg = Math.round(36 - 39 * Math.log(d / 0.127) / Math.log(92));
  if (awg < 0) awg = 0;
  if (awg > 40) awg = 40;
  return { awg, d };
}

function awgToMM2(awg) {
  const d = 0.127 * Math.pow(92, (36 - awg) / 39);
  return { d, area: Math.PI * d * d / 4 };
}

function convertValue() {
  const type = $("conv-type").value;
  const from = $("conv-from").value;
  const raw = parseFloat($("conv-value").value);
  const box = $("conv-result");
  if (!(raw >= 0) || isNaN(raw)) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.className = "vdrop-result ok";
  if (type === "power") {
    const base = CONV_TYPES.power.toBase[from](raw);
    const parts = [];
    for (const u of CONV_TYPES.power.units) {
      parts.push(`${fmtConv(CONV_TYPES.power.fromBase[u.k](base))} ${CONV_UNIT_LABEL.power[u.k]}${u.k === "hp" ? "（公制）" : ""}`);
    }
    box.textContent = `${raw} ${CONV_UNIT_LABEL.power[from]} =\n${parts.join("\n")}`;
  } else if (type === "length") {
    const base = CONV_TYPES.length.toBase[from](raw);
    const parts = [];
    for (const u of CONV_TYPES.length.units) {
      parts.push(`${fmtConv(CONV_TYPES.length.fromBase[u.k](base))} ${CONV_UNIT_LABEL.length[u.k]}`);
    }
    box.textContent = parts.join(" = ");
  } else if (type === "temp") {
    const c = from === "c" ? raw : (raw - 32) * 5 / 9;
    const f = from === "f" ? raw : raw * 9 / 5 + 32;
    box.textContent = `${fmtConv(c)} ℃ = ${fmtConv(f)} ℉`;
  } else if (type === "awg") {
    if (from === "mm2") {
      const { awg, d } = mm2toAWG(raw);
      box.textContent = `${fmtConv(raw)} mm² → 直径约 ${fmtConv(d)} mm，约 AWG ${awg}`;
    } else {
      const { d, area } = awgToMM2(raw);
      box.textContent = `AWG ${raw} → 直径约 ${fmtConv(d)} mm，截面积约 ${fmtConv(area)} mm²`;
    }
  }
}

/* ============================================================
 * 简易计算器
 * ============================================================ */
const calcState = { cur: "0", prev: null, op: null, waiting: false, done: false };

function calcPress(k) {
  const s = calcState;
  if (k === "C") {
    s.cur = "0"; s.prev = null; s.op = null; s.waiting = false; s.done = false;
  } else if (k === "back") {
    if (s.waiting) return;
    if (s.done || s.cur === "错误") { s.cur = "0"; s.done = false; return; }
    s.cur = s.cur.length > 1 ? s.cur.slice(0, -1) : "0";
  } else if (k === "percent") {
    if (s.waiting) return;
    s.cur = String(parseFloat(s.cur) / 100);
    s.done = false;
  } else if (k === ".") {
    if (s.waiting) { s.cur = "0."; s.waiting = false; s.done = false; return; }
    if (s.cur.includes(".")) return;
    s.cur += ".";
  } else if (/^\d$/.test(k)) {
    if (s.waiting || s.done || s.cur === "错误") { s.cur = k; s.waiting = false; s.done = false; }
    else s.cur = s.cur === "0" ? k : s.cur + k;
  } else if (k === "=") {
    if (s.op != null && !s.waiting) {
      s.cur = calcEval(s.prev, s.cur, s.op);
      s.prev = null; s.op = null; s.waiting = false; s.done = true;
    }
  } else {
    if (s.op != null && !s.waiting && !s.done) {
      s.cur = calcEval(s.prev, s.cur, s.op);
      s.prev = s.cur; s.op = k; s.waiting = true;
    } else {
      s.prev = s.cur; s.op = k; s.waiting = true; s.done = false;
    }
  }
  calcRender();
}

function calcEval(a, b, op) {
  const x = parseFloat(a);
  const y = parseFloat(b);
  let r;
  if (op === "+") r = x + y;
  else if (op === "-") r = x - y;
  else if (op === "*") r = x * y;
  else if (op === "/") r = y === 0 ? NaN : x / y;
  return isNaN(r) ? "错误" : String(Math.round(r * 1e10) / 1e10);
}

function calcRender() {
  const s = calcState;
  const sym = { "+": "+", "-": "−", "*": "×", "/": "÷" };
  $("calc-expr").textContent = s.op ? `${s.prev} ${sym[s.op]}` : "\u00a0";
  $("calc-cur").textContent = s.cur;
}

function applyCalcToMain() {
  const val = parseFloat(calcState.cur);
  if (!(val > 0) || calcState.cur === "错误") {
    toast("计算器当前没有有效结果");
    return;
  }
  state.mode = "power";
  state.powerUnit = "kw";
  syncControls();
  $("power").value = String(val);
  $("current").value = "";
  switchTab("calc");
  doCalculate();
  toast("已代入主页计算");
}

/* ============================================================
 * 常用回路配置速查
 * ============================================================ */
const CIRCUIT_PRESETS = [
  { name: "照明回路", kw: 0.5, phase: 1, cos: 1, load: "resistive", wire: 1.5, breaker: 10, note: "普通灯具" },
  { name: "普通插座", kw: 2.2, phase: 1, cos: 1, load: "resistive", wire: 2.5, breaker: 16, note: "10A 插座多个" },
  { name: "厨房插座", kw: 4, phase: 1, cos: 1, load: "resistive", wire: 4, breaker: 32, note: "电磁炉+水壶" },
  { name: "卫生间浴霸", kw: 3, phase: 1, cos: 1, load: "resistive", wire: 4, breaker: 20, note: "浴霸+照明" },
  { name: "挂机空调 1.5匹", kw: 1.2, phase: 1, cos: 0.85, load: "inductive", wire: 2.5, breaker: 20, note: "专线" },
  { name: "柜机空调 3匹", kw: 2.7, phase: 1, cos: 0.85, load: "inductive", wire: 4, breaker: 25, note: "专线" },
  { name: "储水式热水器", kw: 2.5, phase: 1, cos: 1, load: "resistive", wire: 2.5, breaker: 16, note: "" },
  { name: "即热热水器 9kW", kw: 9, phase: 1, cos: 1, load: "resistive", wire: 10, breaker: 50, note: "专线" },
  { name: "7kW 充电桩", kw: 7, phase: 1, cos: 1, load: "resistive", wire: 6, breaker: 40, note: "专线" },
  { name: "15kW 三相动力", kw: 15, phase: 3, cos: 0.85, load: "inductive", wire: 10, breaker: 40, note: "" },
  { name: "22kW 三相电机", kw: 22, phase: 3, cos: 0.85, load: "inductive", wire: 16, breaker: 63, note: "D 曲线" },
  { name: "63A 进线", mode: "current", amps: 63, phase: 3, cos: 1, load: "resistive", wire: 16, breaker: 63, note: "总开关" },
  { name: "100A 进线", mode: "current", amps: 100, phase: 3, cos: 1, load: "resistive", wire: 25, breaker: 100, note: "总开关" }
];

function renderCircuitTable() {
  const box = $("circuit-table");
  const SHOWN = 1;
  let html = `<table class="data-table"><thead><tr><th>回路</th><th>功率</th><th>线径</th><th>空开</th><th></th></tr></thead><tbody>`;
  CIRCUIT_PRESETS.forEach((c, i) => {
    html += `<tr${i >= SHOWN ? ' class="circuit-more"' : ""}>
      <td>${c.name}${c.note ? `<div class="tile-sub">${c.note}</div>` : ""}</td>
      <td>${c.mode === "current" ? c.amps + "A" : c.kw + "kW"}</td>
      <td>${c.wire}mm²</td>
      <td>${c.breaker}A</td>
      <td><button class="mini-btn" data-circuit="${c.name}" type="button">带入</button></td>
    </tr>`;
  });
  html += `</tbody></table>`;
  box.innerHTML = html;
  box.querySelectorAll("[data-circuit]").forEach((b) => {
    b.onclick = () => {
      const c = CIRCUIT_PRESETS.find((x) => x.name === b.dataset.circuit);
      if (c) applyCircuit(c);
    };
  });
  $("circuit-more").onclick = () => {
    const open = $("circuit-more").dataset.open === "1";
    box.querySelectorAll(".circuit-more").forEach((tr) => {
      tr.style.display = open ? "none" : "table-row";
    });
    $("circuit-more").dataset.open = open ? "" : "1";
    $("circuit-more").textContent = open ? "更多回路 ∨" : "收起 ∧";
  };
}

function applyCircuit(c) {
  state.mode = c.mode || "power";
  state.phase = c.phase;
  state.cos = c.cos;
  state.load = c.load;
  state.powerUnit = "kw";
  syncControls();
  if (c.mode === "current") { $("current").value = c.amps; $("power").value = ""; }
  else { $("power").value = c.kw; $("current").value = ""; }
  switchTab("calc");
  doCalculate();
}

/* ============================================================
 * 载流量速查表
 * ============================================================ */
function renderAmpTable() {
  const material = $("amp-material").value;
  const install = $("amp-install").value;
  const temp = $("amp-temp").value;
  const mat = material === "al" ? "al" : "bvr";
  const box = $("amp-table");
  let html = `<table class="data-table"><thead><tr><th>截面积</th><th>载流量 A</th><th>参考空开</th><th>单相 kW</th><th>三相 kW</th></tr></thead><tbody>`;
  for (const w of WIRE_BASE) {
    const amp = adjustedAmpacity(w.mm2, install, temp, mat);
    let br = "—";
    for (const b of BREAKERS) if (b <= amp) br = b;
    const kW1 = amp * 220 / 1000;
    const kW3 = amp * Math.sqrt(3) * 380 / 1000;
    html += `<tr><td>${w.mm2}mm²</td><td>${fmt(amp, 0)}</td><td>${br}A</td><td>${fmt(kW1, 1)}</td><td>${fmt(kW3, 1)}</td></tr>`;
  }
  html += `</tbody></table>`;
  box.innerHTML = html;
}

/* 按现场使用频率重排工具卡片顺序 */
function reorderToolCards() {
  const order = ["tool-common", "tool-load", "tool-motor", "tool-vdrop", "tool-cable", "tool-material", "tool-amp"];
  for (const id of order) {
    const el = $(id);
    if (el) $("tab-data").appendChild(el);
  }
}

/* ============================================================
 * 电机选型
 * ============================================================ */
const CONTACTOR_GRADE = [9, 12, 18, 25, 32, 40, 50, 65, 80, 95, 115, 150];
const THERMAL_RANGES = [
  [0.1, 0.16], [0.16, 0.25], [0.25, 0.4], [0.4, 0.63], [0.63, 1], [1, 1.6], [1.6, 2.5],
  [2.5, 4], [4, 6.3], [6.3, 10], [9, 13], [12, 18], [17, 25], [23, 32], [30, 40],
  [37, 50], [45, 63], [55, 80], [63, 95], [75, 120], [85, 160], [100, 200], [135, 270], [250, 400]
];

function calcMotor() {
  const P = parseFloat($("motor-kw").value);
  const eff = parseFloat($("motor-eff").value);
  const box = $("motor-result");
  if (!(P > 0)) {
    box.hidden = false;
    box.className = "vdrop-result danger";
    box.textContent = "请填写电机功率。";
    return;
  }
  const cos = 0.85;
  const volt = parseFloat($("motor-volt").value) || 380;
  const single = volt === 220;
  const Ie = P * 1000 / ((single ? 220 : Math.sqrt(3) * 380) * cos * eff);
  const Ist = 6 * Ie;
  const need = Ie * 1.25;
  let wire = null;
  for (const w of WIRE_BASE) {
    if (adjustedAmpacity(w.mm2, state.install, state.temp, state.material) >= need) { wire = w; break; }
  }
  let breaker = null;
  for (const b of BREAKERS) {
    if (b >= Ie * 2) { breaker = b; break; }
  }
  if (wire && breaker) {
    let w = wire;
    while (adjustedAmpacity(w.mm2, state.install, state.temp, state.material) < breaker) {
      const idx = WIRE_BASE.indexOf(w);
      if (idx < WIRE_BASE.length - 1) w = WIRE_BASE[idx + 1];
      else break;
    }
    wire = w;
  }
  let contactor = null;
  for (const c of CONTACTOR_GRADE) {
    if (c >= Ie) { contactor = c; break; }
  }
  let thermal = "—";
  for (const r of THERMAL_RANGES) {
    if (Ie >= r[0] && Ie <= r[1] * 0.9) { thermal = `${r[0]}-${r[1]}A`; break; }
  }
  if (thermal === "—") {
    for (const r of THERMAL_RANGES) {
      if (Ie >= r[0] && Ie <= r[1]) { thermal = `${r[0]}-${r[1]}A`; break; }
    }
  }
  box.hidden = false;
  box.className = "vdrop-result ok";
  box.textContent = `额定电流约 ${fmt(Ie, 1)}A（${volt}V ${single ? "单相" : "三相"}）· 启动电流约 ${fmt(Ist, 0)}A（直接启动约 6 倍）
建议：D 曲线空开 ${breaker || "—"}A · 接触器 ${contactor || "—"}A（AC-3）· 热继整定 ${thermal}
线径 ${wire ? wire.mm2 : "—"}mm²（${MATERIAL_NAMES[state.material]}·${MODE_NAMES[state.install]}）`;
}

/* ============================================================
 * 总负荷统计
 * ============================================================ */
let loadRows = [{ name: "照明", kw: 1, phase: "1" }];

function renderLoadRows() {
  const box = $("load-rows");
  box.innerHTML = "";
  loadRows.forEach((row, i) => {
    const div = document.createElement("div");
    div.className = "load-row";
    const name = document.createElement("input");
    name.type = "text";
    name.placeholder = "回路名";
    name.value = row.name;
    name.addEventListener("input", (e) => { loadRows[i].name = e.target.value; });
    const kw = document.createElement("input");
    kw.type = "number";
    kw.min = "0";
    kw.step = "0.1";
    kw.placeholder = "kW";
    kw.value = row.kw;
    kw.addEventListener("input", (e) => { loadRows[i].kw = parseFloat(e.target.value) || 0; });
    const ph = document.createElement("select");
    const o1 = document.createElement("option");
    o1.value = "1"; o1.textContent = "单相";
    const o3 = document.createElement("option");
    o3.value = "3"; o3.textContent = "三相";
    ph.append(o1, o3);
    ph.value = row.phase;
    ph.addEventListener("change", (e) => { loadRows[i].phase = e.target.value; });
    const del = document.createElement("button");
    del.className = "del-row";
    del.type = "button";
    del.textContent = "×";
    del.onclick = () => { loadRows.splice(i, 1); renderLoadRows(); };
    div.append(name, kw, ph, del);
    box.appendChild(div);
  });
}

function calcLoad() {
  let P1 = 0, P3 = 0;
  for (const r of loadRows) {
    if (r.kw > 0) {
      if (r.phase === "3") P3 += r.kw;
      else P1 += r.kw;
    }
  }
  const Kx = parseFloat($("load-kx").value) || 0.7;
  const box = $("load-result");
  if (!(P1 + P3 > 0)) {
    box.hidden = false;
    box.className = "vdrop-result danger";
    box.textContent = "请至少填写一个回路的功率。";
    return;
  }
  const I = P1 * 1000 / 220 + P3 * 1000 / (Math.sqrt(3) * 380 * 0.9);
  const Icalc = I * Kx;
  let wire = null;
  for (const w of WIRE_BASE) {
    if (adjustedAmpacity(w.mm2, state.install, state.temp, state.material) >= Icalc) { wire = w; break; }
  }
  let breaker = null;
  if (wire) {
    for (const b of BREAKERS) {
      if (b < Icalc) continue;
      let w = wire;
      while (adjustedAmpacity(w.mm2, state.install, state.temp, state.material) < b) {
        const idx = WIRE_BASE.indexOf(w);
        if (idx < WIRE_BASE.length - 1) w = WIRE_BASE[idx + 1];
        else break;
      }
      breaker = b;
      wire = w;
      break;
    }
  }
  box.hidden = false;
  box.className = "vdrop-result " + (wire && breaker ? "ok" : "danger");
  box.textContent = `安装功率 ${fmt(P1 + P3, 1)}kW（单相 ${fmt(P1, 1)} + 三相 ${fmt(P3, 1)}）
需用系数 Kx=${fmt(Kx, 2)} → 需用功率约 ${fmt((P1 + P3) * Kx, 1)}kW
计算电流约 ${fmt(Icalc, 1)}A → 建议进线 ${wire ? wire.mm2 : "—"}mm²（${MATERIAL_NAMES[state.material]}·${MODE_NAMES[state.install]}），总开 ${breaker || "—"}A`;
}

/* ============================================================
 * 配电箱标注卡
 * ============================================================ */
function buildLabelText() {
  const r = lastResult;
  if (!r || !r.wire) return "";
  const lines = ["【电工计算 · 回路标注】"];
  if (r.wireMode) {
    lines.push(`线径 ${r.wire.mm2}mm²（${MATERIAL_NAMES[state.material]}·${MODE_NAMES[state.install]}）`);
    lines.push(`载流量约 ${fmt(r.ampacity, 0)}A · 建议空开 ${r.breaker || "—"}A`);
    lines.push(`可带：单相约 ${fmt(r.kW1, 1)}kW / 三相约 ${fmt(r.kW3, 1)}kW`);
  } else {
    lines.push(`${state.mode === "power" ? `功率 ${fmt(r.kW, 1)}kW` : `电流 ${fmt(r.I, 1)}A`} · ${state.phase === 3 ? "三相" : "单相"}`);
    lines.push(`工作电流 ${fmt(r.I, 1)}A · 线径 ${r.wire.mm2}mm²（${MATERIAL_NAMES[state.material]}·${MODE_NAMES[state.install]}）`);
    lines.push(`建议空开 ${r.breaker}A · ${state.phase === 1 ? "30mA 漏保" : "末端 30mA / 总开 300mA"}`);
  }
  const vd = $("vdrop-result");
  if (!vd.hidden && vd.textContent) lines.push(vd.textContent.split("。")[0] + "。");
  const len = parseFloat($("vdrop-len").value);
  if (len > 0) lines.push(`线路长度 ${fmt(len, 0)}m`);
  lines.push("记录于 " + new Date().toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }));
  return lines.join("\n");
}

function copyLabelCard() {
  const text = buildLabelText();
  if (!text) { toast("请先完成计算"); return; }
  copyText(text);
  toast("标注卡已复制，可直接粘贴到微信/标签");
}

/* ============================================================
 * 显示设置 / 全量备份
 * ============================================================ */
const SETTINGS_KEY = "sdx_settings";
let uiSettings = { largeText: false, highContrast: false };

function loadUISettings() {
  try {
    uiSettings = Object.assign({ largeText: false, highContrast: false }, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {});
  } catch {}
}

function saveUISettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(uiSettings)); } catch {}
}

function applyUISettings() {
  document.documentElement.classList.toggle("large-text", !!uiSettings.largeText);
  document.documentElement.classList.toggle("high-contrast", !!uiSettings.highContrast);
  $("set-large").checked = !!uiSettings.largeText;
  $("set-contrast").checked = !!uiSettings.highContrast;
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportAllData() {
  let defaults = null;
  try { defaults = JSON.parse(localStorage.getItem(DEFAULTS_KEY)); } catch {}
  downloadJson("电工计算备份.json", {
    app: "电工计算",
    version: "1.1",
    exportedAt: new Date().toISOString(),
    history: loadHistory(),
    favs: loadFavs(),
    defaults,
    ui: uiSettings
  });
  toast("已导出全部数据备份");
}

function importAllData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (!d || (!Array.isArray(d.history) && !Array.isArray(d.favs))) throw new Error("bad");
      if (Array.isArray(d.history)) localStorage.setItem(HISTORY_KEY, JSON.stringify(d.history));
      if (Array.isArray(d.favs)) localStorage.setItem(FAV_KEY, JSON.stringify(d.favs));
      if (d.defaults) localStorage.setItem(DEFAULTS_KEY, JSON.stringify(d.defaults));
      if (d.ui) {
        uiSettings = Object.assign(uiSettings, d.ui);
        saveUISettings();
      }
      loadDefaults();
      renderHistory();
      renderFavorites();
      syncSettingsControls();
      syncControls();
      applyUISettings();
      toast("导入成功");
    } catch {
      toast("备份文件格式不对");
    }
  };
  reader.readAsText(file);
}

/* ---------- 启动 ---------- */
function init() {
  loadDefaults();
  loadUISettings();
  maybeShowInstallHint();
  switchTab("home");
  renderPresets();
  bindEvents();
  bindExtraEvents();
  syncControls();
  syncSettingsControls();
  renderHistory();
  renderFormulas();
  renderFavorites();
  fillAreaSelect($("vd-area"), "4");
  fillAreaSelect($("cable-area"), "4");
  fillAreaSelect($("wire-area"), "4");
  fillConvFrom();
  renderCircuitTable();
  renderAmpTable();
  renderLoadRows();
  reorderToolCards();
  applyUISettings();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", init);
