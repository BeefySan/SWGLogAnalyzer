import React, { useEffect, useMemo, useRef, useState, useCallback, useTransition, useDeferredValue } from "react";
import { useRafHover } from "./hooks/useRafHover";
import { TimelineHoverOverlay } from "./components/TimelineHoverOverlay";
import ErrorBoundary from "./ErrorBoundary";
import DpsPopoutButton from "./components/DpsPopoutButton";
import { ResponsiveContainer, AreaChart, Area, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, BarChart, Bar, LabelList, Cell, Sankey, ReferenceLine, ReferenceArea } from "recharts";

// --- Bigger, centered label for death-flag ReferenceLines ---
type DeathLabelProps = {
  value: string;
  size?: number;           // font size
  dy?: number;             // vertical offset from the edge
  anchor?: 'top' | 'bottom';
  // recharts injects this when label is a React element:
  viewBox?: { x: number; y: number; width: number; height: number };
};

const DeathLabel: React.FC<DeathLabelProps> = ({
  value, size = 16, dy = 14, anchor = 'top', viewBox
}) => {
  const x = viewBox?.x ?? 0;
  const y = anchor === 'top'
    ? (viewBox?.y ?? 0) + dy
    : (viewBox?.y ?? 0) + (viewBox?.height ?? 0) - dy;

  const skullSize = Math.round(size * 0.9);
  const textSize  = size;

  return (
    <g pointerEvents="none">
      <text x={x + 2}  y={y} textAnchor="middle" fontSize={skullSize} fill="#ff6464">☠</text>
      <text x={x + skullSize + 6} y={y} textAnchor="start" dominantBaseline="middle"
            fontSize={textSize} fontWeight={700} fill="#ffdada"
            stroke="#0b1526" strokeWidth={3} style={{ paintOrder:'stroke' }}>
        {value}
      </text>
    </g>
  );
};



// --- Star Wars skin as CSS string ---
const SW_CSS = /* css */ `
.swg-theme {
  --bg: #070d1a;
  --bg2:#0b1426;
  --panel:#0e1726;
  --panel-2:#0c1624;
  --panel-border:#1b2a3d;
  --glow:#62b0ff;
  --accent:#21d4fd;
  --accent2:#ff9d00;
  --text:#cfe3ff;
  --muted:#9fb7d8;
  --grid:#1c2a3f;
  --good:#19c37d;
  --warn:#ffcc00;
  --bad:#ff4d4d;
  --bg-image: url('/background.jpg');
  isolation: isolate;
  min-height: 100vh;
  color: var(--text);
  font-family: 'Orbitron', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji";
  background:
    radial-gradient(1200px 800px at 70% -10%, rgba(98,176,255,.20), transparent 60%),
    radial-gradient(900px 600px at -10% 110%, rgba(98,176,255,.12), transparent 50%),
    radial-gradient(2px 2px at 20% 30%, rgba(255,255,255,.35) 0, rgba(255,255,255,0) 60%),
    radial-gradient(1.4px 1.4px at 70% 80%, rgba(255,255,255,.28) 0, rgba(255,255,255,0) 60%),
    radial-gradient(1.6px 1.6px at 85% 25%, rgba(255,255,255,.28) 0, rgba(255,255,255,0) 60%),
    linear-gradient(180deg, var(--bg) 0%, var(--bg2) 100%);
  background-attachment: fixed;
  position: relative;
}

.swg-theme::after{
  content:'';
  position: fixed; inset:0;
  background-image: var(--bg-image);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  opacity: .9;
  z-index: -1;
  pointer-events: none;
}

@keyframes holo-scan{ from{transform:translateY(0)} to{transform:translateY(3px)} }

.swg-theme .card{
  background: linear-gradient(180deg, rgba(16,28,50,.96), rgba(12,22,38,.98));
  border: 1px solid var(--panel-border);
  box-shadow: 0 0 0 1px rgba(98,176,255,.08) inset, 0 8px 30px rgba(0,0,0,.35), 0 0 24px rgba(98,176,255,.08) inset;
  border-radius: 14px; backdrop-filter: blur(2px);
}
/* -- Solid panel overrides for clearer boxes -- */
.swg-theme .box,
.swg-theme .panel,
.swg-theme .card,
.swg-theme .table,
.swg-theme .toolbar,
.swg-theme .summary {
  background: linear-gradient(180deg, rgba(16,28,50,.96), rgba(12,22,38,.98)) !important;
  border: 1px solid rgba(120,170,255,.40);
  box-shadow: 0 10px 34px rgba(0,0,0,.55), 0 0 0 2px rgba(98,176,255,.12) inset;
}

.swg-theme .table th,
.swg-theme .table td {
  background-color: rgba(12,22,38,.98);
}

.swg-theme .btn{
  background: linear-gradient(180deg, rgba(40,80,130,.85), rgba(24,45,80,.85));
  color:#e9f3ff; border:1px solid rgba(120,170,255,.35); border-radius:10px; padding:6px 10px;
  text-transform:uppercase; letter-spacing:.06em;
  box-shadow: 0 0 0 1px rgba(0,0,0,.3) inset, 0 0 12px rgba(98,176,255,.2);
  transition: transform .06s ease, box-shadow .12s ease, border-color .12s ease;
}
.swg-theme .btn:hover{ border-color: var(--accent); box-shadow: 0 0 0 1px rgba(0,0,0,.3) inset, 0 0 18px rgba(98,176,255,.35); }
.swg-theme .btn:active{ transform: translateY(1px) scale(.99); }

.swg-theme .input, .swg-theme select.input{
  background: rgba(12,22,38,.85); border:1px solid rgba(120,170,255,.28); color:var(--text);
  border-radius:10px; padding:6px 8px; outline:none; box-shadow:0 0 0 1px rgba(0,0,0,.3) inset;
}
.swg-theme .input:focus{ border-color:var(--accent); box-shadow: 0 0 0 1px rgba(0,0,0,.3) inset, 0 0 0 2px rgba(33,212,253,.18); }

.swg-theme .row{ display:flex; align-items:center; gap:8px; }
.swg-theme .pill{ background: rgba(98,176,255,.12); color:var(--text); padding:4px 8px; border-radius:999px; font-size:12px; }
.swg-theme .badge{ background: linear-gradient(180deg, rgba(98,176,255,.18), rgba(98,176,255,.06)); border:1px solid rgba(120,170,255,.35); padding:4px 8px; border-radius:999px; }

.swg-theme .tabbar{ display:flex; gap:8px; margin-top:12px; }
.swg-theme .tab{
  background: linear-gradient(180deg, rgba(25,45,80,.8), rgba(16,28,50,.9));
  color:#bfe1ff; border:1px solid rgba(120,170,255,.3);
  padding:8px 12px; border-radius:12px; letter-spacing:.08em;
}
.swg-theme .tab.active{ border-color:var(--accent); box-shadow: 0 0 0 1px rgba(0,0,0,.35) inset, 0 0 18px rgba(33,212,253,.25); color:#eaf6ff; }

/* ---------- TABLES (Abilities, etc.) ---------- */
.swg-theme .table{ width:100%; border-collapse:collapse; }

/* Bigger headers & slightly bigger body text */
.swg-theme .table th{
  text-align:left;
  font-weight:800;
  font-size:16px;                 /* was 12px */
  letter-spacing:.06em;
  color:#9fb7d8;
  border-bottom:1px solid var(--panel-border);
  padding:10px 12px;              /* a bit more breathing room */
  text-transform:uppercase;
}
.swg-theme .table td{
  padding:9px 12px;
  font-size:14px;                 /* slightly larger cells */
  border-bottom:1px solid rgba(27,39,56,.6);
}

/* Clear light separators between columns */
.swg-theme .table th + th,
.swg-theme .table td + td {
  border-left: 1px solid rgba(120,170,255,.28);  /* brighter than .18 */
}
.swg-theme .table th:first-child,
.swg-theme .table td:first-child { border-left: none; }

/* Center everything except the first column (Ability) */
.swg-theme .table th:not(:first-child),
.swg-theme .table td:not(:first-child) {
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* Keep Ability column readable left-aligned */
.swg-theme .table th:first-child,
.swg-theme .table td:first-child { text-align: left; }

.swg-theme .table tr:hover td{ background: rgba(98,176,255,.06); }

/* Optional helper if you want to opt-in per cell: */
.swg-theme .num { text-align:center !important; font-variant-numeric: tabular-nums; }

.swg-theme .mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
.swg-theme .nowrap{ white-space: nowrap; }
.swg-theme .muted{ color: var(--muted); }

/* --- Recharts tooltip: solid dark HUD panel for readability --- */
.swg-theme .recharts-tooltip-wrapper { z-index: 1000; }
.swg-theme .recharts-default-tooltip {
  background: rgba(10,16,28,.98) !important;
  border: 1px solid rgba(120,170,255,.45) !important;
  color: var(--text) !important;
  border-radius: 10px;
  box-shadow: 0 12px 28px rgba(0,0,0,.6), 0 0 0 2px rgba(98,176,255,.12) inset;
  padding: 8px 10px !important;
}
.swg-theme .recharts-tooltip-label {
  color: #eaf3ff !important;
  font-weight: 800;
  letter-spacing: .02em;
}
.swg-theme .recharts-tooltip-item { color: var(--text) !important; }
.swg-theme .recharts-tooltip-item-name { color: var(--muted) !important; }
.swg-theme .recharts-tooltip-item-value { color: #d8ecff !important; font-weight: 700; }
`;


// ---- Elemental support (injected) ----
type ElementalBreakdown = Record<string, number>;

// Extend DamageEvent locally if present in this file; otherwise this stays permissive.
type DamageEventWithElements = DamageEvent & { elements?: ElementalBreakdown };

const titleCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);
const fmtPctElem = (v: number) => (v * 100 >= 99.5 || v === 0 ? (v * 100).toFixed(0) : (v * 100).toFixed(1)) + "%";

function collectAbilityElements(
  events: DamageEventWithElements[],
  player: string,
  abilityNorm: string,
  winStart: number,
  winEnd: number
): ElementalBreakdown {
  const out: ElementalBreakdown = {};
  for (const e of (events || [])) {
    if (!e) continue;
    const t: number = (e as any).t ?? (e as any).time ?? 0;
    if (t < winStart || t > winEnd) continue;
    const src: string = (e as any).src || (e as any).source || "";
    const abilityName: string = (e as any).ability || "";
    const canon = typeof canonEntity === "function" ? canonEntity(src) : src;
    const norm = typeof normalizeAbilityName === "function" ? normalizeAbilityName(abilityName) : abilityName;
    if (canon !== player) continue;
    if (norm !== abilityNorm) continue;
    const elements = (e as any).elements as ElementalBreakdown | undefined;
    if (!elements) continue;
    for (const k in elements) {
      const v = Number((elements as any)[k] || 0);
      out[k] = (out[k] || 0) + v;
    }
  }
  return out;
}

function summarizeElements(totals: ElementalBreakdown): { types: string; pct: string } {
  const entries = Object.entries(totals || {});
  const total = entries.reduce((s, [, v]) => s + Number(v || 0), 0);
  if (!total) return { types: "—", pct: "—" };
  entries.sort((a, b) => Number(b[1]) - Number(a[1]));
  const types = entries.map(([k]) => titleCase(k)).join(", ");
  const pct = entries.map(([k, v]) => `${fmtPctElem(Number(v) / total)} ${titleCase(k)}`).join(", ");
  return { types, pct };
}

// ✅ new code goes *after* summarizeElements is fully closed above

// Ability → elemental hints (extend as you like). Keys must be normalized ability names.
const ABILITY_ELEMENT_HINTS: Record<string, ElementalBreakdown> = {
  // Examples — tweak to match your game:
  "plasma mine": { fire: 1 },
  "focused beam": { energy: 1 },
  "force lightning": { electricity: 1 },
  "force shockwave": { kinetic: 1 },
  "maelstrom": { electricity: 1 },
};

