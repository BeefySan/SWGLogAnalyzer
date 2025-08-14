import React, { useEffect, useMemo, useRef, useState } from "react";
import ErrorBoundary from "./ErrorBoundary";
import {
  ResponsiveContainer,
  AreaChart, Area, LineChart, Line,
  CartesianGrid, XAxis, YAxis, Tooltip, Legend,
  BarChart, Bar, LabelList, Cell
} from "recharts";

/* ========================= Utilities & Types ========================= */

type MetricKey = 'damageDealt'|'avgDps'|'healingDone';
type PlayerRow = { name:string; profession?:string; damageDealt:number; healingDone:number; avgDps:number };

type DamageEvent = {
  t: number;          // seconds from start
  src: string;        // attacker
  dst: string;        // target
  ability: string;
  amount: number;
  flags?: string;     // e.g., 'crit', 'glance', 'periodic'
};

type HealEvent = {
  t: number;
  src: string;        // healer
  dst: string;
  ability: string;
  amount: number;
};

type PerAbility = Record<string, Record<string, { hits:number; dmg:number; max:number }>>;
type PerAbilityTargets = Record<string, Record<string, Record<string, { hits:number; dmg:number; max:number }>>>;

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const fmt0 = (v?:number|null)=> nf0.format(Math.round(Number(v||0)));
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
  { npc: 'exar kun', inst: 'Exar Kun' },
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
  const [duration, setDuration] = useState<number>(0);
  const [debug, setDebug] = useState<any>(null);

  // filtered (by segment) derived state
  const [rows, setRows] = useState<PlayerRow[]>([]);
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
  const [mode, setMode] = useState<'sources'|'abilities'>('sources');
  const [smooth, setSmooth] = useState(true);
  const workerRef = useRef<Worker|null>(null);

  // segmentation
  const [idleGap, setIdleGap] = useState<number>(60); // default 60s
  const [segments, setSegments] = useState<Array<{start:number; end:number; label:string}>>([]);
  const [segIndex, setSegIndex] = useState<number>(-1);

  // ability expand
  const [openAbility, setOpenAbility] = useState<string>('');

  /* -------------------- worker / parsing -------------------- */
  function ensureWorker(){
    if (workerRef.current) return workerRef.current;
    const w = new Worker(new URL('./parser.worker.ts', import.meta.url), { type:'module' });
    w.onmessage = (ev:any)=>{
      const msg = ev.data;
      if (msg.type==='progress'){ setParsing({done:msg.done,total:msg.total}); return; }
      if (msg.type==='done'){
        const {
          rows:rws, tl, perSrc, perAbility, perAbilityTargets:pat,
          perTaken, perTakenBy, debug, duration,
          damageEvents, healEvents
        } = msg.payload;

        // normalize & merge ability names in BASE aggregates
        const { pa: basePaNorm, pat: basePatNorm } =
          mergeNormalizedAbilities(perAbility || {}, pat || {});

        // save bases
        setBaseRows(rws); setBaseTimeline(tl);
        setBasePerSrc(perSrc||{});
        setBasePerAbility(basePaNorm);
        setBasePerAbilityTargets(basePatNorm);
        setBasePerTaken(perTaken||{});
        setBasePerTakenBy(perTakenBy||{});
        setDamageEvents(damageEvents||[]);
        setHealEvents(healEvents||[]);
        setDuration(duration||0);
        setDebug(debug);

        // compute segments off raw events
        const segs = deriveSegments(tl, damageEvents||[], idleGap);
        setSegments(segs);
        setSegIndex(-1); // none

        // seed filtered views for full range via applyWindow (so canonicalization applies)
        const start = tl?.[0]?.t ?? 0;
        const end   = tl?.length ? tl[tl.length-1].t : duration;
        applyWindow({ start, end }, {
          tl, rows:rws, perSrc, perAbility: basePaNorm, pat: basePatNorm, perTaken, perTakenBy, duration
        });

        // keep A/B still valid
        setPA(a=> rws.find(v=>v.name===a)?.name || '');
        setPB(b=> rws.find(v=>v.name===b)?.name || '');

        setParsing(null);
      }
    }
    workerRef.current = w; return w;
  }
  function parseTextViaWorker(text:string){
    const w = ensureWorker();
    setParsing({done:0,total:1});
    w.postMessage({ text, collectUnparsed });
  }
  function onChoose(files: FileList | null){
    if(!files || !files.length) return;
    const fr = new FileReader(); fr.onload = () => parseTextViaWorker(String(fr.result||'')); fr.readAsText(files[0]);
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
    tl: any[], rows:PlayerRow[], perSrc:Record<string,number[]>, perAbility:PerAbility, pat:PerAbilityTargets,
    perTaken:Record<string,number>, perTakenBy:Record<string,Record<string,number>>, duration:number
  }){
    if (!window){
      // (Not used anymore for "— none —", we always pass a full-window,
      // but keep this path for completeness.)
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
      const abil = normalizeAbilityName(e.ability);

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

  /* -------------------- selectors & memo -------------------- */

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

  const aSeries = useMemo(()=> smooth ? smoothSeries(seriesFor(pA), 7) : seriesFor(pA), [pA, perSrc, timeline, smooth]);
  const bSeries = useMemo(()=> smooth ? smoothSeries(seriesFor(pB), 7) : seriesFor(pB), [pB, perSrc, timeline, smooth]);

  function pickFromChart(name:string, ev?:any){
    if(!compareOn) return;
    if (ev && ev.shiftKey) setPB(prev => prev===name ? '' : name);
    else setPA(prev => prev===name ? '' : (name===pB ? pB : name));
  }
  useEffect(()=>{ if(!compareOn){ setPA(''); setPB(''); } }, [compareOn]);

  /* -------------------- render -------------------- */

  return <ErrorBoundary>
    <div style={{ minHeight:'100vh', padding:16 }}>
      <div className="card" style={{ padding:12, marginBottom:12 }}>
        <div className="row">
          <label className="row" style={{gap:8}}>
            <span style={{opacity:.8,fontWeight:700}}>Upload SWG chatlog.txt</span>
            <input className="input" type="file" accept=".txt,.log" onChange={(e)=>onChoose(e.target.files)} />
          </label>

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
        <div style={{ padding:'12px 14px', borderBottom:'1px solid #1b2738', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
          <div style={{ fontSize:13, fontWeight:800, color:'#9fb7d8', letterSpacing:.3 }}>DPS/HPS Over Time</div>
          <div className="row" style={{gap:8}}>
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
            <div style={{ fontSize:12, color:'#9bb7df' }}>
              Parsed {fmt0(debug?.parsed)}/{fmt0(debug?.totalLines)} • Duration {toMMSS(debug?.duration||0)}
            </div>
          </div>
        </div>
        <div style={{ padding:0, height:420 }}>
          <ResponsiveContainer>
            <AreaChart data={timeline.map(d=>({ t:d.t, dps:d.dps, hps:d.hps }))} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="dpsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6ec7ff" stopOpacity={0.35}/>
                  <stop offset="100%" stopColor="#6ec7ff" stopOpacity={0.02}/>
                </linearGradient>
                <linearGradient id="hpsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8dd17e" stopOpacity={0.30}/>
                  <stop offset="100%" stopColor="#8dd17e" stopOpacity={0.02}/>
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1c2a3f" strokeDasharray="2 4" />
              <XAxis dataKey="t" tickFormatter={(s)=>toMMSS(Number(s))} stroke="#8aa8cf" />
              <YAxis tickFormatter={(s)=>fmt0(s)} stroke="#8aa8cf" />
              <Tooltip formatter={(v:number)=>fmt0(v)} labelFormatter={(l)=>toMMSS(Number(l))} />
              <Legend />
              <Area type="monotone" dataKey="dps" name="DPS (All)" stroke="#6ec7ff" strokeWidth={2} fill="url(#dpsFill)" />
              <Area type="monotone" dataKey="hps" name="HPS (All)" stroke="#8dd17e" strokeWidth={2} fill="url(#hpsFill)" />
              {compareOn && pA && (
                <Line type="monotone" dataKey="v" name={`A: ${pA}`} data={aSeries} stroke="#ffd166" strokeWidth={2.5} dot={false} />
              )}
              {compareOn && pB && (
                <Line type="monotone" dataKey="v" name={`B: ${pB}`} data={bSeries} stroke="#ef476f" strokeWidth={2.5} dot={false} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Mode buttons under timeline */}
      <div className="tabbar">
        <button className={"tab" + (mode==='sources'?' active':'')} onClick={()=>setMode('sources')}>Sources</button>
        <button className={"tab" + (mode==='abilities'?' active':'')} onClick={()=>setMode('abilities')}>Abilities</button>
      </div>

      {mode==='sources' ? (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:16 }}>
          {renderPanel('Damage Done By Source', listDamage, rows, 'damageDealt', compareOn, pA, pB, pickFromChart, inferredClasses)}
          {renderPanel('Healing Done By Source', listHealing, rows, 'healingDone', compareOn, pA, pB, pickFromChart, inferredClasses)}
          {renderPanel(`Damage Taken By Source${(compareOn && (pA||pB)) ? ' — ' + (pA||pB) : ''}`, takenFor, rows, 'damageDealt', false, '', '', ()=>{}, inferredClasses)}
          {renderPanel('Actions per Minute (APM)', listAPM, rows, 'damageDealt', false, '', '', ()=>{}, inferredClasses)}
        </div>
      ) : (
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
                  <th>Hits</th>
                  <th>Damage</th>
                  <th>Avg</th>
                  <th>Max</th>
                  <th>% of Player</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const player = pA || names[0];
                  if (!player) return null;
                  const map = (perAbility[player] || {}) as Record<string,{hits:number;dmg:number;max:number}>;
                  const entries = Object.entries(map);
                  const total = entries.reduce((sum, [,v]) => sum + (v?.dmg || 0), 0);
                  return entries
                    .map(([ability, v])=> ({ ability, hits:v.hits, damage:v.dmg, avg:v.hits?v.dmg/v.hits:0, max:v.max }))
                    .sort((a,b)=> b.damage-a.damage)
                    .flatMap(r=> {
                      const isOpen = openAbility === r.ability;
                      const targetsMap = ((perAbilityTargets[player] || {})[r.ability]) || {};
                      const targets = Object.entries(targetsMap).map(([t, sv])=> ({
                        target: t,
                        hits: (sv as any)?.hits||0,
                        damage: (sv as any)?.dmg||0,
                        avg: ((sv as any)?.hits? ((sv as any).dmg/(sv as any).hits) : 0),
                        max: (sv as any)?.max||0
                      })).sort((a,b)=> b.damage-a.damage);
                      return [
                        (<tr key={r.ability}>
                          <td className="muted">
                            <button className="btn" style={{padding:'2px 8px'}} onClick={()=> setOpenAbility(isOpen ? '' : r.ability)}>
                              {isOpen ? '▾' : '▸'}
                            </button>{' '}{r.ability}
                          </td>
                          <td>{fmt0(r.hits)}</td>
                          <td>{fmt0(r.damage)}</td>
                          <td>{fmt0(r.avg)}</td>
                          <td>{fmt0(r.max)}</td>
                          <td className="muted">{total>0 ? `${(r.damage/total*100).toFixed(1)}%` : '—'}</td>
                        </tr>),
                        (isOpen ? (
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
                                  <div style={{fontSize:12, color:'#9fb7d8', marginBottom:6}}>Target breakdown for <b>{r.ability}</b></div>
                                  <table className="table" style={{margin:0}}>
                                    <thead>
                                      <tr>
                                        <th>Target</th>
                                        <th>Hits</th>
                                        <th>Damage</th>
                                        <th>Avg</th>
                                        <th>Max</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {targets.map(t => (
                                        <tr key={t.target}>
                                          <td className="muted">{t.target}</td>
                                          <td>{fmt0(t.hits)}</td>
                                          <td>{fmt0(t.damage)}</td>
                                          <td>{fmt0(t.avg)}</td>
                                          <td>{fmt0(t.max)}</td>
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
                        ) : null)
                      ].filter(Boolean) as any;
                    });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
      <ResponsiveContainer>
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
