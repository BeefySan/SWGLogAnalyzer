
import React, { useMemo, useEffect } from "react";
import {
  ResponsiveContainer,
  BarChart, Bar, Cell,
  XAxis, YAxis,
  Tooltip, CartesianGrid,
  LabelList
} from "recharts";

type Segment = { start: number; end: number; label: string };

type Props = {
  open: boolean;
  onClose: () => void;
  basePerSrc: Record<string, number[]>;
  segments: Segment[];
  deathEvents: Array<{ t: number; name: string }>;

  // optional filters / class info
  realPlayers?: string[];
  excludePlayers?: string[];
  excludeAliases?: string[];
  classOf?: Record<string, string>;
  allowedClasses?: string[];
};

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });



// === Class color map (canonical + normalized) ===
const RAW_CLASS_COLORS: Record<string,string> = {
  Jedi:'#00B3FF','Bounty Hunter':'#C41E3A', Commando:'#C69B6D', Officer:'#ABD473',
  Spy:'#FFF569', Medic:'#8787ED', Smuggler:'#F48CBA', Entertainer:'#FF8800', Trader:'#8F8F8F'
};
// normalized (lowercase) lookup
const CLASS_COLORS: Record<string,string> = Object.fromEntries(
  Object.entries(RAW_CLASS_COLORS).map(([k,v]) => [k.toLowerCase(), v])
);
// default color if class missing
const classColor = (p?:string)=> CLASS_COLORS[(p||'').toLowerCase()] || '#6ec7ff';
// legend order
const LEGENDS_CLASSES = ['Jedi','Bounty Hunter','Commando','Officer','Spy','Medic','Smuggler','Entertainer','Trader'];

// get canonical display name for a normalized class key (e.g., 'bounty hunter' -> 'Bounty Hunter')
const displayClass = (clsNorm: string): string => {
  for (const key of Object.keys(RAW_CLASS_COLORS)) {
    if (key.toLowerCase() === clsNorm) return key;
  }
  // fallback capitalize
  return clsNorm.replace(/\b\w/g, c => c.toUpperCase());
};

const norm = (s: string) => (s || "").toLowerCase().trim();

// case-insensitive fetch from classOf map
function getClassFor(map: Record<string,string> | undefined, name: string): string {
  if (!map) return "";
  if ((map as any)[name]) return (map as any)[name];
  const ln = (name || "").toLowerCase();
  if ((map as any)[ln]) return (map as any)[ln];
  const normKey = (v:string) => (v||"").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
  const target = normKey(name);
  for (const k in map) {
    if (normKey(k) === target) return (map as any)[k] || "";
  }
  return "";
}
function formatShort(n: number): string {
  const abs = Math.abs(n);
  const fmt = (v:number) => v.toFixed(2).replace(/\.00$/, "");
  if (abs >= 1e9) return fmt(n/1e9) + "b";
  if (abs >= 1e6) return fmt(n/1e6) + "m";
  if (abs >= 1e3) return fmt(n/1e3) + "k";
  return Math.round(n).toString();
}

