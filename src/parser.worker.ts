/* eslint-disable no-restricted-globals */

// ---------- Types ----------
type DamageEvent = { t:number; src:string; dst:string; ability:string; amount:number; flags?:string };
type HealEvent   = { t:number; src:string; dst:string; ability:string; amount:number };
type PlayerRow   = { name:string; profession?:string; damageDealt:number; healingDone:number; avgDps:number };

type PerAbility = Record<string, Record<string, { hits:number; dmg:number; max:number }>>;
type PerAbilityTargets = Record<string, Record<string, Record<string, { hits:number; dmg:number; max:number }>>>;

// ---------- Timestamp ----------
const T_TIME = /^(?:\[\s*Combat\s*\]\s*)?(\d{2}):(\d{2}):(\d{2})\s+/i;
const toSec = (hh:string, mm:string, ss:string) => (+hh)*3600 + (+mm)*60 + (+ss);

// ---------- Event regexes (run on the line *after* removing time) ----------
const RX_DMG_WITH   = /^(.+?)\s+attacks\s+(.+?)\s+with\s+(.+?)\s+(?:and\s+)?(?:crits|hits|glances)?\s*for\s+(\d+)\s+points/i;
const RX_DMG_BARE   = /^(.+?)\s+attacks\s+(.+?)\s+(?:and\s+)?(?:crits|hits|glances)?\s*for\s+(\d+)\s+points/i;
const RX_DMG_GENERIC= /^(.+?)\s+damages\s+(.+?)\s+for\s+(\d+)\s+points(?:\s+with\s+(.+?))?$/i;
const RX_DMG_DOT    = /^(.+?)\s+suffers\s+(\d+)\s+points\s+of\s+damage\s+from\s+(.+?)\s+over\s+time/i;
const RX_HEAL       = /^(.+?)\s+heals\s+(.+?)\s+for\s+(\d+)\s+points(?:\s+with\s+(.+))?/i;

// ---------- Normalizers ----------
function clean(s?:string){ return (s||'').trim(); }
function normActor(s:string){ return /^(with|using)\s/i.test(s) ? '' : s.trim(); }

