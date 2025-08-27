/* eslint-disable no-restricted-globals */

// ---------- Types ----------
type ElementalBreakdown = Record<string, number>;

type DamageEvent = {
  t:number;
  src:string;
  dst:string;
  ability:string;
  amount:number;
  flags?:string;         // 'hit' | 'crit' | 'glance' | 'strikethrough' | 'periodic' | 'dodge' | 'parry'
  blocked?: number;
  absorbed?: number;
  preMitTotal?: number;
  evadedPct?: number;
  elements?: ElementalBreakdown; // <- NEW
};
type HealEvent = { t: number; src: string; dst: string; ability: string; amount: number };
type PlayerRow = { name: string; profession?: string; damageDealt: number; healingDone: number; avgDps: number };

type PerAbility = Record<string, Record<string, { hits: number; dmg: number; max: number }>>;
type PerAbilityTargets = Record<string, Record<string, Record<string, { hits: number; dmg: number; max: number }>>>;

// NEW: per-defender tallies used for defensive stats
type PerDefenderStats = Record<
  string,
  {
    // Landed split
    hits: number; // landed, non-periodic, NON-glance
    glances: number; // count of glancing blows taken
    glanceDamageSum: number; // sum of glancing damage amounts

    // NEW: avoid/attempts tallies (to mirror Defense Flow math)
    dodges: number; // number of dodge outcomes vs this defender
    parries: number; // number of parry outcomes vs this defender
  }
>;

// ---------- Timestamp ----------
const T_TIME = /^(?:\[\s*Combat\s*\]\s*)?(\d{2}):(\d{2}):(\d{2})\s+/i;
const toSec = (hh: string, mm: string, ss: string) => +hh * 3600 + +mm * 60 + +ss;

// ---------- Event regexes ----------
// NOTE: this version CAPTURES the "hits|glances|crits|..." group as m[4]
const RX_DMG_WITH =
  /^(.+?)\s+attacks\s+(.+?)\s+(?:with|using)\s+(.+?)\s+(?:and\s+(hits|glances|crits|strikes\s+through|punishing\s+blows))?(?:\s*\((\d+)\s*%(?:\s*evaded)?\))?\s*for\s+(\d+)\s+points/i;

const RX_DMG_BARE =
  /^(.+?)\s+attacks\s+(.+?)(?:\s+and\s+)?(?:(hits|glances|crits|strikes\s+through|punishing\s+blows))?(?:\s*\((\d+)\s*%(?:\s*evaded)?\))?\s*for\s+(\d+)\s+points/i;

const RX_DMG_GENERIC =
  /^(.+?)\s+damages\s+(.+?)\s+for\s+(\d+)\s+points(?:\s+(?:with|using)\s+(.+?))?$/i;
const RX_DMG_DOT =
  /^(.+?)\s+suffers\s+(\d+)\s+points\s+of\s+damage\s+from\s+(.+?)\s+over\s+time/i;

// This regex has 3 capture groups; we will NOT read m[4]
const RX_DMG_CAUSED =
  /^(.+?)\s+causes\s+(.+?)\s+to\s+take\s+(\d+)\s+points\s+of\s+damage/i;
// Also handle: "X has caused Y to take N points of <element> damage"
const RX_DMG_HAS_CAUSED_ELEM =
  /^(.+?)\s+has\s+caused\s+(.+?)\s+to\s+take\s+(\d+)\s+points\s+of\s+([a-z]+)\s+damage/i;
const RX_DMG_HAS_CAUSED =
  /^(.+?)\s+has\s+caused\s+(.+?)\s+to\s+take\s+(\d+)\s+points\s+of\s+damage/i;

// ---------- Defensive outcomes ----------
const RX_MISSES_PAREN =
  /^(.+?)\s+attacks\s+(.+?)(?:\s+(?:with|using)\s+.+?)?\s+(?:and\s+)?misses\s*\((dodge|parry|parries)\)\.?$/i;

const RX_DODGE_PARRY_1 =
  /^(.+?)\s+attacks\s+(.+?)\s+(?:with|using)\s+.*?(?:,?\s+)?(?:but|and)\s+\2\s+(dodges|parries)\b/i;