// Turn a hint into a totals object using the ability’s total damage
function hintedElementsForAbility(abilityNorm: string, totalDamage: number): ElementalBreakdown {
  const hint = ABILITY_ELEMENT_HINTS[abilityNorm];
  if (!hint) return {};
  const out: ElementalBreakdown = {};
  for (const [k, ratio] of Object.entries(hint)) {
    out[k] = totalDamage * Number(ratio || 0);
  }
  return out;
}



/* ========================= Utilities & Types ========================= */

type MetricKey = 'damageDealt'|'avgDps'|'healingDone';
type PlayerRow = { name:string; profession?:string; damageDealt:number; healingDone:number; avgDps:number };

type DamageEvent = {

  t: number;
  src: string;
  dst: string;
  ability: string;
  amount: number;
  flags?: string;        // 'hit' | 'crit' | 'glance' | 'strikethrough' | 'periodic' | 'dodge' | 'parry'
  blocked?: number;      // "(N points blocked)" parsed from the line
  absorbed?: number;     // "Armor absorbed N points ..."
  preMitTotal?: number;  // "... out of T" (pre-mit total)
  evadedPct?: number;    // "(X% evaded)" — optional
};

export type DFEvent = DamageEvent & {
  // some logs use alternate keys for the defender
  target?: string;
  victim?: string;
  defender?: string;
};

// ---- Helpers (keep ONE copy only) ----
const nf0  = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const fmt0 = (v: number) => nf0.format(Math.round(v || 0));
const pct  = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

// normalize a name & remove UI prefixes like "A: " / "B: "
const norm = (s?: string) => (s ?? "").normalize("NFKC").trim().toLowerCase();
const cleanName = (s?: string) =>
  norm(s).replace(/^(a|b)\s*:\s*/, "").replace(/^player\s*(a|b)\s*:\s*/, "");

const flagOf = (e: DFEvent) => (e.flags ?? "").toString().toLowerCase();
const PERIODIC_TOKENS = ['periodic','dot','damage over time','bleed','burn','poison'];
const isPeriodic = (e: DFEvent) => {
  const f = flagOf(e);
  if (f.includes('periodic')) return true;
  const abil = (e.ability || '').toLowerCase();
  return PERIODIC_TOKENS.some(tok => abil.includes(tok));
};

// destination with fallbacks (dst/target/victim/defender)
const getDst = (e: DFEvent) =>
  cleanName(e.dst) || cleanName(e.target) || cleanName(e.victim) || cleanName(e.defender);


type HealEvent = {
  t: number;
  src: string;        // healer
  dst: string;
  ability: string;
  amount: number;
};

type PerAbility = Record<string, Record<string, { hits:number; dmg:number; max:number }>>;
type PerAbilityTargets = Record<string, Record<string, Record<string, { hits:number; dmg:number; max:number }>>>;

const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const fmt1 = (v?:number|null)=> nf1.format(Number(v||0));
const toMMSS = (s:number) => {
  const m = Math.floor(Math.max(0, s)/60);
  const sec = Math.max(0, s)%60 | 0;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
};

/* ----- Colors & classes ----- */
const CLASS_COLORS: Record<string,string> = {
  Jedi:'#00B3FF','Bounty Hunter':'#C41E3A', Commando:'#C69B6D', Officer:'#ABD473',
  Spy:'#FFF569', Medic:'#8787ED', Smuggler:'#F48CBA', Entertainer:'#FF8800', Trader:'#8F8F8F'
};
const classColor = (p?:string)=> CLASS_COLORS[p||''] || '#6ec7ff';
const LEGENDS_CLASSES = ['Jedi','Bounty Hunter','Commando','Officer','Spy','Medic','Smuggler','Entertainer','Trader'];

/* ----- Ability collapsing & class inference ----- */
const ABILITY_CLASS_MAP: Record<string,string> = {
  // Bounty Hunter
  'ambush':'Bounty Hunter','assault':'Bounty Hunter','burn':'Bounty Hunter','razor net':'Bounty Hunter','tangle net':'Bounty Hunter','fumble':'Bounty Hunter',
  // Commando
  'plasma mine': 'Commando',
  'cluster bomb':'Commando','bomblet':'Commando','focus beam':'Commando','lethal beam':'Commando','mine':'Commando','cryoban grenade':'Commando',
  // Officer
  'sure shot':'Officer','overcharge':'Officer','paint target':'Officer','artillery strike':'Officer','core bomb':'Officer',
  // Jedi
  'flurry':'Jedi','strike':'Jedi','sweep':'Jedi','force shockwave':'Jedi','maelstrom':'Jedi','force drain':'Jedi','force lightning':'Jedi','force throw':'Jedi',
  // Smuggler
  'precision strike':'Smuggler','concussion shot':'Smuggler','covering fire':'Smuggler','fan shot':'Smuggler','brawler strike':'Smuggler','pin down':'Smuggler','pistol whip':'Smuggler',
  // Spy
  'razor slash':'Spy','blaster burst':'Spy',"assassin's mark":'Spy','assassinate':'Spy',"spy's fang":'Spy',
  // Medic
  'bacta burst':'Medic','bacta spray':'Medic','bacta ampule':'Medic','vital strike':'Medic',
};

// aggressive normalizer to merge variants like “… and hits / glances / crits / punishing blows”, ranks and fluff
function normalizeAbilityName(raw?: string): string {
  if (!raw) return '';
  let s = raw.toLowerCase().trim();

  // drop leading “with/using”
  s = s.replace(/^(with|using)\s+/, '');

  // strip “mine 2:” or “mine:” prefixes
  s = s.replace(/\bmine\s*\d*\s*:\s*/g, '');

  // remove "and <suffix>" bits: hits/glances/crits/strikes through/<n> points blocked/punishing blows
  s = s.replace(
    /(?:[\s.\-]+and\s+(?:\d+\s+points\s+blocked|strikes\s+through|hits|glances|crits|punishing\s+blows)(?:\s+\(\d+%.*?\))?)/gi,
    ''
  );
  s = s.replace(/\band\s+punishing\s+blows\b/gi, ''); // extra safety

  // logs sometimes leave ".and"
  s = s.replace(/\.and\b/gi, '');

  // drop parenthetical/bracketed details
  s = s.replace(/[\(\[][^)\]]*[\)\]]/g, '');

  // strip ranks/digits like "mark 7", roman numerals, stray numbers
  s = s.replace(/\bmark\s*\d+\b/gi, '')
       .replace(/\b[ivxlcdm]+\b/gi, '')
       .replace(/\b\d+\b/g, '');

  // normalize awkward combos
  s = s.replace(/\bmine\s+plasma\s+mine\b/gi, 'plasma mine');

  // drop terminal punctuation
  s = s.replace(/[.,!?;:]+$/g, '');

  // tidy punctuation/whitespace (treat '.' like other separators too)
  s = s.replace(/[.:\-–—]+/g, ' ').replace(/\s+/g, ' ').trim();

  return s;
}

function abilityToClass(raw: string): string | undefined {
  const base = normalizeAbilityName(raw);
  if (ABILITY_CLASS_MAP[base]) return ABILITY_CLASS_MAP[base];
  if (base.startsWith('burn')) return 'Bounty Hunter';
  return undefined;
}

function inferClasses(rows: PlayerRow[], perAbility:PerAbility): Record<string,string> {
  const result: Record<string,string> = {};
  for (const r of rows) {
    const m = perAbility[r.name] || {};
    const tallies: Record<string, number> = {};
    for (const [ability, stats] of Object.entries(m)) {
      const cls = abilityToClass(ability);
      if (!cls) continue;
      tallies[cls] = (tallies[cls] || 0) + (stats?.hits || 0);
    }
    let best: string | undefined; let bestVal = -1;
    for (const [cls, val] of Object.entries(tallies)) {
      if (val > bestVal) { best = cls; bestVal = val; }
    }
    result[r.name] = best || r.profession || '';
  }
  return result;
}

/* ----- Segment naming: map common NPCs -> instance label ----- */
function normName(s:string){
  return (s||'')
    .toLowerCase()
    .replace(/["'`]/g, '')          // drop quotes
    .replace(/[.,:;!?()[\]]/g, '')  // drop punctuation (keep hyphens)
    .replace(/\bcorpse\s+of\s+/g, '') // normalize "corpse of X" -> "x"
    .replace(/\s+/g,' ')
    .trim();
}

// Expanded coverage: Kizash variants and Krix Swiftshadow → ISD
const NPC_TO_INSTANCE: Array<{ npc:string; inst:string }> = [
  { npc: 'sinya nilim', inst: 'Sinya Nilm' },
  { npc: 'sith golem kizash', inst: 'Kizash' },
  { npc: 'sith shadow golem kizash', inst: 'Kizash' },
  { npc: 'kizash', inst: 'Kizash' },
  { npc: 'an old man', inst: 'Dark Side Mellichae' }, // old man phase
  { npc: 'mellichae', inst: 'Light Side Mellichae' },
  { npc: 'tusken king', inst: 'Tusken King' },
  { npc: 'axkva min', inst: 'Axkva Min' },
  { npc: 'ig-88', inst: 'IG-88' },
  { npc: 'exar kun', 'inst': 'Exar Kun' },
  { npc: 'cmdr kenkirk', inst: 'ISD' },
  { npc: 'commander kenkirk', inst: 'ISD' },
  { npc: 'krix swiftshadow', inst: 'ISD' },
  { npc: 'harwakokok the mighty', inst: 'Avatar Hardmode' },
];
const NPC_MAP: Record<string,string> = Object.fromEntries(NPC_TO_INSTANCE.map(x=> [normName(x.npc), x.inst]));

/* ----- Entity canonicalization (merge name variants in aggregation) ----- */
const ENTITY_CANON: Record<string,string> = Object.fromEntries([
  // Core raid bosses/adds with common variations
  ['an old man', 'an old man'],
  ['old man', 'an old man'],
  ['sith golem kizash', 'Kizash'],
  ['sith shadow golem kizash', 'Kizash'],
  ['kizash', 'Kizash'],
  ['cmdr kenkirk', 'Cmdr.Kenkirk'],
  ['commander kenkirk', 'Cmdr.Kenkirk'],
  ['krix swiftshadow', 'Krix Swiftshadow'],
  ['ig-88', 'IG-88'],
  ['ig 88', 'IG-88'],
  ['sinya nilim', 'Sinya Nilim'],
  ['exar kun', 'Exar Kun'],
  ['axkva min', 'Axkva Min'],
  ['tusken king', 'Tusken King'],

  // Player aliases to combine (requested)
  ['jelanna', 'Jelanna'],
  ['jelanna armor', 'Jelanna'],
  ['jelanna armorr', 'Jelanna'],
  ['aldezz', 'Aldezz'],
  ['aldezz rams', 'Aldezz'],
].map(([alias, canon]) => [normName(alias), canon]));

function canonEntity(name:string){ const key = normName(name); return ENTITY_CANON[key] || name; }

/* ========================= Helpers for charts & ability merging ========================= */

function ClassLegend(){
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
      {LEGENDS_CLASSES.map(cls=> (
        <span key={cls} style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12, color:'#cfe3ff' }}>
          <span style={{ width:10, height:10, borderRadius:2, background: classColor(cls) }}/>{cls}
        </span>
      ))}
    </div>
  );
}

function getVal(r:PlayerRow, key:MetricKey){ return Number((r as any)[key]||0) }
function barData(rows:PlayerRow[], metric:MetricKey){
  const src=[...rows];
  return src.sort((a,b)=> getVal(b,metric)-getVal(a,metric))
            .slice(0,12)
            .map(r=>({ name:(r.name||'Unknown'), value: Math.round(getVal(r,metric)) }));
}
function makeSeries(arr:number[]|undefined, duration:number){
  if (!arr || !arr.length) return [];
  return Array.from({length: duration+1}, (_,t)=>({ t, v: arr[t]||0 }));
}
function smoothSeries(data:{t:number;v:number}[], window=5){
  if(!data.length) return data;
  const w = Math.max(1, window|0);
  return data.map((d,i)=>{
    let s=0, c=0;
    for(let k=i-Math.floor(w/2); k<=i+Math.floor(w/2); k++){
      if(k>=0 && k<data.length){ s+=data[k].v; c++; }
    }
    return { t: d.t, v: s/(c||1) };
  });
}