function buildFunFacts(
  basePerSrc: Record<string, number[]>,
  seg: { start: number; end: number },
  rows: Array<{ name:string; dmg:number; dpsAvg:number; ramp:number; peak:number }>,
  deaths: string[]
) {
  const names = rows.map(r => r.name);
  const total = rows.reduce((a,r) => a + r.dmg, 0);

  const openEnd = Math.min(seg.end, seg.start + 10);
  const closeStart = Math.max(seg.start, seg.end - 10);
  const sumWindow = (start:number, end:number) =>
    Object.fromEntries(names.map(n => [n, sumRange(basePerSrc[n] || [], start, end)]));

  const open = sumWindow(seg.start, openEnd);
  const close = sumWindow(closeStart, seg.end);

  const topOpen  = names.map(n => ({ name:n, v: open[n]  || 0 })).sort((a,b)=>b.v-a.v)[0];
  const topClose = names.map(n => ({ name:n, v: close[n] || 0 })).sort((a,b)=>b.v-a.v)[0];
  const biggestCloser = names.map(n => ({ name:n, v:(close[n]||0)-(open[n]||0) })).sort((a,b)=>b.v-a.v)[0];

  const mvp = rows.slice().sort((a,b)=>b.dmg-a.dmg)[0];
  const share = total>0 ? (mvp.dmg/total) : 0;

  const topDps = rows.slice().sort((a,b)=>b.dpsAvg-a.dpsAvg)[0];
  const ramp   = rows.filter(r=>isFinite(r.ramp) && r.peak>0).slice().sort((a,b)=>a.ramp-b.ramp)[0];

  const over1m = rows.filter(r => r.dmg >= 1_000_000).length;
  const over500k = rows.filter(r => r.dmg >= 500_000).length;

  const half = total * 0.5;
  let halfN = 0, run = 0;
  for (const r of rows.slice().sort((a,b)=>b.dmg-a.dmg)) {
    run += r.dmg; halfN++;
    if (run >= half) break;
  }

  const facts:string[] = [];
  if (mvp)     facts.push(`${mvp.name} did ${formatShort(mvp.dmg)} (${(share*100).toFixed(1)}% of team dmg).`);
  if (topDps)  facts.push(`Top sustained DPS: ${topDps.name} at ${formatShort(topDps.dpsAvg)} avg DPS.`);
  if (ramp)    facts.push(`Fastest ramp: ${ramp.name} peaked in ${ramp.ramp}s (burst ${formatShort(ramp.peak)}).`);
  if (topOpen) facts.push(`Best opener: ${topOpen.name} for ${formatShort(topOpen.v)} in the first 10s.`);
  if (topClose)facts.push(`Best finisher: ${topClose.name} for ${formatShort(topClose.v)} in the last 10s.`);
  if (biggestCloser && biggestCloser.v > 0)
              facts.push(`Biggest closer: ${biggestCloser.name} out-damaged opener by ${formatShort(biggestCloser.v)}.`);
  if (over1m)  facts.push(`${over1m} player(s) broke 1M damage.`);
  if (!over1m && over500k) facts.push(`${over500k} player(s) broke 500k damage.`);
  if (rows.length) facts.push(`Top ${halfN} player(s) produced 50% of team damage.`);
  const segLen = Math.max(0, seg.end - seg.start);
  facts.push(`Segment length: ${segLen}s.`);
  if (deaths.length) facts.push(`RIP: ${deaths.join(", ")}.`);
  else facts.push(`Flawless: no deaths.`);

  for (let i = facts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [facts[i], facts[j]] = [facts[j], facts[i]];
  }
  return facts.slice(0, 5);
}


function sumRange(arr: number[] | undefined, s: number, e: number) {
  if (!arr || !arr.length) return 0;
  const s0 = Math.max(0, Math.min(s | 0, arr.length - 1));
  const e0 = Math.max(0, Math.min(e | 0, arr.length - 1));
  let total = 0;
  for (let i = s0; i <= e0; i++) total += arr[i] || 0;
  return total;
}
function maxWithIndex(arr: number[] | undefined, s: number, e: number) {
  if (!arr || !arr.length) return { max: 0, idx: -1 };
  let m = -Infinity, mi = -1;
  const s0 = Math.max(0, Math.min(s | 0, arr.length - 1));
  const e0 = Math.max(0, Math.min(e | 0, arr.length - 1));
  for (let i = s0; i <= e0; i++) {
    const v = arr[i] || 0;
    if (v > m) { m = v; mi = i; }
  }
  return { max: m > 0 ? m : 0, idx: m > 0 ? mi : -1 };
}