const RX_DODGE_PARRY_2 =
  /^(.+?)\s+attacks\s+(.+?)(?:\s+(?:but|and))\s+\2\s+(dodges|parries)\b/i;
const RX_DODGE_PARRY_3 = /^(.+?)\s+(dodges|parries)\s+(.+?)'?s?\s+attack\b/i;
const RX_DODGE_PARRY_4 =
  /^(.+?)'?s?\s+attack\s+(?:is|was)\s+(dodged|parried)\s+by\s+(.+?)\b/i;

const RX_HEAL = /^(.+?)\s+heals\s+(.+?)\s+for\s+(\d+)\s+points(?:\s+with\s+(.+))?/i;
const RX_DEATH = /^(.+?)\s+is\s+no\s+more\./i;

// Helpers
const RX_POINTS_BLOCKED = /\((\d+)\s+points\s+blocked\)/i;
const RX_ARMOR_ABSORB = /Armor\s+absorbed\s+(\d+)\s+points\s+out\s+of\s+(\d+)/i;
const RX_ABSORB_SIMPLE = /\((\d+)\s+absorbed(?:\s*\/\s*(\d+)\s+resisted\.?)*\)/i;
const RX_EVADED_PCT = /\((\d+)\s*%(?:\s*evaded)?\)/i;

// ---------- Elemental parsing helpers ----------
type ElementKey = 'kinetic'|'energy'|'heat'|'cold'|'acid'|'electricity'|'poison';

const ELEMENT_ALIASES: Record<string, ElementKey> = {
  kinetic:'kinetic', kin:'kinetic',
  energy:'energy',
  heat:'heat', fire:'heat',
  cold:'cold',
  acid:'acid',
  electricity:'electricity', electric:'electricity',
  poison:'poison'
};

function parseElementTupleList(s: string): ElementalBreakdown {
  const out: ElementalBreakdown = {};
  // split on comma or "and"
  const parts = s.split(/\s*(?:,|and)\s*/i).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/(\d+)\s*([a-z]+)/i);
    if (!m) continue;
    const n = +m[1];
    const raw = m[2].toLowerCase();
    const key = ELEMENT_ALIASES[raw] ?? (raw as ElementKey);
    out[key] = (out[key] || 0) + n;
  }
  return out;
}

// Pull explicit per-hit split out of the text after the timestamp
function extractElementsFromRest(rest: string): ElementalBreakdown | undefined {
  // pattern: "... for N points (689 energy and 156 cold)"
  const mParen = rest.match(/for\s+\d+\s+points\s*\(([^)]+)\)/i);
  if (mParen && mParen[1] && !/\bpoints\s+blocked\b/i.test(mParen[1])) {
    const parsed = parseElementTupleList(mParen[1]);
    if (Object.keys(parsed).length) return parsed;
  }
  // pattern: "... for 1200 energy."
  const mSingle = rest.match(/for\s+(\d+)\s+(kinetic|energy|heat|cold|acid|electricity|electric|poison)s?\b/i);
  if (mSingle) {
    const amt = +mSingle[1];
    const key = ELEMENT_ALIASES[mSingle[2].toLowerCase()] ?? (mSingle[2].toLowerCase() as ElementKey);
    return { [key]: amt };
  }
  return undefined;
}


// ---------- Normalizers ----------
function clean(s?: string) {
  return (s || "").trim();
}
function normActor(s: string) {
  return /^(with|using)\s/i.test(s) ? "" : s.trim();
}

function normalizeAbilityName(raw?: string): string {
  if (!raw) return "";
  let s = raw.toLowerCase().trim();
  s = s.replace(/^(with|using)\s+/, "");
  s = s.replace(
    /\s+and\s+(?:\d+\s+points\s+blocked|(?:strikes\s+through|hits|glances|crits)(?:\s+\(\d+%.*?\))?)/g,
    ""
  );
  s = s.replace(/[\(\[][^)\]]*[\)\]]/g, "");
  s = s
    .replace(/\bmark\s*\d+\b/gi, "")
    .replace(/\b[ivxlcdm]+\b/gi, "")
    .replace(/\b\d+\b/g, "");
  s = s.replace(/[:\-–—]+/g, " ").replace(/\s+/g, " ").trim();
  return s;
}