function normalizeAbilityName(raw?: string): string {
  if (!raw) return '';
  let s = raw.toLowerCase().trim();
  s = s.replace(/^(with|using)\s+/, '');
  s = s.replace(/\s+and\s+(?:\d+\s+points\s+blocked|(?:strikes\s+through|hits|glances|crits)(?:\s+\(\d+%.*?\))?)/g, '');
  s = s.replace(/[\(\[][^)\]]*[\)\]]/g, '');  // drop (…) / […]
  s = s.replace(/\bmark\s*\d+\b/gi, '').replace(/\b[ivxlcdm]+\b/gi, '').replace(/\b\d+\b/g, '');
  s = s.replace(/[:\-–—]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

// ---------- Worker ----------
self.onmessage = (ev: MessageEvent<{ text:string; collectUnparsed?:boolean }>)=>{
  const { text, collectUnparsed } = ev.data || { text:'' };
  const lines = (text||'').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  let baseAbs: number | null = null;
  let maxAbs = 0, parsed = 0;

  const damageEvents: DamageEvent[] = [];
  const healEvents: HealEvent[] = [];
  const unparsed: string[] = [];

  const dpsByActor: Record<string, number[]> = {};
  const hpsByActor: Record<string, number[]> = {};

  const perAbility: PerAbility = {};
  const perAbilityTargets: PerAbilityTargets = {};
  const perTaken: Record<string, number> = {};
  const perTakenBy: Record<string, Record<string, number>> = {};

  // Remember who cast which DoT on which target last (best-effort attribution)
  // key = `${abilityNorm}||${dst}`
  const lastCasterForDot: Record<string,string> = {};

  function pushDamage(t:number, src:string, dst:string, abilityRaw:string, amount:number, flags?:string){
    const abilityKey = normalizeAbilityName(abilityRaw || 'attack');

    // event list
    damageEvents.push({ t, src, dst, ability: abilityRaw || abilityKey || 'attack', amount, flags });

    // per-second DPS
    if (!dpsByActor[src]) dpsByActor[src] = [];
    dpsByActor[src][t] = (dpsByActor[src][t]||0) + amount;

    // per-ability (by actor)
    if (!perAbility[src]) perAbility[src] = {};
    if (!perAbility[src][abilityKey]) perAbility[src][abilityKey] = { hits:0, dmg:0, max:0 };
    const pa = perAbility[src][abilityKey]; pa.hits++; pa.dmg += amount; if (amount>pa.max) pa.max = amount;

    // per-ability targets
    if (!perAbilityTargets[src]) perAbilityTargets[src] = {};
    if (!perAbilityTargets[src][abilityKey]) perAbilityTargets[src][abilityKey] = {};
    if (!perAbilityTargets[src][abilityKey][dst]) perAbilityTargets[src][abilityKey][dst] = { hits:0, dmg:0, max:0 };
    const pt = perAbilityTargets[src][abilityKey][dst]; pt.hits++; pt.dmg += amount; if (amount>pt.max) pt.max = amount;

    // damage taken
    if (src !== dst){
      perTaken[dst] = (perTaken[dst]||0) + amount;
      if (!perTakenBy[dst]) perTakenBy[dst] = {};
      perTakenBy[dst][src] = (perTakenBy[dst][src]||0) + amount;
    }

    // remember last caster for DOT attributions
    if (!flags && abilityKey) {
      lastCasterForDot[`${abilityKey}||${dst}`] = src;
    }
  }

  function pushHeal(t:number, src:string, dst:string, abilityRaw:string, amount:number){
    healEvents.push({ t, src, dst, ability: abilityRaw, amount });
    if (!hpsByActor[src]) hpsByActor[src] = [];
    hpsByActor[src][t] = (hpsByActor[src][t]||0) + amount;
  }

  for (let i=0;i<lines.length;i++){
    const raw = lines[i];
    if (!raw) continue;

    const tm = T_TIME.exec(raw);
    if (!tm) { if (collectUnparsed) unparsed.push(raw); continue; }

    const abs = toSec(tm[1], tm[2], tm[3]);
    if (baseAbs===null) baseAbs = abs;
    const t = abs - baseAbs;
    if (t>maxAbs) maxAbs = t;

    const rest = raw.slice(tm[0].length).trim();

    let m: RegExpExecArray | null;

    // damage with ability
    if ((m = RX_DMG_WITH.exec(rest))){
      const src = normActor(clean(m[1])); const dst = clean(m[2]); const ability = clean(m[3]); const amount = +m[4];
      if (src){ pushDamage(t, src, dst, ability, amount); parsed++; continue; }
    }
    // bare damage
    if ((m = RX_DMG_BARE.exec(rest))){
      const src = normActor(clean(m[1])); const dst = clean(m[2]); const amount = +m[3];
      if (src){ pushDamage(t, src, dst, 'attack', amount); parsed++; continue; }
    }
    // generic damage (… damages … for N points [with Ability])
    if ((m = RX_DMG_GENERIC.exec(rest))){
      const src = normActor(clean(m[1])); const dst = clean(m[2]); const amount = +m[3]; const ability = clean(m[4]||'attack');
      if (src){ pushDamage(t, src, dst, ability, amount); parsed++; continue; }
    }
    // periodic
    if ((m = RX_DMG_DOT.exec(rest))){
      const dst = clean(m[1]); const amount = +m[2]; const abilityRaw = clean(m[3]);
      const key = normalizeAbilityName(abilityRaw);
      const caster = lastCasterForDot[`${key}||${dst}`] || ''; // best effort, else unattributed
      pushDamage(t, caster || key || 'Periodic', dst, abilityRaw, amount, 'periodic');
      parsed++; continue;
    }
    // healing
    if ((m = RX_HEAL.exec(rest))){
      const src = normActor(clean(m[1])); const dst = clean(m[2]); const amount = +m[3]; const ability = clean(m[4]||'');
      if (src){ pushHeal(t, src, dst, ability, amount); parsed++; continue; }
    }

    if (collectUnparsed) unparsed.push(raw);
  }

  // rows & timeline aggregates
  const actors = new Set<string>([...Object.keys(dpsByActor), ...Object.keys(hpsByActor)]);
  const rows: PlayerRow[] = [];
  const tl: Array<{t:number; dps:number; hps:number}> = [];
  for (let sec=0; sec<=maxAbs; sec++){
    let d=0, h=0;
    for (const a of Object.keys(dpsByActor)) d += dpsByActor[a][sec]||0;
    for (const a of Object.keys(hpsByActor)) h += hpsByActor[a][sec]||0;
    tl.push({ t: sec, dps: d, hps: h });
  }
  for (const a of actors){
    let d=0, h=0;
    const dps = dpsByActor[a]||[]; const hps = hpsByActor[a]||[];
    for (let sec=0; sec<=maxAbs; sec++){ d += dps[sec]||0; h += hps[sec]||0; }
    rows.push({ name:a, damageDealt:d, healingDone:h, avgDps: d/Math.max(1,maxAbs) });
  }

  const payload = {
    rows,
    tl,
    perSrc: dpsByActor,
    perAbility,
    perAbilityTargets,
    perTaken,
    perTakenBy,
    duration: maxAbs,
    debug: { parsed, totalLines: lines.length, duration: maxAbs, unparsed: collectUnparsed ? unparsed.length : 0 },
    damageEvents,
    healEvents,
  };

  (self as any).postMessage({ type:'done', payload });
};