function analyzeSegment(basePerSrc: Record<string, number[]>, seg: Segment, opts?: {
  realPlayers?: string[];
  excludePlayers?: string[];
  excludeAliases?: string[];
  classOf?: Record<string,string>;
  allowedClasses?: string[];
}) {
  const allowedSet = new Set((opts?.allowedClasses || []).map(c => norm(c)));
  const realSet    = new Set((opts?.realPlayers || []).map(n => n));
  const excludeSet = new Set((opts?.excludePlayers || []).map(n => n));
  const aliasList  = (opts?.excludeAliases || []).map(a => norm(a));
  const hasAllowed = allowedSet.size > 0;

  const names = Object.keys(basePerSrc).filter(name => {
    if (excludeSet.has(name)) return false;
    const nn = norm(name);
    if (aliasList.length && aliasList.some(a => nn.includes(a))) return false;
    if ((opts?.realPlayers && opts.realPlayers.length > 0) && !realSet.has(name)) return false;
    if (!opts?.realPlayers && hasAllowed && opts?.classOf) {
      const cls = norm(opts.classOf[name] || "");
      if (!allowedSet.has(cls)) return false;
    }
    return true;
  });

  const rows = names.map(name => {
    const series = basePerSrc[name] || [];

    const dmg = sumRange(series, seg.start, seg.end);
    const { max, idx } = maxWithIndex(series, seg.start, seg.end);
    const ramp = idx >= 0 ? Math.max(0, idx - seg.start) : Number.POSITIVE_INFINITY;
    const dpsAvg = (seg.end > seg.start) ? dmg / Math.max(1, (seg.end - seg.start)) : 0;
    return { name, dmg, dpsAvg, ramp, peak: max };
  });

  const sortedByDmg = [...rows].sort((a, b) => b.dmg - a.dmg);
  const sortedByDps = [...rows].sort((a, b) => b.dpsAvg - a.dpsAvg);
  const topDamage   = sortedByDmg[0];
  const topDps      = sortedByDps[0];
  const rampSorted  = rows.filter(r => isFinite(r.ramp) && r.peak > 0).sort((a, b) => a.ramp - b.ramp);
  const bestRamp    = rampSorted[0];
  const top8        = sortedByDmg.slice(0, 8).map(r => ({ name: r.name, value: Math.round(r.dmg), color: classColor(getClassFor(opts?.classOf, r.name)) }));

    // opener: most damage in first 10 seconds of the segment
  const openerWindow = 10;
  const openerRows = names.map(name => { const series = basePerSrc[name] || [];
    const oEnd = Math.min(seg.end, seg.start + openerWindow);
    const openDmg = sumRange(series, seg.start, oEnd);
    return { name, openDmg };
  }).sort((a,b)=> b.openDmg - a.openDmg);
  const topOpener = openerRows[0];

  return { rows, topDamage, topDps, bestRamp,  top8, topOpener };

}