// Ability → elemental hints (edit to match your game). Keys must be normalized ability names.
const ABILITY_ELEMENT_HINTS: Record<string, ElementalBreakdown> = {
  "plasma mine": { heat: 1 },
  "focused beam": { energy: 1 },
  "force lightning": { electricity: 1 },
  "force shockwave": { kinetic: 1 },
  "maelstrom": { electricity: 1 },
};

// Turn a hint into a totals object scaled by the event's damage
function hintedElementsForAbility(abilityNorm: string, totalDamage: number): ElementalBreakdown {
  const hint = ABILITY_ELEMENT_HINTS[abilityNorm];
  if (!hint) return {};
  const out: ElementalBreakdown = {};
  let sum = 0;
  for (const v of Object.values(hint)) sum += Number(v || 0);
  if (sum <= 0) return {};
  for (const [k, ratio] of Object.entries(hint)) {
    out[k] = totalDamage * (Number(ratio || 0) / sum);
  }
  return out;
}


// ---------- Alias merge (players only; NPCs preserved) ----------
const RX_NPC_PREFIX = /^(?:a|an|the)\s+/i;
function looksLikeNPC(name: string) {
  return RX_NPC_PREFIX.test((name || "").trim());
}
function canonicalizeNPCName(name: string) {
  let s = (name || "").trim().replace(/\s+/g, " ");
  const m = s.match(RX_NPC_PREFIX);
  if (m) {
    const art = m[0].trim().toLowerCase();
    const cap = art === "a" ? "A " : art === "an" ? "An " : "The ";
    s = cap + s.slice(m[0].length);
  }
  return s;
}

const DEFAULT_ALIASES: Record<string, string> = {
  "Shepard EffectMass": "Shepard",
  "Lurcio Leering-Creeper": "Lurcio",
  // --- Canonical player aliases (merge split names) ---
  "Colt": "Colt Sutran",
  "colt": "Colt Sutran",
  "Colt Sutran": "Colt Sutran"
};

