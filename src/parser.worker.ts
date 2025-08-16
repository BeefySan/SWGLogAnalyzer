/* eslint-disable no-restricted-globals */

// ---------- Types ----------
type DamageEvent = {
  t:number;
  src:string;
  dst:string;
  ability:string;
  amount:number;
  flags?:string;         // 'hit' | 'crit' | 'glance' | 'strikethrough' | 'periodic' | 'dodge' | 'parry'
  blocked?: number;      // "(N points blocked)"
  absorbed?: number;     // "Armor absorbed N points"
  preMitTotal?: number;  // "... out of T" (pre-mit total)
};
type HealEvent   = { t:number; src:string; dst:string; ability:string; amount:number };
type PlayerRow   = { name:string; profession?:string; damageDealt:number; healingDone:number; avgDps:number };

type PerAbility = Record<string, Record<string, { hits:number; dmg:number; max:number }>>;
type PerAbilityTargets = Record<string, Record<string, Record<string, { hits:number; dmg:number; max:number }>>>;

// ---------- Timestamp ----------
const T_TIME = /^(?:\[\s*Combat\s*\]\s*)?(\d{2}):(\d{2}):(\d{2})\s+/i;
const toSec = (hh:string, mm:string, ss:string) => (+hh)*3600 + (+mm)*60 + (+ss);

// ---------- Event regexes ----------
const RX_DMG_WITH =
  /^(.+?)\s+attacks\s+(.+?)\s+(?:with|using)\s+(.+?)\s+(?:and\s+)?(?:(crits|hits|glances|strikes\s+through)(?:\s*\(\d+%.*?\))?)?\s*for\s+(\d+)\s+points/i;

const RX_DMG_BARE =
  /^(.+?)\s+attacks\s+(.+?)\s+(?:and\s+)?(?:(crits|hits|glances|strikes\s+through)(?:\s*\(\d+%.*?\))?)?\s*for\s+(\d+)\s+points/i;

const RX_DMG_GENERIC= /^(.+?)\s+damages\s+(.+?)\s+for\s+(\d+)\s+points(?:\s+(?:with|using)\s+(.+?))?$/i;
const RX_DMG_DOT    = /^(.+?)\s+suffers\s+(\d+)\s+points\s+of\s+damage\s+from\s+(.+?)\s+over\s+time/i;