export default function EncounterSummary({ open, onClose, basePerSrc, segments, deathEvents, realPlayers, excludePlayers, excludeAliases, classOf, allowedClasses }: Props) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const segResults = useMemo(() => {
    return (segments || []).map(seg => {
      const res = analyzeSegment(basePerSrc, seg, { realPlayers, excludePlayers, excludeAliases, classOf, allowedClasses });
      const deaths = (deathEvents || []).filter(d => d.t >= seg.start && d.t <= seg.end).map(d => d.name);
      const funFacts = buildFunFacts(basePerSrc, seg, res.rows || [], deaths);
      return { seg, deaths, ...res, funFacts };
    });
  }, [segments, basePerSrc, deathEvents, realPlayers, excludePlayers, excludeAliases, classOf, allowedClasses]);

  if (!open) return null;

  return (
    <>

    <div className="enc-summary-overlay" />
    <style>{`
      .enc-summary-overlay {
        position: fixed;
        inset: 0;
        background:
          linear-gradient(180deg, rgba(5,10,20,0.82), rgba(5,10,20,0.88)),
          url(/background.jpg) center/cover no-repeat,
          url(/background.png) center/cover no-repeat;
        z-index: 9998;
        backdrop-filter: blur(2px);
      }
    `}</style>

    <div className="enc-modal" role="dialog" aria-modal="true">
      {/* Put backdrop FIRST and behind the card */}
      <div className="enc-backdrop enc-fade-in" onClick={onClose} />
      <div className="enc-card enc-pop-in">
        <div className="enc-head">
          <div className="enc-title">Encounter Summary</div>
          <button className="enc-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="enc-body">
          {segResults.length === 0 && (
            <div className="enc-section">
              <div className="enc-sub">No segments detected.</div>
              <div className="enc-note">Tip: Increase/adjust <b>Idle gap</b> and re-scan.</div>
            </div>
          )}

          {segResults.map(({ seg, topDamage, topDps, bestRamp,  top8, topOpener, deaths, funFacts }, i) => (
            <div key={i} className="enc-section enc-fade-in">
              <div className="enc-sub">
                <span className="enc-chip">SEGMENT</span>
                <span className="enc-seg">{seg.label || `Period ${seg.start}–${seg.end} (${seg.end - seg.start}s)`}</span>
              </div>

              <div className="enc-grid">
                <div className="enc-tile">
                  <div className="enc-k">Top Damage</div>
                  <div className="enc-v">{topDamage?.name || '—'}</div>
                  <div className="enc-s">{topDamage ? nf0.format(Math.round(topDamage.dmg)) + " dmg" : "—"}</div>
                </div>
                <div className="enc-tile">
                  <div className="enc-k">Top DPS</div>
                  <div className="enc-v">{topDps?.name || '—'}</div>
                  <div className="enc-s">{topDps ? nf0.format(Math.round(topDps.dpsAvg)) + " avg DPS" : "—"}</div>
                </div>
                <div className="enc-tile">
                  <div className="enc-k">Best Ramp-Up</div>
                  <div className="enc-v">{bestRamp?.name || '—'}</div>
                  <div className="enc-s">
                    {bestRamp ? `${bestRamp.ramp | 0}s to peak (${nf0.format(Math.round(bestRamp.peak))} DPS)` : "—"}
                  </div>
                </div>

                <div className="enc-chart">
                  <div className="enc-chart-title">Top 8 — Damage Comparison</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={top8} margin={{ left: 24, right: 24, top: 24, bottom: 8 }}>
                      <CartesianGrid stroke="rgba(120,170,255,.18)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={formatShort} domain={[0, (dataMax: number) => dataMax * 1.15]} />
                      <Tooltip />
                      <Bar dataKey="value">
                        {top8.map((d, i) => (<Cell key={i} fill={d.color} />))}
                        <LabelList dataKey="value" position="top" formatter={(v: any) => formatShort(Number(v))} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="enc-tile enc-wide">
                  <div className="enc-k">Fun Facts</div>
                  {funFacts && funFacts.length ? (
                    <ul className="enc-list">
                      {funFacts.map((t, idx) => (
                        <li key={idx}>{t}</li>
                      ))}
                    </ul>
                  ) : <div className="enc-s">—</div>}
                </div>

                <div className="enc-tile">
                  <div className="enc-k">Fallen Heroes</div>
                  {deaths.length
                    ? <div className="enc-s">{deaths.join(", ")} <span aria-hidden>😢</span></div>
                    : <div className="enc-s">No deaths this segment. <span aria-hidden>🛡️</span></div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .enc-modal{ position:fixed; inset:0; z-index:9999; pointer-events:none; }
        .enc-backdrop{ position:absolute; inset:0; background:transparent; pointer-events:auto; z-index:0; }
        .enc-card{
          position:absolute; left:50%; top:7%; transform: translateX(-50%);
          width:min(1100px, 94vw); max-height: 86vh; overflow:auto; overscroll-behavior:contain;
          background: linear-gradient(180deg, rgba(20,36,64,.98), rgba(16,30,52,.98));
          border:1px solid rgba(120,170,255,.5);
          box-shadow: 0 18px 60px rgba(0,0,0,.55), 0 0 0 2px rgba(33,212,253,.20) inset;
          border-radius:16px; padding:16px; pointer-events:auto; color:#eaf3ff; z-index:1;
        }
        .enc-pop-in{ animation: enc-pop .18s ease-out; }
        @keyframes enc-pop{ from{ transform: translateX(-50%) scale(.96); opacity:.0 } to{ transform: translateX(-50%) scale(1); opacity:1 } }
        .enc-fade-in{ animation: enc-fade .25s ease-out; }
        @keyframes enc-fade{ from{ opacity:0; transform: translateY(4px) } to{ opacity:1; transform:none } }

        .enc-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:8px }
        .enc-title{ font-weight:900; letter-spacing:.08em; font-size:20px; text-transform:uppercase }
        .enc-x{ background:transparent; border:1px solid rgba(120,170,255,.45); color:#eaf3ff; border-radius:10px; padding:6px 10px; cursor:pointer }

        .enc-body{ display:flex; flex-direction:column; gap:14px }
        .enc-section{ border:1px solid rgba(120,170,255,.32); border-radius:12px; padding:12px }
        .enc-sub{ display:flex; align-items:center; gap:8px; margin-bottom:10px }
        .enc-chip{ font-size:10px; letter-spacing:.12em; padding:3px 8px; border-radius:999px; border:1px solid rgba(120,170,255,.45) }
        .enc-seg{ font-weight:800; color:#cfe3ff }

        .enc-grid{ display:grid; grid-template-columns: repeat(12, 1fr); gap:10px }
        .enc-tile{ grid-column: span 3; background:rgba(12,22,38,.65); border:1px solid rgba(120,170,255,.22); border-radius:10px; padding:10px }
        .enc-tile.enc-wide{ grid-column: span 6; }
        .enc-k{ font-size:12px; color:#9fb7d8; letter-spacing:.06em; text-transform:uppercase }
        .enc-v{ font-size:18px; font-weight:900 }
        .enc-s{ font-size:12px; opacity:.9 }

        .enc-chart{ grid-column: span 6; background:rgba(12,22,38,.65); border:1px solid rgba(120,170,255,.22); border-radius:10px; padding:6px }
        .enc-chart-title{ font-size:12px; color:#9fb7d8; letter-spacing:.06em; text-transform:uppercase; padding:6px 8px }
        .enc-list{ margin:6px 0 0 14px; display:flex; flex-direction:column; gap:4px }
        .enc-tip{ margin-left:8px; opacity:.8; font-size:12px }

/* Tiles: subtle lift + glow */
.enc-tile{ transition: transform .12s ease, box-shadow .18s ease; }
.enc-tile:hover{
  transform: translateY(-2px);
  box-shadow: 0 8px 26px rgba(0,0,0,.35), 0 0 0 1px rgba(120,170,255,.25) inset;
}

/* Chart frame shine */
.enc-chart{
  position: relative;
  overflow: hidden;
}
.enc-chart::after{
  content:"";
  position:absolute; inset:-1px;
  background: radial-gradient(120% 60% at 50% -10%, rgba(160,210,255,.15), rgba(0,0,0,0) 60%);
  pointer-events:none;
}

/* Section pulse separator */
.enc-section{ position:relative; }
.enc-section::before{
  content:"";
  position:absolute; left:12px; right:12px; top:-2px; height:2px;
  background: linear-gradient(90deg, rgba(33,212,253,.0), rgba(33,212,253,.45), rgba(33,212,253,.0));
  filter: blur(0.6px);
  opacity:.55;
  animation: enc-glowline 3.4s ease-in-out infinite;
}
@keyframes enc-glowline{
  0%,100%{ opacity:.35; transform: translateX(-2%) }
  50%   { opacity:.85; transform: translateX(2%)  }
}

      `}</style>
    </div>
      </>
  );
}