function stripJunk(s: string): string {
  let t = s.replace(/^[`'"]+|[`'"]+$/g, "").replace(/\s+/g, " ").trim();
  t = t.replace(/^\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, "");
  return t;
}

function normalizeActorAlias(
  raw: string,
  seen: Set<string>,
  aliases: Record<string, string> = DEFAULT_ALIASES
): string {
  const original = stripJunk(raw);
  if (!original) return "";

  // Case-insensitive alias lookup
  const lc = original.toLowerCase();

// Global canonical overrides (e.g., "colt" -> "Colt Sutran")
const byCanon = ENTITY_CANON[lc] || ENTITY_CANON[original];
if (byCanon) {
  aliases[lc] = byCanon;
  aliases[original] = byCanon;
  return byCanon;
}

  if (aliases[original]) return aliases[original];
  if (aliases[lc]) return aliases[lc];

  if (looksLikeNPC(original)) {
    const canon = canonicalizeNPCName(original);
    aliases[lc] = canon;
    return canon;
  }

  // Collapse "<Base> Effect*" synthetic sources to Base (e.g., "Shepard EffectMass" → "Shepard")
  const mEffect = original.match(/^([A-Za-z][\w'\-]*)\s+(Effect[\w'-]*)$/i);
  if (mEffect) {
    const baseRaw = mEffect[1];
    const baseLc = baseRaw.toLowerCase();
    // If we've seen a canonical capitalization for this actor, reuse it
    const existing = aliases[baseLc] || Array.from(seen).find(n => n.toLowerCase() === baseLc);
    const canon = existing || baseRaw;
    aliases[original] = canon;
    aliases[lc] = canon;
    aliases[baseLc] = canon;
    return canon;
  }

  // If the name looks like "<First> <Suffix>" and we've already seen "<First>" (any case), collapse to "<First>"
  const m = original.match(/^(.+?)\s+([A-Za-z][\w'-]+)$/);
  if (m) {
    const base = m[1];
    const baseLc = base.toLowerCase();
    const seenCanon = Array.from(seen).find(n => n.toLowerCase() === baseLc);
    if (seenCanon) {
      aliases[lc] = seenCanon;
      aliases[original] = seenCanon;
      return seenCanon;
    }
  }

  // Default: remember canonical capitalization for future case-insensitive matches
  aliases[lc] = original;
  return original;
}



// Canonical map (lowercase) for quick lookups at parse- and merge-time
const ENTITY_CANON: Record<string,string> = {
  'colt': 'Colt Sutran',
  'colt sutran': 'Colt Sutran',
};

function canonName(name: string): string {
  const s = (name || '').trim();
  const lc = s.toLowerCase();
  return ENTITY_CANON[lc] || s;
}
// ---------- Worker ----------
self.onmessage = async (ev: MessageEvent<any>) => {
  try {
    // Accept both legacy ({ text, collectUnparsed }) and typed ({ type:'parse', text, collectUnparsed }) shapes
    let textStr: string = "";
    let collectUnparsed: boolean = false;
    const d: any = ev && (ev as any).data ? (ev as any).data : undefined;
    if (typeof d === "string") {
      textStr = d;
    } else if (d && typeof d === "object") {
      if ((d as any).type === "parse") {
        textStr = (d as any).text ?? "";
        collectUnparsed = !!(d as any).collectUnparsed;
      } else {
        textStr = (d as any).text ?? "";
        collectUnparsed = !!(d as any).collectUnparsed;
      }
    }

    // Let UI show activity
    (self as any).postMessage({ type: "progress", done: 0, total: 1 });

    // Normalize lines and optionally dedupe consecutive duplicates
    const rawText: string = String(textStr ?? "");
    const rawLines: string[] = rawText.replace(/\r\n?/g, "\n").split("\n");

    function dedupeConsecutive(lines: string[]) {
      const out: string[] = [];
      let removed = 0;
      let prev = "";
      for (const ln of lines) {
        if (ln === prev) {
          removed++;
          continue;
        }
        out.push(ln);
        prev = ln;
      }
      return { lines: out, removed };
    }

    const { lines, removed: duplicatesDropped } = dedupeConsecutive(rawLines);

    let baseAbs: number | null = null;
    let maxAbs = 0,
      parsed = 0;

    const damageEvents: DamageEvent[] = [];
    const healEvents: HealEvent[] = [];
    const deathEvents: Array<{ t: number; name: string }> = []; // DECLARED
    const unparsed: string[] = [];

    

// === Merge helpers (fold series/ability maps by canonical name) ===
function mergeSeriesMap(map: Record<string, number[]>): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const [name, series] of Object.entries(map || {})) {
    const key = canonName(name);
    const dest = out[key] || [];
    const n = Math.max(dest.length, series.length);
    const merged: number[] = new Array(n).fill(0);
    for (let i = 0; i < n; i++) merged[i] = (dest[i] || 0) + (series[i] || 0);
    out[key] = merged;
  }
  return out;
}
function mergePerAbilityMap(map: any): any {
  const out: any = {};
  for (const [src, abil] of Object.entries(map || {})) {
    const key = canonName(src);
    const dest = out[key] || {};
    for (const [ability, stats] of Object.entries(abil as any)) {
      const cur = dest[ability] || { hits:0, dmg:0, max:0 };
      cur.hits += (stats as any).hits || 0;
      cur.dmg  += (stats as any).dmg || 0;
      if ((stats as any).max > cur.max) cur.max = (stats as any).max;
      dest[ability] = cur;
    }
    out[key] = dest;
  }
  return out;
}
function mergePerAbilityTargetsMap(map: any): any {
  const out: any = {};
  for (const [src, abil] of Object.entries(map || {})) {
    const key = canonName(src);
    const dest = out[key] || {};
    for (const [ability, targets] of Object.entries(abil as any)) {
      const tgtDest = dest[ability] || {};
      for (const [dst, stats] of Object.entries(targets as any)) {
        const cur = tgtDest[dst] || { hits:0, dmg:0, max:0 };
        cur.hits += (stats as any).hits || 0;
        cur.dmg  += (stats as any).dmg || 0;
        if ((stats as any).max > cur.max) cur.max = (stats as any).max;
        tgtDest[dst] = cur;
      }
      dest[ability] = tgtDest;
    }
    out[key] = dest;
  }
  return out;
}
const dpsByActor: Record<string, number[]> = {};
    const actionsByActorSec: Record<string, Record<number, Set<string>>> = {};
    const hpsByActor: Record<string, number[]> = {};

    const perAbility: PerAbility = {};
    const perAbilityTargets: PerAbilityTargets = {};
    const perTaken: Record<string, number> = {};
    const perTakenBy: Record<string, Record<string, number>> = {};

    const lastCasterForDot: Record<string, string> = {};

    // Fallback: last non-periodic damage source per target
    const lastDamageSourceForTarget: Record<string, string> = {};

    const seenActors = new Set<string>();
    const aliasMap = DEFAULT_ALIASES;

    // NEW: defensive tallies per defender
    const perDef: PerDefenderStats = {};

    function ensureDef(name: string) {
      if (!perDef[name])
        perDef[name] = {
          hits: 0,
          glances: 0,
          glanceDamageSum: 0,
          dodges: 0,
          parries: 0,
        };
      return perDef[name];
    }

    function pushDamage(
      t:number,
      src:string,
      dst:string,
      abilityRaw:string,
      amount:number,
      // NEW: explicit per-hit split (if present in log line)
      elementsOverride?: ElementalBreakdown,
      flags?:string,
      blocked?:number,
      absorbed?:number,
      preMitTotal?:number,
      evadedPct?:number
    ){
      const abilityKey = normalizeAbilityName(abilityRaw || 'attack');

      // Prefer explicit parsed split; otherwise fall back to ability hints
      const elemHint = elementsOverride && Object.keys(elementsOverride).length
        ? elementsOverride
        : hintedElementsForAbility(abilityKey, Number(amount||0));
      const hasElems = elemHint && Object.keys(elemHint).length > 0;

      damageEvents.push({
        t, src, dst,
        ability: abilityRaw || abilityKey || 'attack',
        amount, flags,
        blocked, absorbed, preMitTotal,
        evadedPct,
        ...(hasElems ? { elements: elemHint } : {})
      });

// Count unique actions per (sec, normalized ability)
if (flags !== 'periodic') {
  const akey = abilityKey || 'attack';
  if (!actionsByActorSec[src]) actionsByActorSec[src] = {};
  if (!actionsByActorSec[src][t]) actionsByActorSec[src][t] = new Set<string>();
  actionsByActorSec[src][t].add(akey);
}


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

          const d = ensureDef(dst);
          if (flags === 'glance') { d.glances += 1; d.glanceDamageSum += amount; }
          else if (flags !== 'periodic') { d.hits += 1; 
          // Track last source for this target on non-periodic hits
          if (amount>0 && flags !== 'periodic') {
            lastDamageSourceForTarget[dst] = src;
          }
}
        }
      }

      if (!flags && abilityKey) {
        lastCasterForDot[`${abilityKey}||${dst}`] = src;
      }
    }


    function pushOutcome(t: number, src: string, dst: string, flag: "dodge" | "parry") {
      damageEvents.push({ t, src, dst, ability: "attack", amount: 0, flags: flag });
      // NEW: track dodge/parry counts by defender to compute attempts-based chances
      if (src !== dst) {
        const d = ensureDef(dst);
        if (flag === "dodge") d.dodges += 1;
        else d.parries += 1;
      }
    }

    function pushHeal(t: number, src: string, dst: string, abilityRaw: string, amount: number) {
      healEvents.push({ t, src, dst, ability: abilityRaw, amount });
      if (!hpsByActor[src]) hpsByActor[src] = [];
      hpsByActor[src][t] = (hpsByActor[src][t] || 0) + amount;
    }

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw) continue;

      const tm = T_TIME.exec(raw);
      if (!tm) {
        if (collectUnparsed) unparsed.push(raw);
        continue;
      }

      const abs = toSec(tm[1], tm[2], tm[3]);
      if (baseAbs === null) baseAbs = abs;
      const t = abs - (baseAbs as number);
      if (t > maxAbs) maxAbs = t;

      const rest = raw.slice(tm[0].length).trim();

      // declare m BEFORE using it anywhere
      let m: RegExpExecArray | null;

      // death line: "<name> is no more."
      if ((m = RX_DEATH.exec(rest))) {
        const name = (m[1] || "").trim();
        deathEvents.push({ t, name });
        continue;
      }

      const normNames = (srcRaw: string, dstRaw: string) => {
        const src0 = normActor(clean(srcRaw));
        const dst0 = clean(dstRaw);

        const src = src0 ? normalizeActorAlias(src0, seenActors, aliasMap) : "";
        const dst = normalizeActorAlias(dst0, seenActors, aliasMap);

        if (src && !looksLikeNPC(src)) seenActors.add(src);
        if (dst && !looksLikeNPC(dst)) seenActors.add(dst);

        return { src, dst };
      };

      // Defensive outcomes
      if ((m = RX_MISSES_PAREN.exec(rest))) {
        const { src, dst } = normNames(m[1], m[2]);
        const kind = (m[3] || "").toLowerCase();
        if (src) {
          const flag = kind.startsWith("dodg") ? "dodge" : "parry";
          pushOutcome(t, src, dst, flag as "dodge" | "parry");
          parsed++;
          continue;
        }
      }
      if ((m = RX_DODGE_PARRY_1.exec(rest))) {
        const { src, dst } = normNames(m[1], m[2]);
        const flag = (m[3] || "").toLowerCase() as "dodges" | "parries";
        if (src) {
          pushOutcome(t, src, dst, flag === "dodges" ? "dodge" : "parry");
          parsed++;
          continue;
        }
      }
      if ((m = RX_DODGE_PARRY_2.exec(rest))) {
        const { src, dst } = normNames(m[1], m[2]);
        const flag = (m[3] || "").toLowerCase() as "dodges" | "parries";
        if (src) {
          pushOutcome(t, src, dst, flag === "dodges" ? "dodge" : "parry");
          parsed++;
          continue;
        }
      }
      if ((m = RX_DODGE_PARRY_3.exec(rest))) {
        const dst = normalizeActorAlias(clean(m[1]), seenActors, aliasMap);
        const flag = (m[2] || "").toLowerCase();
        const src = normalizeActorAlias(clean(m[3]), seenActors, aliasMap);
        if (src && dst) {
          pushOutcome(t, src, dst, flag === "dodges" ? "dodge" : "parry");
          parsed++;
          continue;
        }
      }
      if ((m = RX_DODGE_PARRY_4.exec(rest))) {
        const src = normalizeActorAlias(clean(m[1]), seenActors, aliasMap);
        const flagPast = (m[2] || "").toLowerCase();
        const dst = normalizeActorAlias(clean(m[3]), seenActors, aliasMap);
        if (src && dst) {
          pushOutcome(t, src, dst, flagPast === "dodged" ? "dodge" : "parry");
          parsed++;
          continue;
        }
      }

      // Block/absorb helpers
      const blockedMatch = rest.match(RX_POINTS_BLOCKED);
      const blockedAmt = blockedMatch ? +blockedMatch[1] : undefined;

      const absorbMatch = rest.match(RX_ARMOR_ABSORB);
      let absorbedAmt = absorbMatch ? +absorbMatch[1] : undefined;
      let preMitTotal = absorbMatch ? +absorbMatch[2] : undefined;

      // Some logs use: "(109 absorbed / 0 resisted.)"
      const simpleAbsorb = rest.match(RX_ABSORB_SIMPLE);
      if (absorbedAmt == null && simpleAbsorb) { absorbedAmt = +simpleAbsorb[1]; }

      const evadedScan = rest.match(RX_EVADED_PCT);
      const evadedFromScan = evadedScan ? +evadedScan[1] : undefined;

      // Elements (explicit) from this line, used by multiple branches below
      const elems = extractElementsFromRest(rest);

      // Damage parsing (with/using form)
      if ((m = RX_DMG_WITH.exec(rest))) {
        const { src, dst } = normNames(m[1], m[2]);
        const ability = clean(m[3]);
        const kindRaw = (m[4] || "").toLowerCase().replace(/\s+/g, " ");
        const evadedPct = m[5] ? +m[5] : evadedFromScan;
        const amount = +m[6];

        const flag =
          kindRaw === "crits"
            ? "crit"
            : kindRaw === "hits"
            ? "hit"
            : kindRaw === "glances"
            ? "glance"
            : kindRaw.startsWith("strikes through")
            ? "strikethrough"
            : undefined;

        if (src) {
          pushDamage(
            t,
            src,
            dst,
            ability,
            amount,
            elems,
            flag,
            blockedAmt,
            absorbedAmt,
            preMitTotal,
            evadedPct
          );
          parsed++;
          continue;
        }
      }

      // Damage parsing (bare form)
      if ((m = RX_DMG_BARE.exec(rest))) {
        const { src, dst } = normNames(m[1], m[2]);
        const kindRaw = (m[3] || "").toLowerCase().replace(/\s+/g, " ");
        const evadedPct = m[4] ? +m[4] : evadedFromScan;
        const amount = +m[5];

        const flag =
          kindRaw === "crits"
            ? "crit"
            : kindRaw === "hits"
            ? "hit"
            : kindRaw === "glances"
            ? "glance"
            : kindRaw.startsWith("strikes through")
            ? "strikethrough"
            : undefined;

        if (src) {
          pushDamage(
            t,
            src,
            dst,
            "attack",
            amount,
            elems,
            flag,
            blockedAmt,
            absorbedAmt,
            preMitTotal,
            evadedPct
          );
          parsed++;
          continue;
        }
      }

      // Generic damage
      if ((m = RX_DMG_GENERIC.exec(rest))) {
        const { src, dst } = normNames(m[1], m[2]);
        const amount = +m[3];
        const ability = clean(m[4] || "attack");
        if (src) {
          pushDamage(
            t,
            src,
            dst,
            ability,
            amount,
            elems,
            undefined,
            blockedAmt,
            absorbedAmt,
            preMitTotal,
            evadedFromScan
          );
          parsed++;
          continue;
        }
      }

      // periodic “suffers … from … over time”
      if ((m = RX_DMG_DOT.exec(rest))) {
        const dstNormOnly = normalizeActorAlias(clean(m[1]), seenActors, aliasMap);
        if (dstNormOnly && !looksLikeNPC(dstNormOnly)) seenActors.add(dstNormOnly);

        const amount = +m[2];
        const abilityRaw = clean(m[3]);
        const key = normalizeAbilityName(abilityRaw);
        const caster = lastCasterForDot[`${key}||${dstNormOnly}`] || lastDamageSourceForTarget[dstNormOnly] || "";
        pushDamage(
          t,
          caster || key || "Periodic",
          dstNormOnly,
          abilityRaw,
          amount,
          undefined,   // no explicit elements
          "periodic"
        );
        parsed++;
        continue;
      }

      // has caused (elemental) — e.g. "Beefy has caused X to take 2567 points of cold damage."
      if ((m = RX_DMG_HAS_CAUSED_ELEM.exec(rest))) {
        const { src, dst } = normNames(m[1], m[2]);
        const amount = +m[3];
        const rawEl = (m[4] || '').toLowerCase();
        const elemKey = (ELEMENT_ALIASES as any)[rawEl] || rawEl;
        const elemsOverride: ElementalBreakdown = { [elemKey]: amount };
        if (src) {
          // Use a generic ability label so DoT shows as periodic in UI; element breakdown carries the type
          pushDamage(t, src, dst, 'Periodic', amount, elemsOverride, 'periodic');
          parsed++;
          continue;
        }
      }

      // has caused (no explicit element)
      if ((m = RX_DMG_HAS_CAUSED.exec(rest))) {
        const { src, dst } = normNames(m[1], m[2]);
        const amount = +m[3];
        if (src) {
          pushDamage(t, src, dst, 'Periodic', amount, undefined, 'periodic');
          parsed++;
          continue;
        }
      }

      // generic “causes X to take N points of damage”
      if ((m = RX_DMG_CAUSED.exec(rest))) {
        const { src, dst } = normNames(m[1], m[2]);
        const amount = +m[3];
        const dtype = "Periodic";
        if (src) {
          pushDamage(t, src, dst, dtype, amount, undefined, "periodic");
          parsed++;
          continue;
        }
      }

      // Healing
      if ((m = RX_HEAL.exec(rest))) {
        const { src, dst } = normNames(m[1], m[2]);
        const amount = +m[3];
        const ability = clean(m[4] || "");
        if (src) {
          pushHeal(t, src, dst, ability, amount);
          parsed++;
          continue;
        }
      }

      if (collectUnparsed) unparsed.push(raw);
    }

    // rows & timeline aggregates
    
// Fold aliases by canonical name before deriving actors/rows
const dpsCanon = mergeSeriesMap(dpsByActor);
const hpsCanon = mergeSeriesMap(hpsByActor);
const actors = new Set<string>([...Object.keys(dpsCanon), ...Object.keys(hpsCanon)]);
    

// Build per-second action counts (distinct abilities used that second)
const actionsByActor: Record<string, number[]> = {};
const apmByActor: Record<string, number> = {};
const fightMinutes = Math.max(1, (maxAbs||0) / 60);
for (const a of Object.keys(dpsCanon)) {
  const secMap = actionsByActorSec[a] || {};
  const arr: number[] = [];
  let total = 0;
  for (let sec = 0; sec <= maxAbs; sec++) {
    const c = (secMap[sec] ? secMap[sec].size : 0);
    arr[sec] = c;
    total += c;
  }
  actionsByActor[a] = arr;
  apmByActor[a] = total / fightMinutes;
}
const rows: PlayerRow[] = [];
    const tl: Array<{ t: number; dps: number; hps: number }> = [];
    for (let sec = 0; sec <= maxAbs; sec++) {
      let d = 0,
        h = 0;
      for (const a of Object.keys(dpsCanon)) d += dpsCanon[a][sec] || 0;
      for (const a of Object.keys(hpsCanon)) h += hpsCanon[a][sec] || 0;
      tl.push({ t: sec, dps: d, hps: h });
    }
    for (const a of actors) {
      let d = 0,
        h = 0;
      const dps = dpsCanon[a] || [];
      const hps = hpsCanon[a] || [];
      for (let sec = 0; sec <= maxAbs; sec++) {
        d += dps[sec] || 0;
        h += hps[sec] || 0;
      }
      rows.push({
        name: a,
        damageDealt: d,
        healingDone: h,
        avgDps: d / Math.max(1, maxAbs),
      });
    }

    // NEW: derive per-defender defensive metrics ready for UI
    const defenseDerived: Record<
      string,
      {
        // existing glancing numbers
        hitsTaken: number; // non-glance landed
        glanceCount: number;
        glanceChancePct: number;
        avgGlance: number;

        // NEW: attempts-based numbers to mirror Defense Flow
        attempts: number;
        dodgeCount: number;
        parryCount: number;
        dodgeChancePct: number; // dodges / attempts
        parryChancePct: number; // parries / attempts
      }
    > = {};

    for (const [defender, v] of Object.entries(perDef)) {
      const landedTotal = v.hits + v.glances; // equals Flow's "Landed"
      const attempts = landedTotal + v.dodges + v.parries; // Flow math
      const denomGlance = v.hits + v.glances; // for Glance %

      defenseDerived[defender] = {
        // glancing
        hitsTaken: v.hits,
        glanceCount: v.glances,
        glanceChancePct: denomGlance ? (v.glances / denomGlance) * 100 : 0,
        avgGlance: v.glances ? v.glanceDamageSum / v.glances : 0,

        // attempts-based chances
        attempts,
        dodgeCount: v.dodges,
        parryCount: v.parries,
        dodgeChancePct: attempts ? (v.dodges / attempts) * 100 : 0,
        parryChancePct: attempts ? (v.parries / attempts) * 100 : 0,
      };
    }

    const payload = {
      rows,
      tl,
      perSrc: dpsCanon,
      perAbility: mergePerAbilityMap(perAbility),
      perAbilityTargets: mergePerAbilityTargetsMap(perAbilityTargets),
      actionsByActor,
      apmByActor,
      perTaken,
      perTakenBy,
      defense: perDef, // raw tallies
      defenseDerived, // ready-to-render numbers (Flow-consistent)
      duration: maxAbs,
      debug: {
        parsed,
        totalLines: rawLines.length,
        uniqueLines: lines.length,
        duplicatesDropped,
        duration: maxAbs,
        unparsed: collectUnparsed ? unparsed.length : 0,
      },
      damageEvents,
      healEvents,
      deathEvents,
    };

    (self as any).postMessage({ type: "done", payload });
  } catch (err: any) {
    (self as any).postMessage({
      type: "error",
      error: String((err && err.message) || err || "Unknown error"),
    });
  }
};