import React, { useEffect, useMemo, useRef, useState, useCallback, useTransition, useDeferredValue, useLayoutEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import ErrorBoundary from "./ErrorBoundary";
import DpsPopoutButton from "./components/DpsPopoutButton";
import { ResponsiveContainer, AreaChart, Area, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, BarChart, Bar, LabelList, Cell, Sankey, Scatter, ReferenceLine, ReferenceArea, ComposedChart, Brush, Customized } from "recharts";
import EncounterSummary from "./components/EncounterSummary";
import PlayerSummary from "./components/PlayerSummary";
import StarLoader from './StarLoader';

type HoverPopupProps = {
  i: number;
  secondsTotal: number;
  hb: Record<string, number>;
  db: Record<string, number>;
  fmt0: (n: number) => string;
};


type SmartTooltipBoxProps = {
  depKey: string;
  children: React.ReactNode;
  offset?: number;
  cardId?: string;
};


// Heuristic: player names in SWG are typically single tokens (may include apostrophes).
// NPCs/bosses commonly contain spaces (e.g., "An old man", "Imperial Officer") or obvious NPC keywords.
// We use this only to decide whether we should wait for/assign class-based colors in exports.
const isLikelyNpcName = (rawName: string): boolean => {
  const name = (rawName || "").trim();
  if (!name) return true;

  // Multi-word names are almost always NPCs/bosses in these logs.
  if (name.includes(" ")) return true;

  // Common non-player buckets / placeholders
  if (/^(unknown|environment|raid|group|all)$/i.test(name)) return true;

  // A few obvious NPC-like patterns (kept broad but low-risk)
  if (/(droid|probe|trooper|officer|commander|captain|lieutenant|sergeant|general|lord|master|jedi|sith|beast|creature|pet)/i.test(name)) {
    return true;
  }

  return false;
};

/**
 * Recharts tooltips are positioned at the cursor. If the tooltip would overflow the viewport,
 * this wrapper flips it up/left so the full panel stays visible without requiring scroll.
 */
function SmartTooltipBox({ depKey, children, cardId }: SmartTooltipBoxProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  /**
   * Center the holo tooltip within the chart card (not at the cursor).
   * This avoids "random" flipping behavior and prevents clipping near edges.
   */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const raf = requestAnimationFrame(() => {
      const tip = el.getBoundingClientRect();

      // Find the correct card wrapper (we portal tooltips to <body>, so use an explicit selector)
      const card = cardId
        ? (document.querySelector(`[data-holo-card-id="${CSS.escape(cardId)}"]`) as HTMLElement | null)
        : (document.querySelector('[data-holo-card="1"]') as HTMLElement | null);
      const cardRect = card?.getBoundingClientRect();

      const vw = window.innerWidth || 0;
      const vh = window.innerHeight || 0;
      const pad = 10;

      // Default: center in the card; fallback: center in viewport
      let cx = cardRect ? cardRect.left + cardRect.width / 2 : vw / 2;
      let cy = cardRect ? cardRect.top + cardRect.height / 2 : vh / 2;

      // Clamp so the tooltip stays fully visible
      const halfW = tip.width / 2;
      const halfH = tip.height / 2;

      cx = Math.max(pad + halfW, Math.min(vw - pad - halfW, cx));
      cy = Math.max(pad + halfH, Math.min(vh - pad - halfH, cy));

      setPos({ left: Math.round(cx), top: Math.round(cy) });
    });

    return () => cancelAnimationFrame(raf);
  }, [depKey]);

  // IMPORTANT: Recharts wraps tooltips in a transformed element; "position: fixed" becomes
  // relative to that transformed ancestor, which can make the tooltip disappear/offscreen.
  // Portaling to <body> ensures true viewport-fixed positioning.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        transform: "translate(-50%, -50%)",
        willChange: "transform,left,top",
        pointerEvents: "none",
        zIndex: 99999,
      }}
    >
      {children}
    </div>,
    document.body
  );
}

function DeathSecondHoverPopup({ i, secondsTotal, hb, db, fmt0 }: HoverPopupProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 'calc(100% + 10px)',
        zIndex: 50,
        pointerEvents: 'none',
        borderRadius: 14,
        padding: '10px 12px',
        background:
          'linear-gradient(180deg, rgba(10,18,34,0.96) 0%, rgba(8,14,26,0.92) 100%)',
        border: '1px solid rgba(150,205,255,0.18)',
        boxShadow: '0 18px 40px rgba(0,0,0,0.55)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 950,
            color: '#d8ecff',
            letterSpacing: 0.25,
          }}
        >
          T-{secondsTotal - i}s details
        </div>
        <div style={{ fontSize: 11, color: '#7f9bc5' }}>
          {i + 1}/{secondsTotal}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, color: '#8ecbff', marginBottom: 6, fontWeight: 800 }}>
            Heals this second
          </div>
          {Object.entries(hb).length ? (
            Object.entries(hb)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([k, v], idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 10,
                    fontSize: 12,
                    color: '#cfe7ff',
                    marginBottom: 4,
                  }}
                >
                  <div
                    style={{
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {k}
                  </div>
                  <div style={{ fontWeight: 900, color: '#7fd0ff' }}>{fmt0(v)}</div>
                </div>
              ))
          ) : (
            <div style={{ fontSize: 12, color: '#6f86a8' }}>—</div>
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, color: '#ff93ab', marginBottom: 6, fontWeight: 800 }}>
            Damage this second
          </div>
          {Object.entries(db).length ? (
            Object.entries(db)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([k, v], idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 10,
                    fontSize: 12,
                    color: '#ffd6df',
                    marginBottom: 4,
                  }}
                >
                  <div
                    style={{
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {k}
                  </div>
                  <div style={{ fontWeight: 900, color: '#ff9fb2' }}>{fmt0(v)}</div>
                </div>
              ))
          ) : (
            <div style={{ fontSize: 12, color: '#7a6a7b' }}>—</div>
          )}
        </div>
      </div>
    </motion.div>
  );
}


// --- Bigger, centered label for death-flag ReferenceLines ---
type DeathLabelProps = {
  value: string;
  size?: number;           // font size
  dy?: number;             // vertical offset from the edge
  anchor?: 'top' | 'bottom';
  // recharts injects this when label is a React element:
  viewBox?: { x: number; y: number; width: number; height: number };
};

// Collapses whitespace and trims. Some views reference this helper when rendering
// ability names (e.g. damage/heal feeds). Keeping it defined prevents runtime
// ReferenceErrors if a refactor leaves a callsite behind.
function collapseAbility(s: string) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

function normalizeAbilityKey(ability: string) {
  // Normalize parsed ability strings so hits/crits/glances/etc all aggregate under one base name.
  // Handles variants like:
  //   "Attack and hits" / "Attack and crits" / "Attack critically hits"
  //   "Mine 2: Plasma Mine.And crits"
  //   "Bomblet and crits (478 points blocked)"
  let s = collapseAbility(ability);

  // Drop trailing parenthetical notes like "(478 points blocked)".
  s = s.replace(/\s*\([^)]*\)\s*$/g, '');

  // Drop common outcome tails at the end.
  // We support both "... and <outcome>" and "<ability> <outcome>" styles, plus punctuation before the tail.
  s = s.replace(
    /\s*[.\-:]?\s*(?:and\s+)?(?:hits?|crits?|glances?|grazes?|miss(?:es)?|blocks?|parries?|dodges?|evades?|resists?|deflects?|absorbs?|strikes\s+through|punishing\s+blows?|critical(?:ly)?\s+hits?)\b.*$/i,
    ''
  );

  return collapseAbility(s);
}


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

/* KPI cards (HoloNet-ish) */
.kpi-grid{
  position: relative;
  z-index: 1;
  display:grid;
  grid-template-columns: repeat(4, minmax(0,1fr));
  gap:16px;
  margin-bottom:16px;
}

.death-snapshot-card{
  position: relative;
  z-index: 20;
}

@media (max-width: 1100px){ .kpi-grid{ grid-template-columns: repeat(2, minmax(0,1fr)); } }
@media (max-width: 640px){ .kpi-grid{ grid-template-columns: 1fr; } }