// NEW periodic style
const RX_DMG_CAUSED = /^(.+?)\s+(?:has\s+)?caused\s+(.+?)\s+to\s+take\s+(\d+)\s+points\s+(?:of\s+([A-Za-z '\-]+?)\s+)?damage\b.*$/i;

// ---------- Defensive outcomes (expanded coverage) ----------
// "...attacks ... [with|using ...] and misses (dodge|parry)."
const RX_MISSES_PAREN =
  /^(.+?)\s+attacks\s+(.+?)(?:\s+(?:with|using)\s+.+?)?\s+(?:and\s+)?misses\s*\((dodge|parry|parries)\)\.?$/i;

// "Amero attacks Beefy using X but/and Beefy dodges/parries"
const RX_DODGE_PARRY_1 = /^(.+?)\s+attacks\s+(.+?)\s+(?:with|using)\s+.*?(?:,?\s+)?(?:but|and)\s+\2\s+(dodges|parries)\b/i;
// "Amero attacks Beefy but/and Beefy dodges/parries"
const RX_DODGE_PARRY_2 = /^(.+?)\s+attacks\s+(.+?)(?:\s+(?:but|and))\s+\2\s+(dodges|parries)\b/i;
// "Beefy dodges/parries Amero's attack"
const RX_DODGE_PARRY_3 = /^(.+?)\s+(dodges|parries)\s+(.+?)'?s?\s+attack\b/i;
// "Amero's attack is/was dodged/parried by Beefy"
const RX_DODGE_PARRY_4 = /^(.+?)'?s?\s+attack\s+(?:is|was)\s+(dodged|parried)\s+by\s+(.+?)\b/i;

const RX_HEAL = /^(.+?)\s+heals\s+(.+?)\s+for\s+(\d+)\s+points(?:\s+with\s+(.+))?/i;

// Helpers to extract block & armor-absorb from the full line
const RX_POINTS_BLOCKED = /\((\d+)\s+points\s+blocked\)/i;
const RX_ARMOR_ABSORB   = /Armor\s+absorbed\s+(\d+)\s+points\s+out\s+of\s+(\d+)/i;

// ---------- Normalizers ----------
function clean(s?:string){ return (s||'').trim(); }
function normActor(s:string){ return /^(with|using)\s/i.test(s) ? '' : s.trim(); }

function normalizeAbilityName(raw?: string): string {
  if (!raw) return '';
  let s = raw.toLowerCase().trim();
  s = s.replace(/^(with|using)\s+/, '');
  s = s.replace(/\s+and\s+(?:\d+\s+points\s+blocked|(?:strikes\s+through|hits|glances|crits)(?:\s+\(\d+%.*?\))?)/g, '');
  s = s.replace(/[\(\[][^)\]]*[\)\]]/g, '');
  s = s.replace(/\bmark\s*\d+\b/gi, '').replace(/\b[ivxlcdm]+\b/gi, '').replace(/\b\d+\b/g, '');
  s = s.replace(/[:\-–—]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

// ---------- Alias merge (players only; NPCs preserved) ----------
const NPC_PREFIXES = ["A ", "An ", "The "];
function looksLikeNPC(name: string){ return NPC_PREFIXES.some(p => name.startsWith(p)); }

const DEFAULT_ALIASES: Record<string,string> = {
  "Shepard EffectMass": "Shepard",
  "Lurcio Leering-Creeper": "Lurcio",
};

function stripJunk(s: string): string {
  let t = s.replace(/^[`'"]+|[`'"]+$/g, "").replace(/\s+/g, " ").trim();
  t = t.replace(/^\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, "");
  return t;
}

function normalizeActorAlias(raw: string, seen: Set<string>, aliases: Record<string,string> = DEFAULT_ALIASES): string {
  const original = stripJunk(raw);
  if (!original) return "";

  if (aliases[original]) return aliases[original];
  if (looksLikeNPC(original)) return original;

  const m = original.match(/^(.+?)\s+([A-Za-z][\w'-]+)$/);
  if (m) {
    const base = m[1];
    const suffix = m[2];
    if (/^[A-Z][A-Za-z'-]*$/.test(suffix) && seen.has(base)) {
      return base;
    }
  }
  return original;
}

// ---------- Worker ----------
self.onmessage = (ev: MessageEvent<{ text:string; collectUnparsed?:boolean }>)=>{
  const { text, collectUnparsed } = ev.data || { text:'' };

  // Normalize newlines and DE-DUPE only *consecutive* exact duplicates.
  const rawLines = (text||'').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  function dedupeConsecutive(arr: string[]): { lines: string[]; removed: number } {
    const out: string[] = [];
    let prevKey: string | undefined;
    let removed = 0;
    for (const ln of arr) {
      if (!ln) continue; // drop empty
      const key = ln.replace(/\s+$/,''); // ignore trailing whitespace only
      if (key === prevKey) { removed++; continue; } // drop only if same as immediate previous
      out.push(ln);
      prevKey = key;
    }
    return { lines: out, removed };
  }

  const { lines, removed: duplicatesDropped } = dedupeConsecutive(rawLines);

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

  const lastCasterForDot: Record<string,string> = {};

  const seenActors = new Set<string>();
  const aliasMap = DEFAULT_ALIASES;

  function pushDamage(
    t:number,
    src:string,
    dst:string,
    abilityRaw:string,
    amount:number,
    flags?:string,
    blocked?:number,
    absorbed?:number,
    preMitTotal?:number
  ){
    const abilityKey = normalizeAbilityName(abilityRaw || 'attack');

    damageEvents.push({
      t, src, dst,
      ability: abilityRaw || abilityKey || 'attack',
      amount, flags,
      blocked, absorbed, preMitTotal
    });

    // Only real damage contributes to DPS/aggregates
    if (amount > 0) {
      if (!dpsByActor[src]) dpsByActor[src] = [];
      dpsByActor[src][t] = (dpsByActor[src][t]||0) + amount;

      if (!perAbility[src]) perAbility[src] = {};
      if (!perAbility[src][abilityKey]) perAbility[src][abilityKey] = { hits:0, dmg:0, max:0 };
      const pa = perAbility[src][abilityKey]; pa.hits++; pa.dmg += amount; if (amount>pa.max) pa.max = amount;

      if (!perAbilityTargets[src]) perAbilityTargets[src] = {};
      if (!perAbilityTargets[src][abilityKey]) perAbilityTargets[src][abilityKey] = {};
      if (!perAbilityTargets[src][abilityKey][dst]) perAbilityTargets[src][abilityKey][dst] = { hits:0, dmg:0, max:0 };
      const pt = perAbilityTargets[src][abilityKey][dst]; pt.hits++; pt.dmg += amount; if (amount>pt.max) pt.max = amount;

      if (src !== dst){
        perTaken[dst] = (perTaken[dst]||0) + amount;
        if (!perTakenBy[dst]) perTakenBy[dst] = {};
        perTakenBy[dst][src] = (perTakenBy[dst][src]||0) + amount;
      }
    }

    // Remember last caster for DoT attribution
    if (!flags && abilityKey) {
      lastCasterForDot[`${abilityKey}||${dst}`] = src;
    }
  }

  function pushOutcome(t:number, src:string, dst:string, flag:'dodge'|'parry'){
    damageEvents.push({ t, src, dst, ability: 'attack', amount: 0, flags: flag });
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

    const normNames = (srcRaw: string, dstRaw: string) => {
      const src0 = normActor(clean(srcRaw));
      const dst0 = clean(dstRaw);

      const src = src0 ? normalizeActorAlias(src0, seenActors, aliasMap) : '';
      const dst = normalizeActorAlias(dst0, seenActors, aliasMap);

      if (src && !looksLikeNPC(src)) seenActors.add(src);
      if (dst && !looksLikeNPC(dst)) seenActors.add(dst);

      return { src, dst };
    };

    // ---------- Defensive outcomes: "misses (dodge|parry)" ----------
    if ((m = RX_MISSES_PAREN.exec(rest))) {
      const { src, dst } = normNames(m[1], m[2]);
      const kind = (m[3] || '').toLowerCase();
      if (src) {
        const flag = kind.startsWith('dodg') ? 'dodge' : 'parry';
        pushOutcome(t, src, dst, flag as 'dodge' | 'parry');
        parsed++; continue;
      }
    }

    // ---------- Defensive outcomes (other phrasings) ----------
    if ((m = RX_DODGE_PARRY_1.exec(rest))){
      const { src, dst } = normNames(m[1], m[2]);
      const flag = (m[3]||'').toLowerCase() as 'dodges'|'parries';
      if (src) { pushOutcome(t, src, dst, flag === 'dodges' ? 'dodge' : 'parry'); parsed++; continue; }
    }
    if ((m = RX_DODGE_PARRY_2.exec(rest))){
      const { src, dst } = normNames(m[1], m[2]);
      const flag = (m[3]||'').toLowerCase() as 'dodges'|'parries';
      if (src) { pushOutcome(t, src, dst, flag === 'dodges' ? 'dodge' : 'parry'); parsed++; continue; }
    }
    if ((m = RX_DODGE_PARRY_3.exec(rest))){
      const dst = normalizeActorAlias(clean(m[1]), seenActors, aliasMap);
      const flag = (m[2]||'').toLowerCase();
      const src = normalizeActorAlias(clean(m[3]), seenActors, aliasMap);
      if (src && dst) { pushOutcome(t, src, dst, flag === 'dodges' ? 'dodge' : 'parry'); parsed++; continue; }
    }
    if ((m = RX_DODGE_PARRY_4.exec(rest))){
      const src = normalizeActorAlias(clean(m[1]), seenActors, aliasMap);
      const flagPast = (m[2]||'').toLowerCase();
      const dst = normalizeActorAlias(clean(m[3]), seenActors, aliasMap);
      if (src && dst) { pushOutcome(t, src, dst, flagPast === 'dodged' ? 'dodge' : 'parry'); parsed++; continue; }
    }

    // Helpers for block/absorb on damage lines
    const blockedMatch = rest.match(RX_POINTS_BLOCKED);
    const blockedAmt = blockedMatch ? +blockedMatch[1] : undefined;

    const absorbMatch = rest.match(RX_ARMOR_ABSORB);
    const absorbedAmt = absorbMatch ? +absorbMatch[1] : undefined;
    const preMitTotal = absorbMatch ? +absorbMatch[2] : undefined;

    // ---------- Damage parsing ----------
    if ((m = RX_DMG_WITH.exec(rest))){
      const { src, dst } = normNames(m[1], m[2]);
      const ability = clean(m[3]);
      const kindRaw = (m[4]||'').toLowerCase().replace(/\s+/g,' ');
      const amount = +m[5];

      const flag =
        kindRaw === 'crits' ? 'crit' :
        kindRaw === 'hits' ? 'hit' :
        kindRaw === 'glances' ? 'glance' :
        kindRaw.startsWith('strikes through') ? 'strikethrough' : undefined;

      if (src){
        pushDamage(t, src, dst, ability, amount, flag, blockedAmt, absorbedAmt, preMitTotal);
        parsed++; continue;
      }
    }

    if ((m = RX_DMG_BARE.exec(rest))){
      const { src, dst } = normNames(m[1], m[2]);
      const kindRaw = (m[3]||'').toLowerCase().replace(/\s+/g,' ');
      const amount = +m[4];

      const flag =
        kindRaw === 'crits' ? 'crit' :
        kindRaw === 'hits' ? 'hit' :
        kindRaw === 'glances' ? 'glance' :
        kindRaw.startsWith('strikes through') ? 'strikethrough' : undefined;

      if (src){
        pushDamage(t, src, dst, 'attack', amount, flag, blockedAmt, absorbedAmt, preMitTotal);
        parsed++; continue;
      }
    }

    if ((m = RX_DMG_GENERIC.exec(rest))){
      const { src, dst } = normNames(m[1], m[2]);
      const amount = +m[3];
      const ability = clean(m[4]||'attack');
      if (src){
        pushDamage(t, src, dst, ability, amount, undefined, blockedAmt, absorbedAmt, preMitTotal);
        parsed++; continue;
      }
    }

    // periodic forms
    if ((m = RX_DMG_DOT.exec(rest))){
      const dstNormOnly = normalizeActorAlias(clean(m[1]), seenActors, aliasMap);
      if (dstNormOnly && !looksLikeNPC(dstNormOnly)) seenActors.add(dstNormOnly);

      const amount = +m[2];
      const abilityRaw = clean(m[3]);
      const key = normalizeAbilityName(abilityRaw);
      const caster = lastCasterForDot[`${key}||${dstNormOnly}`] || '';
      pushDamage(t, caster || key || 'Periodic', dstNormOnly, abilityRaw, amount, 'periodic');
      parsed++; continue;
    }

    if ((m = RX_DMG_CAUSED.exec(rest))){
      const { src, dst } = normNames(m[1], m[2]);
      const amount = +m[3];
      const dtype = clean(m[4] || 'Periodic');
      if (src){ pushDamage(t, src, dst, dtype, amount, 'periodic'); parsed++; continue; }
    }

    // ---------- Healing ----------
    if ((m = RX_HEAL.exec(rest))){
      const { src, dst } = normNames(m[1], m[2]);
      const amount = +m[3]; const ability = clean(m[4]||'');
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
    debug: {
      parsed,
      totalLines: rawLines.length,   // before de-dupe
      uniqueLines: lines.length,     // after consecutive de-dupe
      duplicatesDropped,             // number removed
      duration: maxAbs,
      unparsed: collectUnparsed ? unparsed.length : 0
    },
    damageEvents,
    healEvents,
  };

  (self as any).postMessage({ type:'done', payload });
};