function actionsPerMinute(rows:PlayerRow[], perAbility:PerAbility, duration:number){
  const minutes = Math.max(1, duration/60);
  const items = rows.map(r=>{
    const abilities = perAbility[r.name] || {};
    const hits = Object.values(abilities).reduce((s:any,v:any)=> s + (v?.hits||0), 0);
    const apm = hits / minutes;
    return { name: r.name || 'Unknown', value: Math.round(apm) };
  });
  return items.sort((a,b)=> b.value-a.value).slice(0,12);
}

/** Merge ability rows by normalized name (also merges per-target tables). */
function mergeNormalizedAbilities(
  pa: PerAbility,
  pat: PerAbilityTargets
): { pa: PerAbility; pat: PerAbilityTargets } {
  const outPa: PerAbility = {};
  const outPat: PerAbilityTargets = {};

  for (const actor of Object.keys(pa || {})) {
    outPa[actor] = outPa[actor] || {};
    outPat[actor] = outPat[actor] || {};
    const abilities = pa[actor] || {};

    for (const [rawName, agg] of Object.entries(abilities)) {
      const name = normalizeAbilityName(rawName);
      const cur = outPa[actor][name] || { hits: 0, dmg: 0, max: 0 };
      outPa[actor][name] = {
        hits: cur.hits + (agg?.hits || 0),
        dmg:  cur.dmg  + (agg?.dmg  || 0),
        max:  Math.max(cur.max, agg?.max || 0),
      };

      const targMap = (pat[actor]?.[rawName]) || {};
      for (const [tgt, tv] of Object.entries(targMap)) {
        outPat[actor][name] = outPat[actor][name] || {};
        const prev = outPat[actor][name][tgt] || { hits: 0, dmg: 0, max: 0 };
        outPat[actor][name][tgt] = {
          hits: prev.hits + ((tv as any)?.hits || 0),
          dmg:  prev.dmg  + ((tv as any)?.dmg  || 0),
          max:  Math.max(prev.max, (tv as any)?.max || 0),
        };
      }
    }
  }
  return { pa: outPa, pat: outPat };
}

/* ========================= Main App ========================= */