.kpi-card{
  position: relative;
  overflow: hidden;
}
.kpi-card::before{
  content:"";
  position:absolute; inset:0;
  background:
    radial-gradient(900px 140px at 50% 0%, rgba(120,200,255,.24), transparent 55%),
    repeating-linear-gradient(90deg, rgba(255,255,255,.045) 0, rgba(255,255,255,.045) 1px, transparent 1px, transparent 14px);
  opacity:.55;
  pointer-events:none;
}
.kpi-card::after{
  content:"";
  position:absolute; left:0; right:0; top:0; height:3px;
  background: linear-gradient(90deg, transparent, rgba(130,210,255,.9), transparent);
  opacity:.75;
  pointer-events:none;
}
.kpi-title{
  font-size:11px;
  color:#9fb8da;
  letter-spacing:.55px;
  font-weight:900;
  text-transform:uppercase;
}
.kpi-value{
  text-align:center;
  font-size:28px;
  font-weight:950;
  margin-top:10px;
  text-shadow: 0 0 18px rgba(120,200,255,.28);
}
.kpi-sub{
  text-align:center;
  margin-top:6px;
  font-size:11px;
  color:#93a8c6;
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

.swg-theme .exportWrap{
  display:flex;
  justify-content:center;
  margin-top:12px;
  margin-bottom:8px;
}
.swg-theme .exportBtn{
  display:inline-flex;
  align-items:center;
  gap:10px;
  padding:10px 16px;
  border-radius:14px;
  border:1px solid rgba(120,170,255,.35);
  background: linear-gradient(180deg, rgba(33,212,253,.18), rgba(16,28,50,.92));
  color:#d8f1ff;
  letter-spacing:.08em;
  text-transform:uppercase;
  font-weight:700;
  box-shadow: 0 0 0 1px rgba(0,0,0,.35) inset, 0 14px 40px rgba(0,0,0,.45), 0 0 22px rgba(33,212,253,.22);
  cursor:pointer;
  user-select:none;
}
.swg-theme .exportBtn:hover{
  border-color: rgba(33,212,253,.65);
  box-shadow: 0 0 0 1px rgba(0,0,0,.35) inset, 0 18px 46px rgba(0,0,0,.55), 0 0 28px rgba(33,212,253,.30);
}
.swg-theme .exportBtn:active{
  transform: translateY(1px);
}
.swg-theme .exportBtn:disabled{
  opacity:.55;
  cursor:default;
  transform:none;
}
.swg-theme .exportSub{
  font-size:12px;
  color:#9bb7df;
  margin-top:6px;
  text-align:center;
  letter-spacing:.02em;
}

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

/* ---------- Damage Taken: Incoming table polish ---------- */
.swg-theme .incomingTable {
  border-radius: 12px;
  overflow: hidden;
}
.swg-theme .incomingTable thead th{
  position: sticky;
  top: 0;
  z-index: 2;
  background: linear-gradient(180deg, rgba(14,26,48,.98), rgba(10,18,34,.98));
  border-bottom: 1px solid rgba(120,170,255,.35);
}
.swg-theme .incomingTable tbody tr:nth-child(odd) td{
  background: rgba(8,14,26,.30);
}
.swg-theme .incomingTable tbody tr:nth-child(even) td{
  background: rgba(12,22,38,.55);
}
.swg-theme .incomingTable td{
  padding: 8px 10px;
  font-size: 13px;
}
.swg-theme .incomingTable th{
  padding: 10px 10px;
  font-size: 13px;
}
.swg-theme .incomingTable td:first-child{
  max-width: 260px;
}
.swg-theme .elemPill{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width: 64px;
  padding: 4px 8px;
  border-radius: 999px;
  font-weight: 800;
  letter-spacing: .02em;
  border: 1px solid rgba(120,170,255,.28);
  background: rgba(98,176,255,.10);
  color: #cfe3ff;
}
.swg-theme .elemPill[data-elem="Energy"]{ background: rgba(255,184,77,.12); border-color: rgba(255,184,77,.28); color:#ffe2b8; }
.swg-theme .elemPill[data-elem="Kinetic"]{ background: rgba(160,200,255,.12); border-color: rgba(160,200,255,.28); color:#d8ecff; }
.swg-theme .elemPill[data-elem="Cold"]{ background: rgba(98,176,255,.14); border-color: rgba(98,176,255,.32); color:#cfe9ff; }
.swg-theme .elemPill[data-elem="Heat"]{ background: rgba(255,90,111,.12); border-color: rgba(255,90,111,.30); color:#ffd1d8; }
.swg-theme .elemPill[data-elem="Acid"]{ background: rgba(25,195,125,.12); border-color: rgba(25,195,125,.28); color:#d4ffe9; }
.swg-theme .elemPill[data-elem="Bleeding"]{ background: rgba(255,122,206,.12); border-color: rgba(255,122,206,.30); color:#ffe0f0; }
.swg-theme .elemPill[data-elem="Electric"]{ background: rgba(196,110,255,.12); border-color: rgba(196,110,255,.28); color:#f0ddff; }
.swg-theme .elemPill[data-elem="Electrical"]{ background: rgba(196,110,255,.12); border-color: rgba(196,110,255,.28); color:#f0ddff; }



/* Elemental split pills (KPI card) */
.swg-theme .elemSplitPill{ padding: 8px 12px; border-radius: 999px; font-weight: 800; letter-spacing: .01em; font-size: 14px; background: transparent; }
.swg-theme .elemSplitPillSmall{ padding: 6px 10px; border-radius: 999px; font-weight: 850; letter-spacing: .01em; font-size: 12px; background: transparent; }
.swg-theme .elemSplitPill .elemName{ opacity:.9; }
.swg-theme .elemSplitPill .elemPct{ font-variant-numeric: tabular-nums; }

/* Add a subtle holonet glow per element */
.swg-theme .elemPill{ box-shadow: 0 0 0 1px rgba(160,200,255,.06), 0 0 18px rgba(120,180,255,.10); }
.swg-theme .elemPill[data-elem="Kinetic"]{ box-shadow: 0 0 0 1px rgba(124,192,255,.12), 0 0 18px rgba(124,192,255,.22); }
.swg-theme .elemPill[data-elem="Energy"]{ box-shadow: 0 0 0 1px rgba(255,186,92,.12), 0 0 18px rgba(255,186,92,.24); }
.swg-theme .elemPill[data-elem="Heat"]{ box-shadow: 0 0 0 1px rgba(255,108,108,.12), 0 0 18px rgba(255,108,108,.22); }
.swg-theme .elemPill[data-elem="Cold"]{ box-shadow: 0 0 0 1px rgba(108,240,255,.12), 0 0 18px rgba(108,240,255,.22); }
.swg-theme .elemPill[data-elem="Acid"]{ box-shadow: 0 0 0 1px rgba(118,255,194,.12), 0 0 18px rgba(118,255,194,.22); }
.swg-theme .elemPill[data-elem="Bleeding"]{ box-shadow: 0 0 0 1px rgba(255,122,206,.12), 0 0 18px rgba(255,122,206,.22); }
.swg-theme .elemPill[data-elem="Electric"]{ box-shadow: 0 0 0 1px rgba(196,110,255,.12), 0 0 18px rgba(196,110,255,.22); }

/* Optional helper if you want to opt-in per cell: */
.swg-theme .num { text-align:center !important; font-variant-numeric: tabular-nums; }

.swg-theme .mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
.swg-theme .nowrap{ white-space: nowrap; }
.swg-theme .muted{ color: var(--muted); }

/* --- Recharts tooltip: solid dark HUD panel for readability --- */
.swg-theme .recharts-tooltip-wrapper { z-index: 1000; }

.swg-theme .recharts-wrapper{ overflow: visible !important; }
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

/* ======================
   HoloNet bottom charts
   ====================== */
.swg-theme .holo-panel{
  position: relative;
  overflow: visible;
  isolation: isolate;
  box-shadow: 0 0 0 1px rgba(140, 200, 255, .18), 0 14px 48px rgba(0,0,0,.55);
}
.swg-theme .holo-panel::before{
  content: "";
  position: absolute;
  inset: -2px;
  z-index: 0;
  
  pointer-events:none;
background:
    radial-gradient(900px 360px at 20% -10%, rgba(110, 190, 255, .20), transparent 55%),
    radial-gradient(800px 420px at 85% 10%, rgba(85, 255, 225, .12), transparent 60%),
    linear-gradient(135deg, rgba(255,255,255,.06), transparent 50%),
    linear-gradient(0deg, rgba(0,0,0,.28), rgba(0,0,0,.28));
  filter: blur(.2px);
}
.swg-theme .holo-panel::after{
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  
  pointer-events:none;
background:
    repeating-linear-gradient(
      to bottom,
      rgba(120,200,255,.08) 0px,
      rgba(120,200,255,.08) 1px,
      rgba(0,0,0,0) 3px,
      rgba(0,0,0,0) 7px
    );
  opacity: .30;
  mix-blend-mode: overlay;
  animation: holoScan 6s linear infinite;
}

.swg-theme .holo-content{ position: relative; z-index: 1; }

.swg-theme .holoChartFrame{ position: relative; }
.swg-theme .holoChartFrame{ overflow: visible; }
.swg-theme .holo-scanlines{
  pointer-events:none;
  position:absolute;
  inset: 12px 12px 18px 12px;
  border-radius: 16px;
  background: repeating-linear-gradient(
    to bottom,
    rgba(110, 190, 255, .10) 0px,
    rgba(110, 190, 255, .10) 1px,
    rgba(0,0,0,0) 3px,
    rgba(0,0,0,0) 9px
  );
  opacity: .16;
  mix-blend-mode: overlay;
  animation: holoScan 8s linear infinite;
 }
.swg-theme .holo-vignette{
  pointer-events:none;
  position:absolute;
  inset: 0;
  border-radius: 16px;
  background: radial-gradient(900px 300px at 50% 10%, rgba(90, 255, 230, .10), transparent 55%),
    radial-gradient(900px 420px at 50% 100%, rgba(0, 0, 0, .35), transparent 60%);
  opacity: .8;
 }

.swg-theme .panelTitle{
  display:flex;
  align-items:center;
  gap:10px;
  letter-spacing: .3px;
  text-transform: none;
}
.swg-theme .holoDot{
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: rgba(90, 220, 255, .95);
  box-shadow: 0 0 0 2px rgba(90, 220, 255, .20), 0 0 18px rgba(90, 220, 255, .65);
  animation: holoPulse 1.8s ease-in-out infinite;
}

.swg-theme .holo-chartwrap{ position: relative; }
.swg-theme .holo-grid{
  position: absolute;
  inset: 10px 12px 14px 12px;
  z-index: 0;
  background:
    linear-gradient(to right, rgba(120,200,255,.05) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(120,200,255,.05) 1px, transparent 1px);
  background-size: 44px 44px;
  opacity: .35;
  filter: blur(.15px);
  pointer-events: none;
}
.swg-theme .holo-sweep{
  position: absolute;
  inset: 0;
  z-index: 0;
  background: linear-gradient(
    120deg,
    transparent 0%,
    rgba(140, 220, 255, .10) 38%,
    rgba(140, 220, 255, .22) 45%,
    rgba(140, 220, 255, .10) 52%,
    transparent 75%
  );
  transform: translateX(-60%);
  animation: holoSweep 5.5s ease-in-out infinite;
  pointer-events: none;
}

/* --- Axis footer (Holonet briefing) --- */
.swg-theme .holoAxisFooterWrap{
  position: relative;
  margin-top: 10px;
  padding: 10px 10px 8px;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(8,18,35,.92), rgba(6,12,22,.82));
  border: 1px solid rgba(120,220,255,.30);
  box-shadow: 0 14px 32px rgba(0,0,0,.55), 0 0 0 2px rgba(98,176,255,.10) inset;
  overflow: hidden;
}
.swg-theme .holoAxisFooterScan{
  position: absolute;
  inset: -10px -20px;
  background: linear-gradient(90deg, transparent, rgba(90,220,255,0.14), transparent);
  transform: translateX(-40%);
  animation: holonetFooterScan 2.9s ease-in-out infinite;
  animation-play-state: paused;
  will-change: transform;
  mix-blend-mode: screen;
  pointer-events: none;
  opacity: .75;
}

.holoAxisFooterWrap.isActive .holoAxisFooterScan{ animation-play-state: running; }
@keyframes holonetFooterScan{
  0% { transform: translateX(-45%); opacity: .20; }
  35% { opacity: .55; }
  70% { opacity: .35; }
  100% { transform: translateX(45%); opacity: .20; }
}
.swg-theme .holoAxisFooterRow{
  position: relative;
  z-index: 1;
  display:flex;
  align-items:center;
  justify-content:center;
  gap:10px;
}
.swg-theme .holoAxisFooterLabel{
  display:flex;
  align-items:center;
  gap:10px;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: rgba(190, 235, 255, 0.95);
  text-shadow: 0 0 14px rgba(70, 190, 255, 0.25);
}
.swg-theme .holoAxisFooterChip{
  width: 20px;
  height: 20px;
  border-radius: 999px;
  display:grid;
  place-items:center;
  cursor: help;
  background: rgba(30, 80, 120, 0.36);
  border: 1px solid rgba(120, 220, 255, 0.42);
  box-shadow: 0 0 14px rgba(70, 190, 255, 0.16);
  color: rgba(230, 250, 255, 0.95);
  font-size: 12px;
  font-weight: 900;
  user-select: none;
}
.swg-theme .holoAxisFooterTip{
  position:absolute;
  left:50%;
  bottom: calc(100% + 10px);
  transform: translateX(-50%);
  width: 360px;
  max-width: min(420px, 88vw);
  padding: 10px 12px;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(10, 30, 55, 0.96), rgba(8, 18, 35, 0.94));
  border: 1px solid rgba(120, 220, 255, 0.32);
  box-shadow: 0 20px 48px rgba(0,0,0,0.55), 0 0 22px rgba(70, 190, 255, 0.18);
  color: rgba(220, 245, 255, 0.98);
  font-size: 12px;
  line-height: 1.35;
  letter-spacing: .02em;
  z-index: 50;
}
.swg-theme .holoAxisFooterTipTitle{
  font-weight: 900;
  margin-bottom: 6px;
  color: rgba(170, 235, 255, 0.98);
}
.swg-theme .holoAxisFooterTipPointer{
  position:absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  width: 14px;
  height: 14px;
  background: rgba(8, 18, 35, 0.94);
  border-left: 1px solid rgba(120, 220, 255, 0.32);
  border-bottom: 1px solid rgba(120, 220, 255, 0.32);
  margin-top: -7px;
}

.swg-theme .holo-pill{ animation: pillPop 520ms cubic-bezier(.2,.9,.2,1) both; }
.swg-theme .holo-pill-text{ animation: textGlow 1.8s ease-in-out infinite; }

@keyframes holoScan{
  0%{ transform: translateY(-18%); }
  100%{ transform: translateY(18%); }
}
@keyframes holoPulse{
  0%,100%{ transform: scale(1); opacity: .9; }
  50%{ transform: scale(1.25); opacity: 1; }
}
@keyframes holoSweep{
  0%{ transform: translateX(-70%); opacity: .0; }
  15%{ opacity: .55; }
  50%{ transform: translateX(35%); opacity: .45; }
  70%{ opacity: .25; }
  100%{ transform: translateX(95%); opacity: 0; }
}
@keyframes pillPop{
  0%{ transform: translate3d(-6px, 0, 0) scale(.92); opacity: 0; }
  60%{ transform: translate3d(0,0,0) scale(1.04); opacity: 1; }
  100%{ transform: translate3d(0,0,0) scale(1); opacity: 1; }
}
@keyframes textGlow{
  0%,100%{ filter: drop-shadow(0 0 6px rgba(165,220,255,.35)); }
  50%{ filter: drop-shadow(0 0 10px rgba(165,220,255,.75)); }
}

/* --- Scrollbars (Option A: styled native) --- */
.swg-theme .scrollArea{
  /* Firefox */
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.28) rgba(255,255,255,0.06);
}

/* Chromium / Safari */
.swg-theme .scrollArea::-webkit-scrollbar{
  width: 10px;
}
.swg-theme .scrollArea::-webkit-scrollbar-track{
  background: rgba(255,255,255,0.06);
  border-radius: 999px;
}
.swg-theme .scrollArea::-webkit-scrollbar-thumb{
  background: rgba(255,255,255,0.22);
  border-radius: 999px;
  border: 2px solid rgba(255,255,255,0.06);
}
.swg-theme .scrollArea::-webkit-scrollbar-thumb:hover{
  background: rgba(255,255,255,0.32);
}
.swg-theme .scrollArea::-webkit-scrollbar-corner{
  background: transparent;
}
`;



// --- Toolbar / Ribbon styles ---
const RIBBON_CSS = /* css */ `
.ribbon{
  max-width:2300px;
  margin:0 auto 8px;
  width:100%;
  display:grid;
  grid-template-columns: 1fr auto 1fr;
  align-items:center;
  gap:14px;

  background: var(--panel,#0e1726);
  border:1px solid var(--panel-border,#1b2a3d);
  border-radius:18px;
  padding:18px 22px;
  box-shadow: 0 6px 24px rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.04);
}
.ribbon > *{min-width:0;}
.ribbon .group{display:flex; align-items:center; justify-content:center; gap:14px; flex-wrap:nowrap; min-width:0;}
.ribbon .group.left{justify-self:start;}
.ribbon .group.center{justify-self:center;}
.ribbon .group.right{justify-self:end;}

.ribbon .title{font-weight:700; letter-spacing:.2px; color:var(--text,#cfe3ff); display:flex; align-items:center; gap:10px; white-space:nowrap;}

/* File pill */
.filepill{display:flex; align-items:center; gap:12px; max-width:520px; min-width:0;
  background: var(--panel-2,#0c1624);
  border:1px solid var(--panel-border,#1b2a3d);
  padding:10px 14px; border-radius:999px;
}
.filepill input[type="file"]{display:none}
.filepill .btn-file{background:transparent; border:1px dashed rgba(255,255,255,.25);
  color:var(--text); border-radius:999px; padding:8px 12px; cursor:pointer}
.filepill .hint{opacity:.8; font-size:12px}

/* Segmented Metric (bigger + readable when inactive) */
.segmented{
  display:inline-flex; gap:8px; padding:6px;
  border-radius:999px; background:var(--panel-2,#0c1624);
  border:1px solid var(--panel-border,#1b2a3d);
}
.segmented .seg{
  padding:10px 16px; border-radius:999px; font-size:16px; font-weight:600;
  border:1px solid rgba(255,255,255,.12); cursor:pointer;
  color:#d6e6ff;                       /* readable */
  background: rgba(255,255,255,.08);   /* visible chip even when inactive */
}
.segmented .seg:hover{filter:brightness(1.08)}
.segmented .seg.active{
  color:#ffffff;
  background: rgba(98,176,255,.22);
  border-color: rgba(98,176,255,.55);
  box-shadow: 0 0 0 1px rgba(98,176,255,.25) inset;
}

/* Controls (+25%) */
.ribbon select, .ribbon .btn, .ribbon .chip{
  height:42px; font-size:16px; border-radius:12px;
  border:1px solid var(--panel-border,#1b2a3d);
  background: var(--panel-2,#0c1624); color: var(--text,#cfe3ff);
  padding:0 12px;
}
.ribbon .btn{
  background: linear-gradient(180deg, rgba(98,176,255,.28), rgba(98,176,255,.10));
  border-color: rgba(98,176,255,.55); font-weight:700; letter-spacing:.1px; cursor:pointer;
}
.ribbon .btn.ghost{background:transparent; border-color:var(--panel-border)}
.ribbon .btn.warn{background:linear-gradient(180deg, rgba(255,157,0,.34), rgba(255,157,0,.12));
  border-color: rgba(255,157,0,.58) }
.ribbon .chip{display:inline-flex; align-items:center; gap:8px; cursor:pointer}
.ribbon .chip input{accent-color: var(--accent,#21d4fd)}

/* Paste drawer */
.paste-drawer{margin-top:10px; max-width:1480px; margin-inline:auto;
  background:var(--panel,#0e1726); border:1px solid var(--panel-border,#1b2a3d);
  border-radius:12px; padding:10px}
.paste-drawer textarea{
  width:100%; min-height:110px; resize:vertical; font-size:15px;
  background:var(--bg2,#0b1426); color:var(--text,#cfe3ff);
  border:1px solid rgba(255,255,255,.12); border-radius:12px; padding:12px;
}
`;

const RIBBON_EXTRA = /* css */ `
.center-stack{display:flex;flex-direction:column;align-items:center;gap:12px;}
.center-toggle-row{display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;}
.ab-box{display:flex;flex-direction:column;gap:10px;align-items:stretch;justify-content:center;flex-wrap:nowrap; min-width:0;
  background: var(--panel-2,#0c1624);
  border:1px solid var(--panel-border,#1b2a3d);
  border-radius:12px;
  padding:10px 12px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.04);
}
.ab-box select{height:44px; width:240px; min-width:240px; max-width:240px; font-size:16px; border-radius:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}

/* Holonet-style dropdown (Death selector) */
.holoDeathSelect{height:44px;width:260px;min-width:260px;max-width:260px;padding:10px 12px;border-radius:12px;color:#e7f3ff;background:rgba(8,18,34,0.92);border:1px solid rgba(120,200,255,0.25);box-shadow:0 10px 35px rgba(0,0,0,0.35),0 0 0 1px rgba(0,255,255,0.08) inset,0 0 18px rgba(80,200,255,0.18);appearance:none;-webkit-appearance:none;-moz-appearance:none;}
.holoDeathSelect:focus{outline:none;box-shadow:0 0 0 2px rgba(120,220,255,0.22),0 0 24px rgba(120,220,255,0.22),0 10px 35px rgba(0,0,0,0.35);}
.holoDeathSelect option{background:#071427;color:#e7f3ff;}

.ab-row{display:flex; gap:12px; align-items:center; justify-content:center; flex-wrap:nowrap;}
.ab-actions{display:flex; gap:12px; align-items:center; justify-content:flex-end;}
.ab-actions .btn{height:44px;}

`;


const ENC_CSS = /* css */ `
/* Encounter Summary button — flaming red pulse */
.swg-theme .enc-btn{
  position: relative;
  padding: 52px 34px;
  border-radius: 999px;
  border: 1px solid rgba(120,170,255,.55);
  background-image: var(--bg-image, linear-gradient(180deg, rgba(33,212,253,.18), rgba(10,60,120,.24)));
  background-size: cover;
  background-position: center;
  background-attachment: fixed;
  color:#eaf3ff;
  font-weight:800;
  font-size: 13px;
  letter-spacing:.08em;
  text-transform:uppercase;
  white-space: nowrap;
  cursor:pointer;
  overflow:hidden;
  /* subtle base glow so it still looks good between pulses */
  box-shadow:
    0 0 0 1px rgba(0,0,0,.35) inset,
    0 0 22px rgba(255, 60, 0, .25);
  transition: transform .08s ease, filter .12s ease;
  z-index: 2;
}

/* Outer flame haze */
.swg-theme .enc-btn::before{
  content:"";
  position:absolute; inset:-10px;
  border-radius:999px;
  /* layered “flame” lobes rising from bottom */
  background:
    radial-gradient(60% 120% at 50% 105%, rgba(255,120,40,.60), rgba(255,0,0,0) 70%),
    radial-gradient(42% 90%  at 30% 110%, rgba(255,80,20,.55),  rgba(255,0,0,0) 62%),
    radial-gradient(42% 90%  at 70% 110%, rgba(255,80,20,.55),  rgba(255,0,0,0) 62%);
  filter: none; opacity:.65;
  pointer-events:none;
  animation: enc-flame 2.2s ease-in-out infinite;
}

/* Pulsing red corona + inner vignette */
.swg-theme .enc-btn::after{
  content:"";
  position:absolute; inset:-2px;
  border-radius:999px;
  pointer-events:none;
  background: linear-gradient(180deg, rgba(0,0,0,.22), rgba(0,0,0,.42));
  box-shadow:
    0 0 0 2px rgba(255,80,20,.28) inset,
    0 0 20px rgba(255,60,0,.45),
    0 0 55px rgba(255,40,0,.25);
  animation: enc-pulse 1.8s ease-in-out infinite;
}

.swg-theme .enc-btn:hover{
  filter: brightness(1.08);
  transform: translateY(-1px) scale(1.01);
}

/* Subtle rise + flicker */
@keyframes enc-flame{
  0%,100% { transform: translateY(0)    scale(1);    filter: none; opacity:.55; }
  50%     { transform: translateY(-6px) scale(1.05); filter: none; opacity:.85; }
}

/* Glow breath */
@keyframes enc-pulse{
  0%,100% {
    box-shadow:
      0 0 0 2px rgba(255,80,20,.28) inset,
      0 0 20px rgba(255,60,0,.45),
      0 0 55px rgba(255,40,0,.25);
    transform: scale(1);
  }
  50% {
    box-shadow:
      0 0 0 2px rgba(255,120,40,.45) inset,
      0 0 36px rgba(255,60,0,.75),
      0 0 110px rgba(255,40,0,.55);
    transform: scale(1.02);
  }
}
`;


const PS_CSS = /* css */ `
/* Player Summary button — imperial blue pulse */
.swg-theme .ps-btn{
  position: relative;
  padding: 52px 34px;
  border-radius: 999px;
  border: 1px solid rgba(120,170,255,.55);
  background-image: var(--bg-image, linear-gradient(180deg, rgba(98,176,255,.22), rgba(10,60,120,.24)));
  background-size: cover;
  background-position: center;
  background-attachment: fixed;
  color:#eaf3ff;
  font-weight:800;
  font-size: 13px;
  letter-spacing:.08em;
  text-transform:uppercase;
  white-space: nowrap;
  cursor:pointer;
  overflow:hidden;
  box-shadow:
    0 0 0 1px rgba(0,0,0,.35) inset,
    0 0 22px rgba(33, 212, 253, .22);
  transition: transform .08s ease, filter .12s ease;
  z-index: 2;
}
.swg-theme .ps-btn::before{
  content:"";
  position:absolute; inset:-10px;
  border-radius:999px;
  background:
    radial-gradient(60% 120% at 50% 105%, rgba(98,176,255,.55), rgba(0,0,0,0) 70%),
    radial-gradient(42% 90%  at 30% 110%, rgba(33,212,253,.45),  rgba(0,0,0,0) 62%),
    radial-gradient(42% 90%  at 70% 110%, rgba(33,212,253,.45),  rgba(0,0,0,0) 62%);
  filter: none; opacity:.60;
  pointer-events:none;
  animation: ps-flare 2.2s ease-in-out infinite;
}
.swg-theme .ps-btn::after{
  content:"";
  position:absolute; inset:-2px;
  border-radius:999px;
  pointer-events:none;
  background: linear-gradient(180deg, rgba(0,0,0,.20), rgba(0,0,0,.44));
  box-shadow:
    0 0 0 2px rgba(98,176,255,.26) inset,
    0 0 22px rgba(33,212,253,.40),
    0 0 60px rgba(98,176,255,.22);
  animation: ps-pulse 1.8s ease-in-out infinite;
}
.swg-theme .ps-btn:hover{
  filter: brightness(1.08);
  transform: translateY(-1px) scale(1.01);
}
@keyframes ps-flare{
  0%,100% { transform: translateY(0)    scale(1);    filter: none; opacity:.55; }
  50%     { transform: translateY(-6px) scale(1.05); filter: none; opacity:.85; }
}
@keyframes ps-pulse{
  0%,100% {
    box-shadow:
      0 0 0 2px rgba(98,176,255,.26) inset,
      0 0 22px rgba(33,212,253,.40),
      0 0 60px rgba(98,176,255,.22);
    transform: scale(1);
  }
  50% {
    box-shadow:
      0 0 0 2px rgba(33,212,253,.45) inset,
      0 0 40px rgba(33,212,253,.70),
      0 0 120px rgba(98,176,255,.50);
    transform: scale(1.02);
  }
}
`;

// ---- Elemental support (injected) ----
type ElementalBreakdown = Record<string, number>;

// Extend DamageEvent locally if present in this file; otherwise this stays permissive.
type DamageEventWithElements = DamageEvent & { elements?: ElementalBreakdown };

const titleCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);
const fmtPctElem = (v: number) => (v * 100 >= 99.5 || v === 0 ? (v * 100).toFixed(0) : (v * 100).toFixed(1)) + "%";
// Generic percent formatter for ratios in [0..1]. Safe for undefined/NaN.
const fmtPct = (v: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const p = n * 100;
  // Use 1 decimal for small percentages; 0 decimals otherwise.
  const dp = p > 0 && p < 10 ? 1 : 0;
  return p.toFixed(dp) + "%";
};

const fmtInt = (v: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString();
};



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
// Keep ~target points by skipping with a computed step (fast & simple)
function downsampleToTarget<T>(arr: T[], target: number): T[] {
  const n = Math.max(1, target|0);
  if (arr.length <= n) return arr;
  const step = Math.ceil(arr.length / n);
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
  // keep last point for right-edge alignment
  if (arr.length && out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}


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

// Bar label rendered in a fixed right-hand "value column" (prevents overlap with bars)
function barValuePillOutsideRight(props: any) {
  // Recharts label renderers can pass either {x,y,width,height} or {viewBox:{x,y,width,height}}
  const { x, y, width, height, value, viewBox } = props ?? {};
  const vb = viewBox ?? {};

  const nx = Number.isFinite(x) ? x : (Number.isFinite(vb.x) ? vb.x : NaN);
  const ny = Number.isFinite(y) ? y : (Number.isFinite(vb.y) ? vb.y : NaN);
  const nw = Number.isFinite(width) ? width : (Number.isFinite(vb.width) ? vb.width : NaN);
  const nh = Number.isFinite(height) ? height : (Number.isFinite(vb.height) ? vb.height : NaN);

  const v = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nw) || !Number.isFinite(nh)) return null;

  // use the local formatter if present; fallback is comma-separated
  const format = (n: number) => {
    try {
      return (typeof numberFormatterFn === 'function') ? numberFormatterFn(n) : n.toLocaleString();
    } catch {
      return n.toLocaleString();
    }
  };

  const s = format(v);

  const fontSize = Math.max(12, Math.min(16, nh * 0.62));

  // pill size based on string length, clamped
  const pillH = Math.max(18, Math.min(26, nh * 0.86));
  const pillW = Math.max(56, Math.min(110, s.length * 8.7 + 26));

  // place at the bar end, slightly outside to the right (or left if negative)
  const dir = nw < 0 ? -1 : 1;
  const endX = nx + nw;
  const pad = 18; // extra breathing room (requested)
  const cx = endX + dir * (pad + pillW / 2);
  const cy = ny + nh / 2;

  // little entrance animation
  const animId = `pill-${Math.round(nx)}-${Math.round(ny)}-${Math.round(v)}`;
  const idx = typeof props?.index === 'number' ? props.index : 0;
  const animDelay = `${Math.min(240, idx * 22)}ms`;

  return (
    <g transform={`translate(${cx},${cy})`}>
      <style>{`
        @keyframes pillPop-${animId} {
          0% { transform: scale(0.85); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
      
/* === Holonet Timeline Frame === */
.holoTimelineWrap{
  position: relative;
  border: 1px solid rgba(120,220,255,0.22);
  border-radius: 18px;
  overflow: hidden;
}
.holoTimelineWrap::before{
  content:"";
  position:absolute; inset:0;
  pointer-events:none;
  opacity:0.26;
  background-image:
    linear-gradient(rgba(120,220,255,0.10) 1px, transparent 1px),
    linear-gradient(90deg, rgba(120,220,255,0.08) 1px, transparent 1px);
  background-size: 24px 24px, 24px 24px;
  mask-image: radial-gradient(90% 75% at 50% 35%, #000 58%, transparent 100%);
}
.holoTimelineWrap::after{
  content:"";
  position:absolute; inset:0;
  pointer-events:none;
  background:
    radial-gradient(90% 70% at 50% 15%, rgba(90,220,255,0.07), transparent 60%),
    radial-gradient(120% 140% at 50% 115%, rgba(0,0,0,0.55), transparent 58%);
  opacity:0.95;
}
.holoTimelineNoise{
  position:absolute; inset:0;
  pointer-events:none;
  opacity:0.025;
  background-image: repeating-linear-gradient(
    0deg,
    rgba(255,255,255,0.25),
    rgba(255,255,255,0.25) 1px,
    transparent 1px,
    transparent 3px
  );
  mix-blend-mode: overlay;
}
@keyframes holoTimelineScan {
  0% { transform: translateY(-18%); opacity: 0; }
  12% { opacity: 0.22; }
  50% { opacity: 0.18; }
  88% { opacity: 0.22; }
  100% { transform: translateY(118%); opacity: 0; }
}
.holoTimelineScan{
  position:absolute;
  left:0; right:0;
  height: 22%;
  top: -22%;
  pointer-events:none;
  opacity:0;
  background: linear-gradient(180deg, transparent, rgba(90,220,255,0.07), transparent);
}
.holoTimelineWrap:hover .holoTimelineScan,
.holoTimelineWrap:focus-within .holoTimelineScan{
  animation: holoTimelineScan 3.8s ease-in-out infinite;
}
/* Corner brackets */
.holoCorner{
  position:absolute;
  width: 14px; height: 14px;
  border: 1px solid rgba(120,220,255,0.38);
  opacity: 0.65;
  pointer-events:none;
}
.holoCorner.tl{ top:10px; left:10px; border-right:none; border-bottom:none; border-top-left-radius:6px;}
.holoCorner.tr{ top:10px; right:10px; border-left:none; border-bottom:none; border-top-right-radius:6px;}
.holoCorner.bl{ bottom:10px; left:10px; border-right:none; border-top:none; border-bottom-left-radius:6px;}
.holoCorner.br{ bottom:10px; right:10px; border-left:none; border-top:none; border-bottom-right-radius:6px;}
.holoTimelineTitle{
  display:flex;
  align-items:center;
  gap:10px;
  font-weight:800;
  letter-spacing:0.08em;
  text-transform:uppercase;
  font-size:12px;
  color: rgba(190,235,255,0.92);
  text-shadow: 0 0 10px rgba(70,190,255,0.18);
}
.holoDot{
  width:7px; height:7px; border-radius:999px;
  background: rgba(90,220,255,0.9);
  box-shadow: 0 0 12px rgba(90,220,255,0.45);
}


/* --- Abilities tab upgrade --- */
.abilitiesCard { position: relative; overflow: hidden; }
.abilitiesCard::before{
  content:"";
  position:absolute; inset:0;
  background:
    radial-gradient(900px 320px at 16% 10%, rgba(90,220,255,0.08), transparent 55%),
    radial-gradient(700px 280px at 85% 0%, rgba(110,160,255,0.07), transparent 60%),
    linear-gradient(180deg, rgba(12,22,36,0.12), transparent 35%);
  pointer-events:none;
}
.abilitiesHeader{
  position: sticky; top: 0; z-index: 3;
  backdrop-filter: blur(10px);
}
.abilitiesScroll{
  position: relative;
  scrollbar-gutter: stable both-edges;
}
.abilitiesTable thead th{
  position: sticky; top: 0; z-index: 2;
  background: linear-gradient(180deg, rgba(10,18,30,0.92), rgba(10,18,30,0.70));
  border-bottom: 1px solid rgba(120,220,255,0.14);
}
.abilitiesTable tbody tr{
  transition: background 160ms ease, transform 160ms ease, box-shadow 160ms ease;
}
.abilitiesTable tbody tr:hover{
  background: rgba(35,75,110,0.18);
}
.abilitiesTable tbody tr:nth-child(odd){
  background: rgba(0,0,0,0.06);
}
.abilitiesTable tbody tr:hover .abilityBarFill{
  filter: saturate(1.2);
}
.abilityCell{ width: 420px; min-width: 420px; }
.abilityMain{
  display:flex !important;
  align-items:center;
  gap:10px;
  flex-wrap: nowrap;
  min-width:0;
}
.abilityToggle{
  display:inline-flex !important;
  align-items:center;
  justify-content:center;
  width:26px;
  height:22px;
  padding: 0 !important;
  border-radius: 8px !important;
  background: rgba(20,48,72,0.30) !important;
  border: 1px solid rgba(120,220,255,0.22) !important;
  box-shadow: 0 0 12px rgba(70,190,255,0.08);
  flex: 0 0 auto;
}
.abilityText{
  flex: 1;
  min-width: 0;
  display:flex;
  flex-direction:column;
  gap:6px;
}
.abilityTopRow{ display:flex; align-items:center; gap:10px; }
.abilityName{
  font-weight: 800;
  color: rgba(230,250,255,0.96);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.1;
  display:flex;
  align-items:center;
  gap:8px;
}
.abilityTag{
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 999px;
  border: 1px solid rgba(120,220,255,0.22);
  background: rgba(35,75,110,0.22);
  color: rgba(170,235,255,0.92);
}
.abilityBar{
  margin-top: 6px;
  height: 6px;
  border-radius: 999px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(120,220,255,0.10);
  overflow: hidden;
}
.abilityBarFill{
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(70,200,255,0.85), rgba(150,220,255,0.30));
  box-shadow: 0 0 14px rgba(70,190,255,0.16);
  transition: width 220ms ease;
}
`}
</style>
      <g
        style={{
          transformOrigin: 'center',
          animation: `pillPop-${animId} 260ms ease-out`,
          animationDelay: animDelay,
          animationFillMode: 'both',
        }}
      >
        <rect
          x={-pillW / 2}
          y={-pillH / 2}
          width={pillW}
          height={pillH}
          rx={pillH / 2}
          ry={pillH / 2}
          className="holo-pill"
          fill="rgba(10, 14, 22, 0.92)" // solid, readable pill
          stroke="rgba(255,255,255,0.10)"
          strokeWidth={1}
          filter="url(#holoGlow)"
        />
        <text
          x={0}
          y={fontSize * 0.36}
          textAnchor="middle"
          fontSize={fontSize}
          fontWeight={800}
          className="holo-pill-text"
          fill="rgba(255,255,255,0.96)"
          style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.65))' }}
        >
          {s}
        </text>
      </g>
    </g>
  );
}

// normalize a name & remove UI prefixes like "A: " / "B: "
const norm = (s?: string) => (s ?? "").normalize("NFKC").trim().toLowerCase();
const cleanName = (s?: string) =>
  norm(s).replace(/^(a|b)\s*:\s*/, "").replace(/^player\s*(a|b)\s*:\s*/, "");

// Some logs sometimes emit names with apostrophes at the end of a token,
// e.g. "Minerva'", "Irozu'", or even "Minerva' Testing".
// Treat these as the same entity everywhere (dropdowns + aggregation keys).
// IMPORTANT: only strip apostrophes that appear immediately before whitespace or end-of-string.
const stripTrailingApostrophe = (s?: string) =>
  String(s || '')
    .normalize('NFKC')
    .trim()
    // remove straight/curly apostrophes that terminate a word/token
    .replace(/[’'](?=\s|$)/g, '')
    .trim();

// Canonicalize actor names for grouping/lookup.
// Keep casing (so UI remains familiar) while fixing split-identity issues like "Minerva'".
const canonActor = (n?: string) => stripTrailingApostrophe(String(n ?? '')).trim();

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

type UtilityEvent = { t:number; src:string; ability:string };

function extractUtilityEventsFromPerforms(text: string): UtilityEvent[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const out: UtilityEvent[] = [];
  // Example:
  // [Combat]  16:27:51 Broly performs Bacta Ampule (Mark 6) on RekcuT.
  // [Combat]  16:27:51 Greyian Lalo performs Tangle Bomb (Mark 3).
  const re = /^\[Combat\]\s+(\d{2}):(\d{2}):(\d{2})\s+(.+?)\s+performs\s+(.+?)(?:\s+on\s+.+?)?\.?\s*$/i;
  let minAbs: number | null = null;
  const temp: Array<{abs:number; src:string; ability:string}> = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(re);
    if (!m) continue;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    const ss = Number(m[3]);
    const src = String(m[4] || '').trim();
    const ability = String(m[5] || '').trim();
    if (!src || !ability) continue;
    const abs = hh * 3600 + mm * 60 + ss;
    if (minAbs === null || abs < minAbs) minAbs = abs;
    temp.push({ abs, src, ability });
  }
  if (!temp.length) return out;
  const base = minAbs ?? temp[0].abs;
  for (const e of temp) {
    out.push({ t: Math.max(0, e.abs - base), src: e.src, ability: e.ability });
  }
  return out;
}



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
const canonicalClassLabel = (p?: string) => {
  const raw = (p || '').trim();
  if (!raw) return '';
  const k = raw.toLowerCase();
  // Accept already-pretty labels ("Bounty Hunter") and also lower/short forms ("bounty hunter", "bh", etc.)
  const map: Record<string, string> = {
    'jedi': 'Jedi',
    'bh': 'Bounty Hunter',
    'bountyhunter': 'Bounty Hunter',
    'bounty hunter': 'Bounty Hunter',
    'commando': 'Commando',
    'cmd': 'Commando',
    'officer': 'Officer',
    'off': 'Officer',
    'spy': 'Spy',
    'medic': 'Medic',
    'doc': 'Medic',
    'smuggler': 'Smuggler',
    'smug': 'Smuggler',
    'entertainer': 'Entertainer',
    'ent': 'Entertainer',
    'trader': 'Trader',
    'trade': 'Trader',
    'artisan': 'Trader'
  };
  // If it already matches a key in CLASS_COLORS, use it.
  if ((CLASS_COLORS as any)[raw]) return raw;
  return map[k] || raw;
};
const classColor = (p?: string) => (CLASS_COLORS as any)[canonicalClassLabel(p)] || '#6ec7ff';
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
  'bacta burst':'Medic','bacta spray':'Medic','bacta ampule':'Medic','vital strike':'Medic','nerve gas':'Medic',
};

// aggressive normalizer to merge variants like “… and hits / glances / crits / punishing blows”, ranks and fluff
function normalizeAbilityName(raw?: string): string {
  if (!raw) return '';
  let s = raw.toLowerCase().trim();

  // drop leading “with/using”
  s = s.replace(/^(with|using)\s+/, '');

  // strip “mine 2:” or “mine:” prefixes
  s = s.replace(/\bmine\s*\d*\s*:\s*/g, '');

  // remove "and <suffix>" bits: hits/glances/crits/critically hits/strikes through/<n> points blocked/punishing blows
  s = s.replace(
    /(?:[\s.\-]+and\s+(?:\d+\s+points\s+blocked|strikes\s+through|hits|glances|crits|critical(?:ly)?\s+hits?|punishing\s+blows)(?:\s+\(\d+%.*?\))?)/gi,
    ''
  );
  s = s.replace(/\band\s+punishing\s+blows\b/gi, ''); // extra safety

  // Some logs omit "and" and just end with "critically hits"/"critical hits"/etc.
  s = s.replace(
    /\s+(?:hits|glances|crits|critical(?:ly)?\s+hits?|strikes\s+through|punishing\s+blows)\b.*$/gi,
    ''
  );

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

  { npc: 'a blacksun boarder', inst: 'ISD' },
  { npc: 'the caretaker of the lost', inst: 'Exar Kun' },
  { npc: 'the open hand of hate', inst: 'Exar Kun' },
  { npc: 'a tomb guardian', inst: 'Exar Kun' },
  { npc: 'battle droid', inst: 'IG-88' },
  { npc: 'an avatar guard', inst: 'Avatar Hardmode' },
  { npc: 'avatar guard', inst: 'Avatar Hardmode' },
];
const NPC_MAP: Record<string,string> = Object.fromEntries(NPC_TO_INSTANCE.map(x=> [normName(x.npc), x.inst]));

// Segment-identification NPCs (exclude from player charts/hover/top lists)
function isSegmentNpcName(name: string): boolean {
  return !!NPC_MAP[normName(name)];
}


// Optional: expand short instance labels to a friendlier dungeon/raid name.
// If we don't have a mapping, we fall back to the segment's inferred label.
const INSTANCE_PRETTY: Record<string, { title: string; subtitle?: string }> = {
  'ISD': { title: 'Imperial Star Destroyer', subtitle: 'ISD' },
  'Kizash': { title: 'Kizash' },
  'Sinya Nilm': { title: 'Sinya Nilm' },
  'Exar Kun': { title: 'Exar Kun' },
  'Axkva Min': { title: 'Axkva Min' },
  'Tusken King': { title: 'Tusken King' },
  'IG-88': { title: 'IG-88' },
  'Avatar Hardmode': { title: 'Avatar (Hardmode)', subtitle: 'Avatar' },
  'Dark Side Mellichae': { title: 'Mellichae', subtitle: 'Dark Side' },
  'Light Side Mellichae': { title: 'Mellichae', subtitle: 'Light Side' },
};

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


// --- Player name normalization (merge apostrophe variants & Testing clones) ---
// SWG logs sometimes emit player names like "Irozu'" or "Minerva' Testing".
// We treat these as the same player by removing token-terminal apostrophes and
// collapsing a trailing "Testing" suffix.
function stripTokenTerminalApostrophes(name: string) {
  return String(name || '').replace(/([A-Za-z0-9_])['’](?=\s|$)/g, '$1');
}
function normalizeActorName(name: string) {
  let s = String(name || '').trim();
  if (!s) return '';
  s = stripTokenTerminalApostrophes(s);
  s = s.replace(/\s{2,}/g, ' ').trim();
  // Collapse "X Testing" into "X"
  s = s.replace(/\s+Testing$/i, '').trim();
  return s;
}

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


// APM should reflect *active combat time* rather than total log duration.
// We treat "active" time as the union of derived combat segments (based on idleGap)
// intersected with the current visible window.
function activeSecondsFromSegments(
  segments: { start: number; end: number }[] | undefined,
  start: number,
  end: number
) {
  if (!segments || !segments.length) return Math.max(1, end - start + 1);
  let s = 0;
  for (const seg of segments) {
    const a = Math.max(start, seg.start);
    const b = Math.min(end, seg.end);
    if (b >= a) s += (b - a + 1);
  }
  return Math.max(1, s);
}

function actionsPerMinute(
  perSecond: Record<string, number[]>,
  timelineWindow: { t: number }[],
  fallbackDuration: number,
  segments?: { start: number; end: number }[]
) {
  const winStart = timelineWindow.length ? timelineWindow[0].t : 0;
  const winEnd = timelineWindow.length
    ? timelineWindow[timelineWindow.length - 1].t
    : Math.max(0, fallbackDuration);

  const maxT = Math.max(fallbackDuration, winEnd);
  const active = new Uint8Array(maxT + 1);

  if (!segments || !segments.length) {
    for (let t = winStart; t <= winEnd && t <= maxT; t++) active[t] = 1;
  } else {
    for (const seg of segments) {
      const a = Math.max(winStart, seg.start);
      const b = Math.min(winEnd, seg.end);
      for (let t = a; t <= b && t <= maxT; t++) active[t] = 1;
    }
  }

  let activeSeconds = 0;
  for (let t = winStart; t <= winEnd && t <= maxT; t++) if (active[t]) activeSeconds++;
  activeSeconds = Math.max(1, activeSeconds);

  const minutes = Math.max(1, activeSeconds / 60);

  const items = Object.entries(perSecond || {}).map(([name, series]) => {
    let hits = 0;
    const s = series || [];
    for (let t = winStart; t <= winEnd && t <= maxT; t++) {
      if (!active[t]) continue;
      if ((s[t] || 0) > 0) hits++;
    }
    const apm = hits / minutes;
    return { name: name || "Unknown", value: Math.round(apm) };
  });

  return items.sort((a, b) => b.value - a.value).slice(0, 12);
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


function TopRibbon(props:{
  onPickFile:(f:File)=>void;
  onParsePaste:()=>void;
  pasteText:string; setPasteText:(s:string)=>void;
  metric:MetricKey; setMetric:(s:MetricKey)=>void;
  collectUnparsed:boolean; setCollectUnparsed:(v:boolean)=>void;
  compareOn:boolean; setCompareOn:(v:boolean)=>void;
  pA:string; setPA:(s:string)=>void;
  pB:string; setPB:(s:string)=>void;
  players:string[];
  onClearAB:()=>void;
  parsing?: {done:number,total:number}|null;
  timelineStep:number; setTimelineStep:(n:number)=>void;

  onOpenSummary?: () => void;
  onOpenPlayerSummary?: () => void;
}){
  const [showPaste, setShowPaste] = React.useState(false);
  return (
    <>
      <div className="ribbon">
        <div className="group left">
          <div className="chip" title="Reduce timeline render points to improve FPS">
            <span>Timeline fidelity</span>
            <select className="input" value={props.timelineStep} onChange={e=>props.setTimelineStep(Number(e.target.value)||1)}>
              <option value={1}>Every 1s</option>
              <option value={2}>Every 2s</option>
              <option value={3}>Every 3s</option>
              <option value={5}>Every 5s</option>
              <option value={10}>Every 10s</option>
            </select>
          </div>
          <div className="title">Upload SWG chatlog.txt</div>
          <label className="filepill">
            <input type="file" accept=".txt,.log"
              onChange={e=>{ const f=e.target.files?.[0]; if(f) props.onPickFile(f); }}/>
            <span className="btn-file">Choose File</span>
            <span className="hint">.txt / .log</span>
          </label>
          <button className="btn ghost" onClick={()=>setShowPaste(v=>!v)}>
            {showPaste ? "Hide Paste" : "Paste Raw Lines"}
          </button>
        </div>

        
<div className="group center" style={{ justifyContent: 'center', minWidth: 0 }}>
  <div style={{ display:'flex', gap: 14, alignItems:'center', justifyContent:'center', flexWrap:'nowrap', whiteSpace:'nowrap' }}>
    <button
      type="button"
      className="enc-btn"
      onClick={props.onOpenSummary}
      title="Open Encounter Summary"
    >
      ENCOUNTER SUMMARY
    </button>

    <button
      type="button"
      className="ps-btn"
      onClick={props.onOpenPlayerSummary}
      title="Open Player Summary"
    >
      PLAYER SUMMARY
    </button>
  </div>
</div>

<div className="group right center-stack" style={{justifyContent:'center'}}>
<label className="chip">
            <input type="checkbox" checked={props.compareOn}
              onChange={e=>props.setCompareOn(e.target.checked)} />
            Player comparison
          </label>
        
  <div className="ab-box">
    <div className="ab-row">
      <select disabled={!props.compareOn} value={props.pA} onChange={e=>props.setPA(e.target.value)}>
      <option value="">A: Select player</option>
      {props.players.map(p=> <option key={"A"+p} value={p}>{p}</option>)}
    </select>
      <select disabled={!props.compareOn} value={props.pB} onChange={e=>props.setPB(e.target.value)}>
      <option value="">B: Select player</option>
      {props.players.map(p=> <option key={"B"+p} value={p}>{p}</option>)}
    </select>
    </div>
    <div className="ab-actions">
      <button className="btn warn" disabled={!props.compareOn} onClick={props.onClearAB}>CLEAR A/B</button>
      <DpsPopoutButton makeWorker={() => new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' })} />
    </div>
  </div>
</div>
        <div className="group ribbon-right" style={{justifyContent:'flex-end'}}>
          {props.parsing && <span className="badge">Parsing… <progress max={props.parsing.total} value={props.parsing.done}></progress></span>}
        </div>
      </div>

      {showPaste && (
        <div className="paste-drawer">
          <textarea
            value={props.pasteText}
            onChange={e=>props.setPasteText(e.target.value)}
            placeholder="Or paste raw lines here…"
          />
          <div style={{display:'flex', gap:8, justifyContent:'flex-end', marginTop:8}}>
            <button className="btn" onClick={props.onParsePaste}>PARSE PASTED TEXT</button>
          </div>
        </div>
      )}
    </>
  );
}

/* ========================= Welcome Screen ========================= */

type AnalyzerMode = "pve" | "pvp";

function WelcomeScreen({ onSelect }: { onSelect: (mode: AnalyzerMode) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [tipIdx, setTipIdx] = useState(0);
  const [burstKey, setBurstKey] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [chosenMode, setChosenMode] = useState<AnalyzerMode | null>(null);

  const tips = useMemo(
    () => [
      "Parsing tip: Larger logs take longer—keep the tab open while it indexes.",
      "Crit % tip: Small sample sizes can swing wildly—check hit counts per ability.",
      "Healing tip: Overheal spikes often mean late swaps or stacked healers.",
      "APM tip: Bursts usually align with cooldown windows—compare with damage spikes.",
      "Timeline tip: Segment labels help isolate phases—zoom in for precision.",
    ],
    []
  );

  // progress boot sequence (purely cosmetic)
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const duration = 2600;

    const tick = () => {
      const t = performance.now();
      const ratio = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - ratio, 3);
      setProgress(Math.floor(eased * 100));
      if (ratio >= 1) {
        setTimeout(() => setReady(true), 350);
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // rotate tips
  useEffect(() => {
    const id = window.setInterval(() => {
      setTipIdx((v) => (v + 1) % tips.length);
    }, 2600);
    return () => window.clearInterval(id);
  }, [tips.length]);

  // starfield canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;

    const rand = (min: number, max: number) => min + Math.random() * (max - min);

    const resize = () => {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, Math.floor(rect.width * dpr));
      h = Math.max(1, Math.floor(rect.height * dpr));
      canvas.width = w;
      canvas.height = h;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    const stars = new Array(240).fill(0).map(() => ({
      x: rand(0, w),
      y: rand(0, h),
      z: rand(0.2, 1.0),
      r: rand(0.6, 1.8),
      vy: rand(0.4, 1.25),
      tw: rand(0, Math.PI * 2),
    }));

    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, w, h);

      // subtle vignette
      const g = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.7);
      g.addColorStop(0, "rgba(0,0,0,0.00)");
      g.addColorStop(1, "rgba(0,0,0,0.60)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      for (const s of stars) {
        s.tw += 0.04 + s.z * 0.03;
        const twinkle = 0.55 + 0.45 * Math.sin(s.tw);

        s.y += s.vy * (1 + s.z * 1.4);
        if (s.y > h + 10) {
          s.y = -10;
          s.x = rand(0, w);
        }

        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * (0.6 + s.z), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${0.10 + 0.25 * twinkle * s.z})`;
        ctx.fill();
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const triggerBurst = () => setBurstKey((v) => v + 1);

  const handleSelect = (mode: AnalyzerMode) => {
    if (!ready || exiting) return;
    setChosenMode(mode);
    setExiting(true);
    triggerBurst();
    // Let the UI animate out before switching analyzers
    window.setTimeout(() => onSelect(mode), 750);
  };

  return (
    <motion.div
      className="swg-welcome-root"
      role="dialog"
      aria-label="Welcome"
      initial={{ opacity: 1, scale: 1 }}
      animate={{ opacity: exiting ? 0 : 1, scale: exiting ? 1.01 : 1 }}
      exit={{ opacity: 0, scale: 1.01 }}
      transition={{ duration: 0.55, ease: "easeOut" }}
    >
      <style>{`
        .swg-welcome-root{
          position:fixed; inset:0; z-index:9999; overflow:hidden;
          background:#000 url(/mainmenu.jpg) center/55% auto no-repeat;
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
          color:#fff;
        }
        .swg-welcome-overlayA{ position:absolute; inset:0; background:linear-gradient(to bottom, rgba(0,0,0,.78), rgba(0,0,0,.25) 45%, rgba(0,0,0,.86)); }
        .swg-welcome-overlayB{ position:absolute; inset:0; background:radial-gradient(circle at 50% 20%, rgba(255,255,255,.10), rgba(0,0,0,.65) 55%, rgba(0,0,0,.92) 100%); }
        .swg-welcome-scanlines{ position:absolute; inset:0; opacity:.10; background:repeating-linear-gradient(to bottom, rgba(255,255,255,.06) 0px, rgba(255,255,255,.06) 1px, rgba(0,0,0,0) 6px); mix-blend-mode: overlay; }
        .swg-welcome-wrap{ position:relative; height:100%; width:100%; max-width:2200px; margin:0 auto; padding:36px 14px; display:flex; flex-direction:column; }
        .swg-welcome-top{ display:flex; justify-content:space-between; align-items:center; gap:14px; }
        .swg-welcome-boot{ letter-spacing:.35em; font-size:12px; opacity:.72; }
        .swg-welcome-build{ font-size:12px; opacity:.62; background:rgba(255,255,255,.08); padding:6px 10px; border-radius:999px; }
        .swg-welcome-center{ flex:1; display:grid; align-items:center; grid-template-columns: 1fr 1fr; gap:220px; padding:0 64px; }
        @media (max-width: 980px){ .swg-welcome-center{ grid-template-columns: 1fr; } }
        .swg-welcome-center > div:first-child{ justify-self:start; }
        .swg-welcome-panel{ justify-self:end; }
        @media (max-width: 1200px){ .swg-welcome-center{ padding:0 24px; gap:64px; } }
        @media (max-width: 980px){ .swg-welcome-center{ padding:0; } .swg-welcome-panel{ justify-self:start; } }

        .swg-welcome-title{
          font-size:44px; line-height:1.05; font-weight:800;
          text-shadow: 0 0 22px rgba(255,255,255,.22), 0 0 60px rgba(120,200,255,.14);
        }
        .swg-welcome-sub{ margin-top:12px; font-size:14px; opacity:.78; max-width:760px; }
        .swg-welcome-panel{
          background: rgba(0,0,0,.42); border:1px solid rgba(255,255,255,.14);
          border-radius: 18px; padding:18px 18px 16px;
          box-shadow: 0 18px 60px rgba(0,0,0,.45);
          backdrop-filter: blur(10px);
        }
        .swg-welcome-row{ display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .swg-welcome-bar{
          position:relative; height:10px; width:100%; border-radius:999px;
          background: rgba(255,255,255,.10); overflow:hidden;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,.06);
        }
        .swg-welcome-bar > div{
          height:100%; border-radius:999px;
          background: linear-gradient(90deg, rgba(255,255,255,.25), rgba(255,255,255,.85), rgba(255,255,255,.25));
          width: 0%;
          transition: width 120ms linear;
        }
        .swg-welcome-tip{ margin-top:12px; font-size:12px; opacity:.78; min-height:18px; }
        .swg-welcome-btns{ display:flex; gap:12px; margin-top:14px; }
        @media (max-width: 520px){ .swg-welcome-btns{ flex-direction:column; } }
        .swg-btn{
          position:relative; flex:1;
          border-radius:14px;
          padding:12px 14px;
          background: rgba(255,255,255,.10);
          border: 1px solid rgba(255,255,255,.18);
          color:#fff; font-weight:800; letter-spacing:.08em;
          cursor:pointer;
          transition: transform 120ms ease, background 160ms ease, border-color 160ms ease;
          user-select:none;
          text-transform: uppercase;
        }
        .swg-btn:disabled{ opacity:.45; cursor:not-allowed; }
        .swg-btn:hover:not(:disabled){ transform: translateY(-1px); background: rgba(255,255,255,.14); border-color: rgba(255,255,255,.30); }
        .swg-btn:active:not(:disabled){ transform: translateY(0px); }
        .swg-btn::after{
          content:""; position:absolute; inset:-2px; border-radius:16px;
          background: radial-gradient(circle at 20% 0%, rgba(255,255,255,.22), rgba(0,0,0,0) 55%);
          opacity:.35; pointer-events:none;
        }
        .swg-badge{
          display:inline-flex; align-items:center; gap:8px; font-size:11px; opacity:.86;
          padding:6px 10px; border-radius:999px;
          background: rgba(0,0,0,.32);
          border: 1px solid rgba(255,255,255,.12);
        }
        .swg-crawl{
          position:relative; height:120px; overflow:hidden; margin-top:18px;
          border-radius:16px; border:1px solid rgba(255,255,255,.10);
          background: rgba(0,0,0,.28);
        }
        .swg-crawl-inner{
          position:absolute; left:0; right:0; bottom:-120px;
          padding:16px;
          animation: swgCrawl 12s linear infinite;
          font-size:12px; opacity:.75; line-height:1.6;
          text-align:center;
        }
        @keyframes swgCrawl{
          0%{ transform: translateY(0) skewX(-4deg); opacity:.0;}
          6%{ opacity:.75;}
          100%{ transform: translateY(-360px) skewX(-4deg); opacity:0;}
        }
        .swg-holo{
          margin-top:14px;
          display:flex; flex-wrap:wrap; gap:10px;
          opacity:.85;
        }
        .swg-holo span{
          border:1px solid rgba(255,255,255,.12);
          background: rgba(255,255,255,.08);
          padding:8px 10px; border-radius:12px;
          font-size:11px; letter-spacing:.10em;
        }
      `}</style>

      <canvas
        ref={canvasRef}
        className="swg-welcome-canvas"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", mixBlendMode: "screen", opacity: 0.9 }}
      />

      <div className="swg-welcome-overlayA" />
      <div className="swg-welcome-overlayB" />
      <div className="swg-welcome-scanlines" />

      {/* hyperspace burst overlay */}
      <AnimatePresence>
        {burstKey > 0 && (
          <motion.div
            key={burstKey}
            style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55 }}
          >
            {Array.from({ length: 46 }).map((_, i) => (
              <motion.div
                key={i}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: 320,
                  height: 2,
                  transformOrigin: "0% 50%",
                  transform: `rotate(${(360 / 46) * i + 7.5}deg) translateX(0px)`,
                  borderRadius: 999,
                  background:
                    "linear-gradient(90deg, rgba(255,255,255,0.0), rgba(255,255,255,0.65), rgba(255,255,255,0.0))",
                  filter: "blur(0.8px)",
                }}
                initial={{ opacity: 0, scaleX: 0.05 }}
                animate={{ opacity: 0.75, scaleX: 1.15 }}
                exit={{ opacity: 0, scaleX: 0.05 }}
                transition={{ duration: 0.55, ease: "easeOut" }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="swg-welcome-wrap">
        <div className="swg-welcome-top">
          <div className="swg-welcome-boot">SWG • LOG ANALYZER • INITIALIZING</div>
          <div className="swg-welcome-build">Boot: {progress}%</div>
        </div>

        <div className="swg-welcome-center">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: "easeOut" }}
              className="swg-welcome-title"
            >
              Welcome to the
              <br />
              Star Wars Galaxies
              <br />
              Log Analyzer
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.9, ease: "easeOut" }}
              className="swg-welcome-sub"
            >
              Your combat telemetry, decoded. Choose a mode to proceed.
            </motion.div>

            <div className="swg-holo">
              <span>CRIT%</span>
              <span>DPS/HPS</span>
              <span>SEGMENTS</span>
              <span>UTILITY</span>
              <span>DEATHS</span>
              <span>COMPARE</span>
            </div>
          </div>

          <motion.div
            className="swg-welcome-panel"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.85, ease: "easeOut" }}
          >
            <div className="swg-welcome-row" style={{ marginBottom: 8 }}>
              <div className="swg-badge">SYSTEM STATUS</div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                {ready ? "READY" : "LOADING"}
              </div>
            </div>

            <div className="swg-welcome-bar" aria-label="Loading">
              <div style={{ width: `${progress}%` }} />
            </div>

            <div className="swg-welcome-tip">
              <AnimatePresence mode="wait">
                <motion.div
                  key={tipIdx}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25 }}
                >
                  {tips[tipIdx]}
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="swg-welcome-btns">
              <button
                className="swg-btn"
                disabled={!ready}                onClick={() => handleSelect("pve")}
              >
                PVE Analyzer
              </button>

              <button
                className="swg-btn"
                disabled={!ready}                onClick={() => handleSelect("pvp")}
              >
                PVP Analyzer
              </button>
            </div>

            {exiting && (
              <div className="swg-exit-overlay" aria-hidden>
                <div className="swg-exit-panel">
                  <div className="swg-exit-title">Engaging Hyperdrive</div>
                  <div className="swg-exit-sub">
                    Loading {chosenMode === "pvp" ? "PVP" : "PVE"} Analyzer…
                  </div>
                  <div className="swg-exit-bar">
                    <div className="swg-exit-fill" />
                  </div>
                </div>
              </div>
            )}

            <div className="swg-crawl" aria-hidden>
              <div className="swg-crawl-inner">
                <div style={{ fontWeight: 800, letterSpacing: ".18em", opacity: 0.95 }}>
                  INITIALIZING ANALYSIS CORE
                </div>
                <div style={{ marginTop: 10 }}>
                  Parsing • Normalization • Event Linking • Outcome Inference • Segment Mapping
                </div>
                <div style={{ marginTop: 10 }}>
                  May your crits be plentiful and your overheal be intentional.
                </div>
              </div>
            </div>

            <div style={{ marginTop: 12, fontSize: 11, opacity: 0.65, lineHeight: 1.5 }}>
              Note: PVP mode will share the same app + files; we’ll unlock the PVP-specific views next.
            </div>
          </motion.div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 11, opacity: 0.55 }}>
          <div>© {new Date().getFullYear()} • SWG Log Analyzer</div>
          <div>“Punch it.”</div>
        </div>
      </div>
    </motion.div>
  );
}

/* ========================= Main App ========================= */

export default function App(){
  const [showWelcome, setShowWelcome] = useState<boolean>(true);
  const [analyzerMode, setAnalyzerMode] = useState<AnalyzerMode>("pve");
  const [focusLine, setFocusLine] = React.useState<string | null>(null);
  // raw/unfiltered results from worker
const [timelineStep, setTimelineStep] = useState<number>(1);
  
  const [actorsSeen, setActorsSeen] = useState<string[]>([]);
const [baseRows, setBaseRows] = useState<PlayerRow[]>([]);
const [baseTimeline, setBaseTimeline] = useState<Array<{t:number; dps:number; hps:number}>>([]);
const [basePerSrc, setBasePerSrc] = useState<Record<string, number[]>>({});
const [basePerAbility, setBasePerAbility] = useState<PerAbility>({});
const [basePerAbilityTargets, setBasePerAbilityTargets] = useState<PerAbilityTargets>({});
const [basePerTaken, setBasePerTaken] = useState<Record<string, number>>({});
const [basePerTakenBy, setBasePerTakenBy] = useState<Record<string, Record<string, number>>>({});

const [damageEvents, setDamageEvents] = useState<DFEvent[]>([]);
const [healEvents, setHealEvents] = useState<HealEvent[]>([]);
const [utilityEvents, setUtilityEvents] = useState<UtilityEvent[]>([]);
const [deathEvents, setDeathEvents] = useState<Array<{t:number; name:string}>>([]);
const [duration, setDuration] = useState<number>(0);
const [debug, setDebug] = useState<any>(null);

const [exporting, setExporting] = useState(false);
const [exportToast, setExportToast] = useState<string | null>(null);

// Cache the last rendered export blob so clipboard copy can happen immediately on click
// (avoids browsers denying image clipboard writes after long async work).
const exportBlobRef = useRef<Blob | null>(null);
const exportBlobKeyRef = useRef<string>("");

// Prevent exporting until the export snapshot is fully ready (incl. class colors).
// This avoids the "export twice to get colors" behavior after a fresh parse.
const [exportReady, setExportReady] = useState<boolean>(false);

const lastParsedTextRef = useRef<string>("");

	// --- Dynamic player/NPC name aliasing (merge short vs full names safely) ---
	// This avoids runtime errors in render (e.g., death snapshot dropdown) and keeps
	// names consistent when logs sometimes use short vs full variants.
	const dynLongestByFirst = useMemo(() => {
		const GENERIC_TOKENS = new Set(['a','an','the','with','using']);
		const longest: Record<string,string> = {};
		const learn = (n?: string) => {
			const raw = String(n || '').trim();
			if (!raw) return;
			const ft = normName(raw.split(/\s+/)[0] || '');
			if (!ft || GENERIC_TOKENS.has(ft)) return;
			const cur = longest[ft];
			if (!cur || raw.length > cur.length) longest[ft] = raw;
		};
		damageEvents.forEach(e => learn(e.src));
		healEvents.forEach(e => learn(e.src));
		(baseRows || []).forEach(r => learn(r.name));
		return { longest, GENERIC_TOKENS };
	}, [damageEvents, healEvents, baseRows]);

	const canonDyn = useCallback((n?: string) => {
		const raw = String(n || '').trim();
		if (!raw) return '';
		const ft = normName(raw.split(/\s+/)[0] || '');
		if (!ft || dynLongestByFirst.GENERIC_TOKENS.has(ft)) return raw;
		return normalizeActorName(dynLongestByFirst.longest[ft] || raw);
	}, [dynLongestByFirst]);


  // Allowed player professions
  const ALLOWED_CLASSES = useMemo(() => new Set([
    'Jedi','Bounty Hunter','Commando','Officer','Spy','Medic','Smuggler','Entertainer','Trader'
  ].map(s => s.toLowerCase())), []);

  // Names that have a known, allowed class
  
const playersWithClass = useMemo(() => {
  const rows = (baseRows || []).filter(r => (
    !!r?.name && !!r?.profession &&
    ALLOWED_CLASSES.has(String(r.profession).toLowerCase().trim())
  ));

  // Build longest-by-first alias across these player rows + remember profession for that key
  const longest: Record<string,string> = {};
  const profByKey: Record<string,string> = {};
  for (const r of rows) {
    const raw = stripTrailingApostrophe(String(r.name||'').trim());
    const key = normName(raw.split(/\s+/)[0] || '');
    if (!key) continue;

    const prof = String(r.profession||'').trim();
    if (prof && !profByKey[key]) profByKey[key] = prof;

    if (!longest[key] || raw.length > longest[key].length) longest[key] = raw;
  }

  // Return unique canonical players (keeps order of appearance)
  const out: { name: string; profession?: string }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const raw = stripTrailingApostrophe(String(r.name||'').trim());
    const key = normName(raw.split(/\s+/)[0] || '');
    const can = longest[key] || raw;
    if (!seen.has(can)) {
      seen.add(can);
      out.push({ name: can, profession: profByKey[key] });
    }
  }
  return out;
}, [baseRows, ALLOWED_CLASSES]);




  const UTILITY_DURATIONS_SEC: Record<string, number> = useMemo(() => ({
    "off the cuff": 20,
    "end of the line": 30,
  }), []);

  type UtilityStat = { count: number; uptime: number; uptimePct: number };
  const utilityByPlayer: Record<string, Record<string, UtilityStat>> = useMemo(() => {
    const out: Record<string, Record<string, UtilityStat>> = {};
    if (!utilityEvents || !utilityEvents.length) return out;

    const by: Record<string, Record<string, number[]>> = {};
    for (const ev of utilityEvents) {
      const p = String(ev.src||"").trim();
      const a = String(ev.ability||"").trim();
      if (!p || !a) continue;
      const an = a.toLowerCase().trim();
      if (!by[p]) by[p] = {};
      if (!by[p][a]) by[p][a] = [];
      by[p][a].push(ev.t);
    }

    for (const p of Object.keys(by)) {
      out[p] = {};
      for (const a of Object.keys(by[p])) {
        const times = by[p][a].slice().sort((x,y)=>x-y);
        const dur = UTILITY_DURATIONS_SEC[a.toLowerCase().trim()] || 0;
        let uptime = 0;
        let curStart = -1;
        let curEnd = -1;
        for (const t of times) {
          const s = t;
          const e = Math.min(duration, t + dur);
          if (curStart < 0) { curStart = s; curEnd = e; continue; }
          if (s <= curEnd) {
            // overlap / refresh
            if (e > curEnd) curEnd = e;
          } else {
            uptime += Math.max(0, curEnd - curStart);
            curStart = s; curEnd = e;
          }
        }
        if (curStart >= 0) uptime += Math.max(0, curEnd - curStart);
        const count = times.length;
        out[p][a] = { count, uptime, uptimePct: duration ? (uptime / duration) : 0 };
      }
    }
    return out;
  }, [utilityEvents, duration, UTILITY_DURATIONS_SEC]);



  
  // Broad NPC alias tokens used to hide NPCs from Encounter Summary (substring, case-insensitive)
  const npcAliases = useMemo(() => [
    'sith shadow', 'element of', 'mynock', 'golem', 'kizash', 'mellichae', 'sinya nilim', 'krix', 'warlord', 'raider', 'flight', 'grenadier', 'blackguard', 'blacksun', 'honor'
  ], []);

  // filtered (by segment) derived state
  const [rows, setRows] = useState<PlayerRow[]>([]);
  // smooth heavy updates & defer list derivations
  const [isPending, startTransition] = useTransition();
  const rowsDeferred = useDeferredValue(rows);
  const [timeline, setTimeline] = useState<Array<{t:number; dps:number; hps:number}>>([]);
  
  // --- Downsample timeline for performance (target ~N points) ---
  // 30 points was too chunky visually; keep it light but readable.
  const TARGET_POINTS = 240;
  const timelineView = useMemo(
    () => downsampleToTarget(timeline, TARGET_POINTS),
    [timeline, TARGET_POINTS]
  );
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

const [pA, setPA] = useState('');
const [pB, setPB] = useState('');

const [encOpen, setEncOpen] = useState(false);
const [encLoading, setEncLoading] = useState(false);

const [psOpen, setPsOpen] = useState(false);
const [psLoading, setPsLoading] = useState(false);
const [psSelectedPlayers, setPsSelectedPlayers] = useState<string[]>([]);

const LOADER_OPEN_DELAY_MS = 1200;
const LOADER_MIN_MS = 2500;

const openSummary = React.useCallback(() => {
  console.log('[openSummary] start');
  setEncLoading(true);                          // ✅ mount the “Slicing Data…” overlay

  setTimeout(() => {
    console.log('[openSummary] opening modal');
    setEncOpen(true);                           // ✅ open the modal a bit later
  }, LOADER_OPEN_DELAY_MS);

  setTimeout(() => {
    console.log('[openSummary] hide loader');
    setEncLoading(false);                       // ✅ keep loader up long enough to see it
  }, LOADER_MIN_MS);
}, [LOADER_OPEN_DELAY_MS, LOADER_MIN_MS]);

const openPlayerSummary = React.useCallback(() => {
  // Initialize selection from current A/B picks (or keep existing)
  setPsSelectedPlayers(prev => {
    if (prev && prev.length) return prev.slice(0, 5);
    const seed = [pA, pB].filter(Boolean).slice(0, 5);
    return seed;
  });
  setPsLoading(true);
  setTimeout(() => setPsOpen(true), LOADER_OPEN_DELAY_MS);
  setTimeout(() => setPsLoading(false), LOADER_MIN_MS);
}, [LOADER_OPEN_DELAY_MS, LOADER_MIN_MS, pA, pB]);
  const [mode, setMode] = useState<'sources'|'abilities'|'statistics'|'damageTaken'>('sources'); // <- extended
  const DEATH_SNAPSHOT_SEC = 10;
const DEATH_SNAPSHOT_BIN = 1; // seconds per bin (log timestamps are second-granularity)

  const [selectedDeathKey, setSelectedDeathKey] = useState<string>('');
  const [deathBinHover, setDeathBinHover] = useState<number | null>(null);
  useEffect(() => { setDeathBinHover(null); }, [selectedDeathKey]);
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

  // PERF: throttle selection drag updates (mouse move) to one per animation frame
  const selRafRef = useRef<number | null>(null);
  const selPendingX1Ref = useRef<number | null>(null);
  const scheduleSelectingX1 = useCallback((x1: number) => {
    selPendingX1Ref.current = x1;
    if (selRafRef.current != null) return;
    selRafRef.current = requestAnimationFrame(() => {
      selRafRef.current = null;
      const nextX1 = selPendingX1Ref.current;
      if (nextX1 == null) return;
      setSelecting(s => (s ? ({ ...s, x1: nextX1 }) : s));
    });
  }, []);
  useEffect(() => {
    return () => {
      if (selRafRef.current != null) cancelAnimationFrame(selRafRef.current);
      selRafRef.current = null;
    };
  }, []);

  const handleParsingExport = useCallback(async () => {
    let exportBlob: Blob | null = null;
    try {
      if (exporting) return;
      // Fast-path: if we already have a fresh export blob, copy immediately (keeps user-gesture intact)
      const exportKeyNow = `${lastParsedTextRef.current.length}|${rows?.length ?? 0}|${segments?.length ?? 0}|${psSelectedPlayers.join(",")}|${mode}`;
      if (exportBlobRef.current && exportBlobKeyRef.current === exportKeyNow) {
        try {
          const ClipboardItemAny = (window as any).ClipboardItem;
          if (!navigator.clipboard || !ClipboardItemAny) throw new Error("Clipboard image copy not supported in this browser/context.");
          await navigator.clipboard.write([new ClipboardItemAny({ "image/png": exportBlobRef.current })]);
          setExportToast("Copied! Paste it anywhere.");
          setTimeout(() => setExportToast(null), 2500);
          return;
        } catch (e) {
          // If immediate copy fails, fall through and rebuild+retry below.
        }
      }

      setExporting(true);
      setExportToast("Building export…");

      const tStart = performance.now();

      // --- Build a stable canonicalizer (same idea as applyWindow) ---
      const GENERIC_TOKENS = new Set(["a","an","the","with","using"]);
      const LONGEST_BY_FIRST: Record<string,string> = {};
      const firstKey = (raw: string) => {
        const first = (raw || "").trim().split(/\s+/)[0] || "";
        return normName(first);
      };
      const learn = (n?: string) => {
        const raw = String(n || "").trim();
        if (!raw) return;
        const fk = firstKey(raw);
        if (!fk || GENERIC_TOKENS.has(fk)) return;
        const cur = LONGEST_BY_FIRST[fk];
        if (!cur || raw.length > cur.length) LONGEST_BY_FIRST[fk] = raw;
      };

      for (const e of damageEvents) learn(e?.src);
      for (const e of healEvents) learn(e?.src);
      for (const r of baseRows) learn(r?.name);

      const canonDyn = (n: string) => {
        const raw = String(n || "").trim();
        const fk = firstKey(raw);
        if (!fk || GENERIC_TOKENS.has(fk)) return normalizeActorName(raw);
        return normalizeActorName(LONGEST_BY_FIRST[fk] || raw);
      };

      const topN = (m: Record<string, number>, n = 5) =>
        Object.entries(m)
          .filter(([, v]) => Number.isFinite(v) && v > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, n);

      type SegSnap = {
        label: string;
        start: number;
        end: number;
        dur: number;
        dmgTop: Array<[string, number]>;
        healTop: Array<[string, number]>;
        apmTop: Array<[string, number]>;
      };

      const segs = (segments || []).filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);

      // --- Segment combining rules for export ---
      // 1) If the same segment label appears multiple times (e.g., Exar Kun split into two),
      //    merge them and sum damage/heal/action seconds across the parts.
      // 2) If there are lots of segments, collapse the classic 5-instance run into a single
      //    "OG Heroic Instances" row to keep the export readable. APM is derived from
      //    total action-seconds / total minutes (i.e., a duration-weighted average).
      const normalizeSegmentName = (label: string) => {
        const base = (label || "")
          .replace(/^\s*\d+\s*\.?\s*/g, "") // "1. " prefix
          .replace(/\s+—\s+.*$/g, "")          // anything after em dash (time range)
          .trim();
        return base;
      };

      const isOGHeroic = (name: string) => {
        const n = (name || "").toLowerCase();
        return (
          n.includes("tusken king") ||
          n.includes("axkva") || // Axkva Min
          n.includes("ig-88") || n.includes("ig 88") || n.startsWith("ig88") ||
          n.includes("exar kun") ||
          n === "isd" || n.includes(" isd") || n.includes("imperial star destroyer")
        );
      };

      type ExportSeg = {
        label: string;                 // display label
        baseName: string;              // normalized name used for grouping
        parts: typeof segs;            // original segment parts
        start: number;                 // earliest start among parts
        end: number;                   // latest end among parts
        duration: number;              // sum of part durations
      };

      const mergeByBaseName = (input: typeof segs): ExportSeg[] => {
        const groups = new Map<string, ExportSeg>();
        for (const s of input) {
          const baseName = normalizeSegmentName((s as any).label || "");
          const key = baseName || ((s as any).label || "");
          const dur = ((s as any).end - (s as any).start);
          const existing = groups.get(key);
          if (!existing) {
            groups.set(key, {
              label: (s as any).label || baseName || "Segment",
              baseName: key,
              parts: [s],
              start: (s as any).start,
              end: (s as any).end,
              duration: dur,
            });
          } else {
            existing.parts.push(s);
            existing.start = Math.min(existing.start, (s as any).start);
            existing.end = Math.max(existing.end, (s as any).end);
            existing.duration += dur;
            if ((existing.label || "").length > ((s as any).label || "").length && ((s as any).label || "").length > 0) {
              existing.label = (s as any).label;
            }
          }
        }
        return Array.from(groups.values()).sort((a, b) => a.start - b.start);
      };

      const mergeSegmentsForExport = (input: typeof segs): ExportSeg[] => {
        let merged = mergeByBaseName(input);

        if (merged.length > 5) {
          const og = merged.filter(s => isOGHeroic(s.baseName));
          const rest = merged.filter(s => !isOGHeroic(s.baseName));
          if (og.length >= 2) {
            const ogSeg: ExportSeg = {
              label: "OG Heroic Instances",
              baseName: "OG Heroic Instances",
              parts: og.flatMap(s => s.parts),
              start: Math.min(...og.map(s => s.start)),
              end: Math.max(...og.map(s => s.end)),
              duration: og.reduce((acc, s) => acc + s.duration, 0),
            };
            merged = [ogSeg, ...rest].sort((a, b) => a.start - b.start);
          }
        }

        return merged;
      };

      const exportSegs = mergeSegmentsForExport(segs);

      const MAX_SEGS = 8;
      const segsToRender = exportSegs.slice(0, MAX_SEGS);

      const snaps: SegSnap[] = segsToRender.map((s) => {
        const displayName = normalizeSegmentName(s.label || s.baseName || "Segment") || (s.label || "Segment");

        // Use per-part ranges so merged/non-contiguous segments aggregate correctly.
        const ranges = (s.parts || []).map(p => {
          const a = Math.max(0, Math.floor((p as any).start));
          const b = Math.max(a, Math.floor((p as any).end));
          return [a, b] as const;
        }).sort((a, b) => a[0] - b[0]);

        const start = ranges.length ? ranges[0][0] : Math.max(0, Math.floor(s.start));
        const end = ranges.length ? ranges[ranges.length - 1][1] : Math.max(start, Math.floor(s.end));

        const dur = Math.max(1, Math.round(s.duration || ranges.reduce((acc, r) => acc + (r[1] - r[0]), 0) || (end - start)));
        const inRanges = (t: number) => {
          for (const r of ranges) {
            if (t < r[0]) return false;
            if (t >= r[0] && t <= r[1]) return true;
          }
          return ranges.length === 0 ? (t >= start && t <= end) : false;
        };

        const dmgBy: Record<string, number> = {};
        const healBy: Record<string, number> = {};

        for (const e of damageEvents) {
          if (!e) continue;
          const t = e.t;
          if (!inRanges(t)) continue;
          const src = canonDyn(e.src);
          if (isSegmentNpcName(src)) continue;
          dmgBy[src] = (dmgBy[src] || 0) + (e.amount || 0);
        }
        for (const e of healEvents) {
          if (!e) continue;
          const t = e.t;
          if (!inRanges(t)) continue;
          const src = canonDyn(e.src);
          if (isSegmentNpcName(src)) continue;
          healBy[src] = (healBy[src] || 0) + (e.amount || 0);
        }

        // APM: count unique action-seconds (damage OR utility) per actor within the segment.
        const actionSecondsBy: Record<string, number> = {};
        const seen = new Set<string>();

        for (const e of damageEvents) {
          if (!e) continue;
          const t = e.t;
          if (!inRanges(t)) continue;
          const actor = canonDyn(e.src);
          if (isSegmentNpcName(actor)) continue;
          const k = actor + "@" + t;
          if (seen.has(k)) continue;
          seen.add(k);
          actionSecondsBy[actor] = (actionSecondsBy[actor] || 0) + 1;
        }
        for (const e of utilityEvents) {
          if (!e) continue;
          const t = (e as any).t;
          if (!Number.isFinite(t)) continue;
          if (!inRanges(t)) continue;
          const actor = canonDyn((e as any).src);
          if (isSegmentNpcName(actor)) continue;
          const k = actor + "@" + t;
          if (seen.has(k)) continue;
          seen.add(k);
          actionSecondsBy[actor] = (actionSecondsBy[actor] || 0) + 1;
        }

        const minutes = Math.max(1, dur / 60);
        const apmBy: Record<string, number> = {};
        for (const [actor, secs] of Object.entries(actionSecondsBy)) {
          apmBy[actor] = secs / minutes;
        }

        const dmgTop = topN(dmgBy, 5);
        const healTop = topN(healBy, 5);
        const apmTop = Object.entries(apmBy)
          .filter(([, v]) => Number.isFinite(v) && v > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([k, v]) => [k, Math.round(v)] as [string, number]);

        return {
          label: displayName,
          start,
          end,
          dur,
          dmgTop,
          healTop,
          apmTop,
        };
      });
      // Overall totals for the current window (same window as the export duration)
      const overallStart = Math.max(0, Math.floor(windowStart || 0));
      const overallEnd = Math.max(overallStart, Math.floor(windowEnd || 0));
      const overallDur = Math.max(1, overallEnd - overallStart + 1);

      const totalDmgBy: Record<string, number> = {};
      const totalHealBy: Record<string, number> = {};

      for (const e of damageEvents) {
        if (!e) continue;
        const t = e.t;
        if (t < overallStart || t > overallEnd) continue;
        const src = canonDyn(e.src);
        if (isSegmentNpcName(src)) continue;
        totalDmgBy[src] = (totalDmgBy[src] || 0) + (e.amount || 0);
      }
      for (const e of healEvents) {
        if (!e) continue;
        const t = e.t;
        if (t < overallStart || t > overallEnd) continue;
        const src = canonDyn(e.src);
        if (isSegmentNpcName(src)) continue;
        totalHealBy[src] = (totalHealBy[src] || 0) + (e.amount || 0);
      }

      // APM totals: unique action-seconds (damage OR utility) per actor within the window.
      const totalActionSecondsBy: Record<string, number> = {};
      const seenTotal = new Set<string>();

      for (const e of damageEvents) {
        if (!e) continue;
        const t = e.t;
        if (t < overallStart || t > overallEnd) continue;
        const actor = canonDyn(e.src);
        if (isSegmentNpcName(actor)) continue;
        const k = actor + "@" + t;
        if (seenTotal.has(k)) continue;
        seenTotal.add(k);
        totalActionSecondsBy[actor] = (totalActionSecondsBy[actor] || 0) + 1;
      }
      for (const e of utilityEvents) {
        if (!e) continue;
        const t = (e as any).t;
        if (!Number.isFinite(t)) continue;
        if (t < overallStart || t > overallEnd) continue;
        const actor = canonDyn((e as any).src);
        if (isSegmentNpcName(actor)) continue;
        const k = actor + "@" + t;
        if (seenTotal.has(k)) continue;
        seenTotal.add(k);
        totalActionSecondsBy[actor] = (totalActionSecondsBy[actor] || 0) + 1;
      }

      const overallMinutes = Math.max(1, overallDur / 60);
      const totalApmBy: Record<string, number> = {};
      for (const [actor, secs] of Object.entries(totalActionSecondsBy)) {
        totalApmBy[actor] = secs / overallMinutes;
      }

      const totalHealTop = topN(totalHealBy, 6);
      const topHealerName = totalHealTop[0]?.[0];

      let totalDmgTop = topN(totalDmgBy, 8);
      // Reserve the 8th slot for the top healer so they are always represented in the totals block.
      if (topHealerName && !totalDmgTop.some(([n]) => n === topHealerName)) {
        const healerDmg: number = (totalDmgBy as any)?.[topHealerName] ?? 0;
        if (totalDmgTop.length < 8) totalDmgTop = [...totalDmgTop, [topHealerName, healerDmg]];
        else totalDmgTop = [...totalDmgTop.slice(0, 7), [topHealerName, healerDmg]];
      }
      // Ensure max length is 8
      totalDmgTop = totalDmgTop.slice(0, 8);
      const totalApmTop = Object.entries(totalApmBy)
        .filter(([, v]) => Number.isFinite(v) && v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k, v]) => [k, Math.round(v)] as [string, number]);

      const totalDamageSum = Object.values(totalDmgBy).reduce((s, v) => s + (v || 0), 0);
      const totalHealingSum = Object.values(totalHealBy).reduce((s, v) => s + (v || 0), 0);
// Ensure class colors are available before rendering the export (so users don't need to export twice).
// These "entries" are local variables created above (totalDmgTop / totalHealTop / totalApmTop and per-segment snaps).
const dmgEntries = totalDmgTop;
const healEntries = totalHealTop;

const snapNames: string[] = snaps.flatMap((s) => [
  ...s.dmgTop.map((r) => r[0]),
  ...s.healTop.map((r) => r[0]),
  ...s.apmTop.map((r) => r[0]),
]);

const neededColorNames = Array.from(
  new Set<string>([
    ...dmgEntries.map((r) => r[0]),
    ...healEntries.map((r) => r[0]),
    ...totalApmTop.map((r) => r[0]),
    ...snapNames,
  ])
).filter((n) => !isLikelyNpcName(n));

const colorsReady = async (timeoutMs = 6000) => {
        const start = performance.now();
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        while (performance.now() - start < timeoutMs) {
          let ok = true;
          const profMap = professionByCanonRef.current || {};
          const inferMap = inferredClassesRef.current || {};
          for (const n of neededColorNames) {
            if (!n) continue;
            if (isLikelyNpcName(n)) continue;
            if (profMap[n] || inferMap[n]) continue;
            ok = false;
            break;
          }
          if (ok) return true;
          await sleep(60);
        }
        return false;
      };

      const readyNow = await colorsReady();
      if (!readyNow) {
        // Don't block exports just because class inference hasn't finished for everyone.
        // We'll export using fallback colors for any unknown classes.
        setExportToast("Some class colors are still loading — exporting with defaults.");
      }



      // --- Render an image using Canvas2D ---
      const W = 1500;
      const line = 22;
      const totalsY0 = 156;
      const maxRows = 8;
      const lineT = 18;
      // Header height needs to fit totals + lists; keep generous padding to avoid overlap.
      const headerH = totalsY0 + 26 + 22 + maxRows * lineT + 78;
      const perSegH = 220;
      const extraSegs = Math.max(0, exportSegs.length - segsToRender.length);
      const H = headerH + snaps.length * perSegH + (extraSegs ? 48 : 0) + 40;

      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No canvas context");

      // background image (same as app UI)
      const loadImg = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
        img.src = src;
      });

      let bgImg: HTMLImageElement | null = null;
      try {
        bgImg = await loadImg("/background.jpg");
      } catch {
        bgImg = null;
      }

      // background

      if (bgImg) {
        const iw = bgImg.naturalWidth || bgImg.width;
        const ih = bgImg.naturalHeight || bgImg.height;
        const s = Math.max(W / Math.max(1, iw), H / Math.max(1, ih));
        const dw = iw * s;
        const dh = ih * s;
        const dx = (W - dw) / 2;
        const dy = (H - dh) / 2;
        ctx.drawImage(bgImg, dx, dy, dw, dh);
        // darken for readability
        ctx.fillStyle = "rgba(4,8,16,0.62)";
        ctx.fillRect(0, 0, W, H);
      } else {
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, "rgba(10,18,34,1)");
        grad.addColorStop(1, "rgba(6,10,20,1)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
      }

      // subtle grid
      ctx.globalAlpha = 0.08;
      ctx.strokeStyle = "#79c7ff";
      for (let x = 0; x < W; x += 60) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 0; y < H; y += 60) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.globalAlpha = 1;

      const pad = 36;

      // title
      ctx.fillStyle = "#eaf6ff";
      ctx.font = "700 34px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText("PARSING EXPORT", pad, 54);

      ctx.fillStyle = "#9bb7df";
      ctx.font = "500 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      const now = new Date();
      ctx.fillText(now.toLocaleString(), pad, 78);

      const fullDur = toMMSS(duration || 0);
      const parseMs = (debug && (debug.parseMs ?? debug.parseTimeMs ?? debug.workerMs)) as any;
      const parseTimeTxt = Number.isFinite(parseMs) ? `${Math.round(parseMs)} ms parse` : "parse time n/a";

      ctx.fillStyle = "#bfe1ff";
      ctx.font = "600 16px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText(`Full duration: ${fullDur}  •  ${parseTimeTxt}`, pad, 110);

      ctx.fillStyle = "rgba(121,199,255,0.22)";
      ctx.fillRect(pad, 126, W - pad * 2, 1);

      // columns
      const col1 = pad;
      const col2 = Math.round(W * 0.40);
      const col3 = Math.round(W * 0.70);

      const drawBlockTitle = (t: string, x: number, y: number) => {
        ctx.fillStyle = "#d8f1ff";
        ctx.font = "700 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
        ctx.fillText(t, x, y);
      };

      const drawRow = (name: string, val: string, x: number, y: number) => {
        ctx.fillStyle = "#d7e7ff";
        ctx.font = "500 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
        ctx.fillText(name, x, y);

        ctx.fillStyle = "#eaf6ff";
        ctx.font = "700 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
        const w = ctx.measureText(val).width;
        ctx.fillText(val, x + 360 - w, y);
      };

      const rgbaFromHex = (hex: string, a: number) => {
        const h = (hex || "").replace("#", "");
        const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
        const r = parseInt(full.slice(0, 2) || "00", 16);
        const g = parseInt(full.slice(2, 4) || "00", 16);
        const b = parseInt(full.slice(4, 6) || "00", 16);
        return `rgba(${r},${g},${b},${a})`;
      };
      // Build a fast profession lookup from the already-rendered source rows.
      // This avoids a delay where inferredClasses may still be computing after a big parse.
      const professionByCanon: Record<string, string> = {};
      for (const r of baseRows as any[]) {
        const cn = canonDyn(r?.name ?? "");
        const prof = r?.profession;
        if (cn && prof && !professionByCanon[cn]) professionByCanon[cn] = prof;
      }

      // Export bar color: prefer immediate profession data; fall back to inferred classes; be resilient to name variants.
      const exportBarColor = (name: string) => {
        try {
          const cn = canonDyn(name);
          const profImmediate = professionByCanon[cn] || professionByCanon[name];

          const ic: any = (inferredClassesRef.current || {}) as any;
          const direct = ic?.[name];
          const norm = typeof normalizeActorName === "function" ? normalizeActorName(name) : name;
          const byNorm = ic?.[norm] || ic?.[cn];

          return classColor(profImmediate ?? direct ?? byNorm);
        } catch {
          return "#79c7ff";
        }
      };

      // NPC/encounter names often have these patterns; used for APM averaging fallback.

      const drawRowBar = (name: string, valNum: number, x: number, y: number, maxVal: number, valFmt?: (v:number)=>string) => {
        const val = valFmt ? valFmt(valNum) : fmt0(Math.round(valNum));
        const base = exportBarColor(name);

        // name
        ctx.save();
        ctx.font = "600 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
        ctx.fillStyle = "#d7e7ff";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.strokeText(name, x, y);
        ctx.fillText(name, x, y);
        ctx.restore();

        // bar
        // Leave a clear gap between the bar end and the number pill so viewers can see the bar's true end.
        const barX = x + 155;
        const barW = 160;
        const barH = 10;
        const barY = y - 11;
        const p = maxVal > 0 ? Math.max(0, Math.min(1, valNum / maxVal)) : 0;

        // track
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        ctx.fillRect(barX, barY, barW, barH);

        // fill (class-colored)
        const fillW = Math.max(2, Math.round(barW * p));
        ctx.fillStyle = rgbaFromHex(base, 0.88);
        ctx.fillRect(barX, barY, fillW, barH);

        // end-cap highlight so the bar end is readable even when the value pill sits nearby
        const endX = barX + fillW;
        ctx.fillStyle = rgbaFromHex(base, 1);
        ctx.fillRect(Math.max(barX, endX - 2), barY - 1, 2, barH + 2);

        // value pill (placed *outside* the bar area) so the numbers never hide the bar end
        ctx.save();
        ctx.font = "900 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
        const w = ctx.measureText(val).width;
        const gap = 12;
        const vx = barX + barW + gap;
        const pillPadX = 6;
        const pillW = w + pillPadX * 2;
        const pillH = 18;
        const pillX = vx - pillPadX;
        const pillY = y - 14;

        // rounded rect pill
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.strokeStyle = "rgba(255,255,255,0.14)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        const r = 7;
        ctx.moveTo(pillX + r, pillY);
        ctx.arcTo(pillX + pillW, pillY, pillX + pillW, pillY + pillH, r);
        ctx.arcTo(pillX + pillW, pillY + pillH, pillX, pillY + pillH, r);
        ctx.arcTo(pillX, pillY + pillH, pillX, pillY, r);
        ctx.arcTo(pillX, pillY, pillX + pillW, pillY, r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // text
        ctx.fillStyle = "#f4fbff";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.75)";
        ctx.strokeText(val, vx, y);
        ctx.fillText(val, vx, y);
        ctx.restore();
      };;


      // --- Totals (overall) -------------------------------------------------

      ctx.fillStyle = "#9bb7df";
      ctx.font = "700 13px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText("TOTALS (window)", pad, totalsY0 - 18);

      // headline totals
      ctx.fillStyle = "#eaf6ff";
      ctx.font = "800 18px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText(`Damage: ${fmt0(Math.round(totalDamageSum))}`, col1, totalsY0);
      ctx.fillText(`Healing: ${fmt0(Math.round(totalHealingSum))}`, col2, totalsY0);
      let ty = totalsY0 + 26;
      drawBlockTitle("Top damage sources", col1, ty);
      drawBlockTitle("Top healing sources", col2, ty);
      drawBlockTitle("Top APM", col3, ty);
      ty += 22;

      const maxD = Math.max(1, ...totalDmgTop.map(([,v]) => v));
      const maxH = Math.max(1, ...totalHealTop.map(([,v]) => v));
      const maxA = Math.max(1, ...totalApmTop.map(([,v]) => v));

      for (let r = 0; r < maxRows; r++) {
        const d = totalDmgTop[r];
        const h = totalHealTop[r];
        const a = totalApmTop[r];

        if (d) drawRowBar(d[0], d[1], col1, ty, maxD);
        if (h) drawRowBar(h[0], h[1], col2, ty, maxH);
        if (a) drawRowBar(a[0], a[1], col3, ty, maxA, (v)=>String(Math.round(v)));

        ty += lineT;
      }

      ctx.fillStyle = "rgba(121,199,255,0.22)";
      ctx.fillRect(pad, headerH - 18, W - pad * 2, 1);

      let y = headerH;

      snaps.forEach((s, i) => {
        // segment header pill
        const title = `${i + 1}. ${s.label}`;
        ctx.fillStyle = "rgba(33,212,253,0.12)";
        ctx.strokeStyle = "rgba(120,170,255,0.35)";
              // rounded rect helper
      const rr = (x:number,y:number,w:number,h:number,r:number) => {
        const rad = Math.min(r, w/2, h/2);
        ctx.beginPath();
        ctx.moveTo(x+rad, y);
        ctx.arcTo(x+w, y, x+w, y+h, rad);
        ctx.arcTo(x+w, y+h, x, y+h, rad);
        ctx.arcTo(x, y+h, x, y, rad);
        ctx.arcTo(x, y, x+w, y, rad);
        ctx.closePath();
      };

      ctx.fillStyle = "rgba(33,212,253,0.12)";
      ctx.strokeStyle = "rgba(120,170,255,0.35)";
      rr(pad, y - 24, W - pad * 2, 40, 14);
      ctx.fill();
      ctx.stroke();

        ctx.fillStyle = "#eaf6ff";
        ctx.font = "700 16px system-ui, -apple-system, Segoe UI, Roboto, Arial";
        ctx.fillText(title, pad + 14, y);

        ctx.fillStyle = "#9bb7df";
        ctx.font = "600 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
        const segDur = toMMSS(s.dur);
        const rightTxt = `${toMMSS(s.start)} → ${toMMSS(s.end)}  •  ${segDur}`;
        const wRight = ctx.measureText(rightTxt).width;
        ctx.fillText(rightTxt, W - pad - wRight - 10, y);

        y += 34;

        drawBlockTitle("Damage (top)", col1, y);
        drawBlockTitle("Healing (top)", col2, y);
        drawBlockTitle("APM (top)", col3, y);

        y += 22;

        const maxSegDmg = Math.max(0, ...s.dmgTop.map((v) => v[1] || 0));
        const maxSegHeal = Math.max(0, ...s.healTop.map((v) => v[1] || 0));
        const maxSegApm = Math.max(0, ...s.apmTop.map((v) => v[1] || 0));

        for (let r = 0; r < 5; r++) {
          const d = s.dmgTop[r];
          const h = s.healTop[r];
          const a = s.apmTop[r];

          if (d) drawRowBar(d[0], d[1], col1, y, maxSegDmg);
          if (h) drawRowBar(h[0], h[1], col2, y, maxSegHeal);
          if (a) drawRowBar(a[0], a[1], col3, y, maxSegApm, (v) => String(Math.round(v)));

          y += line;
        }

        y += 24;
      });

      if (extraSegs) {
        ctx.fillStyle = "#9bb7df";
        ctx.font = "600 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
        ctx.fillText(`…and ${extraSegs} more segments (export shows first ${MAX_SEGS}).`, pad, y);
        y += 26;
      }

      const tEnd = performance.now();
      const genMs = Math.round(tEnd - tStart);

      // footer
      ctx.fillStyle = "rgba(121,199,255,0.22)";
      ctx.fillRect(pad, H - 54, W - pad * 2, 1);
      ctx.fillStyle = "#9bb7df";
      ctx.font = "500 12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText(`Generated in ${genMs} ms • Paste anywhere (Discord, forums, etc.)`, pad, H - 28);

      exportBlob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Failed to encode image"))), "image/png", 1);
      });

      
      // Cache for next click (lets clipboard copy happen immediately with user gesture)
      const exportKeyBuilt = `${lastParsedTextRef.current.length}|${rows?.length ?? 0}|${segments?.length ?? 0}|${psSelectedPlayers.join(",")}|${mode}`;
      exportBlobRef.current = exportBlob;
      exportBlobKeyRef.current = exportKeyBuilt;

      const ClipboardItemAny = (window as any).ClipboardItem;
      if (!navigator.clipboard || !ClipboardItemAny) {
        throw new Error("Clipboard image copy not supported in this browser/context.");
      }

      if (!exportBlob) throw new Error("Failed to encode image.");

      await navigator.clipboard.write([new ClipboardItemAny({ "image/png": exportBlob })]);

      setExportToast("Copied! Paste it anywhere.");
      setTimeout(() => setExportToast(null), 2500);
    } catch (e: any) {
      console.error(e);
      const msg = (e && (e.name || e.message)) ? String(e.name || e.message) : "";
      const denied = /NotAllowedError/i.test(msg) || /permission denied/i.test(msg) || /Write permission denied/i.test(msg);
      if (denied && exportBlob) {
        // Fallback: download the PNG instead of copying (image clipboard write is permission-gated in browsers).
        try {
          const url = URL.createObjectURL(exportBlob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `parsing-export-${Date.now()}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          setExportToast("Clipboard blocked by browser — downloaded PNG instead.");
          setTimeout(() => setExportToast(null), 4000);
          return;
        } catch (dlErr) {
          // fall through to normal error toast
        }
      }

      setExportToast(e?.message ? `Export failed: ${e.message}` : "Export failed.");
      setTimeout(() => setExportToast(null), 4000);
    } finally {
      setExporting(false);
    }
  }, [exporting, segments, damageEvents, healEvents, utilityEvents, duration, debug, baseRows]);


  const [hoverX, setHoverX] = useState<number | null>(null);

  // PERF: throttle high-frequency hover updates to one per animation frame
  const hoverRafRef = useRef<number | null>(null);
  const hoverPendingRef = useRef<number | null>(null);
  const scheduleHoverX = useCallback((next: number | null) => {
    hoverPendingRef.current = next;
    if (hoverRafRef.current != null) return;
    hoverRafRef.current = requestAnimationFrame(() => {
      hoverRafRef.current = null;
      setHoverX(hoverPendingRef.current);
    });
  }, []);
  useEffect(() => {
    return () => {
      if (hoverRafRef.current != null) cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = null;
    };
  }, []);


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

  // Abilities table scroll perf (virtualized rows)
  const abilitiesScrollRef = useRef<HTMLDivElement | null>(null);
  const [abilitiesScrollTop, setAbilitiesScrollTop] = useState(0);
  const [abilitiesViewportH, setAbilitiesViewportH] = useState(640);
  const abilitiesScrollRaf = useRef<number | null>(null);

  const onAbilitiesScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (abilitiesScrollRaf.current != null) cancelAnimationFrame(abilitiesScrollRaf.current);
    abilitiesScrollRaf.current = requestAnimationFrame(() => {
      setAbilitiesScrollTop(el.scrollTop);
    });
  }, []);

  useEffect(() => {
    const el = abilitiesScrollRef.current;
    if (!el || typeof (window as any).ResizeObserver === "undefined") return;

    const ro = new (window as any).ResizeObserver(() => {
      setAbilitiesViewportH(el.clientHeight || 640);
    });
    ro.observe(el);
    setAbilitiesViewportH(el.clientHeight || 640);
    return () => ro.disconnect();
  }, []);


  /* -------------------- worker / parsing -------------------- */
  
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
          damageEvents, healEvents, utilityEvents, deathEvents
        , actors: actorsFromWorker} = msg.payload;

        // --- Canonicalize actor names to avoid split identities like "Minerva" vs "Minerva'" ---
        // Base canonicalization: strip token-terminal apostrophes ("Name'" / "Name' Testing" => "Name" / "Name Testing").
        const canonActorBase = (n?: string) => stripTrailingApostrophe(String(n || '').trim());

        // Merge PlayerRow[] by canonical actor name
        const mergedRows: PlayerRow[] = (() => {
          const by = new Map<string, PlayerRow>();
          for (const r of (rws || [])) {
            const can = canonActorBase(r?.name);
            if (!can) continue;
            const cur = by.get(can);
            if (!cur) {
              by.set(can, { ...r, name: can });
            } else {
              cur.damageDealt += Number(r.damageDealt || 0);
              cur.healingDone += Number(r.healingDone || 0);
              // prefer a real profession if one exists
              if (!cur.profession && r.profession) cur.profession = r.profession;
            }
          }
          // recompute avgDps from merged damage if possible
          const dur = Number(duration || 0);
          for (const v of by.values()) {
            v.avgDps = dur > 0 ? (v.damageDealt / dur) : Number(v.avgDps || 0);
          }
          return Array.from(by.values());
        })();

        // Secondary canonicalization:
        // Some logs include suffixes like "Testing" for the same character (e.g. "Minerva' Testing").
        // If stripping the suffix matches a known merged player name, collapse to that base name.
        const mergedNameSet = new Set<string>(mergedRows.map(r => String(r.name || '').trim()).filter(Boolean));
        const canonActor = (n?: string) => {
          const base = canonActorBase(n);
          if (!base) return '';
          const maybe = base.replace(/\s+testing\s*$/i, '').trim();
          return (maybe && maybe !== base && mergedNameSet.has(maybe)) ? maybe : base;
        };

        const mergeNumArray = (a: number[] | undefined, b: number[] | undefined) => {
          const A = a || [];
          const B = b || [];
          const n = Math.max(A.length, B.length);
          const out = new Array(n).fill(0);
          for (let i = 0; i < n; i++) out[i] = (A[i] || 0) + (B[i] || 0);
          return out;
        };

        const mergedPerSrc: Record<string, number[]> = (() => {
          const out: Record<string, number[]> = {};
          for (const [k, arr] of Object.entries(perSrc || {})) {
            const can = canonActor(k);
            if (!can) continue;
            out[can] = mergeNumArray(out[can], arr);
          }
          return out;
        })();

        const mergedPerTaken: Record<string, number> = (() => {
          const out: Record<string, number> = {};
          for (const [k, v] of Object.entries(perTaken || {})) {
            const can = canonActor(k);
            if (!can) continue;
            out[can] = (out[can] || 0) + Number(v || 0);
          }
          return out;
        })();

        const mergedPerTakenBy: Record<string, Record<string, number>> = (() => {
          const out: Record<string, Record<string, number>> = {};
          for (const [victim, by] of Object.entries(perTakenBy || {})) {
            const vCan = canonActor(victim);
            if (!vCan) continue;
            if (!out[vCan]) out[vCan] = {};
            for (const [src, amt] of Object.entries(by || {})) {
              const sCan = canonActor(src);
              if (!sCan) continue;
              out[vCan][sCan] = (out[vCan][sCan] || 0) + Number(amt || 0);
            }
          }
          return out;
        })();

        const mergedPerAbilityRaw: PerAbility = (() => {
          const out: PerAbility = {};
          for (const [actor, abilMap] of Object.entries(perAbility || {})) {
            const aCan = canonActor(actor);
            if (!aCan) continue;
            if (!out[aCan]) out[aCan] = {};
            for (const [abil, stats] of Object.entries(abilMap || {})) {
              const cur = out[aCan][abil] || { hits: 0, dmg: 0, max: 0 };
              cur.hits += Number((stats as any)?.hits || 0);
              cur.dmg  += Number((stats as any)?.dmg || 0);
              cur.max   = Math.max(cur.max, Number((stats as any)?.max || 0));
              out[aCan][abil] = cur;
            }
          }
          return out;
        })();

        const mergedPerAbilityTargetsRaw: PerAbilityTargets = (() => {
          const out: PerAbilityTargets = {};
          for (const [actor, abilMap] of Object.entries(pat || {})) {
            const aCan = canonActor(actor);
            if (!aCan) continue;
            if (!out[aCan]) out[aCan] = {};
            for (const [abil, tgtMap] of Object.entries(abilMap || {})) {
              if (!out[aCan][abil]) out[aCan][abil] = {};
              for (const [tgt, stats] of Object.entries(tgtMap || {})) {
                const tCan = canonActor(tgt);
                if (!tCan) continue;
                const cur = out[aCan][abil][tCan] || { hits: 0, dmg: 0, max: 0 };
                cur.hits += Number((stats as any)?.hits || 0);
                cur.dmg  += Number((stats as any)?.dmg || 0);
                cur.max   = Math.max(cur.max, Number((stats as any)?.max || 0));
                out[aCan][abil][tCan] = cur;
              }
            }
          }
          return out;
        })();

        const mergedDamageEvents: DFEvent[] = (damageEvents || []).map((e: any) => ({
          ...e,
          src: canonActor(e?.src),
          dst: canonActor(e?.dst),
          target: canonActor(e?.target),
          victim: canonActor(e?.victim),
          defender: canonActor(e?.defender),
        }));

        const mergedHealEvents: HealEvent[] = (healEvents || []).map((e: any) => ({
          ...e,
          src: canonActor(e?.src),
          dst: canonActor(e?.dst),
        }));

        const mergedUtilityEvents: UtilityEvent[] = (utilityEvents || []).map((e: any) => ({
          ...e,
          src: canonActor(e?.src),
        }));

        const mergedDeathEvents = (deathEvents || []).map((e: any) => ({
          ...e,
          name: canonActor(e?.name),
        }));

        const mergedActors = Array.isArray(actorsFromWorker)
          ? Array.from(new Set(actorsFromWorker.map((x: any) => canonActor(x)).filter(Boolean)))
          : [];

        const { pa: basePaNorm, pat: basePatNorm } =
          mergeNormalizedAbilities(mergedPerAbilityRaw || {}, mergedPerAbilityTargetsRaw || {});

        setBaseRows(mergedRows); setBaseTimeline(tl);
        setBasePerSrc(mergedPerSrc||{});
        setBasePerAbility(basePaNorm);
        setBasePerAbilityTargets(basePatNorm);
        setBasePerTaken(mergedPerTaken||{});
        setBasePerTakenBy(mergedPerTakenBy||{});
        setDamageEvents(mergedDamageEvents||[]);
        setHealEvents(mergedHealEvents||[]);
        const utilFromWorker = utilityEvents || [];
        const utilFallback = (!utilFromWorker.length && lastParsedTextRef.current)
          ? extractUtilityEventsFromPerforms(lastParsedTextRef.current)
          : utilFromWorker;
        setUtilityEvents(mergedUtilityEvents.length ? mergedUtilityEvents : utilFallback.map(e => ({ ...e, src: canonActor((e as any)?.src) })));
        setDeathEvents(mergedDeathEvents||[]);
        setDuration(duration||0);
        setDebug(debug);
        setActorsSeen(mergedActors);

        const segs = deriveSegments(tl, mergedDamageEvents||[], idleGap);
        setSegments(segs);
        setSegIndex(-1);

        const start = tl?.[0]?.t ?? 0;
        const end   = tl?.length ? tl[tl.length-1].t : duration;
        applyWindow({ start, end }, {
          tl, rows: mergedRows, perSrc: mergedPerSrc, perAbility: basePaNorm, pat: basePatNorm, perTaken: mergedPerTaken, perTakenBy: mergedPerTakenBy, duration
        });

        setPA(a=> mergedRows.find(v=>v.name===canonActor(a))?.name || '');
        setPB(b=> mergedRows.find(v=>v.name===canonActor(b))?.name || '');

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
    setExportReady(false);
    lastParsedTextRef.current = text;
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

    


// --- Dynamic player aliasing (merge short vs full names safely) ---
// Generic first words we should never use for aliasing (NPC phrases)
// NOTE: use normName() so "Renn" and "Renn'" share the same key.
const GENERIC_TOKENS = new Set(['a','an','the','with','using']);
const LONGEST_BY_FIRST: Record<string,string> = {};
const firstKey = (raw:string) => {
  const first = (raw||'').trim().split(/\s+/)[0] || '';
  return normName(first); // strips quotes/apostrophes/punct
};
const learn = (n?:string) => {
  const raw = String(n||'').trim(); if (!raw) return;
  const fk = firstKey(raw);
  if (!fk || GENERIC_TOKENS.has(fk)) return;
  const cur = LONGEST_BY_FIRST[fk];
  if (!cur || raw.length > cur.length) LONGEST_BY_FIRST[fk] = raw;
};
dE.forEach(e => learn(e.src));
hE.forEach(e => learn(e.src));
(base.rows||[]).forEach(r => learn(r.name));

const canonDyn = (n:string) => {
  const raw = String(n||'').trim();
  const fk = firstKey(raw);
  if (!fk || GENERIC_TOKENS.has(fk)) return normalizeActorName(raw);
  return normalizeActorName(LONGEST_BY_FIRST[fk] || raw);
};
// rows (canonicalized)
    const dmgBySrc: Record<string, number> = {};
    const healBySrc: Record<string, number> = {};
    for (const e of dE){
      const src = canonDyn(e.src);
      dmgBySrc[src] = (dmgBySrc[src]||0) + e.amount;
    }
    for (const e of hE){
      const src = canonDyn(e.src);
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
      const src = canonDyn(e.src);
      if (!byActorPS[src]) byActorPS[src] = [];
      byActorPS[src][sec] = (byActorPS[src][sec]||0) + e.amount;
    }
    setPerSrc(byActorPS);

    // abilities per actor (normalized ability + canonicalized target/source)
    const pa: PerAbility = {};
    const pat: PerAbilityTargets = {};
    for (const e of dE){
      const actor = canonDyn(e.src);
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
      const src = canonDyn(e.src);
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

  // Alphabetize and de-duplicate the comparison dropdown
  // Alphabetize and de-duplicate the comparison dropdown
  const names = useMemo(() => {
    const bad  = /^(with|using)\s/i;
    const keep = /^(Element of\s+(Acid|Cold|Electricity|Heat))$/i;

    // Also strip common trailing apostrophe variants (logs sometimes emit "Name'" as the same actor)
    const clean = (s: string) => stripTrailingApostrophe((s || '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,''))
      .replace(/\s+and\s.+$/i,'')
      .replace(/\([^\)]*\)/g,'')
      .replace(/\s{2,}/g,' ')
      .trim();

    const keyOf = (s: string) => clean(s)
      .toLowerCase()
      .replace(/\./g,'')                 // strip periods
      .replace(/^cmdr\s*/, 'commander ') // normalize Cmdr variants
      .replace(/\s+/g,' ')               // collapse spaces
      .replace(/^an\s+/, 'an ')          // normalize An/an
      .trim();

    const fromRows   = (rows ?? []).map(r => r.name);
    const fromTaken  = Object.keys(perTaken ?? {});
    const fromActors = actorsSeen ?? [];
    const arr  = [...fromRows, ...fromTaken, ...fromActors].map(clean);

    const pick = new Map<string,string>();
    for (const n of arr) {
      if (!n || (bad.test(n) && !keep.test(n))) continue;
      const k = keyOf(n);
      const cur = pick.get(k);
      if (!cur) { pick.set(k, n); continue; }
      const prefUpper = /^[A-Z]/.test(n) && !/^[A-Z]/.test(cur);
      const longer    = n.length > cur.length;
      if (prefUpper || longer) pick.set(k, n);
    }

        // If the log sometimes emits a short player name ("Renn") and other times a full name ("Renn Kaizer"),
    // prefer the full name when it is an unambiguous extension of the short name.
    const vals = Array.from(pick.values());

    const normFirst = (s: string) => normName(clean(s).split(/\s+/)[0] || '');
    const byFirst: Record<string, string[]> = {};
    for (const v of vals) {
      const k = normFirst(v);
      if (!k) continue;
      (byFirst[k] ||= []).push(v);
    }

    const final: string[] = [];
    const dropped = new Set<string>();
    for (const v of vals) {
      if (dropped.has(v)) continue;
      const parts = clean(v).split(/\s+/).filter(Boolean);
      if (parts.length === 1) {
        const k = normFirst(v);
        const cands = (byFirst[k] || []).filter(x =>
          clean(x).length > clean(v).length &&
          clean(x).toLowerCase().startsWith(clean(v).toLowerCase() + ' ')
        );
        // Only merge when there is exactly one longer candidate.
        if (cands.length === 1) {
          dropped.add(v);
          continue;
        }
      }
      final.push(v);
    }

    // Ensure the preferred longest name exists for any dropped short key.
    for (const arr2 of Object.values(byFirst)) {
      const longest = arr2.slice().sort((a,b)=> clean(b).length - clean(a).length)[0];
      const hadDroppedShort = arr2.some(x => dropped.has(x));
      if (hadDroppedShort && longest && !final.includes(longest)) final.push(longest);
    }

    return final.sort((a,b)=> a.localeCompare(b, undefined, {sensitivity:'base'}));
  }, [rows, perTaken, actorsSeen]);

  const listDamage = useMemo(()=> barData(rows, metric), [rows, metric]);
  const listHealing = useMemo(()=> barData(rows, 'healingDone'), [rows]);
  const inferredClasses = useMemo(()=> inferClasses(rows, perAbility), [rows, perAbility]);


  // Keep refs so async export waits always see latest inferred/profession maps (avoid stale closures).
  const inferredClassesRef = useRef<Record<string, string>>({});
  const professionByCanonRef = useRef<Record<string, string>>({});

  useEffect(() => { inferredClassesRef.current = inferredClasses || {}; }, [inferredClasses]);
  useEffect(() => {
    // Build a resilient profession lookup for async export color readiness checks.
    // We include both raw and canonicalized names to survive apostrophes/variants.
    const src = inferredClasses || ({} as Record<string, string>);
    const out: Record<string, string> = {};
    for (const [rawName, prof] of Object.entries(src)) {
      if (!rawName || !prof) continue;
      out[rawName] = prof;
      try {
        const canon = canonEntity(rawName);
        out[canon] = prof;
      } catch {
        // ignore
      }
    }
    professionByCanonRef.current = out;
  }, [inferredClasses]);

  // Mark export as ready once we have a finished parse + computed class inference.
  // Use rAF to ensure React has committed the render containing inferredClasses.
  useEffect(() => {
    if (parsing) return;
    if (!segments?.length) return;
    if (!rows?.length) return;
    const hasAny = inferredClasses && Object.keys(inferredClasses).length > 0;
    if (!hasAny) return;
    const id = requestAnimationFrame(() => setExportReady(true));
    return () => cancelAnimationFrame(id);
  }, [parsing, segments, rows, inferredClasses]);

// PlayerSummary expects Player objects (name + optional profession). Build it from parsed events, then attach inferred class.
const playersForSummary = useMemo(() => {
  const set = new Set<string>();
  for (const e of damageEvents) if (e?.src) set.add(normalizeActorName(e.src));
  for (const e of healEvents) if (e?.src) set.add(normalizeActorName(e.src));
  for (const e of utilityEvents) if (e?.src) set.add(normalizeActorName(e.src));
  for (const d of deathEvents) if (d?.name) set.add(normalizeActorName(d.name));

  return Array.from(set)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map(name => ({ name, profession: inferredClasses?.[name] }));
}, [damageEvents, healEvents, utilityEvents, deathEvents, inferredClasses]);



  const playersWithInferredClass = useMemo(() => (
    (rows || [])
      .filter(r => !!r?.name && !!inferredClasses[r.name])
      .filter(r => ALLOWED_CLASSES.has(String(inferredClasses[r.name]).toLowerCase()))
      .map(r => r.name)
  ), [rows, inferredClasses, ALLOWED_CLASSES]);
// APM should ignore travel/idle downtime between segments; use derived segments as the active-time denominator.
  // IMPORTANT: For APM we count "activity seconds" (button-press-like activity), not raw event lines.
  // We include: damage seconds (perSrc) + utility seconds ("performs X" utilityEvents). We explicitly do NOT include heal tick lines.
  const apmPerSecond = useMemo(() => {
    const out: Record<string, number[]> = {};
    const winStart = timeline.length ? timeline[0].t : 0;
    const winEnd = timeline.length ? timeline[timeline.length - 1].t : duration;

    // Damage activity (per second)
    for (const [actor, series] of Object.entries(perSrc || {})) {
      const s = series || [];
      const act = canonDyn(actor);
      if (!act) continue;
      if (!out[act]) out[act] = [];
      for (let t = winStart; t <= winEnd; t++) {
        if ((s[t] || 0) > 0) out[act][t] = 1;
      }
    }

    // Utility activity ("performs ...")
    for (const ev of utilityEvents || []) {
      const actorRaw = String(ev?.src || "").trim();
      const actor = canonDyn(actorRaw);
      if (!actor) continue;
      const t = (ev?.t ?? -1) | 0;
      if (t < winStart || t > winEnd) continue;
      if (!out[actor]) out[actor] = [];
      out[actor][t] = 1;
    }

    return out;
  }, [perSrc, utilityEvents, timeline, duration]);

  const listAPM = useMemo(
    () => actionsPerMinute(apmPerSecond, timeline, duration, segments),
    [apmPerSecond, timeline, duration, segments]
  );

  // Build a per-player explanation map so the Sources APM panel can show "why" a player is higher.
  const apmBreakdownByPlayer = useMemo(() => {
    const winStart = timeline.length ? timeline[0].t : 0;
    const winEnd = timeline.length ? timeline[timeline.length - 1].t : duration;
    const maxT = Math.max(duration, winEnd);

    // active mask (segments ∩ window)
    const active = new Uint8Array(maxT + 1);
    if (!segments || !segments.length) {
      for (let t = winStart; t <= winEnd && t <= maxT; t++) active[t] = 1;
    } else {
      for (const seg of segments) {
        const a = Math.max(winStart, seg.start);
        const b = Math.min(winEnd, seg.end);
        for (let t = a; t <= b && t <= maxT; t++) active[t] = 1;
      }
    }
    let activeSeconds = 0;
    for (let t = winStart; t <= winEnd && t <= maxT; t++) if (active[t]) activeSeconds++;
    activeSeconds = Math.max(1, activeSeconds);
    const minutes = Math.max(1, activeSeconds / 60);

    // precompute util seconds per player
    const utilSec: Record<string, Uint8Array> = {};
    for (const ev of utilityEvents || []) {
      const actorRaw = String(ev?.src || "").trim();
      const actor = canonDyn(actorRaw);
      if (!actor) continue;
      const t = (ev?.t ?? -1) | 0;
      if (t < winStart || t > winEnd || t > maxT) continue;
      if (!utilSec[actor]) utilSec[actor] = new Uint8Array(maxT + 1);
      utilSec[actor][t] = 1;
    }

    // precompute damage seconds per player
    const dmgSec: Record<string, Uint8Array> = {};
    for (const [actorRaw, series] of Object.entries(perSrc || {})) {
      const s = series || [];
      const actor = canonDyn(actorRaw);
      if (!actor) continue;
      const arr = new Uint8Array(maxT + 1);
      for (let t = winStart; t <= winEnd && t <= maxT; t++) {
        if ((s[t] || 0) > 0) arr[t] = 1;
      }
      // merge if multiple aliases map to same canonical
      if (dmgSec[actor]) {
        const cur = dmgSec[actor];
        for (let t = winStart; t <= winEnd && t <= maxT; t++) if (arr[t]) cur[t] = 1;
      } else {
        dmgSec[actor] = arr;
      }
    }

    // top abilities by "activations" (dedup per (actor, second, ability))
    const dmgActs: Record<string, Record<string, number>> = {};
    const dmgSeen = new Set<string>();
    for (const e of damageEvents || []) {
      const actorRaw = String(e?.src || "").trim();
      const actor = canonDyn(actorRaw);
      const t = (e?.t ?? -1) | 0;
      if (!actor || t < winStart || t > winEnd || t > maxT) continue;
      if (!active[t]) continue;
      const abil = normalizeAbilityName(String(e?.ability || "Unknown"));
      const key = actor + "|" + t + "|" + abil;
      if (dmgSeen.has(key)) continue;
      dmgSeen.add(key);
      dmgActs[actor] = dmgActs[actor] || {};
      dmgActs[actor][abil] = (dmgActs[actor][abil] || 0) + 1;
    }

    const utilActs: Record<string, Record<string, number>> = {};
    const utilSeen = new Set<string>();
    for (const e of utilityEvents || []) {
      const actorRaw = String(e?.src || "").trim();
      const actor = canonDyn(actorRaw);
      const t = (e?.t ?? -1) | 0;
      if (!actor || t < winStart || t > winEnd || t > maxT) continue;
      if (!active[t]) continue;
      const abil = normalizeAbilityName(String(e?.ability || "Unknown"));
      const key = actor + "|" + t + "|" + abil;
      if (utilSeen.has(key)) continue;
      utilSeen.add(key);
      utilActs[actor] = utilActs[actor] || {};
      utilActs[actor][abil] = (utilActs[actor][abil] || 0) + 1;
    }

    const out: Record<string, any> = {};
    const allPlayers = new Set<string>([
      ...Object.keys(apmPerSecond || {}),
      ...Object.keys(dmgSec || {}),
      ...Object.keys(utilSec || {}),
    ]);

    // Compute per *canonical* actor key, then expose under any alias key present in the window.
    const computedByCanon: Record<string, any> = {};

    for (const name of allPlayers) {
      const canon = canonDyn(name);
      if (!canon) continue;

      if (!computedByCanon[canon]) {
        const dArr = dmgSec[canon] || new Uint8Array(maxT + 1);
        const uArr = utilSec[canon] || new Uint8Array(maxT + 1);
      let dmgSeconds = 0, utilSeconds = 0, overlap = 0, actionSeconds = 0;
      for (let t = winStart; t <= winEnd && t <= maxT; t++) {
        if (!active[t]) continue;
        const d = dArr[t] ? 1 : 0;
        const u = uArr[t] ? 1 : 0;
        if (d) dmgSeconds++;
        if (u) utilSeconds++;
        if (d && u) overlap++;
        if (d || u) actionSeconds++;
      }
      const apm = actionSeconds / minutes;

      let topDamage = Object.entries(dmgActs[canon] || {})
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .slice(0, 5)
        .map(([ability, count]) => ({ ability, count }));

      // Fallback: some logs only emit reliable ability names in the aggregated perAbility table
      // (e.g. many damageEvents lines collapse to "periodic"). If we only see "periodic"
      // here, show top abilities by hits so users still get a useful breakdown.
      let topDamageMode: 'activations' | 'hits' = 'activations';
      const onlyPeriodic = (topDamage.length <= 1) && (topDamage[0]?.ability === 'periodic' || topDamage[0]?.ability === '' || topDamage[0]?.ability === 'unknown');
      if (onlyPeriodic) {
        const abilMap = (perAbility as any)?.[canon] || (perAbility as any)?.[name] || {};
        const alt = Object.entries(abilMap)
          .map(([ability, stats]: any) => ({ ability: String(ability), count: Number(stats?.hits || 0) }))
          .filter(x => x.ability && x.count > 0)
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);
        if (alt.length) {
          topDamage = alt;
          topDamageMode = 'hits';
        }
      }
      const topUtility = Object.entries(utilActs[canon] || {})
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .slice(0, 5)
        .map(([ability, count]) => ({ ability, count }));

        computedByCanon[canon] = {
        winStart,
        winEnd,
        activeSeconds,
        minutes,
        apm: Math.round(apm),
        dmgSeconds,
        utilSeconds,
        overlap,
        actionSeconds,
        topDamage,
        topDamageMode,
        topUtility,
        };
      }

      // Expose under both the alias key and the canonical key so tooltips work
      // even if charts/dropdowns use a shorter variant.
      out[name] = computedByCanon[canon];
      out[canon] = computedByCanon[canon];
    }
    return out;
  }, [apmPerSecond, perSrc, utilityEvents, damageEvents, timeline, duration, segments, perAbility]);

  

const healingBreakdownByPlayer = useMemo(() => {
  const out: Record<string, any> = {};
  const totalsByCanon: Record<string, number> = {};
  const perSecondByCanon: Record<string, Record<number, number>> = {};
  const castsByCanon: Record<string, Set<string>> = {};
  const topTargetsByCanon: Record<string, Record<string, number>> = {};
  const topAbilitiesByCanon: Record<string, Record<string, number>> = {};
  const largestByCanon: Record<string, number> = {};

  const wStart = windowStart ?? 0;
  const wEnd = windowEnd ?? duration;

  for (const ev of (healEvents || [])) {
    const t = Number(ev?.t ?? 0);
    if (t < wStart || t > wEnd) continue;

    const src = canonDyn(String(ev?.src || "").trim());
    if (!src) continue;

    const dst = canonDyn(String(ev?.dst || "").trim()) || String(ev?.dst || "").trim() || "(Unknown)";
    const abilityRaw = String(ev?.ability || "").trim();
    const ability = normalizeAbilityKey(abilityRaw) || abilityRaw || "(Unknown)";
    const amt = Number(ev?.amount ?? 0);
    if (!Number.isFinite(amt) || amt <= 0) continue; // ignore 0/neg heals for now

    totalsByCanon[src] = (totalsByCanon[src] || 0) + amt;

    if (!perSecondByCanon[src]) perSecondByCanon[src] = {};
    perSecondByCanon[src][t] = (perSecondByCanon[src][t] || 0) + amt;

    if (!castsByCanon[src]) castsByCanon[src] = new Set();
    // Casts are deduped by (second, ability) to avoid inflating multi-target/tick healing
    castsByCanon[src].add(`${t}|${ability}`);

    if (!topTargetsByCanon[src]) topTargetsByCanon[src] = {};
    topTargetsByCanon[src][dst] = (topTargetsByCanon[src][dst] || 0) + amt;

    if (!topAbilitiesByCanon[src]) topAbilitiesByCanon[src] = {};
    topAbilitiesByCanon[src][ability] = (topAbilitiesByCanon[src][ability] || 0) + amt;

    largestByCanon[src] = Math.max(largestByCanon[src] || 0, amt);
  }

  for (const [canon, total] of Object.entries(totalsByCanon)) {
    const perSec = perSecondByCanon[canon] || {};
    const activeSeconds = Object.values(perSec).filter(v => (v || 0) > 0).length;
    const burstiest1s = Math.max(0, ...Object.values(perSec));
    const casts = castsByCanon[canon]?.size || 0;

    const topTargets = Object.entries(topTargetsByCanon[canon] || {})
      .sort((a,b)=>b[1]-a[1]).slice(0,5)
      .map(([name, v]) => ({ name, v }));
    const topAbilities = Object.entries(topAbilitiesByCanon[canon] || {})
      .sort((a,b)=>b[1]-a[1]).slice(0,5)
      .map(([name, v]) => ({ name, v }));

    out[canon] = {
      total,
      casts,
      activeSeconds,
      hpsActive: activeSeconds ? total / activeSeconds : 0,
      burstiest1s,
      largest: largestByCanon[canon] || 0,
      topTargets,
      topAbilities,
      wStart,
      wEnd,
    };
  }

  return out;
}, [healEvents, windowStart, windowEnd, duration, segments, timeline]);

const healingTooltipContent = useCallback((tp: any) => {
  if (!tp?.active) return null;
  const payload = tp?.payload || [];
  const name = payload?.[0]?.payload?.name || tp?.label;
  const canon = canonDyn(String(name || "").trim()) || String(name || "").trim();
  const info = healingBreakdownByPlayer?.[canon] || healingBreakdownByPlayer?.[String(name || "")];

  const tFmt = (s:number)=>{
    const m = Math.floor((s||0)/60);
    const ss = String(Math.max(0,(s||0)%60)).padStart(2,'0');
    return `${m}:${ss}`;
  };
  const fmt0Local = (n:number)=> (Number.isFinite(n) ? Math.round(n).toLocaleString() : "0");

  if (!info) {
    return (
      <SmartTooltipBox depKey={`heal:${String(name||"")}`} cardId={`${mode}:Healing Done`}>
      <div style={{ background:"rgba(9,14,24,.96)", border:"1px solid rgba(120,170,255,.35)", padding:16, borderRadius:14, color:"#cfe3ff", width:560, boxShadow:"0 18px 60px rgba(0,0,0,.55), 0 0 0 1px rgba(98,176,255,.12) inset" }}>
        <div style={{ fontWeight:800 }}>{String(name||"")}</div>
        <div style={{ opacity:.8, fontSize:12, marginTop:6 }}>No healing breakdown available for this player in the current window.</div>
      </div>
      </SmartTooltipBox>
    );
  }

  const line = (label:string, value:any) => (
    <div style={{ display:"flex", justifyContent:"space-between", gap:12, fontSize:12, marginTop:4 }}>
      <div style={{ opacity:.85 }}>{label}</div>
      <div style={{ fontWeight:700 }}>{value}</div>
    </div>
  );

  return (
    <SmartTooltipBox depKey={`heal:${String(name||"")}:${info.total}:${info.casts}`} cardId={`${mode}:Healing Done`}>
    <div style={{ background:"rgba(9,14,24,.96)", border:"1px solid rgba(120,170,255,.35)", padding:18, borderRadius:16, color:"#cfe3ff", width:640, boxShadow:"0 18px 60px rgba(0,0,0,.55), 0 0 0 1px rgba(98,176,255,.12) inset" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:10 }}>
        <div style={{ fontSize:26, fontWeight:900, letterSpacing:.2 }}>{String(name||"")}</div>
        <div style={{ fontSize:18, fontWeight:800, color:"#d9ecff" }}>HPS {Number(info.total / Math.max(1,(info.wEnd-info.wStart)||duration||1)).toFixed(1)}</div>
      </div>
      <div style={{ opacity:.8, fontSize:12, marginTop:4 }}>
        Window {tFmt(info.wStart)}–{tFmt(info.wEnd)} • {(((info.wEnd-info.wStart)||0)/60).toFixed(1)} min
      </div>

      <div style={{ marginTop:12, display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
        <div>
          {line("Total healing", fmt0Local(info.total))}
          {line("Healing casts (est.)", fmt0Local(info.casts))}
          {line("Active healing seconds", fmt0Local(info.activeSeconds))}
          {line("HPS during active", info.hpsActive ? info.hpsActive.toFixed(1) : "0.0")}
          {line("Burstiest 1s (total)", fmt0Local(info.burstiest1s))}
          {line("Largest single heal", fmt0Local(info.largest))}
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
          <div>
            <div style={{ fontSize:13, fontWeight:900, opacity:.9, marginBottom:6 }}>Top targets healed</div>
            {(info.topTargets || []).map((r:any)=>(
              <div key={r.name} style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginTop:4 }}>
                <div style={{ opacity:.9 }}>{r.name}</div>
                <div style={{ fontWeight:800 }}>{fmt0Local(r.v)}</div>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize:13, fontWeight:900, opacity:.9, marginBottom:6 }}>Top healing abilities</div>
            {(info.topAbilities || []).map((r:any)=>(
              <div key={r.name} style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginTop:4 }}>
                <div style={{ opacity:.9 }}>{r.name}</div>
                <div style={{ fontWeight:800 }}>{fmt0Local(r.v)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ opacity:.65, fontSize:11, marginTop:10 }}>
        Note: “Casts” are deduped by (second, ability) to avoid inflating multi-target/tick healing.
      </div>
    </div>
  </SmartTooltipBox>
  );
}, [healingBreakdownByPlayer, windowStart, windowEnd, duration, mode]);

const apmTooltipContent = useCallback((tp: any) => {
    if (!tp?.active) return null;
    const payload = tp?.payload || [];
    const name = payload?.[0]?.payload?.name || tp?.label;
    const info = apmBreakdownByPlayer?.[name];
    if (!info) return (
      <SmartTooltipBox depKey={`apm:${String(name||"")}`} cardId={`${mode}:APM`}>
      <div style={{ background:"rgba(9,14,24,.96)", border:"1px solid rgba(120,170,255,.35)", padding:16, borderRadius:14, color:"#cfe3ff", width:560, boxShadow:"0 18px 60px rgba(0,0,0,.55), 0 0 0 1px rgba(98,176,255,.12) inset" }}>
        <div style={{ fontWeight:800 }}>{String(name||"")}</div>
        <div style={{ opacity:.8, fontSize:12, marginTop:6 }}>No APM breakdown available for this player in the current window.</div>
      </div>
      </SmartTooltipBox>
    );

    const tFmt = (s:number)=>{
      const m = Math.floor((s||0)/60);
      const ss = String(Math.max(0,(s||0)%60)).padStart(2,'0');
      return `${m}:${ss}`;
    };

    const line = (label:string, value:any) => (
      <div style={{ display:"flex", justifyContent:"space-between", gap:12, fontSize:12, marginTop:4 }}>
        <div style={{ opacity:.85 }}>{label}</div>
        <div style={{ fontWeight:700 }}>{value}</div>
      </div>
    );

    return (
      <SmartTooltipBox depKey={`apm:${String(name||"")}:${info.apm}:${info.activeSeconds}`} cardId={`${mode}:APM`}>
      <div style={{ background:"rgba(9,14,24,.96)", border:"1px solid rgba(120,170,255,.35)", padding:16, borderRadius:14, color:"#cfe3ff", width:720, boxShadow:"0 18px 60px rgba(0,0,0,.55), 0 0 0 1px rgba(98,176,255,.12) inset" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:10 }}>
          <div style={{ fontWeight:900 }}>{String(name||"")}</div>
          <div style={{ fontWeight:900 }}>APM {info.apm}</div>
        </div>
        <div style={{ opacity:.8, fontSize:12, marginTop:4 }}>
          Window {tFmt(info.winStart)}–{tFmt(info.winEnd)} • Active {fmt1(info.activeSeconds/60)} min
        </div>
        <div style={{ marginTop:8 }}>
          {line("Action seconds (damage ∪ utility)", info.actionSeconds)}
          {line("Damage seconds", info.dmgSeconds)}
          {line("Utility seconds", info.utilSeconds)}
          {line("Overlap seconds", info.overlap)}
        </div>
        {(info.topDamage?.length || info.topUtility?.length) ? (
          <div style={{ marginTop:12, display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <div>
              <div style={{ fontSize:12, fontWeight:800, opacity:.9, marginBottom:6 }}>
                Top damage actions{info.topDamageMode === 'hits' ? ' (by hits)' : ''}
              </div>
              {(info.topDamage||[]).length ? (info.topDamage||[]).map((x:any)=>(
                <div key={x.ability} style={{ display:"flex", justifyContent:"space-between", gap:10, fontSize:12, marginTop:4 }}>
                  <div style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:160 }}>{x.ability}</div>
                  <div style={{ fontWeight:800 }}>{x.count}</div>
                </div>
              )) : <div style={{ fontSize:12, opacity:.7 }}>None</div>}
            </div>
            <div>
              <div style={{ fontSize:12, fontWeight:800, opacity:.9, marginBottom:6 }}>Top utility actions</div>
              {(info.topUtility||[]).length ? (info.topUtility||[]).map((x:any)=>(
                <div key={x.ability} style={{ display:"flex", justifyContent:"space-between", gap:10, fontSize:12, marginTop:4 }}>
                  <div style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:160 }}>{x.ability}</div>
                  <div style={{ fontWeight:800 }}>{x.count}</div>
                </div>
              )) : <div style={{ fontSize:12, opacity:.7 }}>None</div>}
            </div>
          </div>
        ) : null}
        <div style={{ marginTop:10, fontSize:11, opacity:.65 }}>
          Note: APM counts at most 1 per second for a given player (activity-seconds), so AoE multi-target lines don’t inflate it.
        </div>
      </div>
      </SmartTooltipBox>
    );
  }, [apmBreakdownByPlayer, mode]);

  const takenFor = useMemo(()=> {
    const who = (compareOn && (pA || pB)) ? (pA || pB) : '';
    if (who && perTakenBy[who]) {
      return Object.entries(perTakenBy[who]).map(([src, value])=>({ name: src, value })).sort((a,b)=> b.value-a.value).slice(0,12);
    }
    const items = Object.entries(perTaken).map(([name, value])=>({ name, value }));
    return items.sort((a,b)=> b.value - a.value).slice(0,12);
  }, [perTaken, perTakenBy, compareOn, pA, pB]);

  // ---- Damage Taken tab helpers ----
  const primaryPlayer = useMemo(() => (pA || pB || ''), [pA, pB]);

  const windowBounds = useMemo(() => {
    const start = timeline.length ? timeline[0].t : 0;
    const end   = timeline.length ? timeline[timeline.length - 1].t : duration;
    return { start, end };
  }, [timeline, duration]);

  const deathsForPrimary = useMemo(() => {
    const who = normalizeActorName(canonEntity(primaryPlayer));
    if (!who) return [];
    const { start, end } = windowBounds;
    return deathEvents
      .filter(d => normalizeActorName(canonEntity(d.name)) === who && d.t >= start && d.t <= end)
      .sort((a,b)=>a.t-b.t);
  }, [deathEvents, primaryPlayer, windowBounds]);

  // Keep a stable selected death key; default to latest death in window
  useEffect(() => {
    if (!deathsForPrimary.length) {
      if (selectedDeathKey) setSelectedDeathKey('');
      return;
    }
    if (!selectedDeathKey || !deathsForPrimary.some(d => String(d.t) === selectedDeathKey)) {
      setSelectedDeathKey(String(deathsForPrimary[deathsForPrimary.length - 1].t));
    }
  }, [deathsForPrimary, selectedDeathKey]);

  const selectedDeath = useMemo(() => {
    if (!selectedDeathKey) return null;
    const t = Number(selectedDeathKey);
    return deathsForPrimary.find(d => d.t === t) || null;
  }, [selectedDeathKey, deathsForPrimary]);

  const deathWindow = useMemo(() => {
    if (!selectedDeath) return null;
    const end = selectedDeath.t;
    const start = Math.max(0, end - DEATH_SNAPSHOT_SEC);
    return { start, end };
  }, [selectedDeath]);

  const deathSnap = useMemo(() => {
    if (!primaryPlayer || !deathWindow) return null;
    const who = normalizeActorName(canonEntity(primaryPlayer));
    const { start, end } = deathWindow;

    const dmg = damageEvents.filter(e => canonEntity(e.dst) === who && e.t >= start && e.t <= end);
    const heals = healEvents.filter(e => canonEntity(e.dst) === who && e.t >= start && e.t <= end);
    const util = utilityEvents.filter(e => canonDyn(e.src) === canonDyn(who) && e.t >= start && e.t <= end);

    // Killing blow = last damage event in window
    const killing = dmg.slice().sort((a,b)=>a.t-b.t).at(-1) || null;

    const totalDmg = dmg.reduce((s,e)=>s+e.amount,0);
    const totalHeal = heals.reduce((s,e)=>s+e.amount,0);

    // ---- Snapshot series ----
    // Per-second bins (0..DEATH_SNAPSHOT_SEC). This matches the axis ticks and your expectation
    // that each bar represents one second.
    const step = 1;
    const bins = DEATH_SNAPSHOT_SEC;

    const healsByBin: number[] = Array.from({ length: bins + 1 }, () => 0);
    const dmgByBin: number[]   = Array.from({ length: bins + 1 }, () => 0);

    // Tooltip wants per-bin breakdowns
    const healByWho: Record<number, Record<string, number>> = {};
    const dmgByWhat: Record<number, Record<string, number>> = {};

    const toBin = (t:number) => {
      const rel = Math.max(0, Math.min(DEATH_SNAPSHOT_SEC, t - start));
      return Math.max(0, Math.min(bins, Math.floor(rel / step)));
    };

    for (const e of heals) {
      const bi = toBin(e.t);
      healsByBin[bi] += e.amount;
      if (!healByWho[bi]) healByWho[bi] = {};
      const whoHealed = canonDyn(e.src);
      healByWho[bi][whoHealed] = (healByWho[bi][whoHealed] || 0) + e.amount;
    }
    for (const e of dmg) {
      const bi = toBin(e.t);
      dmgByBin[bi] += e.amount;
      if (!dmgByWhat[bi]) dmgByWhat[bi] = {};
      const what = (e.ability ? String(e.ability) : 'Damage');
      dmgByWhat[bi][what] = (dmgByWhat[bi][what] || 0) + e.amount;
    }

    // HP remaining is estimated by forcing HP to hit 0 at death.
    // If we assume HP_end = 0, then HP_start = totalDmg - totalHeal.
    const startHP = Math.max(1, Math.round(totalDmg - totalHeal));

    // Build chart series forward from start -> death.
    let hp = startHP;
    const chartSeries = Array.from({ length: bins + 1 }, (_, i) => {
      const heal = healsByBin[i] || 0;
      const dmgAmt = dmgByBin[i] || 0;

      // Track top heal/dmg for tooltip summary
      const hb = healByWho[i] || {};
      const db = dmgByWhat[i] || {};
      const topHeal = Object.entries(hb).sort((a,b)=> (b[1] as number) - (a[1] as number))[0] as any;
      const topDmg  = Object.entries(db).sort((a,b)=> (b[1] as number) - (a[1] as number))[0] as any;

      const row = {
        x: i,
        heal,
        dmg: -dmgAmt, // negative so it plots below 0
        hp,
        healBy: hb,
        dmgBy: db,
        topHealWho: topHeal ? topHeal[0] : undefined,
        topHealAmt: topHeal ? topHeal[1] : 0,
        topDmgWhat: topDmg ? topDmg[0] : undefined,
        topDmgAmt: topDmg ? topDmg[1] : 0,
      };

      // advance HP to next second
      hp = Math.max(0, hp + heal - dmgAmt);
      return row;
    });

    const maxEvt = Math.max(
      1,
      ...chartSeries.map(r => Math.max(Math.abs(Number(r.heal) || 0), Math.abs(Number(r.dmg) || 0)))
    );

    // Heal labels: choose a few biggest heals across the window and label with healer name.
    const healLabels = Object.entries(healByWho)
      .flatMap(([biStr, m]) => {
        const bi = Number(biStr);
        return Object.entries(m || {}).map(([whoHealed, amt]) => ({ x: bi, who: whoHealed, y: chartSeries[bi]?.hp ?? 0, amt }));
      })
      .filter(r => (Number(r.amt) || 0) > 0)
      .sort((a,b)=> (Number(b.amt)||0) - (Number(a.amt)||0))
      .slice(0, 8);


    // Event feed (merged), sorted latest → earliest
    const feed = [
      ...dmg.map(e=>({ kind:'damage' as const, t:e.t, src:e.src, dst:e.dst, ability:e.ability, amount:e.amount, flags:e.flags, blocked:e.blocked, absorbed:e.absorbed })),
      ...heals.map(e=>({ kind:'heal' as const, t:e.t, src:e.src, dst:e.dst, ability:e.ability, amount:e.amount })),
      ...util.map(e=>({ kind:'utility' as const, t:e.t, src:e.src, dst: who, ability:e.ability, amount:0 }))
    ].sort((a,b)=> b.t - a.t);

    return {
      dmg,
      heals,
      util,
      killing,
      totalDmg,
      totalHeal,
      startHP,
      maxEvt,
      chartSeries,
      healLabels,
      feed,
    };
  }, [primaryPlayer, deathWindow, damageEvents, healEvents, utilityEvents]);

  const topAttackersForPrimary = useMemo(() => {
    const who = normalizeActorName(canonEntity(primaryPlayer));
    if (!who) return [];
    const m = perTakenBy[who] || {};
    const rows = Object.entries(m).map(([name, value]) => ({ name, value: Number(value) || 0 }))
      .sort((a,b)=>b.value-a.value);
    return rows;
  }, [primaryPlayer, perTakenBy]);

  const topAttackersTotalForPrimary = useMemo(() => topAttackersForPrimary.reduce((s:any, r:any) => s + (Number(r.value)||0), 0), [topAttackersForPrimary]);

const renderTopAttackerValueLabel = (props: any) => {
  const { x, y, width, height, value } = props || {};
  const v = Number(value || 0);
  const pct = topAttackersTotalForPrimary ? (v / topAttackersTotalForPrimary) : 0;

  const label = `${fmt0(v)} (${fmtPct(pct)})`;
  const tx = (Number(x) || 0) + (Number(width) || 0) + 12;
  const ty = (Number(y) || 0) + (Number(height) || 0) / 2 + 4;

  return (
    <text
      x={tx}
      y={ty}
      fill="rgba(235,252,255,.92)"
      fontSize={14}
      fontWeight={850}
      className="mono"
    >
      {label}
    </text>
  );
};

  const incomingByAbilityForPrimary = useMemo(() => {
    const who = normalizeActorName(canonEntity(primaryPlayer));
    if (!who) return [];
    const events = damageEvents.filter(e => canonEntity(e.dst) === who);

    type Row = {
      ability: string;
      hits: number;
      damage: number;
      avg: number;
      max: number;
      critPct: number;
      glancePct: number;
      elemTop: string;
      stPct: number;
      dodge: number;
      parry: number;
      block: number;
    };

    const agg: Record<string, any> = {};
    const addElem = (a:any, elems?:Record<string,number>) => {
      if (!elems) return;
      for (const [k,v] of Object.entries(elems)) {
        a.elem[k] = (a.elem[k]||0) + (v as number);
      }
    };

    for (const e of events) {
      const abil = normalizeAbilityKey(e.ability);
      const a = agg[abil] || (agg[abil] = { hits:0, dmg:0, max:0, crit:0, glance:0, st:0, dodge:0, parry:0, block:0, elem:{} as Record<string,number> });
      a.hits += 1;
      a.dmg += e.amount;
      if (e.amount > a.max) a.max = e.amount;

      const f = (e.flags||'').toLowerCase();
      const abilRaw = String(e.ability||'').toLowerCase();

      // Some logs encode crit/glance in the *text* (e.g. "critically hits") but the worker may label it as a normal hit.
      const critByText = /(?:\bcrits?\b|\bcritical(?:ly)?\s+hits?\b)/i.test(abilRaw);
      const glanceByText = /\bglances?\b/i.test(abilRaw);

      if (f.includes('crit') || critByText) a.crit += 1;
      if (f.includes('glance') || glanceByText) a.glance += 1;
      if (f.includes('strikethrough')) a.st += 1;
      if (f.includes('dodge')) a.dodge += 1;
      if (f.includes('parry')) a.parry += 1;
      if ((e.blocked||0) > 0) a.block += 1;

      addElem(a, (e as any).elements);
    }

    const rows: Row[] = Object.entries(agg).map(([ability, a]) => {
      const avg = a.hits ? a.dmg / a.hits : 0;
      const critPct = a.hits ? a.crit / a.hits : 0;
      const glancePct = a.hits ? a.glance / a.hits : 0;
      const stPct = a.hits ? a.st / a.hits : 0;

      // pick dominant element
      let elemTop = '—';
      const entries = Object.entries(a.elem).sort((x,y)=>(y[1] as number)-(x[1] as number));
      if (entries.length) elemTop = titleCase(entries[0][0]);

      return { ability, hits:a.hits, damage:a.dmg, avg, max:a.max, critPct, glancePct, elemTop, stPct, dodge:a.dodge, parry:a.parry, block:a.block };
    });

    return rows.sort((a,b)=>b.damage-a.damage);
  }, [primaryPlayer, damageEvents]);

  const damageTakenKpisForPrimary = useMemo(() => {
    const who = normalizeActorName(canonEntity(primaryPlayer));
    if (!who) {
      return {
        totalDamage: 0,
        elem: {} as Record<string, number>,
        avgAbsorbed: 0,
        mitigatedRatio: 0,
        unmitigatedRatio: 0,
        mitigatedCount: 0,
        totalCount: 0,
      };
    }

    const events = damageEvents.filter(e => canonEntity(e.dst) === who);

    let totalDamage = 0;
    const elem: Record<string, number> = {};
    let absorbedSum = 0;
    let absorbedHits = 0;
    let absorbedDamageSum = 0;

    let mitigatedCount = 0;

    for (const e of events) {
      const amt = Number(e.amount || 0);
      totalDamage += amt;

      // Elemental breakdown (if missing/empty, treat as Unknown for accounting).
      const breakdown = (e as any).elements as (Record<string, number> | undefined);
      if (breakdown && Object.keys(breakdown).length) {
        for (const [k, v] of Object.entries(breakdown)) {
          elem[k] = (elem[k] || 0) + Number(v || 0);
        }
      } else {
        elem["Unknown"] = (elem["Unknown"] || 0) + amt;
      }

      const a = Number((e as any).absorbed || 0);
      if (a > 0) {
        absorbedSum += a;
        absorbedHits += 1;
        absorbedDamageSum += amt;
      }

      const f = String((e as any).flags || "").toLowerCase();
      const isDodge = f.includes("dodge");
      const isParry = f.includes("parry");
      const isGlance = f.includes("glance");
      const isEvade = f.includes("evade") || (Number((e as any).evadedPct || 0) > 0);
      const isBlock = Number((e as any).blocked || 0) > 0;

      // "Mitigated" bucket per your definition: dodge/parry/block/glance/evade
      if (isDodge || isParry || isBlock || isGlance || isEvade) mitigatedCount += 1;
    }

    const totalCount = events.length || 0;
    const mitigatedRatio = totalCount ? mitigatedCount / totalCount : 0;
    const unmitigatedRatio = totalCount ? 1 - mitigatedRatio : 0;

    const avgAbsorbed = absorbedHits ? absorbedSum / absorbedHits : 0;
    // Portion of (damage + absorbed) that was absorbed by armor across the window.
    const avgAbsorbedPct = absorbedSum + absorbedDamageSum > 0 ? absorbedSum / (absorbedSum + absorbedDamageSum) : 0;

    return {
      totalDamage,
      elem,
      avgAbsorbed,
      avgAbsorbedPct,
      mitigatedRatio,
      unmitigatedRatio,
      mitigatedCount,
      totalCount,
    };
  }, [primaryPlayer, damageEvents]);


  const TLdps = useMemo(()=> timelineView.map(d=>({t:d.t, v:d.dps})), [timelineView]);
  const TLhps = useMemo(()=> timelineView.map(d=>({t:d.t, v:d.hps})), [timelineView]);
  const seriesDuration = useMemo(()=> (timeline.length ? (timeline[timeline.length-1].t - timeline[0].t + 1) : duration), [timelineView, duration]);

  function seriesFor(name:string){
    const arr = perSrc[name]||[];
    if (!arr.length) return [];
    const first = timelineView[0]?.t ?? 0;
    const last = timelineView.length ? timelineView[timelineView.length-1].t : duration;
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

  // Timeline mode:
  // - "Summary" shows WarcraftLogs-style aggregate lines.
  // - "Compared" shows per-player lines (your current view).
  const [timelineMode, setTimelineMode] = useState<'summary' | 'compare'>('summary');

  // Exclude segment-identification NPCs from player-derived views (top lines, hover breakdown, panels)
  const rowsPlayers = useMemo(() => rows.filter(r => !isSegmentNpcName(r.name)), [rows]);

  // NEW: Top 10 lines (by total damage in current window)
  const top10Names = useMemo(
    () => [...rowsPlayers].sort((a,b)=> b.damageDealt - a.damageDealt).slice(0,10).map(r=> r.name),
    [rowsPlayers]
  );

  // Top names are normally damage-driven, but we also want healers (e.g. Medics) to show up in the hover breakdown.
  // So we build Top-8 by damage AND Top-8 by healing, then union them (deduped by canonical actor key).
  const top8DamageNames = useMemo(
    () => [...rowsPlayers].sort((a,b)=> b.damageDealt - a.damageDealt).slice(0,8).map(r=> r.name),
    [rowsPlayers]
  );
  const top8HealNames = useMemo(
    () => [...rowsPlayers].sort((a,b)=> (Number(b.healingDone||0) - Number(a.healingDone||0))).slice(0,8).map(r=> r.name),
    [rowsPlayers]
  );
  const top8Names = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const n of [...top8DamageNames, ...top8HealNames]) {
      if (!n) continue;
      const key = canonActor(n);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
    return out;
  }, [top8DamageNames, top8HealNames]);

  const top10Series = useMemo(
    () => top10Names.map(name => ({
      name,
      series: smooth ? smoothSeries(seriesFor(name), 7) : seriesFor(name),
      color: classColor(inferredClasses[name]),
    })),
    [top10Names, smooth, perSrc, timeline, inferredClasses]
  );

  // Labels on the timeline can get crowded—only tag a few of the most relevant lines.
  const topLabelNames = useMemo(() => top10Names.slice(0, 4), [top10Names]);
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

  // Build a per-second "damage taken" series for a chosen set of players (e.g. top-8 damage).
  const takenByTop8 = useMemo(() => {
    if (!damageEvents?.length || !top8Names.length || !timeline.length) return new Map<number, number>();
    const allow = new Set(top8Names.map(canonActor));
    const start = timeline[0]?.t ?? 0;
    const end = timeline.length ? timeline[timeline.length - 1].t : duration;
    const m = new Map<number, number>();
    for (const e of damageEvents as any[]) {
      const t = Number(e?.t ?? 0);
      // Keep this scoped to the currently selected window (timeline start/end).
      if (t < start || t > end) continue;
      const dst = canonActor(String(e?.dst || ''));
      if (!allow.has(dst)) continue;
      const amt = Number(e?.amount || 0);
      if (!amt) continue;
      m.set(t, (m.get(t) || 0) + amt);
    }
    return m;
  }, [damageEvents, top8Names, timeline, duration]);

  // Map of t -> total healing done for that second (already computed in timeline from the worker).
  const hpsBySecond = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of timeline as any[]) m.set(Number(p?.t ?? 0), Number(p?.hps || 0));
    return m;
  }, [timeline]);

  
  // Per-second breakdown for the *Top 8 damage dealers* (used by the timeline hover HUD).
  const takenBySecondByActorTop8 = useMemo(() => {
    const m = new Map<number, Record<string, number>>();
    const topSet = new Set(top8Names.map(canonActor));
    for (const ev of damageEvents as any[]) {
      const t = Math.floor(Number(ev?.t ?? 0));
      if (!Number.isFinite(t)) continue;

      // target/defender name can appear under different keys depending on the log line
      const rawTarget = (ev?.dst ?? ev?.target ?? ev?.victim ?? ev?.defender ?? '') as string;
      const target = canonActor(String(rawTarget || ''));
      if (!target || !topSet.has(target)) continue;

      const amt = Number(ev?.amount ?? 0) || 0;
      if (!amt) continue;

      const row = m.get(t) || {};
      row[target] = (row[target] || 0) + amt;
      m.set(t, row);
    }
    return m;
  }, [damageEvents, top8Names]);

  const healBySecondByActorTop8 = useMemo(() => {
    const m = new Map<number, Record<string, number>>();
    const topSet = new Set(top8Names.map(canonActor));
    for (const ev of healEvents as any[]) {
      const t = Math.floor(Number(ev?.t ?? 0));
      if (!Number.isFinite(t)) continue;

      const healer = canonActor(String(ev?.src ?? ''));
      if (!healer || !topSet.has(healer)) continue;

      const amt = Number(ev?.amount ?? 0) || 0;
      if (!amt) continue;

      const row = m.get(t) || {};
      row[healer] = (row[healer] || 0) + amt;
      m.set(t, row);
    }
    return m;
  }, [healEvents, top8Names]);

  // Top-8 healers (by total healing done) for the summary timeline.
  // This is independent from top8Names (top-8 damage dealers).
  const top8Healers = useMemo(() => {
    const totals = new Map<string, { canon: string; best: string; total: number }>();
    for (const ev of healEvents as any[]) {
      const raw = String(ev?.src ?? '');
      const canon = canonActor(raw);
      if (!canon) continue;
      const amt = Number(ev?.amount ?? 0) || 0;
      if (!amt) continue;
      const cur = totals.get(canon) || { canon, best: stripTrailingApostrophe(raw).trim() || raw, total: 0 };
      cur.total += amt;
      // Keep the prettiest display name we saw for this canonical key.
      const pretty = stripTrailingApostrophe(raw).trim() || raw;
      if (pretty.length > cur.best.length) cur.best = pretty;
      totals.set(canon, cur);
    }
    return [...totals.values()].sort((a, b) => b.total - a.total).slice(0, 8).map((x) => x.canon);
  }, [healEvents]);

  const healTop8BySecond = useMemo(() => {
    const set = new Set(top8Healers);
    const m = new Map<number, number>();
    for (const ev of healEvents as any[]) {
      const t = Math.floor(Number(ev?.t ?? 0));
      if (!Number.isFinite(t)) continue;
      const healer = canonActor(String(ev?.src ?? ''));
      if (!healer || !set.has(healer)) continue;
      const amt = Number(ev?.amount ?? 0) || 0;
      if (!amt) continue;
      m.set(t, (m.get(t) || 0) + amt);
    }
    return m;
  }, [healEvents, top8Healers]);

// Summary (default) dataset: aggregate lines similar to Warcraft Logs.
  //  - Damage Done: sum of top-8 DPS sources
  //  - Damage Taken: incoming damage to those same top-8 sources
  //  - Healing Done: total healing (all sources)
  //  - Healing (Top 8): sum of top-8 healers (by total healing done)
  const summaryData = useMemo(() => {
    if (!top10Data.length) return [] as any[];
    return top10Data.map((row: any) => {
      const t = Number(row.t);
      let dmg = 0;
      for (const name of top8Names) dmg += Number(row?.[name] || 0);
      const taken = Number(takenByTop8.get(t) || 0);
      const heal = Number(hpsBySecond.get(t) || 0);
      const healTop8 = Number(healTop8BySecond.get(t) || 0);
      return { t, dmg, taken, heal, healTop8 };
    });
  }, [top10Data, top8Names, takenByTop8, hpsBySecond, healTop8BySecond]);

  // Mini overview (for brush/zoom): total DPS of the top-10 lines.
  const overviewData = useMemo(() => {
    if (!top10Data.length) return [] as Array<{ t: number; total: number }>;
    return top10Data.map((row: any) => {
      let total = 0;
      for (const { name } of top10Series) total += Number(row?.[name] || 0);
      return { t: Number(row.t), total };
    });
  }, [top10Data, top10Series]);

  const overviewDataSummary = useMemo(() => {
    if (!summaryData.length) return [] as Array<{ t: number; total: number }>;
    return summaryData.map((r: any) => ({ t: Number(r.t), total: Number(r.dmg || 0) }));
  }, [summaryData]);

  // Keep the brush synced to the current window.
  const brushRange = useMemo(() => {
    if (!top10Data.length) return { startIndex: 0, endIndex: 0 };
    const t0 = windowStart;
    const t1 = windowEnd;
    let si = 0;
    let ei = top10Data.length - 1;
    for (let i = 0; i < top10Data.length; i++) {
      const t = Number((top10Data as any)[i]?.t ?? 0);
      if (t <= t0) si = i;
      if (t <= t1) ei = i;
    }
    if (ei < si) ei = si;
    return { startIndex: si, endIndex: ei };
  }, [top10Data, windowStart, windowEnd]);

  const onBrushChange = useCallback((range: any) => {
    if (!range || !top10Data.length) return;
    const si = Math.max(0, Math.min(top10Data.length - 1, Number(range.startIndex ?? 0)));
    const ei = Math.max(0, Math.min(top10Data.length - 1, Number(range.endIndex ?? (top10Data.length - 1))));
    const t0 = Number((top10Data as any)[Math.min(si, ei)]?.t ?? windowStart);
    const t1 = Number((top10Data as any)[Math.max(si, ei)]?.t ?? windowEnd);
    if (Number.isFinite(t0) && Number.isFinite(t1) && Math.abs(t1 - t0) >= 1) commitWindow(t0, t1);
  }, [top10Data, commitWindow, windowStart, windowEnd]);

  // Segment chooser helpers: make the dropdown more readable by grouping by instance/dungeon.
  const segView = useMemo(() => {
    const parse = (label: string) => {
      const parts = String(label || '').split('—');
      const inst = (parts[0] || '').trim();
      const rest = (parts.slice(1).join('—') || '').trim();
      const pretty = INSTANCE_PRETTY[inst]?.title || inst || 'Segment';
      const sub = INSTANCE_PRETTY[inst]?.subtitle;
      return { inst, pretty, sub, rest };
    };

    const items = segments.map((s, i) => {
      const p = parse(s.label);
      return {
        i,
        ...s,
        inst: p.inst,
        dungeon: p.pretty,
        dungeonShort: p.sub,
        rangeText: p.rest,
      };
    });

    const groups = new Map<string, typeof items>();
    for (const it of items) {
      const key = it.dungeon || 'Other';
      const cur = groups.get(key);
      if (cur) cur.push(it);
      else groups.set(key, [it]);
    }
    return { items, groups };
  }, [segments]);

  // Segments rendered as horizontal bands across the timeline (Warcraft Logs style).
  const segBandsRaw = useMemo(() => {
    return segView.items
      .map((s) => {
        const title = s.dungeon || 'Segment';
        const sub = s.dungeonShort || '';
        // Keep the band label short.
        const label = sub ? `${sub}` : title;
        return { start: s.start, end: s.end, label, full: title };
      })
      .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);
  }, [segView.items]);

  // Merge adjacent segments that resolve to the same label to avoid "double boxes".
  const segBands = useMemo(() => {
    const items = [...segBandsRaw].sort((a, b) => a.start - b.start);
    const merged: { start: number; end: number; label: string; full: string }[] = [];
    const MERGE_GAP_S = 1; // treat touching/near-touching as continuous
    for (const s of items) {
      const last = merged[merged.length - 1];
      if (
        last &&
        last.label === s.label &&
        last.full === s.full &&
        s.start <= last.end + MERGE_GAP_S
      ) {
        last.end = Math.max(last.end, s.end);
      } else {
        merged.push({ ...s });
      }
    }
    return merged;
  }, [segBandsRaw]);

  const renderSegBands = useCallback((props: any) => {
    try {
      const xAxisKey = Object.keys(props?.xAxisMap || {})[0];
      const xAxis = xAxisKey ? (props.xAxisMap[xAxisKey] as any) : null;
      const scale = xAxis?.scale;
      const offset = props?.offset;
      if (!scale || !offset) return null;

      // Segment label display tweaks (keep the underlying segment timings intact).
      const displaySegName = (name: string) => {
        const n = String(name || '').trim();
        if (!n) return n;
        // Requested shorthand
        if (n.toLowerCase() === 'tusken king') return 'TK';
        return n;
      };

      // If multiple adjacent segments share the same (display) name, merge them into a single band.
      // This prevents repeated labels like "Tusken King" appearing multiple times in a row.
      const mergedSegBands = (() => {
        const src = (segBands || [])
          .map((s: any) => ({
            ...s,
            __disp: displaySegName(String(s.full || s.label || '')),
          }))
          .sort((a: any, b: any) => Number(a.start) - Number(b.start));

        const out: any[] = [];
        const EPS = 1e-3; // allow tiny gaps due to rounding
        for (const s of src) {
          if (!Number.isFinite(Number(s.start)) || !Number.isFinite(Number(s.end))) continue;
          const last = out[out.length - 1];
          if (last && String(last.__disp) === String(s.__disp) && Number(s.start) <= Number(last.end) + EPS) {
            // Merge by extending the end time.
            last.end = Math.max(Number(last.end), Number(s.end));
            // Keep the richest label fields.
            last.full = last.full || s.full;
            last.label = last.label || s.label;
          } else {
            out.push({ ...s });
          }
        }
        return out;
      })();

      // Place segment bands safely *outside* the plot-area clip-path so labels never get cut when zooming.
      // Anchor relative to the chart's top margin (or offset.y as fallback) and clamp inside the SVG viewport.
      const chartTop = (props?.margin?.top ?? offset.y ?? 40);
      const y = Math.max(2, chartTop - 26); // sits just above the plot area, below the controls
      const h = 22;

      return (
        <g>
          <defs>
            <linearGradient id="segBandGradA" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(120,200,255,0.18)" />
              <stop offset="100%" stopColor="rgba(70,140,230,0.08)" />
            </linearGradient>
            <linearGradient id="segBandGradB" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(255,220,140,0.16)" />
              <stop offset="100%" stopColor="rgba(255,200,90,0.07)" />
            </linearGradient>
            <filter id="segBandShadow" x="-20%" y="-40%" width="140%" height="200%">
              <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="rgba(0,0,0,0.45)" />
            </filter>
          </defs>
          {mergedSegBands.map((s, i) => {
            const x1 = Number(scale(s.start));
            const x2 = Number(scale(s.end));
            if (!Number.isFinite(x1) || !Number.isFinite(x2)) return null;
            const left = Math.min(x1, x2);
            const w = Math.max(0, Math.abs(x2 - x1));
            if (w < 6) return null;
            const isAlt = i % 2 === 1;
            const fill = isAlt ? 'url(#segBandGradB)' : 'url(#segBandGradA)';
            const stroke = 'rgba(150,205,255,0.22)';
            const rx = 10;
            const textY = y + (h / 2);

            // Wrap the label inside the band (2 lines max) so long names remain readable.
            const fullLabel = displaySegName(String(s.full || s.label || ''));

            // Trim segment to the visible viewport so off-screen segments don't create giant overlapping boxes when zoomed.
            const rawLeft = left;
            const rawRight = left + w;
            const boxLeft = Math.max(0, rawLeft);
            const boxRight = Math.min(offset.width, rawRight);
            const boxW = Math.max(0, boxRight - boxLeft);
            if (boxW < 6) return null;

            const textX = boxLeft + (boxW / 2);
            const maxCharsPerLine = Math.max(4, Math.floor((boxW - 20) / 7)); // ~7px/char
            const words = fullLabel.split(/\s+/).filter(Boolean);

            const lines: string[] = [];
            let cur = '';
            const pushLine = (line: string) => {
              if (line.trim()) lines.push(line.trim());
            };

            for (const word of words) {
              // If a single word is too long, hard-split it.
              const parts: string[] = [];
              if (word.length > maxCharsPerLine) {
                for (let k = 0; k < word.length; k += maxCharsPerLine) {
                  parts.push(word.slice(k, k + maxCharsPerLine));
                }
              } else {
                parts.push(word);
              }

              for (const part of parts) {
                const cand = cur ? `${cur} ${part}` : part;
                if (cand.length <= maxCharsPerLine) {
                  cur = cand;
                } else {
                  pushLine(cur);
                  cur = part;
                  if (lines.length >= 2) break;
                }
              }
              if (lines.length >= 2) break;
            }
            pushLine(cur);

            // Clamp to 2 lines and ellipsize the last line if we had to drop words.
            const hadMore = words.join(' ').length > lines.join(' ').length;
            if (lines.length > 2) lines.length = 2;
            if (lines.length === 2 && hadMore) {
              const l = lines[1];
              lines[1] = l.length > Math.max(1, maxCharsPerLine - 1) ? (l.slice(0, maxCharsPerLine - 1) + '…') : (l + '…');
            }

            const showText = boxW >= 70 && lines.length > 0;
            const clipId = `segclip-${i}-${Math.round(s.start * 1000)}-${Math.round(s.end * 1000)}`;
            return (
              <g key={`${s.start}-${s.end}-${i}`} style={{ cursor: 'pointer' }} onClick={() => commitWindow(s.start, s.end)}>
                {/* Segment label (single box; can be wider than the raw segment). */}
                <defs>
                  <clipPath id={clipId}>
                    <rect x={boxLeft} y={y} width={boxW} height={h} rx={rx} ry={rx} />
                  </clipPath>
                </defs>
                <g filter="url(#segBandShadow)">
                <rect x={boxLeft} y={y} width={boxW} height={h} rx={rx} ry={rx} fill={fill} stroke={stroke} />
                <rect clipPath={`url(#${clipId})`} x={boxLeft} y={y + 1} width={boxW} height={Math.max(0, Math.floor(h / 2) - 1)} rx={rx} ry={rx} fill="rgba(255,255,255,0.06)" />
                </g>
                {showText && (
                  <text
                    clipPath={`url(#${clipId})`}
                    x={textX}
                    y={textY}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="rgba(229,245,255,0.94)"
                    fontSize={11}
                    fontWeight={900}
                    letterSpacing={0.35}
                    stroke="rgba(6,12,22,0.75)"
                    strokeWidth={3}
                    style={{ userSelect: 'none', pointerEvents: 'none', paintOrder: 'stroke' }}

                  >
                    {lines.slice(0, 2).map((ln, li) => (
                      <tspan key={li} x={textX} dy={li === 0 ? (lines.length === 2 ? -3 : 0) : 11}>
                        {ln}
                      </tspan>
                    ))}
</text>
                )}
              </g>
            );
          })}
        </g>
      );
    } catch {
      return null;
    }
  }, [segBands, commitWindow]);

  const hoverSummary = useMemo(() => {
    const data = (timelineMode === 'summary') ? (summaryData as any[]) : (top10Data as any[]);
    if (hoverX == null || !data.length) return null;
    // exact match is common (hoverX is activeLabel), fall back to nearest.
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < data.length; i++) {
      const t = Number((data as any)[i]?.t ?? 0);
      const d = Math.abs(t - hoverX);
      if (d < bestDist) { bestDist = d; bestIdx = i; if (d === 0) break; }
    }
    if (bestIdx < 0) return null;
    const row: any = (data as any)[bestIdx];

    // Always show Top-3 damage dealers at that moment.
    // In summary mode, the row only has dmg/taken/heal, so pull per-player values from top10Data.
    const perPlayerRow: any = (timelineMode === 'summary')
      ? ((top10Data as any[])[bestIdx] || {})
      : row;

    const top = top10Series
      .map(s => ({ name: s.name, v: Number(perPlayerRow?.[s.name] || 0), color: s.color }))
      .sort((a,b) => b.v - a.v)
      .slice(0, 3);

    const total = (timelineMode === 'summary')
      ? Number(row?.dmg || 0)
      : top8Names.reduce((acc, n) => acc + Number(row?.[n] || 0), 0);

    const t = Number(row.t);

    const takenRow = takenBySecondByActorTop8.get(t) || {};
    const healRow = healBySecondByActorTop8.get(t) || {};

    const breakdown = top8Names
      .map((name) => {
        const key = canonActor(name);
        return {
          name,
          dmg: Number(perPlayerRow?.[name] || 0),
          taken: Number((takenRow as any)?.[key] || 0),
          heal: Number((healRow as any)?.[key] || 0),
        };
      })
      .sort((a, b) => (b.dmg + b.heal) - (a.dmg + a.heal));

    return { t, total, top, row, breakdown };
  }, [hoverX, top10Data, summaryData, top10Series, top8Names, timelineMode]);

  const maxYSummary = useMemo(() => {
    let m = 0;
    for (const r of summaryData as any[]) {
      m = Math.max(m, Number(r?.dmg || 0), Number(r?.taken || 0), Number(r?.heal || 0));
    }
    return m || 1;
  }, [summaryData]);

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
      {/* Welcome / Main Menu */}
      <AnimatePresence mode="wait">
        {showWelcome && (
          <WelcomeScreen
          onSelect={(mode) => {
            setAnalyzerMode(mode);
            setShowWelcome(false);
          }}
        />
        )}
      </AnimatePresence>

      
      {analyzerMode === "pvp" && !showWelcome && (
        <div
          style={{
            position: "fixed",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9000,
            padding: "10px 14px",
            borderRadius: 999,
            background: "rgba(0,0,0,0.55)",
            border: "1px solid rgba(255,255,255,0.18)",
            backdropFilter: "blur(10px)",
            fontSize: 12,
            letterSpacing: ".08em",
            textTransform: "uppercase",
          }}
        >
          PVP mode selected — PVP-specific panels coming next (running PVE pipeline for now)
        </div>
      )}
<style dangerouslySetInnerHTML={{ __html: SW_CSS }} />
      <style dangerouslySetInnerHTML={{ __html: RIBBON_CSS }} />
      <style dangerouslySetInnerHTML={{ __html: RIBBON_EXTRA }} />
      <style dangerouslySetInnerHTML={{ __html: ENC_CSS }} />
      <style dangerouslySetInnerHTML={{ __html: PS_CSS }} />
      <div style={{ minHeight:'100vh', padding:16 }}>
      
<div className="card" style={{ padding:12, marginBottom:12 }}>
  
<TopRibbon
  onPickFile={(file) => {
    const fr = new FileReader();
    fr.onload = () => parseTextViaWorker(String(fr.result || ''));
    fr.readAsText(file);
  }}
  onParsePaste={() => { if (!pasteText.trim()) return; parseTextViaWorker(pasteText); }}
  pasteText={pasteText} setPasteText={setPasteText}
  metric={metric} setMetric={setMetric}
  collectUnparsed={collectUnparsed} setCollectUnparsed={setCollectUnparsed}
  compareOn={compareOn} setCompareOn={setCompareOn}
  pA={pA} setPA={setPA}
  pB={pB} setPB={setPB}
  players={names}
  onClearAB={() => { setPA(''); setPB(''); }}
  parsing={parsing}
  timelineStep={timelineStep} setTimelineStep={setTimelineStep}
  onOpenSummary={openSummary}
  onOpenPlayerSummary={openPlayerSummary}
/>

</div>

<EncounterSummary
  open={encOpen}
  onClose={() => setEncOpen(false)}
  basePerSrc={basePerSrc}
  segments={segments}
  deathEvents={deathEvents}
  
    excludeAliases={npcAliases}
    realPlayers={playersWithInferredClass}
  classOf={inferredClasses}
  allowedClasses={Array.from(ALLOWED_CLASSES)}
  />

<PlayerSummary
  open={psOpen}
  onClose={() => setPsOpen(false)}
  players={playersForSummary}
  selectedPlayers={psSelectedPlayers}
  onChangeSelectedPlayers={setPsSelectedPlayers}
  classOf={inferredClasses}
  duration={duration}
  damageEvents={damageEvents}
  healEvents={healEvents}
  utilityEvents={utilityEvents}
  deathEvents={deathEvents}
  perAbility={perAbility}
  utilityByPlayer={utilityByPlayer}
/>
<StarLoader show={encLoading || psLoading} subtitle={encLoading ? "Preparing encounter summary" : "Preparing player summary"} />


      {/* Timeline + segments UI */}
      <div className="card holoTimelineWrap" tabIndex={0}>

<div className="holoTimelineNoise" aria-hidden="true" />
<div className="holoTimelineScan" aria-hidden="true" />
<div className="holoCorner tl" aria-hidden="true" />
<div className="holoCorner tr" aria-hidden="true" />
<div className="holoCorner bl" aria-hidden="true" />
<div className="holoCorner br" aria-hidden="true" />

        <div className="abilitiesHeader" style={{ padding:'12px 14px', borderBottom:'1px solid #1b2738', display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
          <div style={{ alignSelf:'flex-start' }}><div style={{ fontSize:13, fontWeight:800, color:'#9fb7d8', letterSpacing:.3 }}>DPS Over Time - Top 10</div></div>
          <div className="row" style={{gap:8, alignItems:'center', justifyContent:'center', flexWrap:'wrap', width:'100%', marginTop:6}}>
            <label className="row" style={{gap:6}}><input type="checkbox" checked={smooth} onChange={e=>setSmooth(e.target.checked)} /><span className="pill">Smooth</span></label>
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <button
                className={"btn" + (timelineMode === 'summary' ? ' active' : '')}
                onClick={() => setTimelineMode('summary')}
                title="Aggregate view (Damage Done, Damage Taken, Healing Done)"
              >
                Summary Mode
              </button>
              <button
                className={"btn" + (timelineMode === 'compare' ? ' active' : '')}
                onClick={() => setTimelineMode('compare')}
                title="Show individual damage lines (Top 10)"
              >
                Compared Damage Mode
              </button>
            </div>
            <label className="row" style={{gap:6}}>
              <span className="pill">Idle gap (s)</span>
              <input className="input" style={{width:72}} type="number" min={30} step={10} value={idleGap} onChange={(e)=>setIdleGap(Math.max(10, Number(e.target.value||60)))} />
            </label>
            <label className="row" style={{gap:6}}>
              <span className="pill">Segments:</span>
              <select className="input" value={segIndex} onChange={e=>setSegIndex(Number(e.target.value))}>
                <option value={-1}>Full log</option>
                {[...segView.groups.entries()].map(([dungeon, items]) => (
                  <optgroup key={dungeon} label={dungeon}>
                    {items.map((s) => (
                      <option key={s.i} value={s.i}>
                        {s.dungeonShort ? `${s.dungeonShort} • ` : ''}{s.rangeText}
                      </option>
                    ))}
                  </optgroup>
                ))}
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

        {/* Timeline wrapper (no extra vertical slack) */}
        <div style={{ padding:0, width:'100%', display:'flex', flexDirection:'column' }}>
          {/* Main timeline */}
          <div style={{ position:'relative', height:330, width:'100%' }}>
            {hoverSummary && (
              <div
                style={{
                  position:'absolute',
                  right:12,
                  top:10,
                  zIndex:5,
                  padding:'8px 10px',
                  borderRadius:12,
                  background:'linear-gradient(180deg, rgba(10,18,34,0.92) 0%, rgba(8,14,26,0.88) 100%)',
                  border:'1px solid rgba(150,205,255,0.16)',
                  boxShadow:'0 14px 28px rgba(0,0,0,0.45)',
                  backdropFilter:'blur(10px)',
                  pointerEvents:'none',
                  minWidth: 210,
                }}
              >
                <div style={{ display:'flex', justifyContent:'space-between', gap:10, marginBottom:6 }}>
                  <div style={{ fontSize:12, fontWeight:950, color:'#d8ecff', letterSpacing:0.25 }}>
                    {toMMSS(hoverSummary.t)}
                  </div>
                  {timelineMode === 'summary' ? (
                    <div style={{ fontSize:11, color:'#7f9bc5', display:'flex', gap:10, flexWrap:'wrap', justifyContent:'flex-end' }}>
                      <span style={{ color:'#8fd3ff' }}>Dmg {fmt0(hoverSummary.row?.dmg || 0)}</span>
                      <span style={{ color:'#ff6b6b' }}>Taken {fmt0(hoverSummary.row?.taken || 0)}</span>
                      <span style={{ color:'#19c37d' }}>Heal {fmt0(hoverSummary.row?.heal || 0)}</span>
                      <span style={{ color:'#49e6a5' }}>Top8 Heal {fmt0(hoverSummary.row?.healTop8 || 0)}</span>
                    </div>
                  ) : (
                    <div style={{ fontSize:11, color:'#7f9bc5' }}>Total {fmt0(hoverSummary.total)}</div>
                  )}
                </div>
                {/* Top-8 breakdown (damage dealers), with dmg/taken/heal columns */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 84px 84px 84px', gap:8, fontSize:11, color:'#7f9bc5', marginTop:6, marginBottom:6 }}>
                  <div>Player</div>
                  <div style={{ textAlign:'right', color:'#8ecbff', fontWeight:800 }}>Dmg</div>
                  <div style={{ textAlign:'right', color:'#ff93ab', fontWeight:800 }}>Taken</div>
                  <div style={{ textAlign:'right', color:'#74f2c2', fontWeight:800 }}>Heal</div>
                </div>

                {(hoverSummary.breakdown || []).map((it: any, idx: number) => (
                  <div key={idx} style={{ display:'grid', gridTemplateColumns:'1fr 84px 84px 84px', gap:8, fontSize:12, marginBottom:4 }}>
                    <div style={{ minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'#cfe7ff' }}>{it.name}</div>
                    <div style={{ textAlign:'right', fontWeight:900, color:'#8ecbff' }}>{fmt0(it.dmg)}</div>
                    <div style={{ textAlign:'right', fontWeight:900, color:'#ff93ab' }}>{fmt0(it.taken)}</div>
                    <div style={{ textAlign:'right', fontWeight:900, color:'#74f2c2' }}>{fmt0(it.heal)}</div>
                  </div>
                ))}
                <div style={{ marginTop:6, fontSize:11, color:'#6f86a8' }}>
                  Drag to zoom • Double-click to reset
                </div>
              </div>
            )}

            <ResponsiveContainer width="100%" height="100%" debounce={200}>
              <LineChart
                onMouseLeave={() => { setFocusLine(null); scheduleHoverX(null); }}
                onMouseDown={(e:any)=>{ if(!e||e.activeLabel==null)return; setSelecting({x0:Number(e.activeLabel),x1:Number(e.activeLabel)}); }}
                onMouseMove={(e:any)=>{ if(e&&e.activeLabel!=null) scheduleHoverX(Number(e.activeLabel)); if(!selecting||!e||e.activeLabel==null) return; scheduleSelectingX1(Number(e.activeLabel)); }}
                onMouseUp={(e:any)=>{ if(!selecting) return; const {x0,x1}=selecting; setSelecting(null); if(Math.abs(x1-x0)>=1) commitWindow(x0,x1); }}
                onDoubleClick={()=> resetWindow()}
                data={timelineMode === 'summary' ? (summaryData as any) : (top10Data as any)}
                // Extra top margin so segment-band labels never clip
                margin={{ top: 40, right: 44, left: 26, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="tlGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(98,176,255,0.22)" />
                    <stop offset="100%" stopColor="rgba(98,176,255,0)" />
                  </linearGradient>
                </defs>
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
                domain={[0, (timelineMode === 'summary' ? maxYSummary : maxY) * 1.05]}
              />
              <Tooltip content={() => null} wrapperStyle={{ display: 'none' }} cursor={false} isAnimationActive={false} />
              <Customized component={renderSegBands} />
    
              {timelineMode === 'summary' ? (
                <>
                  {/* WarcraftLogs-style summary lines */}
                  <Line type="monotone" dataKey="dmg" name="Damage Done" stroke="#8fd3ff" strokeWidth={2.6} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="taken" name="Damage Taken" stroke="#ff6b6b" strokeWidth={2.6} dot={false} isAnimationActive={false} />
                  {/* Healing line back to classic green */}
                  <Line type="monotone" dataKey="heal" name="Healing Done" stroke="#19c37d" strokeWidth={2.6} dot={false} isAnimationActive={false} />
				      <Line type="monotone" dataKey="healTop8" name="Top 8 Healing Done" stroke="#49e6a5" strokeWidth={2.6} dot={false} isAnimationActive={false} />
                </>
              ) : (
                <>
              {/* Top-10 per-player lines */}
              {top10Series.map(({ name, color }) => {
                const selected = (name === pA || name === pB);
                const baseOpacity = hasSelection ? (selected ? 1 : 0.4) : 1;

                // Focus-line mode (FFLogs-style): when focusLine is set, fade all other lines
                const focusMatch = (!focusLine || focusLine === name);
                const opacity = baseOpacity * (focusMatch ? 1 : 0.12);
                const width = focusMatch ? (selected ? 3 : 2.6) : 1.2;



                return (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    name={name}
                    stroke={color}
                    strokeWidth={width}
                    strokeOpacity={opacity}  // dim non-selected
                    dot={false}
                    activeDot={{ r: 3 }}
                    isAnimationActive={false}
                  >
                    {/* label at the last point only */}
                    {topLabelNames.includes(name) && (

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
                    )}

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

                </>
              )}

                {selecting && (
                  <ReferenceArea
                    x1={Math.max(selecting.x0, selecting.x1)}
                    x2={Math.min(selecting.x0, selecting.x1)}
                    strokeOpacity={0}
                    fill="rgba(33,212,253,0.12)"
                  />
                )}
                {hoverX != null && !selecting && (
                  <ReferenceLine x={hoverX} stroke="#62b0ff" strokeDasharray="3 3" />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* (Removed) Overview + Brush */}
        </div>
      </div>


      {/* Parsing export button (copies a shareable snapshot to clipboard) */}
      <div className="exportWrap">
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
          <button className="exportBtn" onClick={handleParsingExport} disabled={exporting || !segments?.length || !exportReady}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>📸</span>
            {exporting ? "Exporting…" : (exportReady ? "Copy Parsing Export" : "Preparing Export…")}
          </button>
          <div className="exportSub">
            {exportToast ?? (exportReady
              ? "Copies a shareable snapshot (Damage / Healing / APM by segment) to your clipboard."
              : "Finishing class-color & segment prep… (export will enable automatically)")}
          </div>
        </div>
      </div>

      {/* Mode buttons under timeline */}
      <div className="tabbar">
        <button className={"tab" + (mode==='sources'?' active':'')} onClick={()=>setMode('sources')}>Sources</button>
        <button className={"tab" + (mode==='abilities'?' active':'')} onClick={()=>setMode('abilities')}>Abilities</button>
        <button className={"tab" + (mode==='statistics'?' active':'')} onClick={()=>setMode('statistics')}>Statistics</button>
        <button className={"tab" + (mode==='damageTaken'?' active':'')} onClick={()=>setMode('damageTaken')}>Damage Taken</button>
      </div>

      {mode==='sources' ? (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:16 }}>
          {renderPanel('Damage Done By Source', listDamage, rowsPlayers, 'Damage Dealt', mode, { label: 'Total Combat Damage Output (points)', tooltip: 'Sum of damage inflicted while in combat. Use this to compare raw output by source across the encounter. Totals reflect combat activity (not downtime) when the log provides it.' }, inferredClasses, undefined, pickFromChart)}
          {renderPanel('Healing Done By Source', listHealing, rowsPlayers, 'Healing Done', mode, { label: 'Total Healing Delivered (points)', tooltip: 'Total healing events attributed to the source. Includes effective healing captured in the log . Useful for identifying primary sustain and burst recovery.' }, inferredClasses, healingTooltipContent, pickFromChart)}
          {renderPanel(`Damage Taken By Source${(compareOn && (pA||pB)) ? ' — ' + (pA||pB) : ''}`, takenFor, rowsPlayers, 'Damage Taken', mode, { label: 'Incoming Damage Sustained (points)', tooltip: 'Total hostile damage received. High values often indicate frontline duty, focus fire, or tanking responsibility — not necessarily poor play. Compare alongside deaths and heals received.' }, inferredClasses)}
          {renderPanel('Actions per Minute (APM)', listAPM, rowsPlayers, 'APM', mode, { label: 'Actions per Minute (actions/min)', tooltip: 'How frequently abilities/actions were performed during combat. Higher APM generally means higher activity/uptime, but role matters (supports/controllers spike during key windows).' }, inferredClasses, apmTooltipContent, pickFromChart)}
        </div>
      ) : mode==='abilities' ? (
        <div className="card abilitiesCard" style={{ marginTop:16 }}>
          <div className="abilitiesHeader" style={{ padding:'12px 14px', borderBottom:'1px solid #1b2738', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ fontSize:13, fontWeight:800, color:'#9fb7d8', letterSpacing:.3 }}>Abilities — {(pA || names[0] || 'No player selected')}</div>
            <div className="row">
              <span className="pill">Click a bar to pick A (Shift+Click for B). Abilities show A (or top player).</span>
            </div>
          </div>
          <div ref={abilitiesScrollRef} onScroll={onAbilitiesScroll} className="abilitiesScroll scrollArea" style={{ padding:14, overflow:'auto' }}>
            <table className="table abilitiesTable">
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

    return (() => {
      const __sorted = (entries
      .map(([ability, v])=> ({
        ability,
        hits: v.hits,
        damage: v.dmg,
        avg: v.hits ? v.dmg / v.hits : 0,
        max: v.max
      })))
        .sort((a,b)=> b.damage - a.damage);

      const __rowH = 54;
      const __vh = abilitiesViewportH || 640;
      const __total = __sorted.length;
      const __start = Math.max(0, Math.floor(abilitiesScrollTop / __rowH) - 6);
      const __end = Math.min(__total, __start + Math.ceil(__vh / __rowH) + 12);
      const __top = __start * __rowH;
      const __bot = (__total - __end) * __rowH;

      const __slice = __sorted.slice(__start, __end);

      return ([
        __top ? (
          <tr style={{ height: __top }}>
            <td colSpan={8} style={{ padding: 0, border: 0 }} />
          </tr>
        ) : null,

        ...__slice.flatMap((r) => {

        const isOpen = openAbility === r.ability;
        const sharePct = total ? (r.damage / total) * 100 : 0;
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
              <td className="abilityCell">
                <div className="abilityMain" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    className="btn abilityToggle"
                    onClick={()=> setOpenAbility(isOpen ? '' : r.ability)}
                    aria-label={isOpen ? "Collapse ability" : "Expand ability"}
                    title={isOpen ? "Collapse" : "Expand"}
                  >
                    {isOpen ? '▾' : '▸'}
                  </button>

                  <div className="abilityText" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <div className="abilityTopRow">
                      <div className="abilityName">
                        {r.ability}
                        {isDoT ? <span className="abilityTag">DoT</span> : null}
                      </div>
                    </div>

                    <div className="abilityBar" title={`${Math.min(100, Math.max(0, sharePct)).toFixed(1)}% of player damage`}>
                      <div className="abilityBarFill" style={{ width: `${Math.min(100, Math.max(0, sharePct))}%` }} />
                    </div>
                  </div>
                </div>
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
        }),

        __bot ? (
          <tr style={{ height: __bot }}>
            <td colSpan={8} style={{ padding: 0, border: 0 }} />
          </tr>
        ) : null,
      ].filter(Boolean) as any);
    })();})()}
</tbody>

                         </table>
          </div>
        </div>
      ) : mode==='damageTaken' ? (
        <div style={{ display:'grid', gap:16, marginTop:16 }}>
          {/* Top row: snapshot + event feed */}
          <div style={{ display:'grid', gridTemplateColumns:'1.35fr 1fr', gap:16 }}>
            <div className="card death-snapshot-card" style={{ padding:14 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                <div style={{ fontSize:13, fontWeight:900, letterSpacing:.35, color:'#9fb7d8' }}>
                  Death Snapshot (last {DEATH_SNAPSHOT_SEC}s){selectedDeath ? ` — ${toMMSS(selectedDeath.t)}` : ''}
                </div>

                <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                  {deathsForPrimary.length > 1 && (
                    <select
                      value={selectedDeathKey}
                      onChange={(e)=>setSelectedDeathKey(e.target.value)}
                      className="holoDeathSelect"
                      style={{ height:28, padding:'0 10px', fontSize:12 }}
                      title="Choose a death to inspect"
                    >
                      {deathsForPrimary.map((d, i) => {
                        const key = String(d.t);
                        // best-effort killer name from last dmg event near the death time
                        const killerGuess = (() => {
                          const who = normalizeActorName(canonEntity(primaryPlayer));
                          const last = damageEvents
                            .filter(e => canonEntity(e.dst)===who && e.t <= d.t && e.t >= Math.max(0, d.t - 2))
                            .sort((a,b)=>b.t-a.t)[0];
                          return last ? canonDyn(last.src) : '—';
                        })();
                        return (
                          <option key={key} value={key}>
                            #{i+1} — {toMMSS(d.t)} — {killerGuess}
                          </option>
                        );
                      })}
                    </select>
                  )}

                  <div className="pill" style={{ fontSize:11 }}>
                    Damage: {fmt0(deathSnap?.totalDmg||0)}
                  </div>
                  <div className="pill" style={{ fontSize:11 }}>
                    Heals: {fmt0(deathSnap?.totalHeal||0)}
                  </div>
                  <div className="pill" style={{ fontSize:11 }}>
                    Utility: {deathSnap?.util?.length ? `${deathSnap.util.length} used` : 'none'}
                  </div>
                  <div className="pill" style={{ fontSize:11 }}>
                    Killing blow: {deathSnap?.killing ? `${fmt0(deathSnap.killing.amount)} (${canonDyn(deathSnap.killing.src)})` : '—'}
                  </div>
                </div>
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 14,
                padding: '6px 8px 2px',
                marginTop: 2,
                color: '#a8c6e8',
                fontSize: 12,
                userSelect: 'none'
              }}>
                <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                  <span style={{ width:10, height:10, borderRadius:2, background:'#62b0ff', opacity:0.75, boxShadow:'0 0 10px rgba(98,176,255,0.25)' }} />
                  Heals
                </span>
                <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                  <span style={{ width:10, height:10, borderRadius:2, background:'#ff5a6f', opacity:0.75, boxShadow:'0 0 10px rgba(255,90,111,0.22)' }} />
                  Damage
                </span>
                <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                  <span style={{ width:18, height:0, borderTop:'2px solid #7fc6ff', boxShadow:'0 0 10px rgba(127,198,255,0.22)' }} />
                  HP remaining
                </span>
                <span style={{ opacity:0.85 }}>Second</span>
              </div>

              <div style={{ height:260, width:'100%' }}>
                {deathSnap ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={deathSnap.chartSeries} margin={{ top: 10, right: 18, left: 10, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
                      <XAxis
                        dataKey="x"
                        type="number"
                        domain={[0, DEATH_SNAPSHOT_SEC]}
                        ticks={Array.from({ length: DEATH_SNAPSHOT_SEC + 1 }, (_, i) => i)}
                        tickFormatter={(v)=>`${Number(v).toFixed(0)}s`}
                      />

                      <YAxis
                        yAxisId="hp"
                        orientation="left"
                        domain={[0, deathSnap.startHP]}
                        tickFormatter={(v)=>fmt0(Number(v))}
                      />
                      <YAxis
                        yAxisId="evt"
                        orientation="right"
                        domain={[-deathSnap.maxEvt, deathSnap.maxEvt]}
                        tickFormatter={(v)=>fmt0(Math.abs(Number(v)))}
                      />

                      <Tooltip content={() => null} wrapperStyle={{ display: 'none' }} cursor={false} isAnimationActive={false} />

                                            <ReferenceLine yAxisId="evt" y={0} stroke="#7aa6d6" strokeDasharray="3 3" />
                      {/* NOTE: This chart declares custom Y axes (hp / evt). Recharts defaults
                         ReferenceLine/ReferenceArea to yAxisId=0 if unspecified, which throws.
                         Keep these markers pinned to the hp axis. */}
                      <ReferenceArea yAxisId="hp" x1={DEATH_SNAPSHOT_SEC - 1} x2={DEATH_SNAPSHOT_SEC} fillOpacity={0.06} />
                      <ReferenceLine
                        yAxisId="hp"
                        x={DEATH_SNAPSHOT_SEC}
                        stroke="#ff5a6f"
                        strokeDasharray="4 4"
                        label={{
                          value: deathSnap.killing
                            ? `Killing blow: ${fmt0(deathSnap.killing.amount)} • ${canonDyn(deathSnap.killing.src)}`
                            : 'Death',
                          position: 'insideTopRight',
                          fill: '#ff8ea0',
                          fontSize: 11,
                          fontWeight: 700
                        }}
                      />

                      <Bar yAxisId="evt" dataKey="heal" name="Heals" fill="#62b0ff" opacity={0.35} barSize={14} minPointSize={2} />
                      <Bar yAxisId="evt" dataKey="dmg" name="Damage" fill="#ff5a6f" opacity={0.35} barSize={14} minPointSize={2} />

                      <Line yAxisId="hp" type="monotone" dataKey="hp" name="HP remaining" stroke="#7fc6ff" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 4 }} />

                      {deathSnap.healLabels?.length ? (
                        <Scatter data={deathSnap.healLabels} dataKey="y" yAxisId="hp" fill="#62b0ff" name="Second" legendType="none">
                          <LabelList
                            dataKey="who"
                            content={(props:any) => {
                              const { x, y, value, index } = props;
                              if (x == null || y == null || !value) return null;
                              const txt = String(value);
                              const maxLen = 12;
                              const parts: string[] = [];
                              for (let i = 0; i < txt.length; i += maxLen) parts.push(txt.slice(i, i + maxLen));
                              const dy = -12 - ((index || 0) % 2) * 10;
                              return (
                                <text
                                  x={x}
                                  y={y + dy}
                                  textAnchor="middle"
                                  fontSize={11}
                                  fontWeight={800}
                                  fill="#62b0ff"
                                  stroke="rgba(0,0,0,0.65)"
                                  strokeWidth={3}
                                  paintOrder="stroke"
                                >
                                  {parts.map((p, i) => (
                                    <tspan key={i} x={x} dy={i === 0 ? 0 : 12}>{p}</tspan>
                                  ))}
                                </text>
                              );
                            }}
                          />
                        </Scatter>
                      ) : null}
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height:'100%', display:'flex', alignItems:'center', justifyContent:'center', color:'#92a8c8', fontSize:12 }}>
                    {primaryPlayer ? 'No deaths in the current window.' : 'Select a player (A) to view a death snapshot.'}
                  </div>
                )}
              </div>


              {deathSnap ? (
                <div style={{
                  marginTop:10,
                  paddingTop:10,
                  borderTop:'1px solid rgba(140,185,255,0.14)'
                }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8 }}>
                    <div style={{ fontSize:12, fontWeight:900, letterSpacing:.3, color:'#a9c1e6' }}>
                      Per-second breakdown
                    </div>
                    <div style={{ fontSize:11, color:'#7f9bc5' }}>
                      10 bins (T-10s → T-1s)
                    </div>
                  </div>

                  <div style={{
                    display:'grid',
                    gridTemplateColumns:`repeat(${DEATH_SNAPSHOT_SEC}, minmax(0, 1fr))`,
                    gap:8,
                    width:'100%',
                    overflowX:'auto',
                    paddingBottom:2
                  }}>
                    {Array.from({ length: DEATH_SNAPSHOT_SEC }, (_, i) => {
                      const row: any = deathSnap.chartSeries?.[i] ?? {};
                      const dmgAbs = Math.abs(Number(row.dmg) || 0);
                      const heal = Number(row.heal) || 0;

                      const hb: Record<string, number> = row.healBy ?? {};
                      const db: Record<string, number> = row.dmgBy ?? {};
                      const topHeal = Object.entries(hb).sort((a,b)=> (b[1] as number) - (a[1] as number))[0];
                      const topDmg  = Object.entries(db).sort((a,b)=> (b[1] as number) - (a[1] as number))[0];

                      return (
                        <div
                          key={i}
                          onMouseEnter={() => setDeathBinHover(i)}
                          onMouseLeave={() => setDeathBinHover((h) => (h === i ? null : h))}
                          style={{
                            position: 'relative',
                            borderRadius: 12,
                            padding: '10px 10px 8px',
                            background:
                              'linear-gradient(180deg, rgba(14,24,44,0.72) 0%, rgba(10,18,34,0.52) 100%)',
                            border: '1px solid rgba(130,180,255,0.14)',
                            boxShadow: '0 10px 24px rgba(0,0,0,0.22) inset',
                            minWidth: 0,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'baseline',
                              marginBottom: 8,
                            }}
                          >
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight: 950,
                                color: '#cfe2ff',
                                letterSpacing: 0.25,
                              }}
                            >
                              T-{DEATH_SNAPSHOT_SEC - i}s
                            </div>
                            <div style={{ fontSize: 11, color: '#7f9bc5' }}>
                              {i + 1}/{DEATH_SNAPSHOT_SEC}
                            </div>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <div
                              style={{
                                borderRadius: 10,
                                padding: '8px 8px 7px',
                                border: '1px solid rgba(114,200,255,0.16)',
                                background: 'rgba(18,34,56,0.45)',
                                minWidth: 0,
                              }}
                            >
                              <div style={{ fontSize: 11, color: '#88a7d6', marginBottom: 2 }}>
                                Heals
                              </div>
                              <div
                                style={{
                                  fontSize: 16,
                                  fontWeight: 950,
                                  color: '#7fd0ff',
                                  lineHeight: 1.1,
                                }}
                              >
                                {fmt0(heal)}
                              </div>
                              <div
                                style={{
                                  fontSize: 10,
                                  color: '#6f8fbf',
                                  marginTop: 4,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {topHeal ? `${topHeal[0]} (${fmt0(topHeal[1] as number)})` : '—'}
                              </div>
                            </div>

                            <div
                              style={{
                                borderRadius: 10,
                                padding: '8px 8px 7px',
                                border: '1px solid rgba(255,120,150,0.16)',
                                background: 'rgba(44,18,30,0.32)',
                                minWidth: 0,
                              }}
                            >
                              <div style={{ fontSize: 11, color: '#cba0b0', marginBottom: 2 }}>
                                Damage
                              </div>
                              <div
                                style={{
                                  fontSize: 16,
                                  fontWeight: 950,
                                  color: '#ff8aa6',
                                  lineHeight: 1.1,
                                }}
                              >
                                {fmt0(dmgAbs)}
                              </div>
                              <div
                                style={{
                                  fontSize: 10,
                                  color: '#a98a9a',
                                  marginTop: 4,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {topDmg ? `${topDmg[0]} (${fmt0(topDmg[1] as number)})` : '—'}
                              </div>
                            </div>
                          </div>

                          <div
                            style={{
                              marginTop: 8,
                              height: 6,
                              borderRadius: 999,
                              overflow: 'hidden',
                              background: 'rgba(120,160,220,0.14)',
                              border: '1px solid rgba(140,185,255,0.10)',
                            }}
                          >
                            {/* simple holonet “signal” bar: heal (left) vs damage (right) */}
                            {(() => {
                              const max = Math.max(1, Math.max(heal, dmgAbs));
                              const hPct = Math.min(100, (heal / max) * 100);
                              const dPct = Math.min(100, (dmgAbs / max) * 100);
                              return (
                                <div style={{ display: 'flex', width: '100%', height: '100%' }}>
                                  <div
                                    style={{
                                      width: `${hPct}%`,
                                      height: '100%',
                                      background: 'rgba(120,210,255,0.75)',
                                    }}
                                  />
                                  <div
                                    style={{
                                      width: `${dPct}%`,
                                      height: '100%',
                                      background: 'rgba(255,120,150,0.70)',
                                    }}
                                  />
                                  <div style={{ flex: 1 }} />
                                </div>
                              );
                            })()}
                          </div>

                          {deathBinHover === i ? (
                            <DeathSecondHoverPopup
                              i={i}
                              secondsTotal={DEATH_SNAPSHOT_SEC}
                              hb={hb}
                              db={db}
                              fmt0={fmt0}
                            />
                          ) : null}
                        </div>
                      );

                    })}
                  </div>
                </div>
              ) : null}

              <div style={{ marginTop:8, fontSize:11, color:'#87a0c6' }}>
                HP remaining is estimated (forced to hit 0 at death). Bars show per-second heals (up) and damage (down).
              </div>
            </div>

            <div className="card" style={{ padding:14 }}>
              <div style={{ fontSize:13, fontWeight:900, letterSpacing:.35, color:'#9fb7d8', marginBottom:10 }}>
                Event Feed
              </div>

              <div className="scrollArea" style={{ maxHeight:360, overflow:'auto', paddingLeft:24, paddingRight:28, scrollbarGutter:'stable both-edges' }}>
                {deathSnap?.feed?.length ? deathSnap.feed.slice(0, 60).map((e:any, i:number) => {
                  const rel = deathWindow ? (deathWindow.end - e.t) : 0;
                  const tLabel = `T-${rel.toFixed(2)}s`;
                  const kind = e.kind;
                  const badge =
                    kind==='damage' ? { bg:'rgba(255,90,111,.18)', fg:'#ff9aaa', label:'DMG' } :
                    kind==='heal' ? { bg:'rgba(98,176,255,.16)', fg:'#9fd0ff', label:'HEAL' } :
                    { bg:'rgba(180,160,255,.14)', fg:'#cabdff', label:'UTIL' };

                  const isKill = kind==='damage' && deathSnap.killing && e.t === deathSnap.killing.t && e.amount === deathSnap.killing.amount;

                  return (
                    <div
                      key={i}
                      style={{
                        display:'grid',
                        gridTemplateColumns:'70px 56px 1fr 110px',
                        gap:10,
                        alignItems:'center',
                        padding:'10px 10px',
                        border:'1px solid rgba(120,160,210,.12)',
                        borderRadius:12,
                        marginBottom:8,
                        background: isKill ? 'rgba(255,90,111,.08)' : 'rgba(0,0,0,0.08)'
                      }}
                    >
                      <div style={{ fontSize:11, color:'#9ab2d8', fontWeight:800 }}>{tLabel}</div>

                      <div style={{
                        justifySelf:'start',
                        fontSize:11,
                        fontWeight:900,
                        padding:'4px 8px',
                        borderRadius:999,
                        background: badge.bg,
                        color: badge.fg,
                        letterSpacing:.6
                      }}>
                        {badge.label}
                      </div>

                      <div style={{ minWidth:0 }}>
                        <div style={{ fontSize:12, color:'#d7e6ff', fontWeight:800, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                          {collapseAbility(e.ability)}
                        </div>
                        <div style={{ fontSize:11, color:'#8ea7cc', marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                          {canonDyn(e.src)} → {canonEntity(e.dst)}
                          {kind==='utility' ? ' (used)' : ''}
                        </div>
                      </div>

                      <div style={{ textAlign:'right', fontSize:13, fontWeight:900, color: kind==='damage' ? '#ffb1bc' : kind==='heal' ? '#bfe0ff' : '#d7d0ff' }}>
                        {kind==='utility' ? '—' : fmt0(e.amount)}
                      </div>
                    </div>
                  );
                }) : (
                  <div style={{ color:'#92a8c8', fontSize:12 }}>
                    {primaryPlayer ? 'No death feed available.' : 'Select a player (A) to view events.'}
                  </div>
                )}
              </div>
            </div>
          </div>


          {/* KPI row for Damage Taken */}
          <div className="kpi-grid">
            <div className="card kpi-card" style={{ padding:14 }}>
              <div className="kpi-accent" />
              <div className="kpi-title">Total Damage Taken</div>
              <div className="kpi-value mono">{fmt0(damageTakenKpisForPrimary.totalDamage)}</div>
              <div className="kpi-sub">Based on {fmt0(damageTakenKpisForPrimary.totalCount)} incoming hits</div>
            </div>

            <div className="card kpi-card" style={{ padding:14 }}>
              <div className="kpi-title">Elemental Split</div>
              <div style={{ marginTop:10, display:'flex', flexWrap:'wrap', gap:8, justifyContent:'center' }}>
                {Object.entries(damageTakenKpisForPrimary.elem)
                  .sort((a,b)=>(b[1] as number)-(a[1] as number))
                  .slice(0, 6)
                  .map(([k,v]) => {
                    const ratio = damageTakenKpisForPrimary.totalDamage ? (Number(v||0) / damageTakenKpisForPrimary.totalDamage) : 0;
                    return (
                      <span key={k} className="elemPill elemSplitPillSmall" data-elem={titleCase(k)}>
                        {titleCase(k)} {fmtPctElem(ratio)}
                      </span>
                    );
                  })}
              </div>
              <div style={{ fontSize:11, color:'#6f8db8', marginTop:10 }}>
                % of total incoming damage by element
              </div>
            </div>

            <div className="card kpi-card" style={{ padding:14 }}>
              <div className="kpi-title">Avg Armor Mitigation</div>
              <div className="kpi-value mono">
                {fmtPct(damageTakenKpisForPrimary.avgAbsorbedPct)}
              </div>
              <div className="kpi-sub">
                {fmt0(damageTakenKpisForPrimary.avgAbsorbed)} avg absorbed pts (hits with absorption)
              </div>
            </div>

            <div className="card kpi-card" style={{ padding:14 }}>
              <div className="kpi-title">Mitigated vs Unmitigated</div>
              <div style={{ display:'flex', justifyContent:'space-between', gap:12, marginTop:10 }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:11, color:'#6f8db8', fontWeight:800 }}>Mitigated</div>
                  <div style={{ fontSize:22, fontWeight:950 }} className="mono">{fmtPct(damageTakenKpisForPrimary.mitigatedRatio)}</div>
                </div>
                <div style={{ width:1, background:'rgba(128,160,210,.25)' }} />
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:11, color:'#6f8db8', fontWeight:800 }}>Unmitigated</div>
                  <div style={{ fontSize:22, fontWeight:950 }} className="mono">{fmtPct(damageTakenKpisForPrimary.unmitigatedRatio)}</div>
                </div>
              </div>
              <div style={{ fontSize:11, color:'#6f8db8', marginTop:6 }}>
                Mitigated = dodge/parry/block/glance/evade
              </div>
            </div>
          </div>

          {/* Bottom row: top attackers + incoming by ability */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            <div className="card" style={{ padding:14 }}>
              <div style={{ fontSize:13, fontWeight:900, letterSpacing:.35, color:'#9fb7d8', marginBottom:10 }}>
                Top Attackers
              </div>

              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8 }}>
  <div style={{ fontSize:11, color:'#7fa0ca' }}>
    Showing <span className="mono" style={{ color:'#cfe9ff', fontWeight:900 }}>{topAttackersForPrimary.length}</span> attackers
  </div>
  <div style={{ fontSize:11, color:'#6f8db8' }}>Hover bars for details</div>
</div>

<div className="scrollArea" style={{ maxHeight:320, overflow:'auto', paddingRight:6, paddingLeft:6 }}>
  <div style={{ height: Math.max(300, topAttackersForPrimary.length * 44) }}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        layout="vertical"
        data={topAttackersForPrimary}
        margin={{ top: 18, right: 180, left: 140, bottom: 16 }}
        barCategoryGap={18}
      >
        <CartesianGrid strokeDasharray="3 3" opacity={0.22} />
        <XAxis type="number" tickFormatter={fmt0} padding={{ right: 24 }} tick={{ fontSize: 13, fill: 'rgba(220,245,255,.72)' }} axisLine={false} tickLine={false} />
        <YAxis
          type="category"
          dataKey="name"
          width={150}
          tick={{ fontSize: 14, fill: 'rgba(230,250,255,.92)', fontWeight: 900 }}
          tickMargin={14}
          axisLine={false}
          tickLine={false}
          interval={0}
          tickFormatter={(v:any) => {
            const s = String(v ?? '');
            return s.length > 24 ? s.slice(0, 24) + '…' : s;
          }}
        />
        <Tooltip
          cursor={{ fill: 'rgba(130, 220, 255, 0.06)' }}
          content={({ active, payload }: any) => {
            if (!active || !payload?.length) return null;
            const p = payload[0];
            const name = String(p?.payload?.name ?? '');
            const val = Number(p?.value || 0);
            const pct = topAttackersTotalForPrimary ? (val / topAttackersTotalForPrimary) : 0;

            return (
              <div style={{
                pointerEvents:'none',
                padding:'10px 12px',
                borderRadius:12,
                background:'linear-gradient(180deg, rgba(10, 26, 46, 0.96), rgba(7, 16, 30, 0.92))',
                border:'1px solid rgba(120, 220, 255, 0.28)',
                boxShadow:'0 18px 40px rgba(0,0,0,0.45), 0 0 16px rgba(70, 190, 255, 0.10)',
                color:'rgba(220,245,255,0.96)',
                minWidth:220,
              }}>
                <div style={{ fontSize:12, fontWeight:900, letterSpacing:'.06em', textTransform:'uppercase' }}>Attacker</div>
                <div style={{ fontSize:14, fontWeight:950, marginTop:4 }}>{name}</div>
                <div style={{ display:'flex', justifyContent:'space-between', gap:12, marginTop:8 }}>
                  <div>
                    <div style={{ fontSize:11, color:'#7fa0ca', fontWeight:800 }}>Damage</div>
                    <div className="mono" style={{ fontSize:18, fontWeight:950 }}>{fmt0(val)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize:11, color:'#7fa0ca', fontWeight:800 }}>Share</div>
                    <div className="mono" style={{ fontSize:18, fontWeight:950 }}>{fmtPct(pct)}</div>
                  </div>
                </div>
              </div>
            );
          }}
        />
        <Bar
          dataKey="value"
          barSize={24}
          radius={[12, 12, 12, 12]}
          background={{ fill: 'rgba(255,255,255,0.04)' }}
          isAnimationActive={false}
        >
          {topAttackersForPrimary.map((d:any, i:number) => (
            <Cell key={i} fill={classColor(inferredClasses?.[d.name] || '')} opacity={0.92} />
          ))}
          <LabelList dataKey="value" content={renderTopAttackerValueLabel} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  </div>
</div>
            </div>

            <div className="card" style={{ padding:14 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                <div style={{ fontSize:13, fontWeight:900, letterSpacing:.35, color:'#9fb7d8' }}>
                  Incoming Damage By Ability
                </div>
                <div style={{ fontSize:11, color:'#89a3c8' }}>Element • ST% • D/P/B counts</div>
              </div>

              <div className="scrollArea" style={{ maxHeight:260, overflow:'auto' }}>
                <table className="table incomingTable mono" style={{ width:'100%' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign:'left' }}>Ability</th>
                      <th>Elem</th>
                      <th>Hits</th>
                      <th>Damage</th>
                      <th>Avg</th>
                      <th>Max</th>
                      <th>Crit%</th>
                      <th>Glance%</th>
                      <th>ST%</th>
                      <th>D</th>
                      <th>P</th>
                      <th>B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incomingByAbilityForPrimary.slice(0, 80).map((r:any, i:number) => (
                      <tr key={i}>
                        <td style={{ textAlign:'left', maxWidth:240, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }} title={r.ability}>{r.ability}</td>
                        <td><span className="elemPill" data-elem={r.elemTop}>{r.elemTop}</span></td>
                        <td>{fmt0(r.hits)}</td>
                        <td>{fmt0(r.damage)}</td>
                        <td>{fmt0(r.avg)}</td>
                        <td>{fmt0(r.max)}</td>
                        <td>{fmtPct(r.critPct)}</td>
                        <td>{fmtPct(r.glancePct)}</td>
                        <td>{fmtPct(r.stPct)}</td>
                        <td>{fmt0(r.dodge)}</td>
                        <td>{fmt0(r.parry)}</td>
                        <td>{fmt0(r.block)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop:8, fontSize:11, color:'#87a0c6' }}>
                ST% = strikethrough rate observed on incoming hits. D/P/B are counts in the current window.
              </div>
            </div>
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

      <StarLoader show={encLoading || psLoading} subtitle={encLoading ? "Preparing encounter summary" : "Preparing player summary"} />
</ErrorBoundary>;
}

/* ========================= Shared panel renderer ========================= */

type AxisFooterSpec = { label: string; tooltip: string };


function HolonetTimelineTooltip({
  active,
  label,
  payload,
  onFocus,
}: {
  active?: boolean;
  label?: any;
  payload?: any[];
  onFocus?: (name: string | null) => void;
}) {
  if (!active || label == null || !payload || payload.length === 0) return null;

  const items = (payload || [])
    .filter((p: any) => typeof p?.value === "number" && p.value > 0)
    .sort((a: any, b: any) => (b.value as number) - (a.value as number))
    .slice(0, 6);

  return (
    <div
      onMouseLeave={() => onFocus?.(null)}
      style={{
        pointerEvents: "auto",
        padding: "10px 12px",
        borderRadius: 12,
        background:
          "linear-gradient(180deg, rgba(10, 26, 46, 0.96), rgba(7, 16, 30, 0.92))",
        border: "1px solid rgba(120, 220, 255, 0.28)",
        boxShadow: "0 18px 40px rgba(0,0,0,0.45), 0 0 16px rgba(70, 190, 255, 0.10)",
        color: "rgba(220,245,255,0.96)",
        minWidth: 220,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {toMMSS(Number(label))}
      </div>
      <div style={{ height: 6 }} />
      {items.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.85 }}>No activity</div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {items.map((it: any) => (
            <div key={String(it.dataKey)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    background: it.stroke || "rgba(120,220,255,0.9)",
                    boxShadow: "0 0 10px rgba(70, 200, 255, 0.18)",
                    flex: "0 0 auto",
                  }}
                />
                <span style={{ fontSize: 12, opacity: 0.92, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {it.name || it.dataKey}
                </span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 800 }}>{fmt0(it.value)}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 8, fontSize: 11, opacity: 0.65 }}>
        Showing top {items.length} at this moment
      </div>
    </div>
  );
}

function HolonetAxisFooter({ spec, tabKey }: { spec: AxisFooterSpec; tabKey: string }) {
  const [open, setOpen] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  return (
    <div className="holoAxisFooterWrap" onMouseLeave={() => setOpen(false)} style={{ position: "relative" }}>
      <div className="holoAxisFooterScan" aria-hidden="true" />
      <div className="holoAxisFooterRow">
        <div
          key={tabKey + "|" + spec.label}
          className="holoAxisFooterLabel"
          style={{ animation: "pillPop 520ms cubic-bezier(.2,.9,.2,1) both" }}
        >
          <span className="holoDot" aria-hidden="true" style={{ width: 7, height: 7 }} />
          <span>{spec.label}</span>
        </div>

        <div
          className="holoAxisFooterChip"
          onMouseEnter={() => setOpen(true)}
          onFocus={() => setOpen(true)}
          tabIndex={0}
          aria-label="Metric info"
        >
          i
        </div>

        {open && (
          <div className="holoAxisFooterTip" role="tooltip">
            <div className="holoAxisFooterTipTitle">Holonet Briefing</div>
            <div style={{ opacity: 0.92 }}>{spec.tooltip}</div>
            <div className="holoAxisFooterTipPointer" aria-hidden="true" />
          </div>
        )}
      </div>
    </div>
  );
}



function renderPanel(
  title: string,
  list: { name: string; value: number }[],
  rows: PlayerRow[],
  seriesName: string,
  tabKey: string,
  axisFooter?: AxisFooterSpec,
  inferredClasses: Record<string, string> = {},
  tooltipContent?: any,
  onPick?: (name: string, ev?: any) => void,
) {
  return <div className="card holo-panel" data-holo-card="1" data-holo-card-id={`${tabKey}:${seriesName}`}>
    <div className="abilitiesHeader" style={{ padding:'12px 14px', borderBottom:'1px solid #1b2738', display:'flex', justifyContent:'space-between' }}>
      <div style={{ fontSize:13, fontWeight:800, color:'#9fb7d8', letterSpacing:.3, display:'flex', alignItems:'center', gap:8 }}>
        <span className="holoDot" aria-hidden="true" />
        <span>{title}</span>
      </div>
      <div><ClassLegend /></div>
    </div>
    <div className="holoChartFrame" style={{ padding:14, height:430, display:"flex", flexDirection:"column", gap:10 }}>
      <div className="holo-scanlines" aria-hidden="true" />
      <div className="holo-vignette" aria-hidden="true" />
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%" debounce={200}>
          <BarChart data={list} layout="vertical" margin={{ top:6, right:120, left:20, bottom:6 }} barCategoryGap="28%" barGap={6}>
          <defs>
            <filter id="holoGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#7fd0ff" floodOpacity="0.35" />
              <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#1b5b8e" floodOpacity="0.25" />
            </filter>
          </defs>
          <CartesianGrid horizontal={false} strokeDasharray="3 3" />
          <YAxis type="category" dataKey="name"
                 width={Math.max(160, Math.min(360, 16 + list.reduce((m,i)=>Math.max(m,(i.name||'').length),0)*8))}
                 interval={0} tick={{ fill: "#cfe3ff", fontSize: 12 }} tickLine={false} axisLine={false} />
          <XAxis type="number" tickFormatter={(v:number)=> fmt0(v)} tick={{ fill: "#9bb7df" }} />
          {tooltipContent ? (
            <Tooltip isAnimationActive={false} content={tooltipContent} wrapperStyle={{ zIndex: 99999, pointerEvents: 'none' }} allowEscapeViewBox={{ x: true, y: true }} />
          ) : (
            <Tooltip isAnimationActive={false} formatter={(v:number)=> fmt0(v)} labelFormatter={(l)=> l as string} wrapperStyle={{ zIndex: 99999, pointerEvents: 'none' }} allowEscapeViewBox={{ x: true, y: true }} />
          )}

          <Bar
            dataKey="value"
            name={seriesName}
            radius={[4,4,4,4]}
            isAnimationActive={false}
            onClick={(data:any, _idx:number, ev:any)=> onPick?.(String(data?.payload?.name||''), ev)}
          >
            <LabelList dataKey="value" content={barValuePillOutsideRight} />
            {list.map((it, i)=> <Cell key={'c'+i} fill={classColor(inferredClasses[it.name])} />)}
          </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {axisFooter ? <HolonetAxisFooter spec={axisFooter} tabKey={tabKey} /> : null}
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
      style={{ pointerEvents: "auto" }}
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
          style={{ pointerEvents: "auto" }}
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