export default function App(){
  // raw/unfiltered results from worker
  const [baseRows, setBaseRows] = useState<PlayerRow[]>([]);
  const [baseTimeline, setBaseTimeline] = useState<Array<{t:number; dps:number; hps:number}>>([]);
  const [basePerSrc, setBasePerSrc] = useState<Record<string, number[]>>({});
  const [basePerAbility, setBasePerAbility] = useState<PerAbility>({});
  const [basePerAbilityTargets, setBasePerAbilityTargets] = useState<PerAbilityTargets>({});
  const [basePerTaken, setBasePerTaken] = useState<Record<string, number>>({});
  const [basePerTakenBy, setBasePerTakenBy] = useState<Record<string, Record<string, number>>>({});
  const [damageEvents, setDamageEvents] = useState<DamageEvent[]>([]);
  const [healEvents, setHealEvents] = useState<HealEvent[]>([]);
  const [deathEvents, setDeathEvents] = useState<Array<{t:number; name:string}>>([]);
  const [duration, setDuration] = useState<number>(0);
  const [debug, setDebug] = useState<any>(null);

  // filtered (by segment) derived state
  const [rows, setRows] = useState<PlayerRow[]>([]);

  // smooth heavy updates & defer list derivations
  const [isPending, startTransition] = useTransition();
  const rowsDeferred = useDeferredValue(rows);
  const [timeline, setTimeline] = useState<Array<{t:number; dps:number; hps:number}>>([]);
  const [perSrc, setPerSrc] = useState<Record<string, number[]>>({});
  const [perAbility, setPerAbility] = useState<PerAbility>({});
  const [perAbilityTargets, setPerAbilityTargets] = useState<PerAbilityTargets>({});
  const [perTaken, setPerTaken] = useState<Record<string, number>>({});
  const [perTakenBy, setPerTakenBy] = useState<Record<string, Record<string, number>>>({});

  // ui state
  const [metric, setMetric] = useState<MetricKey>('damageDealt');
  const [pasteText, setPasteText] = useState('');
  const [collectUnparsed, setCollectUnparsed] = useState(false);
  const [parsing, setParsing] = useState<{done:number,total:number}|null>(null);
  const [compareOn, setCompareOn] = useState(true);
  const [pA, setPA] = useState(''); const [pB, setPB] = useState(''); 
  const [mode, setMode] = useState<'sources'|'abilities'|'statistics'>('sources'); // <- extended
  const [smooth, setSmooth] = useState(true);
  const workerRef = useRef<Worker|null>(null);

  // segmentation
  const [idleGap, setIdleGap] = useState<number>(60); // default 60s
  const [segments, setSegments] = useState<Array<{start:number; end:number; label:string}>>([]);
  const [segIndex, setSegIndex] = useState<number>(-1);

const resetWindow = useCallback(() => {
  if (segIndex >= 0 && segments[segIndex]) {
    const { start, end } = segments[segIndex];
    applyWindow({ start, end }, {
      tl: baseTimeline, rows: baseRows, perSrc: basePerSrc,
      perAbility: basePerAbility, pat: basePerAbilityTargets,
      perTaken: basePerTaken, perTakenBy: basePerTakenBy, duration
    });
    return;
  }
  const start = baseTimeline?.[0]?.t ?? 0;
  const end   = baseTimeline?.length ? baseTimeline[baseTimeline.length - 1].t : duration;
  applyWindow({ start, end }, {
    tl: baseTimeline, rows: baseRows, perSrc: basePerSrc,
    perAbility: basePerAbility, pat: basePerAbilityTargets,
    perTaken: basePerTaken, perTakenBy: basePerTakenBy, duration
  });
}, [
  segIndex, segments,
  baseTimeline, baseRows, basePerSrc, basePerAbility, basePerAbilityTargets,
  basePerTaken, basePerTakenBy, duration, applyWindow
]);
// --- Zoom / window selection ---
  const [selecting, setSelecting] = useState<{x0:number, x1:number} | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  
  const timelineRef = useRef<HTMLDivElement>(null);

  // Prevent re-render storms: only update hoverX while selecting
  const setHoverXThrottled = (x: number | null) => {
    if (selecting) setHoverXThrottled(x);
  };

  // rAF-driven hover overlay
  useRafHover(timelineRef, {
    xToTime: (px) => {
      const w = timelineRef.current?.getBoundingClientRect().width || 1;
      return windowStart + (px / w) * (windowEnd - windowStart);
    },
    times: (timeline ?? []).map((p: any) => p.t),
    onUpdate: ({ x, time }) => {
      timelineRef.current?.dispatchEvent(
        new CustomEvent("timeline-hover-update", { detail: { x, label: toMMSS(time) } })
      );
    },
    minDeltaPx: 1,
  });
const clampToActive = useCallback((start:number, end:number)=>{
    if (segIndex >= 0 && segments[segIndex]) {
      const seg = segments[segIndex];
      const s = Math.max(seg.start, Math.min(start, end));
      const e = Math.min(seg.end,   Math.max(start, end));
      return { start: Math.min(s,e), end: Math.max(s,e) };
    }
    return { start: Math.min(start,end), end: Math.max(start,end) };
  }, [segIndex, segments]);

  const commitWindow = useCallback((s:number, e:number)=>{
    const { start, end } = clampToActive(s, e);
    applyWindow({ start, end }, {
      tl: baseTimeline, rows: baseRows, perSrc: basePerSrc,
      perAbility: basePerAbility, pat: basePerAbilityTargets,
      perTaken: basePerTaken, perTakenBy: basePerTakenBy, duration
    });
  }, [clampToActive, baseTimeline, baseRows, basePerSrc, basePerAbility, basePerAbilityTargets, basePerTaken, basePerTakenBy, duration]);

  // ability expand
  const [openAbility, setOpenAbility] = useState<string>('');


  /* -------------------- worker / parsing -------------------- */
// Popout-only: fresh worker factory so the popout can parse independently
function makeWorkerForPopout(): Worker {
  try {
    // Preferred: module worker via URL
    return new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' });
  } catch (e) {
    // Fallback for Vite: ?worker import
    try {
      // @ts-ignore
      const WorkerCtor = (window as any).__SWG_WORKER_CTOR__;
      if (WorkerCtor) return new WorkerCtor();
    } catch {}
  }
  // Last resort: dynamic import (async), but our popout expects sync.
  // If you hit this, add: window.__SWG_WORKER_CTOR__ = (await import('./parser.worker.ts?worker')).default;
  throw new Error('Unable to construct parser worker for popout');
}

  
async function ensureWorker(): Promise<Worker>{
    if (workerRef.current) return workerRef.current;

    let w: Worker | null = null;

    // Try native new URL pattern first
    try {
      w = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' });
    } catch (e) {
      // Fallback for some Vite setups: ?worker import
      try {
        const mod: any = await import('./parser.worker.ts?worker');
        const WorkerCtor = mod?.default;
        if (WorkerCtor) {
          w = new WorkerCtor();
        }
      } catch (e2) {
        console.error('Failed to construct worker via ?worker import:', e2);
      }
    }

    if (!w) {
      throw new Error('Failed to create parser worker');
    }

    
    // Debug: confirm worker constructed
    try { console.debug('[parser worker] constructed'); } catch {}
w.onmessage = (ev:any)=>{
      try { console.debug('[parser worker] message', ev?.data); } catch {}
      const msg = ev.data;
      if (msg?.type === 'progress'){
        setParsing({done:msg.done,total:msg.total});
        return;
      }
      if (msg?.type === 'done'){
      startTransition(() => {
        const {
          rows:rws, tl, perSrc, perAbility, perAbilityTargets:pat,
          perTaken, perTakenBy, debug, duration,
          damageEvents, healEvents, deathEvents
        } = msg.payload;

        const { pa: basePaNorm, pat: basePatNorm } =
          mergeNormalizedAbilities(perAbility || {}, pat || {});

        setBaseRows(rws); setBaseTimeline(tl);
        setBasePerSrc(perSrc||{});
        setBasePerAbility(basePaNorm);
        setBasePerAbilityTargets(basePatNorm);
        setBasePerTaken(perTaken||{});
        setBasePerTakenBy(perTakenBy||{});
        setDamageEvents(damageEvents||[]);
        setHealEvents(healEvents||[]);
        setDeathEvents(deathEvents||[]);
        setDuration(duration||0);
        setDebug(debug);

        const segs = deriveSegments(tl, damageEvents||[], idleGap);
        setSegments(segs);
        setSegIndex(-1);

        const start = tl?.[0]?.t ?? 0;
        const end   = tl?.length ? tl[tl.length-1].t : duration;
        applyWindow({ start, end }, {
          tl, rows:rws, perSrc, perAbility: basePaNorm, pat: basePatNorm, perTaken, perTakenBy, duration
        });

        setPA(a=> rws.find(v=>v.name===a)?.name || '');
        setPB(b=> rws.find(v=>v.name===b)?.name || '');

        setParsing(null);
      
      });
}
    };
    w.onerror = (err) => {
      console.error('Parser worker error:', err);
    };
    (w as any).onmessageerror = (err: any) => {
      console.error('Parser worker messageerror:', err);
    };

    workerRef.current = w;
    return w;
  }

  async function parseTextViaWorker(text:string){
    const w = await ensureWorker();
    setParsing({done:0,total:1});
    try {
      // Send both legacy and typed shapes so either worker impl will parse it
      w.postMessage({ text, collectUnparsed });
      w.postMessage({ type: 'parse', text, collectUnparsed });
    } catch (e) {
      console.error('Failed to postMessage to worker:', e);
      setParsing(null);
      return;
    }
    // Watchdog: if we don't get progress/done soon, clear spinner and surface hint
    setTimeout(() => {
      setParsing(prev => {
        if (prev && prev.done === 0 && prev.total === 1) {
          console.error('[parser worker] no response after 6s — check worker import path or message shape');
          return null;
        }
        return prev;
      });
    }, 6000);
  }

  function onChoose(files: FileList | null){
    if(!files || !files.length) return;
    const fr = new FileReader();
    fr.onload = () => { parseTextViaWorker(String(fr.result||'')); };
    fr.readAsText(files[0]);
  }
  

  /* -------------------- segmentation & filtering -------------------- */

  function deriveSegments(tl:Array<{t:number;dps:number;hps:number}>, dmg:DamageEvent[], gap:number){
    if (!tl?.length) return [];
    const active = tl.map(p => ({t:p.t, active: (p.dps>0 || p.hps>0)}));
    const segs: Array<{start:number;end:number;label:string}> = [];
    let runStart: number|null = null;
    let lastActive: number|null = null;
    for (let i=0;i<active.length;i++){
      if (active[i].active){
        if (runStart===null) runStart = active[i].t;
        lastActive = active[i].t;
      }
      const nextT = (i+1<active.length) ? active[i+1].t : active[i].t + gap + 1;
      const idle = (lastActive!=null) ? (nextT - lastActive) : 0;
      if (runStart!=null && lastActive!=null && idle>=gap){
        segs.push(makeSegmentLabel({start:runStart, end:lastActive}, dmg));
        runStart = null; lastActive = null;
      }
    }
    if (runStart!=null && lastActive!=null){
      segs.push(makeSegmentLabel({start:runStart, end:lastActive}, dmg));
    }
    return segs;
  }

  function makeSegmentLabel(rng:{start:number; end:number}, dmg:DamageEvent[]){
    const counts: Record<string, number> = {};
    for (const e of dmg){
      if (e.t<rng.start || e.t>rng.end) continue;
      const key = normName(e.dst);
      counts[key] = (counts[key]||0) + e.amount;
    }
    let bestNpc = '', bestVal = 0;
    for (const [k,v] of Object.entries(counts)){
      if (v>bestVal && NPC_MAP[k]){ bestNpc = k; bestVal = v; }
    }
    const labelCore = bestNpc ? NPC_MAP[bestNpc] : `#${(segments?.length||0)+1}`;
    return { start:rng.start, end:rng.end, label: `${labelCore} — ${toMMSS(rng.start)}→${toMMSS(rng.end)} (${toMMSS(rng.end-rng.start)})` };
  }

  // recompute filtered aggregates for current window
  function applyWindow(window: {start:number; end:number} | null, base:{
    tl: any[], rows:PlayerRow[], perSrc:Record<string,number[]>, perAbility:PerAbility, pat: PerAbilityTargets,
    perTaken:Record<string,number>, perTakenBy:Record<string,Record<string,number>>, duration:number
  }){
  startTransition(() => {
    if (!window){
      setRows(base.rows);
      setTimeline(base.tl);
      setPerSrc(base.perSrc);
      setPerAbility(base.perAbility);
      setPerAbilityTargets(base.pat);
      setPerTaken(base.perTaken);
      setPerTakenBy(base.perTakenBy);
      return;
    }

    const {start, end} = window;
    const winDur = Math.max(1, end - start + 1);

    // timeline slice
    const tlWindow = base.tl.filter(p => p.t>=start && p.t<=end);
    setTimeline(tlWindow);

    // events filtered
    const dE = damageEvents.filter(e => e.t>=start && e.t<=end);
    const hE = healEvents.filter(e => e.t>=start && e.t<=end);

    // rows (canonicalized)
    const dmgBySrc: Record<string, number> = {};
    const healBySrc: Record<string, number> = {};
    for (const e of dE){
      const src = canonEntity(e.src);
      dmgBySrc[src] = (dmgBySrc[src]||0) + e.amount;
    }
    for (const e of hE){
      const src = canonEntity(e.src);
      healBySrc[src] = (healBySrc[src]||0) + e.amount;
    }
    const actors = new Set<string>([...Object.keys(dmgBySrc), ...Object.keys(healBySrc)]);
    const nextRows: PlayerRow[] = [...actors].map(name=>{
      const damageDealt = dmgBySrc[name]||0;
      const healingDone = healBySrc[name]||0;
      const avgDps = damageDealt/winDur;
      return { name, damageDealt, healingDone, avgDps, profession: undefined };
    });
    setRows(nextRows);

    // perSrc per-second DPS for A/B (canonicalized)
    const byActorPS: Record<string, number[]> = {};
    for (const e of dE){
      const sec = e.t;
      const src = canonEntity(e.src);
      if (!byActorPS[src]) byActorPS[src] = [];
      byActorPS[src][sec] = (byActorPS[src][sec]||0) + e.amount;
    }
    setPerSrc(byActorPS);

    // abilities per actor (normalized ability + canonicalized target/source)
    const pa: PerAbility = {};
    const pat: PerAbilityTargets = {};
    for (const e of dE){
      const actor = canonEntity(e.src);
      const target = canonEntity(e.dst);
      let abil = normalizeAbilityName(e.ability);
// Keep aggregation key normalized without suffix; label in UI instead.

      if (!pa[actor]) pa[actor] = {};
      if (!pa[actor][abil]) pa[actor][abil] = { hits:0, dmg:0, max:0 };
      const a = pa[actor][abil]; a.hits++; a.dmg+=e.amount; if (e.amount>a.max) a.max=e.amount;

      if (!pat[actor]) pat[actor] = {};
      if (!pat[actor][abil]) pat[actor][abil] = {};
      if (!pat[actor][abil][target]) pat[actor][abil][target] = { hits:0, dmg:0, max:0 };
      const t = pat[actor][abil][target]; t.hits++; t.dmg+=e.amount; if (e.amount>t.max) t.max=e.amount;
    }
    setPerAbility(pa);
    setPerAbilityTargets(pat);

    // damage taken (overall) & taken by source (canonicalized)
    const takenTotal: Record<string, number> = {};
    const takenBy: Record<string, Record<string, number>> = {};
    for (const e of dE){
      const src = canonEntity(e.src);
      const dst = canonEntity(e.dst);
      if (src === dst) continue; // ignore self damage
      takenTotal[dst] = (takenTotal[dst]||0) + e.amount;
      if (!takenBy[dst]) takenBy[dst] = {};
      takenBy[dst][src] = (takenBy[dst][src]||0) + e.amount;
    }
    setPerTaken(takenTotal);
    setPerTakenBy(takenBy);
  
  });
}

  // recompute segments when idle gap changes or new data arrives
  useEffect(()=>{
    if (!baseTimeline.length) return;
    const segs = deriveSegments(baseTimeline, damageEvents, idleGap);
    setSegments(segs);
    setSegIndex(prev => (prev>=0 && prev<segs.length) ? prev : -1);
  }, [idleGap, baseTimeline, damageEvents]);

  // when segment changes, recompute windowed views
  useEffect(()=>{
    if (!baseTimeline.length){
      setRows([]); setTimeline([]); setPerAbility({}); setPerAbilityTargets({}); setPerTaken({}); setPerTakenBy({}); setPerSrc({});
      return;
    }
    if (segIndex<0 || !segments[segIndex]){
      // Treat "— none —" as full fight window so canonicalization is applied
      const start = baseTimeline[0]?.t ?? 0;
      const end   = baseTimeline.length ? baseTimeline[baseTimeline.length-1].t : duration;
      applyWindow({ start, end }, {
        tl: baseTimeline, rows: baseRows, perSrc: basePerSrc,
        perAbility: basePerAbility, pat: basePerAbilityTargets,
        perTaken: basePerTaken, perTakenBy: basePerTakenBy, duration
      });
    }else{
      const seg = segments[segIndex];
      applyWindow({ start: seg.start, end: seg.end }, {
        tl: baseTimeline, rows: baseRows, perSrc: basePerSrc,
        perAbility: basePerAbility, pat: basePerAbilityTargets,
        perTaken: basePerTaken, perTakenBy: basePerTakenBy, duration
      });
    }
  }, [segIndex, baseTimeline, baseRows, basePerSrc, basePerAbility, basePerAbilityTargets, basePerTaken, basePerTakenBy, segments, duration]);

  
  /* -------------------- derived window bounds (for overlays) -------------------- */
  const windowStart = useMemo(() => (timeline[0]?.t ?? (baseTimeline[0]?.t ?? 0)), [timeline, baseTimeline]);
  const windowEnd   = useMemo(() => (timeline.length ? timeline[timeline.length-1].t : (baseTimeline.length ? baseTimeline[baseTimeline.length-1].t : duration)), [timeline, baseTimeline, duration]);
/* -------------------- selectors & memo -------------------- */
// Selected player helper (A if set, else first in current rows). Return null for "all players".
function getSelectedPlayerForPopout(): string | null {
  // If comparison is on and A is chosen, use that; otherwise default to top row
  try {
    if (compareOn && pA) return pA || null;
  } catch {}
  try {
    return (rows && rows[0] && rows[0].name) ? rows[0].name : null;
  } catch {}
  return null;
}


  // Alphabetize and de-duplicate the comparison dropdown
  const names = useMemo(()=>{
    const bad = /^(with|using)\s/i;
    const arr = rows.map(r=>r.name).filter(n=>!bad.test(n));
    const uniq = Array.from(new Set(arr));
    return uniq.sort((a,b)=> a.localeCompare(b, undefined, {sensitivity:'base'}));
  }, [rows]);

  const listDamage = useMemo(()=> barData(rows, metric), [rows, metric]);
  const listHealing = useMemo(()=> barData(rows, 'healingDone'), [rows]);
  const inferredClasses = useMemo(()=> inferClasses(rows, perAbility), [rows, perAbility]);
  const listAPM = useMemo(()=> actionsPerMinute(rows, perAbility, (segIndex>=0 && segments[segIndex]) ? (segments[segIndex].end - segments[segIndex].start + 1) : duration), [rows, perAbility, duration, segIndex, segments]);

  const takenFor = useMemo(()=> {
    const who = (compareOn && (pA || pB)) ? (pA || pB) : '';
    if (who && perTakenBy[who]) {
      return Object.entries(perTakenBy[who]).map(([src, value])=>({ name: src, value })).sort((a,b)=> b.value-a.value).slice(0,12);
    }
    const items = Object.entries(perTaken).map(([name, value])=>({ name, value }));
    return items.sort((a,b)=> b.value - a.value).slice(0,12);
  }, [perTaken, perTakenBy, compareOn, pA, pB]);

  const TLdps = useMemo(()=> timeline.map(d=>({t:d.t, v:d.dps})), [timeline]);
  const TLhps = useMemo(()=> timeline.map(d=>({t:d.t, v:d.hps})), [timeline]);
  const seriesDuration = useMemo(()=> (timeline.length ? (timeline[timeline.length-1].t - timeline[0].t + 1) : duration), [timeline, duration]);

  function seriesFor(name:string){
    const arr = perSrc[name]||[];
    if (!arr.length) return [];
    const first = timeline[0]?.t ?? 0;
    const last = timeline.length ? timeline[timeline.length-1].t : duration;
    const out: {t:number; v:number}[] = [];
    for (let t=first; t<=last; t++){
      if (arr[t]) out.push({ t, v: arr[t] });
      else out.push({ t, v: 0 });
    }
    return out;
  }

  // A/B overlays (kept)
  const aSeries = useMemo(()=> smooth ? smoothSeries(seriesFor(pA), 7) : seriesFor(pA), [pA, perSrc, timeline, smooth]);
  const bSeries = useMemo(()=> smooth ? smoothSeries(seriesFor(pB), 7) : seriesFor(pB), [pB, perSrc, timeline, smooth]);

  // NEW: Top 10 lines (by total damage in current window)
  const top10Names = useMemo(
    () => [...rows].sort((a,b)=> b.damageDealt - a.damageDealt).slice(0,10).map(r=> r.name),
    [rows]
  );
  const top10Series = useMemo(
    () => top10Names.map(name => ({
      name,
      series: smooth ? smoothSeries(seriesFor(name), 7) : seriesFor(name),
      color: classColor(inferredClasses[name]),
    })),
    [top10Names, smooth, perSrc, timeline, inferredClasses]
  );
const deathFlags = useMemo(() => {
  if (!deathEvents?.length || !top10Series?.length) return [];
  const allow = new Set(top10Series.map(s => s.name));
  return deathEvents
    .filter(d => d.t >= windowStart && d.t <= windowEnd && allow.has(d.name))
    .sort((a, b) => a.t - b.t);
}, [deathEvents, top10Series, windowStart, windowEnd]);


  // Should we dim non-selected lines? Only if A or B is selected AND present in Top-10.
  const hasSelection = useMemo(
    () =>
      compareOn &&
      ((pA && top10Names.includes(pA)) || (pB && top10Names.includes(pB))),
    [compareOn, pA, pB, top10Names]
  );

  // Build a combined dataset: one row per second with a column per Top-10 player
  const top10Data = useMemo(() => {
    if (!timeline.length || !top10Series.length) return [];
    const len = top10Series[0].series.length;
    return Array.from({ length: len }, (_, i) => {
      const t = top10Series[0].series[i]?.t ?? (timeline[0]?.t ?? 0) + i;
      const row: any = { t };
      top10Series.forEach(({ name, series }) => {
        row[name] = series[i]?.v || 0;
      });
      return row;
    });
  }, [timeline, top10Series]);

  // Y-axis max across Top-10 and A/B overlays
  const maxY = useMemo(() => {
    let m = 0;
    top10Series.forEach(({ series }) => series.forEach(p => { if (p.v > m) m = p.v; }));
    aSeries.forEach(p => { if ((p?.v || 0) > m) m = p.v; });
    bSeries.forEach(p => { if ((p?.v || 0) > m) m = p.v; });
    return m || 1;
  }, [top10Series, aSeries, bSeries]);

  function pickFromChart(name:string, ev?:any){
    if(!compareOn) return;
    if (ev && ev.shiftKey) setPB(prev => prev===name ? '' : name);
    else setPA(prev => prev===name ? '' : (name===pB ? pB : name));
  }
  useEffect(()=>{ if(!compareOn){ setPA(''); setPB(''); } }, [compareOn]);

  /* -------------------- render -------------------- */

  return <ErrorBoundary>
    <div className="swg-theme">
      <style dangerouslySetInnerHTML={{ __html: SW_CSS }} />
      <div style={{ minHeight:'100vh', padding:16 }}>
      <div className="card" style={{ padding:12, marginBottom:12 }}>
        <div className="row">
          <label className="row" style={{gap:8}}>
            <span style={{opacity:.8,fontWeight:700}}>Upload SWG chatlog.txt</span>
            <input className="input" type="file" accept=".txt,.log" onChange={(e)=>onChoose(e.target.files)} />
          </label>
          <DpsPopoutButton getSelectedPlayer={getSelectedPlayerForPopout} makeWorker={makeWorkerForPopout} />

          <span style={{opacity:.8,fontWeight:700}}>Metric:</span>
          <select className="input" value={metric} onChange={(e)=>setMetric(e.target.value as MetricKey)}>
            <option value="damageDealt">Damage Dealt</option>
            <option value="avgDps">Average DPS</option>
            <option value="healingDone">Healing Done</option>
          </select>

          <label className="row" style={{gap:6}}>
            <input type="checkbox" checked={collectUnparsed} onChange={(e)=>setCollectUnparsed(e.target.checked)} />
            <span className="pill">Collect unparsed lines</span>
          </label>

          <label className="row" style={{gap:6, marginLeft:8}}>
            <input type="checkbox" checked={compareOn} onChange={(e)=>setCompareOn(e.target.checked)} />
            <span className="pill">Player comparison</span>
          </label>
          <select className="input" disabled={!compareOn} value={pA} onChange={e=>setPA(e.target.value)}>
            <option value="">A: Select player</option>
            {names.map(n=> <option key={'A'+n} value={n}>{n}</option>)}
          </select>
          <select className="input" disabled={!compareOn} value={pB} onChange={e=>setPB(e.target.value)}>
            <option value="">B: Select player</option>
            {names.map(n=> <option key={'B'+n} value={n}>{n}</option>)}
          </select>
          <button className="btn" disabled={!compareOn} onClick={()=>{ setPA(''); setPB(''); }}>Clear A/B</button>

          {parsing && <span className="badge">Parsing… <progress max={parsing.total} value={parsing.done}></progress> {fmt0(parsing.done)}/{fmt0(parsing.total)}</span>}
        </div>

        <div className="row" style={{marginTop:10}}>
          <textarea className="input mono" placeholder="Or paste raw lines here…" value={pasteText} onChange={(e)=>setPasteText(e.target.value)} style={{width:'min(900px,100%)',height:90}} />
          <button className="btn" onClick={()=>{ if(!pasteText.trim()) return; parseTextViaWorker(pasteText) }}>Parse pasted text</button>
        </div>
      </div>

      {/* Timeline + segments UI */}
      <div className="card">
        <div style={{ padding:'12px 14px', borderBottom:'1px solid #1b2738', display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
          <div style={{ alignSelf:'flex-start' }}><div style={{ fontSize:13, fontWeight:800, color:'#9fb7d8', letterSpacing:.3 }}>DPS Over Time - Top 10</div></div>
          <div className="row" style={{gap:8, alignItems:'center', justifyContent:'center', flexWrap:'wrap', width:'100%', marginTop:6}}>
            <label className="row" style={{gap:6}}><input type="checkbox" checked={smooth} onChange={e=>setSmooth(e.target.checked)} /><span className="pill">Smooth</span></label>
            <label className="row" style={{gap:6}}>
              <span className="pill">Idle gap (s)</span>
              <input className="input" style={{width:72}} type="number" min={30} step={10} value={idleGap} onChange={(e)=>setIdleGap(Math.max(10, Number(e.target.value||60)))} />
            </label>
            <label className="row" style={{gap:6}}>
              <span className="pill">Segments:</span>
              <select className="input" value={segIndex} onChange={e=>setSegIndex(Number(e.target.value))}>
                <option value={-1}>— none —</option>
                {segments.map((s, i)=>(<option key={i} value={i}>{s.label}</option>))}
              </select>
            </label>
<div style={{ display:'flex', gap:12, alignItems:'center' }}>
  <div style={{ fontSize:12, color:'#9bb7df' }}>
    Parsed {fmt0(debug?.parsed)}/{fmt0(debug?.totalLines)} • Duration {toMMSS(debug?.duration||0)}
  </div>
  <button className="btn" style={{ marginLeft: 8 }} onClick={resetWindow}>
    RESET WINDOW
  </button>
</div>
        </div>

        <div ref={timelineRef} style={{ position:'relative', padding:0, height:420, width:'100%' }}>
          <ResponsiveContainer width="100%" height="100%" debounce={200}>
            <LineChart onMouseDown={(e:any)=>{ if(!e||e.activeLabel==null)return; setSelecting({x0:Number(e.activeLabel),x1:Number(e.activeLabel)}); }} onMouseMove={(e:any)=>{ if(e&&e.activeLabel!=null) setHoverXThrottled(Number(e.activeLabel)); if(!selecting||!e||e.activeLabel==null) return; setSelecting(s=>s?({...s,x1:Number(e.activeLabel)}):s); }} onMouseUp={(e:any)=>{ if(!selecting) return; const {x0,x1}=selecting; setSelecting(null); if(Math.abs(x1-x0)>=1) commitWindow(x0,x1); }} onMouseLeave={()=> setHoverXThrottled(null)} onDoubleClick={()=> resetWindow()} data={top10Data} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#1c2a3f" strokeDasharray="2 4" />
              <XAxis
                dataKey="t"
                type="number"
                domain={['dataMin','dataMax']}
                tickFormatter={(s)=>toMMSS(Number(s))}
                stroke="#8aa8cf"
              />
              <YAxis
                tickFormatter={(s)=>fmt0(s)}
                stroke="#8aa8cf"
                domain={[0, maxY * 1.05]}
              />
              <Tooltip formatter={(v:number)=>fmt0(v)} labelFormatter={(l)=>toMMSS(Number(l))} />
              <Legend />

              {/* Top-10 per-player lines */}
              {top10Series.map(({ name, color }) => {
                const selected = (name === pA || name === pB);
                const opacity = hasSelection ? (selected ? 1 : 0.4) : 1;



                return (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    name={name}
                    stroke={color}
                    strokeWidth={2}
                    strokeOpacity={opacity}  // dim non-selected
                    dot={false}
                    isAnimationActive={false}
                  >
                    {/* label at the last point only */}
                    <LabelList
                      dataKey={name}
                      content={(props:any) => {
                        const { x, y, index, value } = props;
                        if (index !== top10Data.length - 1 || (value ?? 0) <= 0) return null;
                        return (
                          <text
                            x={x + 6}
                            y={y - 6}
                            fontSize={11}
                            fill={color}
                            fillOpacity={opacity}  // dim label to match line
                            style={{ pointerEvents:'none' }}
                          >
                            {name}
                          </text>
                        );
                      }}
                    />
                  </Line>
                );
              })}

              {/* A/B overlays */}
              {compareOn && pA && (
                <Line type="monotone" data={aSeries} dataKey="v" name={`A: ${pA}`} stroke="#ffd166" strokeWidth={2.5} dot={false} isAnimationActive={false} />
              )}
              {compareOn && pB && (
                <Line type="monotone" data={bSeries} dataKey="v" name={`B: ${pB}`} stroke="#ef476f" strokeWidth={2.5} dot={false} isAnimationActive={false} />
              )}

{/* Death flags in current window */}
{deathFlags.map(df => (
  <ReferenceLine
    key={`death-${df.name}-${df.t}`}
    x={df.t}
    stroke="#ff6464"
    strokeOpacity={0.9}
    strokeDasharray="3 3"
    isFront
    label={<DeathLabel value={df.name} size={16} dy={14} anchor="top" />}
  />
))}

{selecting && (
  <ReferenceArea
    x1={Math.max(selecting.x0, selecting.x1)}
    x2={Math.min(selecting.x0, selecting.x1)}
    strokeOpacity={0}
    fill="rgba(33,212,253,0.12)"
  />
)}
</LineChart>
          </ResponsiveContainer>
  <TimelineHoverOverlay containerRef={timelineRef} />
        </div>
      </div>

      {/* Mode buttons under timeline */}
      <div className="tabbar">
        <button className={"tab" + (mode==='sources'?' active':'')} onClick={()=>setMode('sources')}>Sources</button>
        <button className={"tab" + (mode==='abilities'?' active':'')} onClick={()=>setMode('abilities')}>Abilities</button>
        <button className={"tab" + (mode==='statistics'?' active':'')} onClick={()=>setMode('statistics')}>Statistics</button>
      </div>

      {mode==='sources' ? (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:16 }}>
          {renderPanel('Damage Done By Source', listDamage, rows, 'damageDealt', compareOn, pA, pB, pickFromChart, inferredClasses)}
          {renderPanel('Healing Done By Source', listHealing, rows, 'healingDone', compareOn, pA, pB, pickFromChart, inferredClasses)}
          {renderPanel(`Damage Taken By Source${(compareOn && (pA||pB)) ? ' — ' + (pA||pB) : ''}`, takenFor, rows, 'damageDealt', false, '', '', ()=>{}, inferredClasses)}
          {renderPanel('Actions per Minute (APM)', listAPM, rows, 'damageDealt', false, '', '', ()=>{}, inferredClasses)}
        </div>
      ) : mode==='abilities' ? (
        <div className="card" style={{ marginTop:16 }}>
          <div style={{ padding:'12px 14px', borderBottom:'1px solid #1b2738', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ fontSize:13, fontWeight:800, color:'#9fb7d8', letterSpacing:.3 }}>Abilities — {(pA || names[0] || 'No player selected')}</div>
            <div className="row">
              <span className="pill">Click a bar to pick A (Shift+Click for B). Abilities show A (or top player).</span>
            </div>
          </div>
          <div style={{ padding:14, overflow:'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Ability</th>
                  <th className="num">HITS</th>
                  <th className="num">DAMAGE</th>
                  <th className="num">AVG</th>
                  <th className="num">MAX</th>
                  <th className="num">% OF PLAYER</th>
    <th className="num">ELEMENTAL TYPE</th>
    <th className="num">ELEMENTAL % OF DAMAGE</th>
                </tr>
              </thead>
<tbody>
  {(() => {
    const player = pA || names[0];
    if (!player) return null;

    // Current window bounds
    const winStart = timeline[0]?.t ?? 0;
    const winEnd   = timeline.length ? timeline[timeline.length - 1].t : duration;

    // Collect abilities that ticked as DoT for this player in the window
    const dotAbilities = new Set(
      damageEvents
        .filter(e =>
          e.t >= winStart &&
          e.t <= winEnd &&
          canonEntity(e.src) === player &&
          isPeriodic(e as any)
        )
        .map(e => normalizeAbilityName(e.ability))
    );const map = (perAbility[player] || {}) as Record<string,{hits:number;dmg:number;max:number}>;
    const entries = Object.entries(map);
    const total = entries.reduce((sum, [,v]) => sum + (v?.dmg || 0), 0);

    return entries
      .map(([ability, v])=> ({
        ability,
        hits: v.hits,
        damage: v.dmg,
        avg: v.hits ? v.dmg / v.hits : 0,
        max: v.max
      }))
      .sort((a,b)=> b.damage - a.damage)
      .flatMap(r => {
        const isOpen = openAbility === r.ability;
        const targetsMap = ((perAbilityTargets[player] || {})[r.ability]) || {};
        const targets = Object.entries(targetsMap).map(([t, sv])=> ({
          target: t,
          hits: (sv as any)?.hits || 0,
          damage: (sv as any)?.dmg || 0,
          avg: (sv as any)?.hits ? (sv as any).dmg / (sv as any).hits : 0,
          max: (sv as any)?.max || 0
        })).sort((a,b)=> b.damage - a.damage);

        const isDoT = dotAbilities.has(normalizeAbilityName(r.ability));

        return [
          (
            <tr key={r.ability}>
              <td className="muted">
                <button
                  className="btn"
                  style={{padding:'2px 8px'}}
                  onClick={()=> setOpenAbility(isOpen ? '' : r.ability)}
                >
                  {isOpen ? '▾' : '▸'}
                </button>{' '}
                {r.ability + (isDoT ? ' (Damage over Time)' : '')}
              </td>
              <td className="num">{fmt0(r.hits)}</td>
              <td className="num">{fmt0(r.damage)}</td>
              <td className="num">{fmt0(r.avg)}</td>
              <td className="num">{fmt0(r.max)}</td>
              <td className="num">{total>0 ? `${(r.damage/total*100).toFixed(1)}%` : '—'}</td>
            
              {/* Elemental columns (injected) */}
              {(() => {
                try {
                  const winStart = timeline?.[0]?.t ?? 0;
                  const winEnd = timeline?.length ? timeline[timeline.length-1].t : duration ?? 0;
                  const abilityNorm = typeof normalizeAbilityName === "function" ? normalizeAbilityName(r.ability) : r.ability;
                  const playerName = (pA || names?.[0] || "");
                  const elemTotals = collectAbilityElements(damageEvents as any, playerName, abilityNorm, winStart, winEnd);
                  const { types, pct } = summarizeElements(elemTotals);
                  return (<><td className="num">{types}</td><td className="num nowrap">{pct}</td></>);
                } catch {
                  return (<><td className="num">—</td><td className="num">—</td></>);
                }
              })()}
</tr>
          ),
          isOpen ? (
            <tr key={r.ability + ':targets'}>
              <td colSpan={6}>
                {targets.length ? (
                  <div
                    style={{
                      padding:'6px 8px',
                      background:'#0e1724',
                      borderWidth:1,
                      borderStyle:'solid',
                      borderColor:'#1b2738',
                      borderRadius:8
                    }}
                  >
                    <div style={{fontSize:12, color:'#9fb7d8', marginBottom:6}}>
                      Target breakdown for <b>{r.ability}</b>{isDoT ? ' (Damage over Time)' : ''}
                    </div>
                    <table className="table" style={{margin:0}}>
                      <thead>
                        <tr>
                          <th>Target</th>
                          <th className="num">HITS</th>
                          <th className="num">DAMAGE</th>
                          <th className="num">AVG</th>
                          <th className="num">MAX</th>
                        </tr>
                      </thead>
                      <tbody>
                        {targets.map(t => (
                          <tr key={t.target}>
                            <td className="muted">{t.target}</td>
                            <td className="num">{fmt0(t.hits)}</td>
                            <td className="num">{fmt0(t.damage)}</td>
                            <td className="num">{fmt0(t.avg)}</td>
                            <td className="num">{fmt0(t.max)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div
                    style={{
                      padding:'8px 10px',
                      background:'#0e1724',
                      borderWidth:1,
                      borderStyle:'solid',
                      borderColor:'#1b2738',
                      borderRadius:8,
                      color:'#9fb7d8',
                      fontSize:12
                    }}
                  >
                    No per-target data available for this ability.
                  </div>
                )}
              </td>
            </tr>
          ) : null
        ].filter(Boolean) as any;
      });
  })()}
</tbody>

                         </table>
          </div>
        </div>
      ) : (
        /* ===================== Statistics tab ===================== */
        <StatisticsTab
          actor={pA || ''}
          damageEvents={damageEvents}
          healEvents={healEvents}
          perAbility={perAbility}
          perTaken={perTaken}
          perTakenBy={perTakenBy}
          windowStart={timeline[0]?.t ?? 0}
          windowEnd={timeline.length ? timeline[timeline.length-1].t : duration}
        />
      )}
    </div>
  </div>
    </div>
</ErrorBoundary>;
}

/* ========================= Shared panel renderer ========================= */

function renderPanel(
  title:string,
  list:{name:string;value:number}[],
  rows:PlayerRow[],
  metric:MetricKey,
  compareOn:boolean, pA:string, pB:string,
  onPick:(name:string, ev?:any)=>void,
  inferredClasses:Record<string,string> = {}
){
  return <div className="card">
    <div style={{ padding:'12px 14px', borderBottom:'1px solid #1b2738', display:'flex', justifyContent:'space-between' }}>
      <div style={{ fontSize:13, fontWeight:800, color:'#9fb7d8', letterSpacing:.3 }}>{title}</div>
      <div><ClassLegend /></div>
    </div>
    <div style={{ padding:14, height:360 }}>
      <ResponsiveContainer debounce={200}>
        <BarChart data={list} layout="vertical" margin={{ top:6, right:40, left:20, bottom:6 }} barCategoryGap="28%" barGap={6}>
          <CartesianGrid horizontal={false} strokeDasharray="3 3" />
          <YAxis type="category" dataKey="name"
                 width={Math.max(160, Math.min(360, 16 + list.reduce((m,i)=>Math.max(m,(i.name||'').length),0)*8))}
                 interval={0} tick={{ fill: "#cfe3ff", fontSize: 12 }} tickLine={false} axisLine={false} />
          <XAxis type="number" tickFormatter={(v:number)=> fmt0(v)} tick={{ fill: "#9bb7df" }} />
          <Tooltip formatter={(v:number)=> fmt0(v)} labelFormatter={(l)=> l as string} />
          <Legend />
          <Bar dataKey="value" name={metric==='damageDealt'?'Damage Dealt': metric==='avgDps'?'Average DPS':'Healing Done'}
               radius={[4,4,4,4]} onClick={(data:any, _idx:number, ev:any)=> onPick?.(String(data?.payload?.name||''), ev)}>
            <LabelList dataKey="value" position="right" formatter={(v:number)=> fmt0(v)} />
            {list.map((it, i)=> <Cell key={'c'+i} fill={classColor(inferredClasses[it.name])} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  </div>;
}

// ============================= DefenseFlow =============================
export function DefenseFlow({
  actor,
  events,
  windowStart,
  windowEnd,
}: {
  actor: string;
  events: DFEvent[];
  windowStart: number;
  windowEnd: number;
}) {
  const fmt0 = (v: number) =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
      Math.round(v || 0)
    );
  const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

  const CE = (s?: string) => canonEntity(cleanName(s || ""));
  const flags = (e: DFEvent) => (e.flags ?? "").toString().toLowerCase();
  const isPeriodic = (e: DFEvent) => flags(e).includes("periodic");
  const getDstAny = (e: DFEvent) =>
    e.dst ?? e.target ?? e.victim ?? e.defender ?? "";

  const C = {
    landed: "#ef4444",
    unblocked: "#ef4444",
    block: "#f59e0b",
    dodge: "#63d26c",
    parry: "#cde15a",
    glance: "#3498db",        // NEW: Glance color
    nodeFill: "#0f172a",
    nodeStroke: "#203047",
    text: "#ffffff",
    linkHalo: "#0b1220",
  };

  const ShadowText: React.FC<{
    x: number; y: number; fs?: number; anchor?: "start"|"middle"|"end";
    children: React.ReactNode;
  }> = ({ x, y, fs = 16, anchor = "start", children }) => (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fontSize={fs}
      fill={C.text}
      stroke="#000"
      strokeWidth={3.6}
      paintOrder="stroke"
      style={{ pointerEvents: "none" }}
    >
      {children}
    </text>
  );

  if (!actor) {
    return <div className="card" style={{ padding:12, color:"#9fb7d8" }}>
      Select a player to see their defensive flow.
    </div>;
  }

  // -------- windowed incoming, direct only --------
  const incoming = React.useMemo(() => {
    const A = CE(actor);
    const inWin = (e: DFEvent) => e.t >= windowStart && e.t <= windowEnd;
    return events.filter(
      (e) => inWin(e) && !isPeriodic(e) && CE(getDstAny(e)) === A
    );
  }, [events, actor, windowStart, windowEnd]);

  const hitsTaken    = incoming.filter(e => (e.amount||0) > 0).length;
  const dodgeCount   = incoming.filter(e => flags(e).includes("dodge")).length;
  const parryCount   = incoming.filter(e => flags(e).includes("parry")).length;
  const blockCount   = incoming.filter(e => (e.blocked||0) > 0 && (e.amount||0) > 0).length;
  const unblockedCnt = Math.max(0, hitsTaken - blockCount);
  const attempts     = hitsTaken + dodgeCount + parryCount;

  // NEW: glancing events (landed + flags === 'glance')
  const glanceCount  = incoming.filter(e => (e.amount||0) > 0 && flags(e) === "glance").length;
  const glancePctOfLanded = pct(glanceCount, hitsTaken);

  // side metrics (unchanged)
  const evSamples = incoming.filter(e => (e.amount||0) > 0 && typeof e.evadedPct === "number");
  const evEvents  = evSamples.length;
  const avgEv     = evEvents ? evSamples.reduce((s,e)=> s+(e.evadedPct||0),0)/evEvents : 0;
  const evTotal   = evSamples.reduce((s,e)=>{
    const base = e.preMitTotal ?? (e.amount||0) + (e.absorbed||0);
    return s + base * ((e.evadedPct||0)/100);
  }, 0);
  const evAvgAmt  = evEvents ? evTotal / evEvents : 0;

  if (!attempts) {
    return <div className="card" style={{ padding:12, color:"#9fb7d8" }}>
      No defensive events in this window.
    </div>;
  }

  // ===== decide which goes on top in the MIDDLE column =====
  const dodgeOnTop = dodgeCount > parryCount; // larger should be on top
  const TOP_LABEL  = dodgeOnTop ? "Dodge" : "Parry";
  const BOT_LABEL  = dodgeOnTop ? "Parry" : "Dodge";
  const hasDodge   = dodgeCount > 0;
  const hasParry   = parryCount > 0;

  // ---- nodes ----
  const N_D_END="__dodge_end__", N_P_END="__parry_end__", EPS=1e-5;
  const nodes: Array<{name:string}> = [];
  const idx: Record<string,number> = {};
  const add = (name:string)=> (idx[name] = nodes.push({name}) - 1);

  add("Total Attempts");               // only node in column 0 -> centers vertically
  if (hasDodge || hasParry) add(TOP_LABEL);   // column 1 (top)
  if (hasDodge || hasParry) add(BOT_LABEL);   // column 1 (bottom)
  add("Landed");                       // column 2
  add("Unblocked");                    // column 3
  add("Block");                        // column 3
  add("Glance");                       // NEW: column 3 (under Block)
  if (hasDodge) add(N_D_END);          // hidden end-caps to stabilize layout
  if (hasParry) add(N_P_END);

  // ---- links ----
  const links:any[] = [];
  links.push({ source:idx["Total Attempts"], target:idx["Landed"], value:hitsTaken, color:C.landed });
  if (hasDodge) links.push({ source:idx["Total Attempts"], target:idx["Dodge"], value:dodgeCount, color:C.dodge });
  if (hasParry) links.push({ source:idx["Total Attempts"], target:idx["Parry"], value:parryCount, color:C.parry });
  links.push({ source:idx["Landed"], target:idx["Unblocked"], value:unblockedCnt, color:C.unblocked });
  links.push({ source:idx["Landed"], target:idx["Block"],     value:blockCount,   color:C.block });
  // NEW: Landed -> Glance (with % of Landed in payload.meta)
  links.push({
    source: idx["Landed"],
    target: idx["Glance"],
    value: glanceCount,
    color: C.glance,
    meta: { pctOfLanded: glancePctOfLanded }
  });
  if (hasDodge) links.push({ source:idx["Dodge"], target:idx[N_D_END], value:EPS, color:"transparent" });
  if (hasParry) links.push({ source:idx["Parry"], target:idx[N_P_END], value:EPS, color:"transparent" });

  // ===== custom link renderer =====
  const CurvedLink: React.FC<any> = (p) => {
    const { sourceX, sourceY, targetX, targetY, linkWidth, payload } = p;
    if (!payload || (payload.value ?? 0) <= 0) return null;
    if (payload?.color === "transparent") return null;

    const sName = String(payload?.source?.name || "");
    const tName = String(payload?.target?.name || "");

    const half = Math.max(10, (linkWidth || 0) / 2);
    const CAP_DEF = Math.min(6, Math.max(4, half * 0.35));

    // visual shaping
    const LEFT_STAGGER = 0;
    const LANE_GAP     = Math.max(0, half * 1.35);
    const CURVE_AVOID  = 0.001;  // very shallow near the source
    const CURVE_OTHER  = 0.014;

    const isAvoid = sName === "Total Attempts" && (tName === "Dodge" || tName === "Parry");
    const startX  = (isAvoid ? sourceX + LEFT_STAGGER : sourceX) + CAP_DEF;
    const endX    = targetX - CAP_DEF;

    // --- offset only at the source; keep target centered ---
    let sy = sourceY;
    let ty = targetY;
    if (isAvoid) {
      const sign   = (tName === (dodgeOnTop ? "Dodge" : "Parry")) ? -1 : +1;
      const offset = sign * LANE_GAP;
      sy += offset;
    }

    const t = isAvoid ? CURVE_AVOID : CURVE_OTHER;
    const c1x = startX * (1 - t) + endX * t;
    const c2x = startX * t + endX * (1 - t);
    const c1y = sy;
    const c2y = ty;

    const d = `M ${startX},${sy} C ${c1x},${c1y} ${c2x},${c2y} ${endX},${ty}`;

    const mainW   = Math.max(2, linkWidth);
    const haloW   = mainW + 3;
    const outline = mainW + 2.5;

    // Label text: for Glance show "count (xx.x%)", others show count
    const label =
      tName === "Glance" && payload?.meta?.pctOfLanded != null
        ? `${fmt0(payload.value)} (${Number(payload.meta.pctOfLanded).toFixed(1)}%)`
        : fmt0(payload.value);

    return (
      <g style={{ shapeRendering: "geometricPrecision" }}>
        <path d={d} stroke={C.linkHalo}              strokeWidth={haloW}   strokeLinecap="butt" strokeLinejoin="round" fill="none" opacity={0.85}/>
        <path d={d} stroke={payload.color || "#888"} strokeWidth={outline} strokeLinecap="butt" strokeLinejoin="round" fill="none"/>
        <path d={d} stroke={payload.color || "#888"} strokeWidth={mainW}   strokeLinecap="butt" strokeLinejoin="round" fill="none" opacity={0.98}/>
        <text
          x={(startX + endX) / 2}
          y={(sy + ty) / 2 - 1}
          textAnchor="middle"
          fontSize={16}
          fill="#fff"
          stroke="#000"
          strokeWidth={3.6}
          paintOrder="stroke"
          style={{ pointerEvents: "none" }}
        >
          {label}
        </text>
      </g>
    );
  };

  // Bigger & visually centered "Total Attempts" node (without breaking links)
  const FlowNode: React.FC<any> = ({ x, y, width, height, payload }) => {
    const name = String(payload?.name || "");
    if (name === N_D_END || name === N_P_END) return null;

    // base used for percentages
    let base = attempts;
    if (name === "Block" || name === "Unblocked" || name === "Glance") base = Math.max(1, hitsTaken); // % of Landed
    const inVal = (payload?.value ?? 0) || 0;

    const swatch =
      name === "Landed"   ? C.landed   :
      name === "Unblocked"? C.unblocked:
      name === "Block"    ? C.block    :
      name === "Glance"   ? C.glance   :
      name === "Dodge"    ? C.dodge    :
      name === "Parry"    ? C.parry    : "#64748b";

    const MIN_H_TOTAL = 40;
    const MIN_H_OTHER = 14;
    const wantMin = name === "Total Attempts" ? MIN_H_TOTAL : MIN_H_OTHER;
    const drawH   = Math.max(height, wantMin);
    const drawY   = y + (height - drawH) / 2;

    return (
      <g>
        <rect x={x} y={drawY} width={width} height={drawH} rx={6} fill={C.nodeFill} stroke={C.nodeStroke}/>
        <rect x={x + 2} y={drawY + Math.max(0, (drawH - 12) / 2)} width={10} height={12} rx={3} fill={swatch}/>
        <ShadowText x={x + width + 8} y={drawY + Math.max(16, drawH / 2)} fs={18}>{name}</ShadowText>
        <ShadowText x={x + width + 8} y={drawY + Math.max(16, drawH / 2) + 20} fs={15}>
          {fmt0(inVal)} ({pct(inVal, base).toFixed(1)}%)
        </ShadowText>
      </g>
    );
  };

  // Enforce the middle-column order and right-column order
  const middleOrder = [TOP_LABEL, BOT_LABEL];
  const sortFn = (a: any, b: any) => {
    if (a.depth !== b.depth) return 0;
    if (a.depth === 1) {
      const ia = middleOrder.indexOf(a.name);
      const ib = middleOrder.indexOf(b.name);
      if (ia !== -1 && ib !== -1) return ia - ib;
    }
    if (a.depth === 3) {
      const order = ["Unblocked", "Block", "Glance"]; // NEW: Glance under Block
      const ia = order.indexOf(a.name), ib = order.indexOf(b.name);
      if (ia !== -1 && ib !== -1) return ia - ib;
    }
    return 0;
  };

  return (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 360px", gap:16 }}>
      <div className="card" style={{ padding:8 }}>
        <div style={{ fontSize:12, color:"#9fb7d8" }}>
          Attempts → <b>Dodge</b> / <b>Parry</b> / <b>Landed</b> → <b>Block</b> / <b>Glance</b> / <b>Unblocked</b>
        </div>
        <div style={{ marginTop:6, marginBottom:6 }}>
          <span style={{ display:"inline-flex", alignItems:"center", gap:6, marginRight:12, fontSize:12, color:"#cfe3ff" }}>
            <span style={{ width:12, height:12, borderRadius:3, background:C.dodge }}/>Dodge
          </span>
          <span style={{ display:"inline-flex", alignItems:"center", gap:6, marginRight:12, fontSize:12, color:"#cfe3ff" }}>
            <span style={{ width:12, height:12, borderRadius:3, background:C.parry }}/>Parry
          </span>
          <span style={{ display:"inline-flex", alignItems:"center", gap:6, marginRight:12, fontSize:12, color:"#cfe3ff" }}>
            <span style={{ width:12, height:12, borderRadius:3, background:C.landed }}/>Landed
          </span>
          <span style={{ display:"inline-flex", alignItems:"center", gap:6, marginRight:12, fontSize:12, color:"#cfe3ff" }}>
            <span style={{ width:12, height:12, borderRadius:3, background:C.block }}/>Block
          </span>
          <span style={{ display:"inline-flex", alignItems:"center", gap:6, marginRight:12, fontSize:12, color:"#cfe3ff" }}>
            <span style={{ width:12, height:12, borderRadius:3, background:C.glance }}/>Glance (from Landed)
          </span>
          <span style={{ display:"inline-flex", alignItems:"center", gap:6, marginRight:12, fontSize:12, color:"#cfe3ff" }}>
            <span style={{ width:12, height:12, borderRadius:3, background:C.unblocked }}/>Unblocked (from Landed)
          </span>
        </div>
        <div style={{ fontSize:11, color:"#7fa2d1", marginBottom:4 }}>
          percentages are of <i>Attempts</i> or of <i>Landed</i> where indicated
        </div>

        <div style={{ height: 280, overflow: "hidden" }}>
          <ResponsiveContainer width="100%" height="100%">
            <Sankey
              key={`${TOP_LABEL}-${BOT_LABEL}-${attempts}`} // force fresh layout when order flips
              data={{ nodes: nodes as any, links: links as any }}
              nodePadding={40}
              nodeWidth={16}
              iterations={64}
              margin={{ top: 10, right: 110, bottom: 54, left: 110 }}
              link={<CurvedLink />}
              node={<FlowNode />}
              linkCurvature={0.10}
              sort={sortFn as any}
              nodeSort={sortFn as any}
            >
              <Tooltip formatter={(v: number) => fmt0(Number(v))} />
            </Sankey>
          </ResponsiveContainer>
        </div>
      </div>

      {/* side metrics */}
      <div className="card" style={{ padding:12 }}>
        <div style={{ fontSize:14, fontWeight:800, color:"#9fb7d8", marginBottom:8 }}>Evasion</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", rowGap:8 }}>
          <div style={{ opacity:.85 }}>Events</div>
          <div style={{ textAlign:"right" }}>{fmt0(evEvents)}</div>
          <div style={{ opacity:.85 }}>Avg % evaded</div>
          <div style={{ textAlign:"right" }}>{evEvents ? `${avgEv.toFixed(1)}%` : "—"}</div>
          <div style={{ opacity:.85 }}>Total evaded</div>
          <div style={{ textAlign:"right" }}>{fmt0(evTotal)}</div>
          <div style={{ opacity:.85 }}>Avg evaded / event</div>
          <div style={{ textAlign:"right" }}>{fmt0(evAvgAmt)}</div>
        </div>
        <div style={{ marginTop:10, fontSize:11, color:"#8aa3c6" }}>
          Evaded amount ≈ pre-mit total × evaded % (or (damage+absorbed) × % when needed).
        </div>
      </div>
    </div>
  );
}
// =========================== end DefenseFlow ===========================
/* ========================= Statistics Tab Component ========================= */

function StatisticsTab({
  actor,
  damageEvents,
  healEvents,
  perAbility,
  perTaken,
  perTakenBy,
  windowStart,
  windowEnd,
}: {
  actor: string;
  damageEvents: DamageEvent[];
  healEvents: HealEvent[];
  perAbility: PerAbility;
  perTaken: Record<string, number>;
  perTakenBy: Record<string, Record<string, number>>;
  windowStart: number;
  windowEnd: number;
}) {
  const hasActor = !!actor;
  const dur = Math.max(1, windowEnd - windowStart + 1);

  // Canon + DoT helpers (reuse the canonEntity you already defined in this file)
  const CE = (s?: string) => canonEntity(String(s ?? ""));
  const isDot = (e: DamageEvent) =>
    (e.flags ?? "").toString().toLowerCase().includes("periodic");

  // Windowed slices
  const dEvAll = useMemo(
    () => damageEvents.filter(e => e.t >= windowStart && e.t <= windowEnd),
    [damageEvents, windowStart, windowEnd]
  );

  const dEvByActor = useMemo(
    () => (hasActor ? dEvAll.filter(e => CE(e.src) === CE(actor)) : dEvAll),
    [dEvAll, hasActor, actor]
  );

  const dEvIncoming = useMemo(
    () => (hasActor ? dEvAll.filter(e => CE(e.dst) === CE(actor)) : []),
    [dEvAll, hasActor, actor]
  );

  const hEvSrc = useMemo(
    () =>
      healEvents.filter(
        e =>
          e.t >= windowStart &&
          e.t <= windowEnd &&
          (!hasActor || CE(e.src) === CE(actor))
      ),
    [healEvents, windowStart, windowEnd, hasActor, actor]
  );

  const hEvDst = useMemo(
    () =>
      hasActor
        ? healEvents.filter(
            e => e.t >= windowStart && e.t <= windowEnd && CE(e.dst) === CE(actor)
          )
        : [],
    [healEvents, windowStart, windowEnd, hasActor, actor]
  );

  // ========================= Offensive aggregates =========================
  const totalDmg  = dEvByActor.reduce((s, e) => s + e.amount, 0);
  const dotDmg    = dEvByActor.filter(isDot).reduce((s, e) => s + e.amount, 0);
  const directDmg = totalDmg - dotDmg;
  const maxHit    = dEvByActor.reduce((m, e) => Math.max(m, e.amount), 0);
  const targets   = new Set(dEvByActor.map(e => e.dst)).size;
  const abilitiesUsed = hasActor ? Object.keys(perAbility[actor] || {}).length : 0;
  const actions   = dEvByActor.length + hEvSrc.length;
  const apm       = actions / (dur / 60);

  // Direct swings by flag (exclude DoTs)
  const swings = dEvByActor.filter(e => !isDot(e));
  let hitCount = 0, critCount = 0, stCount = 0, hitDmg = 0, critDmg = 0, stDmg = 0;
  for (const e of swings) {
    const f = (e.flags || "hit");
    if (f === "crit") { critCount++; critDmg += e.amount; }
    else if (f === "strikethrough") { stCount++; stDmg += e.amount; }
    else { hitCount++; hitDmg += e.amount; }
  }
  const totalSwings   = swings.length || 1;
  const pct = (n:number, d:number)=> d ? (n/d*100) : 0;

  const hitDmgPct     = pct(hitDmg, totalDmg);
  const critDmgPct    = pct(critDmg, totalDmg);
  const stDmgPct      = pct(stDmg, totalDmg);
  const hitChancePct  = pct(hitCount, totalSwings);
  const critChancePct = pct(critCount, totalSwings);
  const stChancePct   = pct(stCount, totalSwings);

// ========================= Defensive aggregates =========================
const incomingDirect   = dEvIncoming.filter(e => !isDot(e));
const hitsTakenDirect  = incomingDirect.filter(e => e.amount > 0).length;

// Dodge / Parry counts
const dodgeCount = incomingDirect.filter(e =>
  (e.flags ?? "").toString().toLowerCase().includes("dodge")
).length;
const parryCount = incomingDirect.filter(e =>
  (e.flags ?? "").toString().toLowerCase().includes("parry")
).length;

// NEW: attempts = landed (amount>0, includes glances) + dodges + parries
const attempts = hitsTakenDirect + dodgeCount + parryCount;

// NEW: chances use attempts as the denominator
const dodgeChance = pct(dodgeCount, attempts);
const parryChance = pct(parryCount, attempts);

// Glancing blows (count, % of Landed, average glance amount)
const glanceEvents = incomingDirect.filter(
  e => (e.flags ?? '').toString().toLowerCase().includes('glance') && (e.amount || 0) > 0
);
const glanceCount  = glanceEvents.length;
// % should match Defense Flow: percent of Landed (i.e., of hitsTakenDirect)
const glanceChance = pct(glanceCount, hitsTakenDirect);
const avgGlance    = glanceCount
  ? glanceEvents.reduce((s, e) => s + (e.amount || 0), 0) / glanceCount
  : 0;

// Block (unchanged): % of Landed
const blockEvents  = incomingDirect.filter(e => (e.blocked || 0) > 0 && e.amount > 0);
const blockCount   = blockEvents.length;
const totalBlocked = blockEvents.reduce((s,e)=> s + (e.blocked || 0), 0);
const avgBlocked   = blockCount ? (totalBlocked / blockCount) : 0;
const blockChance  = pct(blockCount, hitsTakenDirect);

  // Armor mitigation
  const mitSamples = incomingDirect.filter(e => (e.absorbed ?? 0) > 0 && (e.preMitTotal ?? 0) > 0);
  const avgArmorMitigation = mitSamples.length
    ? (mitSamples.reduce((s,e)=> s + (Number(e.absorbed)/Number(e.preMitTotal)), 0) / mitSamples.length * 100)
    : 0;

  // Totals
  const dmgTaken  = hasActor ? (perTaken[actor] || 0) : 0;
  const hitsTaken = hitsTakenDirect;
  const dpmTaken  = dmgTaken / (dur / 60);
  const healsRecv = hEvDst.reduce((s,e)=> s + e.amount, 0);
  const selfHeal  = hasActor ? hEvDst.filter(e => CE(e.src) === CE(actor)).reduce((s,e)=> s + e.amount, 0) : 0;

  const attackers = hasActor
    ? Object.entries(perTakenBy[actor] || {}).sort((a,b)=> b[1]-a[1]).slice(0, 6)
    : [];

  // Layout
  const gridStyle: React.CSSProperties = { display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:16 };
  const card: React.CSSProperties      = { padding:12, borderRadius:10, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)' };
  const th: React.CSSProperties        = { textAlign:'left', opacity:0.8, fontWeight:600, padding:'6px 8px' };
  const td: React.CSSProperties        = { textAlign:'right', padding:'6px 8px', fontVariantNumeric:'tabular-nums' };
  const title: React.CSSProperties     = { margin:'0 0 8px 0', fontSize:14, fontWeight:700, opacity:0.9 };
  const labelSuffix = hasActor ? ` — ${actor}` : '';
  const fmtPct1 = (v:number)=> `${v.toFixed(1)}%`;

  return (
    <>
      <div style={gridStyle}>
        {/* Offensive */}
        <div className="card" style={card}>
          <h3 style={title}>Offensive Statistics{labelSuffix}</h3>
          <table className="table" style={{ width:'100%', borderCollapse:'collapse' }}>
            <tbody>
              <tr><th style={th}>Total Damage</th><td style={td}>{fmt0(totalDmg)}</td></tr>
              <tr><th style={th}>Direct Damage</th><td style={td}>{fmt0(directDmg)} {totalDmg ? `(${((directDmg/totalDmg)*100).toFixed(1)}%)` : ''}</td></tr>
              <tr><th style={th}>DoT Damage</th><td style={td}>{fmt0(dotDmg)} {totalDmg ? `(${((dotDmg/totalDmg)*100).toFixed(1)}%)` : ''}</td></tr>
              <tr><th style={th}>Max Hit</th><td style={td}>{fmt0(maxHit)}</td></tr>
              <tr><th style={th}>Unique Targets Hit</th><td style={td}>{fmt0(targets)}</td></tr>
              <tr><th style={th}>Abilities Used</th><td style={td}>{fmt0(abilitiesUsed)}</td></tr>
              <tr><th style={th}>Actions per Minute (APM)</th><td style={td}>{fmt1(apm)}</td></tr>

              <tr><th style={th}>Hit Chance</th><td style={td}>{fmt0(hitCount)} ({fmtPct1(hitChancePct)})</td></tr>
              <tr><th style={th}>Critical Chance</th><td style={td}>{fmt0(critCount)} ({fmtPct1(critChancePct)})</td></tr>
              <tr><th style={th}>Strikethrough Chance</th><td style={td}>{fmt0(stCount)} ({fmtPct1(stChancePct)})</td></tr>

              <tr><th style={th}>Hit Damage % of Total</th><td style={td}>{fmt0(hitDmg)} {totalDmg ? `(${hitDmgPct.toFixed(1)}%)` : ''}</td></tr>
              <tr><th style={th}>Critical Damage % of Total</th><td style={td}>{fmt0(critDmg)} {totalDmg ? `(${critDmgPct.toFixed(1)}%)` : ''}</td></tr>
              <tr><th style={th}>Strikethrough Damage % of Total</th><td style={td}>{fmt0(stDmg)} {totalDmg ? `(${stDmgPct.toFixed(1)}%)` : ''}</td></tr>
            </tbody>
          </table>
        </div>

        {/* Defensive */}
        <div className="card" style={card}>
          <h3 style={title}>Defensive Statistics{labelSuffix}</h3>
          <table className="table" style={{ width:'100%', borderCollapse:'collapse' }}>
            <tbody>
              <tr><th style={th}>Damage Taken</th><td style={td}>{fmt0(dmgTaken)}</td></tr>
              <tr><th style={th}>Damage Taken / min</th><td style={td}>{fmt0(dpmTaken)}</td></tr>
              <tr><th style={th}>Hits Taken</th><td style={td}>{fmt0(hitsTaken)}</td></tr>
              <tr><th style={th}>Heals Received</th><td style={td}>{fmt0(healsRecv)}</td></tr>
              <tr><th style={th}>Self-Healing</th><td style={td}>{fmt0(selfHeal)}</td></tr>

              <tr><th style={th}>Dodge Chance</th><td style={td}>{fmt0(dodgeCount)} ({fmtPct1(dodgeChance)})</td></tr>
              <tr><th style={th}>Parry Chance</th><td style={td}>{fmt0(parryCount)} ({fmtPct1(parryChance)})</td></tr>
	      <tr>
               	<th style={th}>Glancing Blow Chance</th>
                <td style={td}>{fmt0(glanceCount)} ({fmtPct1(glanceChance)})</td>
           		   </tr>              
	      <tr><th style={th}>Block Chance</th><td style={td}>{fmt0(blockCount)} ({fmtPct1(blockChance)})</td></tr>
              <tr><th style={th}>Total Blocked Amount</th><td style={td}>{fmt0(totalBlocked)}</td></tr>
              <tr><th style={th}>Average Blocked Amount</th><td style={td}>{fmt0(avgBlocked)}</td></tr>
              <tr><th style={th}>Average Armor Mitigation</th><td style={td}>{fmtPct1(avgArmorMitigation)}</td></tr>

              {attackers.length > 0 && (
                <tr>
                  <th style={{...th, verticalAlign:'top'}}>Top Attackers</th>
                  <td style={{...td, textAlign:'left'}}>
                    {attackers.map(([name, dmg]) => (
                      <div key={name} style={{ display:'flex', justifyContent:'space-between', gap:8 }}>
                        <span style={{ opacity:0.85 }}>{name}</span>
                        <span style={{ fontVariantNumeric:'tabular-nums' }}>{fmt0(dmg)}</span>
                      </div>
                    ))}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Defense Flow (visual) */}
      <div className="card" style={{ marginTop:16, gridColumn:'1 / -1', padding:12 }}>
        <DefenseFlow actor={actor} events={damageEvents} windowStart={windowStart} windowEnd={windowEnd} />
      </div>
    </>
  );
}
