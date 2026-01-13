import React, { useEffect, useMemo, useRef, useState } from "react";

type DamageEvent = { t: number; src: string; ability: string; amount: number; flags?: string };
type HealEvent = { t: number; src: string; ability?: string; amount: number };
type UtilityEvent = { t: number; src: string; ability: string };
type DeathEvent = { t: number; name: string };

type Player = { name: string; profession?: string };

type PerAbility = Record<string, Record<string, { hits: number; dmg: number; max: number }>>;

type UtilityByPlayer = Record<
  string,
  Record<string, { count: number; uptime: number; uptimePct: number }>
>;

type Props = {
  open: boolean;
  onClose: () => void;

  players: Player[];
  selectedPlayers: string[];
  onChangeSelectedPlayers: (next: string[]) => void;

  classOf: Record<string, string>;
  duration: number;

  damageEvents: DamageEvent[];
  healEvents: HealEvent[];
  utilityEvents: UtilityEvent[];
  deathEvents: DeathEvent[];
  perAbility: PerAbility;

  // pre-aggregated in App: { player: { ability: {count, uptime, uptimePct} } }
  utilityByPlayer: UtilityByPlayer;
};

const fmtNum = (n: number) => {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(/\.00$/, "") + "M";
  if (abs >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(Math.round(n));
};

const fmtPct = (n: number) => (Number.isFinite(n) ? (n * 100).toFixed(1) + "%" : "—");

const fmtTime = (sec: number) => {
  if (!Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
};

const normalizeAbility = (s: string) =>
  (s || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "") // drop parenthetical suffixes like (Mark 3)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const canonPlayer = (s: string) => (s || "").replace(/'+$/g, "").trim();

// APM should reflect meaningful ability activations, not every damage tick / multi-target hit.
// We approximate "actions" by collapsing events into 0.25s buckets (SWG global cooldown) per ability,
// and ignoring extremely noisy pseudo-abilities like auto-attack / periodic tick buckets.
const APM_BUCKET = 0.25;
const apmCountsAbility = (ability?: string) => {
  const k = normalizeAbility(ability || "");
  if (!k) return false;
  // Common high-noise buckets that would massively inflate APM
  if (k === "periodic" || k === "attack" || k === "and hits") return false;
  return true;
};
const apmKey = (t: number, ability?: string) => {
  const bucket = Math.round(t / APM_BUCKET) * APM_BUCKET;
  return `${bucket.toFixed(2)}|${normalizeAbility(ability || "")}`;
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function computePeak10s(events: DamageEvent[], duration: number) {
  const dur = Math.max(0, Math.floor(duration));
  if (!dur || events.length === 0) return 0;

  const buckets = new Array(dur + 1).fill(0);
  for (const e of events) {
    const s = clamp(Math.floor(e.t), 0, dur);
    buckets[s] += e.amount || 0;
  }
  let window = 0;
  for (let i = 0; i <= Math.min(9, dur); i++) window += buckets[i];
  let best = window;

  for (let i = 10; i <= dur; i++) {
    window += buckets[i] - buckets[i - 10];
    if (window > best) best = window;
  }
  return best / 10;
}

function computeFingerprint(secondsActive: boolean[]) {
  // compress to 80 pips max for UI
  const maxPips = 80;
  const n = secondsActive.length;
  if (n === 0) return new Array(0).fill(false);
  const step = Math.max(1, Math.ceil(n / maxPips));
  const pips: boolean[] = [];
  for (let i = 0; i < n; i += step) {
    let any = false;
    for (let j = i; j < Math.min(n, i + step); j++) {
      if (secondsActive[j]) { any = true; break; }
    }
    pips.push(any);
  }
  return pips;
}

function compressSeries(values: number[], maxBars: number) {
  const n = values.length;
  if (n === 0) return [] as number[];
  const bars = Math.min(maxBars, n);
  const step = Math.max(1, Math.ceil(n / bars));
  const out: number[] = [];
  for (let i = 0; i < n; i += step) {
    let sum = 0;
    let count = 0;
    for (let j = i; j < Math.min(n, i + step); j++) {
      sum += Number(values[j]) || 0;
      count++;
    }
    out.push(count ? sum / count : 0);
  }
  // normalize 0..1 for UI bars
  let max = 0;
  for (const v of out) max = Math.max(max, v);
  if (max <= 0) return out.map(() => 0);
  return out.map(v => clamp(v / max, 0, 1));
}

function longestStreak(bits: boolean[], want: boolean) {
  let best = 0;
  let cur = 0;
  for (const b of bits) {
    if (b === want) {
      cur++;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best;
}

export default function PlayerSummary(props: Props) {
  const {
    open,
    onClose,
    players,
    selectedPlayers,
    onChangeSelectedPlayers,
    classOf,
    duration,
    damageEvents,
    healEvents,
    utilityEvents,
    deathEvents,
    perAbility,
    utilityByPlayer,
  } = props;

  // Some logs encode player names with a trailing apostrophe (e.g., "Vegeta'").
  // Canonicalize keys so selection/player lists ("Vegeta") match utility aggregation ("Vegeta'").
    // Some logs include a companion / effect suffix in the source (e.g. "Shepard EffectMass performs ...").
  // For UI purposes we want those to roll up under the owning player when possible.
  const utilityByPlayerCanon: UtilityByPlayer = React.useMemo(() => {
    const out: UtilityByPlayer = {};

    const resolveUtilityOwner = (raw: string) => {
      const n = canonPlayer(raw);
      const base = n.split(" ")[0];
      // If the base token is a known roster player / has a class, roll up to it.
      if (classOf?.[base] || players.some(p => canonPlayer(p.name) === base)) return base;
      return n;
    };

    for (const [rawPlayer, abilities] of Object.entries(utilityByPlayer || {})) {
      const p = resolveUtilityOwner(rawPlayer);
      out[p] ||= {};
      for (const [ability, v] of Object.entries(abilities || {})) {
        const prev = out[p][ability];
        out[p][ability] = {
          count: (prev?.count || 0) + (v?.count || 0),
          uptime: (prev?.uptime || 0) + (v?.uptime || 0),
          // uptimePct is not additive; keep the max as a conservative display value
          uptimePct: Math.max(prev?.uptimePct || 0, v?.uptimePct || 0),
        };
      }
    }
    return out;
  }, [utilityByPlayer, players, classOf]);

  const professionOf = (name: string): string => {
    const n = canonPlayer(name);
    return (
      classOf?.[name] ||
      classOf?.[n] ||
      players.find(p => canonPlayer(p.name) === n)?.profession ||
      "Unknown"
    );
  };

const isIncomingDamage = (e: { ability?: string; flags?: string; amount?: number }) => {
  if (typeof e.amount === 'number' && e.amount < 0) return true;
  const f = (e.flags ?? '').toLowerCase();
  const a = (e.ability ?? '').toLowerCase();
  return (
    f.includes('taken') ||
    f.includes('incoming') ||
    f.includes('inc') ||
    f.includes('received') ||
    f.includes('recv') ||
    f.includes('dmg_taken') ||
    f.includes('damage_taken') ||
    a.startsWith('damage taken') ||
    a.includes('damage taken') ||
    a.includes('incoming') ||
    a.startsWith('taken ') ||
    a.includes('(taken)') ||
    a.includes('hit by') ||
    a.includes('from ')
  );
};

  // Build a roster from *all* known sources (events + class map + players list).
  // This is critical because the "players" array may be filtered upstream.
  const rosterNames = useMemo(() => {
    const set = new Set<string>();
    for (const p of players) if (p?.name) set.add(canonPlayer(p.name));
    for (const n of Object.keys(classOf || {})) if (n) set.add(canonPlayer(n));
    for (const e of damageEvents) if (e?.src) set.add(canonPlayer(e.src));
    for (const e of healEvents) if (e?.src) set.add(canonPlayer(e.src));
    for (const e of utilityEvents) if (e?.src) set.add(canonPlayer(e.src));
    for (const e of deathEvents) if (e?.src) set.add(canonPlayer(e.src));

    const selectedSet = new Set(selectedPlayers);
    const names = Array.from(set)
      .filter(n => n && (selectedSet.has(n) || professionOf(n) !== "Unknown"))
      .sort((a, b) => a.localeCompare(b));
    return names;
  }, [players, classOf, damageEvents, healEvents, utilityEvents, deathEvents, selectedPlayers]);

  const playerOptions = useMemo(() => {
    return rosterNames.map(name => ({
      name,
      profession: professionOf(name),
    }));
  }, [rosterNames, classOf, players]);

  const selected = useMemo(() => uniq(selectedPlayers).slice(0, 5), [selectedPlayers]);

  const byPlayer = useMemo(() => {
    const by: Record<string, {
      totalDamage: number;
      avgDps: number;
      peak10s: number;
      apm: number;
      damageTaken: number;
      // Fingerprint / engagement metrics
      activePips: boolean[];
      dmgBars: number[]; // 0..1 bars, compressed
      firstAction: number; // seconds
      lastAction: number; // seconds
      longestIdle: number; // seconds
      longestActive: number; // seconds
      burstiness: number; // 0..+ (std/mean of per-second damage)
      deaths: number;
      uptime: number;
      activeSeconds: number;
      topAbilities: Array<{ ability: string; dmg: number; share: number; critPct: number; pctOfTotal: number }>;
      utilities: Array<{ ability: string; count: number; uptime: number; uptimePct: number }>;
      utilityCount: number;
    }> = {};

    const dur = Math.max(1, duration);
    const durSec = Math.max(0, Math.floor(duration));

    const damageBySrc = new Map<string, DamageEvent[]>();
    for (const e of damageEvents) {
      if (!e?.src) continue;
      const arr = damageBySrc.get(e.src) || [];
      arr.push(e);
      damageBySrc.set(e.src, arr);
    }

    const healsBySrc = new Map<string, HealEvent[]>();
    for (const e of healEvents) {
      if (!e?.src) continue;
      const arr = healsBySrc.get(canonPlayer(e.src)) || [];
      arr.push(e);
      healsBySrc.set(canonPlayer(e.src), arr);
    }

    const utilBySrc = new Map<string, UtilityEvent[]>();
    for (const e of utilityEvents) {
      if (!e?.src) continue;
      const arr = utilBySrc.get(canonPlayer(e.src)) || [];
      arr.push(e);
      utilBySrc.set(canonPlayer(e.src), arr);
    }

    const deathsByName = new Map<string, number>();
    for (const d of deathEvents) {
      if (!d?.name) continue;
      deathsByName.set(d.name, (deathsByName.get(d.name) || 0) + 1);
    }

    // Damage taken: we infer target from damage events if present (different parsers use different keys).
    const damageTakenByName = new Map<string, number>();
    for (const e of damageEvents as any[]) {
      const t =
        (e && (e.dst ?? e.target ?? e.tgt ?? e.to ?? e.victim ?? e.defender ?? e.targetName ?? e.dstName)) as any;
      const name =
        typeof t === 'string'
          ? t
          : t && typeof t.name === 'string'
            ? t.name
            : undefined;
      if (!name) continue;
      const amt = Number(e.amount ?? e.dmg ?? e.value ?? 0);
      if (!Number.isFinite(amt)) continue;
      damageTakenByName.set(name, (damageTakenByName.get(name) || 0) + amt);
    }

    for (const name of rosterNames) {
      const dEvents = (damageBySrc.get(name) || []).slice().sort((a,b)=>a.t-b.t);
      const hEvents = (healsBySrc.get(name) || []).slice().sort((a,b)=>a.t-b.t);
      const uEvents = (utilBySrc.get(name) || []).slice().sort((a,b)=>a.t-b.t);

      const totalDamage = dEvents.reduce((s, e) => s + (e.amount || 0), 0);
      const avgDps = totalDamage / dur;
      const peak10s = computePeak10s(dEvents, dur);

            // Actions-per-minute: dedupe by (time bucket, ability) so AoE/multi-target hits and periodic ticks
      // don't explode the count.
      const actionKeys = new Set<string>();
      for (const e of dEvents) {
        if (!apmCountsAbility(e.ability)) continue;
        actionKeys.add(apmKey(e.t, e.ability));
      }
      for (const e of hEvents) actionKeys.add(apmKey(e.t, e.ability));
      for (const e of uEvents) actionKeys.add(apmKey(e.t, e.ability));
      const actions = actionKeys.size;
      const apm = actions / Math.max(1e-9, dur / 60);

      const secondsActive = new Array(durSec + 1).fill(false);
      for (const e of dEvents) secondsActive[clamp(Math.floor(e.t), 0, durSec)] = true;
      for (const e of hEvents) secondsActive[clamp(Math.floor(e.t), 0, durSec)] = true;
      for (const e of uEvents) secondsActive[clamp(Math.floor(e.t), 0, durSec)] = true;

      let activeSeconds = 0;
      for (const b of secondsActive) if (b) activeSeconds++;
      const uptime = durSec > 0 ? activeSeconds / (durSec + 1) : 0;

      const activePips = computeFingerprint(secondsActive);

      // Damage cadence bars (per-second damage compressed & normalized 0..1)
      const secDmg = new Array(durSec + 1).fill(0);
      for (const e of dEvents) {
        const s = clamp(Math.floor(e.t), 0, durSec);
        secDmg[s] += Number(e.amount) || 0;
      }
      const dmgBars = compressSeries(secDmg, 96);

      // Engagement streaks
      const longestActive = longestStreak(secondsActive, true);
      const longestIdle = longestStreak(secondsActive, false);

      // First/last action time
      let firstAction = -1;
      let lastAction = -1;
      for (let i = 0; i < secondsActive.length; i++) {
        if (secondsActive[i]) { firstAction = i; break; }
      }
      for (let i = secondsActive.length - 1; i >= 0; i--) {
        if (secondsActive[i]) { lastAction = i; break; }
      }

      // Burstiness: coefficient of variation of per-second damage (std/mean).
      // Uses only seconds where player dealt damage to avoid healing-only periods inflating quietness.
      let sumDmg = 0;
      let dmgCount = 0;
      for (const v of secDmg) {
        if (v > 0) { sumDmg += v; dmgCount++; }
      }
      const mean = dmgCount ? sumDmg / dmgCount : 0;
      let variance = 0;
      if (dmgCount && mean > 0) {
        for (const v of secDmg) {
          if (v > 0) variance += (v - mean) * (v - mean);
        }
        variance /= dmgCount;
      }
      const burstiness = mean > 0 ? Math.sqrt(variance) / mean : 0;

            // Aggregate abilities with normalization so minor naming differences (case/punct/parentheses)
      // don't split the same ability across players.
      const rawAbilityMap = perAbility?.[name] || perAbility?.[canonPlayer(name)] || {};
      const agg = new Map<string, { display: string; dmg: number }>();
      for (const [ability, v] of Object.entries(rawAbilityMap)) {
        const key = normalizeAbility(ability);
        if (!key) continue;
        const prev = agg.get(key);
        const dmg = (v as any)?.dmg || 0;
        if (!prev) agg.set(key, { display: ability, dmg });
        else agg.set(key, { display: prev.display, dmg: prev.dmg + dmg });
      }

      const top = Array.from(agg.entries())
        .map(([key, v]) => ({ key, ability: v.display, dmg: v.dmg }))
        .sort((a, b) => b.dmg - a.dmg)
        ;

      // Precompute crit damage per normalized ability for this player
      const critByKey = new Map<string, { dmg: number; critDmg: number }>();
      for (const e of dEvents) {
        const k = normalizeAbility(e.ability || "");
        if (!k) continue;
        const amt = Number((e as any).amount ?? (e as any).dmg ?? (e as any).value ?? 0);
        if (!Number.isFinite(amt)) continue;
        const isCrit = ((e.flags || "") + "").toLowerCase().includes("crit");
        const prev = critByKey.get(k) || { dmg: 0, critDmg: 0 };
        prev.dmg += amt;
        if (isCrit) prev.critDmg += amt;
        critByKey.set(k, prev);
      }

      const topAbilities = top.map((a) => {
        const share = totalDamage > 0 ? a.dmg / totalDamage : 0; // fraction
        const cd = critByKey.get(a.key);
        const critPct = cd && cd.dmg > 0 ? cd.critDmg / cd.dmg : 0; // fraction of ability dmg that was crit
        return { ability: a.ability, dmg: a.dmg, share, pctOfTotal: share, critPct };
      });

      const utilAgg = utilityByPlayerCanon?.[canonPlayer(name)] || {};

      // Utility abilities are parsed from lines like:
      //   [Combat]  16:27:46 Broly performs Adrenaline Rush.
      //   [Combat]  16:27:47 Broly performs Bacta Burst (Mark 3) on Broly.
      // We treat these as *uses*; uptime isn't derivable from a single "performs" line,
      // so we keep uptime metrics at 0 for now.
      const utilities = Object.entries(utilAgg)
        .map(([ability, v]) => ({
          ability,
          count: v?.count ?? 0,
          uptime: v?.uptime ?? 0,
          uptimePct: v?.uptimePct ?? 0,
        }))
        .filter(u => (u.count || 0) > 0 || (u.uptime || 0) > 0)
        .sort((a, b) => (b.count || 0) - (a.count || 0));

      // Total utility uses for accolades (not limited to top 10)
      const utilityCount = Object.values(utilAgg).reduce((sum, v) => sum + (v?.count || 0), 0);

      by[name] = {
        totalDamage,
        avgDps,
        peak10s,
        apm,
        damageTaken: damageTakenByName.get(name) || 0,
        deaths: deathsByName.get(name) || 0,
        uptime,
        activeSeconds,
        activePips,
        dmgBars,
        firstAction,
        lastAction,
        longestIdle,
        longestActive,
        burstiness,
        topAbilities,
        utilities,
        utilityCount,
      };
    }

    return by;
  }, [rosterNames, damageEvents, healEvents, utilityEvents, deathEvents, perAbility, utilityByPlayer, duration]);

  const primary = selected[0];

  // ---------------------------------------------------------------------------
  // WHAT WON THE FIGHT
  // Fight definition: segments of combat separated by >30 seconds of global inactivity.
  // We use *any* action (damage/heal/utility) as combat activity.
  // ---------------------------------------------------------------------------
  type Fight = {
    start: number;
    end: number;
    duration: number;
    deaths: DeathEvent[];
    totalDamageByPlayer: Record<string, number>;
    decisiveDamageByPlayer: Record<string, number>;
    decisiveTopAbilities: Array<{ ability: string; dmg: number; share: number }>; // across selected players
  };

  const fights: Fight[] = useMemo(() => {
    const all: Array<{ t: number; kind: 'dmg'|'heal'|'util'; src?: string; ability?: string; amount?: number }> = [];
    for (const e of (damageEvents || [])) {
      if (!e) continue;
      if (isIncomingDamage(e)) continue;
      all.push({ t: Number(e.t) || 0, kind: 'dmg', src: canonPlayer(e.src), ability: e.ability, amount: Number((e as any).amount ?? 0) });
    }
    for (const e of (healEvents || [])) {
      if (!e) continue;
      all.push({ t: Number(e.t) || 0, kind: 'heal', src: canonPlayer(e.src), ability: e.ability, amount: Number((e as any).amount ?? 0) });
    }
    for (const e of (utilityEvents || [])) {
      if (!e) continue;
      all.push({ t: Number(e.t) || 0, kind: 'util', src: canonPlayer(e.src), ability: e.ability });
    }
    all.sort((a, b) => a.t - b.t);
    if (all.length === 0) return [];

    const GAP = 30; // seconds of inactivity that ends a fight
    const segments: Array<{ start: number; end: number }> = [];
    let start = all[0].t;
    let prev = all[0].t;
    for (let i = 1; i < all.length; i++) {
      const t = all[i].t;
      if (t - prev > GAP) {
        segments.push({ start, end: prev });
        start = t;
      }
      prev = t;
    }
    segments.push({ start, end: prev });

    // build fight objects
    const out: Fight[] = [];
    for (const seg of segments) {
      const s0 = Math.max(0, Math.floor(seg.start));
      const s1 = Math.max(s0, Math.ceil(seg.end));
      const deaths = (deathEvents || []).filter(d => d && d.t >= seg.start && d.t <= seg.end);

      const totalDamageByPlayer: Record<string, number> = {};
      const decisiveDamageByPlayer: Record<string, number> = {};
      const decisiveByAbility = new Map<string, number>();

      // total damage in fight
      for (const e of (damageEvents || [])) {
        if (!e || isIncomingDamage(e)) continue;
        if (e.t < seg.start || e.t > seg.end) continue;
        const p = canonPlayer(e.src);
        const amt = Number((e as any).amount ?? 0) || 0;
        totalDamageByPlayer[p] = (totalDamageByPlayer[p] || 0) + amt;
      }

      // decisive windows: 5s prior to each death inside the fight
      // (If there are no deaths, we fall back to the top 10 seconds peak window logic later in UI.)
      const decisiveRanges = deaths.map(d => ({ a: Math.max(seg.start, d.t - 5), b: d.t }));
      if (decisiveRanges.length) {
        for (const e of (damageEvents || [])) {
          if (!e || isIncomingDamage(e)) continue;
          // quick reject
          if (e.t < seg.start || e.t > seg.end) continue;
          // check if in any decisive window
          let inWin = false;
          for (const r of decisiveRanges) {
            if (e.t >= r.a && e.t <= r.b) { inWin = true; break; }
          }
          if (!inWin) continue;
          const p = canonPlayer(e.src);
          const amt = Number((e as any).amount ?? 0) || 0;
          decisiveDamageByPlayer[p] = (decisiveDamageByPlayer[p] || 0) + amt;
          const ab = (e.ability || 'Unknown');
          decisiveByAbility.set(ab, (decisiveByAbility.get(ab) || 0) + amt);
        }
      }

      const decisiveTotal = Array.from(decisiveByAbility.values()).reduce((a, b) => a + b, 0) || 0;
      const decisiveTopAbilities = Array.from(decisiveByAbility.entries())
        .map(([ability, dmg]) => ({ ability, dmg, share: decisiveTotal > 0 ? dmg / decisiveTotal : 0 }))
        .sort((a, b) => b.dmg - a.dmg)
        .slice(0, 6);

      out.push({
        start: s0,
        end: s1,
        duration: Math.max(1, s1 - s0),
        deaths,
        totalDamageByPlayer,
        decisiveDamageByPlayer,
        decisiveTopAbilities,
      });
    }
    return out;
  }, [damageEvents, healEvents, utilityEvents, deathEvents]);

  // Keep fight selection in bounds
  useEffect(() => {
    if (!fights.length) {
      if (selectedFightIdx !== 0) setSelectedFightIdx(0);
      return;
    }
    if (selectedFightIdx < 0) setSelectedFightIdx(0);
    else if (selectedFightIdx > fights.length - 1) setSelectedFightIdx(fights.length - 1);
  }, [fights.length]);

  // Used for subtle progress bars in the left "snapshot" tiles.
  const metricMax = useMemo(() => {
    let maxTotal = 0;
    let maxAvg = 0;
    let maxPeak = 0;
    let maxApm = 0;
    for (const s of Object.values(byPlayer)) {
      if (!s) continue;
      maxTotal = Math.max(maxTotal, Number(s.totalDamage) || 0);
      maxAvg = Math.max(maxAvg, Number(s.avgDps) || 0);
      maxPeak = Math.max(maxPeak, Number(s.peak10s) || 0);
      maxApm = Math.max(maxApm, Number(s.apm) || 0);
    }
    return { maxTotal, maxAvg, maxPeak, maxApm };
  }, [byPlayer]);

  // The stat tiles should reflect the *selection*:
  // - 1 selected: show that player's stats
  // - 2+ selected: show combined/averaged rollups (visual-only request, but keeps numbers intuitive)
  const primaryStats = useMemo(() => {
    if (!selected.length) return null;
    if (selected.length === 1) return byPlayer[selected[0]] || null;

    const statsList = selected.map(n => byPlayer[n]).filter(Boolean) as any[];
    if (!statsList.length) return null;

    const sum = (k: string) => statsList.reduce((a, s) => a + (Number(s?.[k]) || 0), 0);
    const avg = (k: string) => sum(k) / statsList.length;

    // Build a combined "squad" profile for the fingerprint visuals.
    const maxBars = Math.max(...statsList.map(s => (s?.dmgBars?.length || 0)), 0);
    const dmgBars = maxBars
      ? Array.from({ length: maxBars }, (_, i) => {
          let acc = 0;
          let c = 0;
          for (const s of statsList) {
            const v = (s?.dmgBars && s.dmgBars[i] != null) ? Number(s.dmgBars[i]) : NaN;
            if (Number.isFinite(v)) { acc += v; c++; }
          }
          return c ? acc / c : 0;
        }).map(v => clamp(v, 0, 1))
      : [];

    const maxPips = Math.max(...statsList.map(s => (s?.activePips?.length || 0)), 0);
    const activePips = maxPips
      ? Array.from({ length: maxPips }, (_, i) => {
          for (const s of statsList) {
            if (s?.activePips?.[i]) return true;
          }
          return false;
        })
      : [];

    const firstAction = Math.min(...statsList.map(s => (Number.isFinite(s?.firstAction) && s.firstAction >= 0) ? s.firstAction : 1e9));
    const lastAction = Math.max(...statsList.map(s => (Number.isFinite(s?.lastAction) && s.lastAction >= 0) ? s.lastAction : -1));

    // totalDamage sums; rate-like metrics are averaged across selected players
    return {
      ...statsList[0],
      totalDamage: sum("totalDamage"),
      avgDps: avg("avgDps"),
      peak10s: avg("peak10s"),
      apm: avg("apm"),
      uptime: avg("uptime"),
      activeSeconds: sum("activeSeconds"),
      deaths: sum("deaths"),
      burstiness: avg("burstiness"),
      longestIdle: avg("longestIdle"),
      longestActive: avg("longestActive"),
      firstAction: Number.isFinite(firstAction) && firstAction < 1e9 ? firstAction : -1,
      lastAction,
      dmgBars,
      activePips,
    };
  }, [selected, byPlayer]);

  const selectedStats = useMemo(() => {
    return selected
      .map(name => ({ name, stats: byPlayer[name] }))
      .filter(x => !!x.stats);
  }, [selected, byPlayer]);

  const isCompare = selectedStats.length > 1;

  // Seconds where *any* damage occurred in the fight. Used for fair uptime.
  const globalActiveSeconds = useMemo(() => {
    const sec = new Array(Math.max(0, Math.ceil(duration))).fill(false) as boolean[];
    for (const e of damageEvents) {
      if (isIncomingDamage(e)) continue;
      const s = Math.floor(e.t);
      if (s >= 0 && s < sec.length) sec[s] = true;
    }
    return sec;
  }, [damageEvents, duration]);

  const globalActiveCount = useMemo(() => globalActiveSeconds.reduce((a, b) => a + (b ? 1 : 0), 0), [globalActiveSeconds]);

  const accolades = useMemo(() => {
    if (!rosterNames.length) {
      return {
        mvp: { name: "—", detail: "" },
        burst: { name: "—", detail: "" },
        uptime: { name: "—", detail: "" },
        survivor: { name: "—", detail: "" },
        support: { name: "—", detail: "" },
      };
    }

    const rows = rosterNames
      .map(name => {
        const s = byPlayer[name];
        const dmg = s?.totalDamage ?? 0;
        const util = s?.utilityCount ?? 0;
        const taken = s?.damageTaken ?? 0;
        const deaths = s?.deaths ?? 0;
        const uptimePct = Math.max(0, Math.min(1, s?.uptime ?? 0));
        return { name, dmg, util, taken, deaths, uptimePct };
      })
      .filter(r => r.dmg > 0 || r.util > 0 || r.taken > 0);

    const rank = <T,>(arr: T[], get: (t: T) => number, desc = true) => {
      const sorted = [...arr].sort((a, b) => (desc ? get(b) - get(a) : get(a) - get(b)));
      const map = new Map<string, number>();
      sorted.forEach((r: any, i) => map.set(r.name, i + 1));
      return map;
    };

    const rDmg = rank(rows, r => r.dmg, true);
    const rUtil = rank(rows, r => r.util, true);
    const rTaken = rank(rows, r => r.taken, false);
    const rUp = rank(rows, r => r.uptimePct, true);

    let bestMvp = rows[0];
    let bestScore = Infinity;
    for (const r of rows) {
      const score = (rDmg.get(r.name) || 999) + (rUtil.get(r.name) || 999) + (rTaken.get(r.name) || 999) + (rUp.get(r.name) || 999);
      if (score < bestScore) {
        bestScore = score;
        bestMvp = r;
      }
    }

    // Burst: count how many 10s windows are "burst" and their average window damage
const burstFor = (name: string) => {
  const events = (damageEvents || []).filter(e => e.src === name);
  if (!events.length) return { windows: 0, avg: 0, max: 0, score: 0 };

  const len = Math.max(1, Math.ceil(duration));
  const perSec = new Array(len).fill(0) as number[];
  for (const e of events) {
    const s = Math.floor(e.t);
    if (s >= 0 && s < perSec.length) perSec[s] += e.amount;
  }

  const win = 10; // keep your current 10s burst window
  let best = 0;
  const sums = new Array(Math.max(0, len - win + 1)).fill(0);
  let cur = 0;

  for (let i = 0; i < len; i++) {
    cur += perSec[i];
    if (i >= win) cur -= perSec[i - win];
    if (i >= win - 1) {
      const idx = i - (win - 1);
      sums[idx] = cur;
      if (cur > best) best = cur;
    }
  }

  const thresh = best * 0.6;

  let windows = 0;
  let totalBurst = 0;
  let i = 0;
  while (i < sums.length) {
    if (sums[i] >= thresh && thresh > 0) {
      windows += 1;
      totalBurst += sums[i];
      // skip ahead to avoid counting the same burst repeatedly
      i += 6;
    } else {
      i += 1;
    }
  }

  // These are DPS values (damage per second) for consistency with your existing avg
  const avg = windows ? (totalBurst / windows) / win : 0;
  const max = best / win;

  // ✅ Impact-weighted burst score:
  // - max (biggest spike) dominates
  // - avg matters some (sustained burst quality)
  // - windows is minor (spam shouldn’t win)
  const score =
    (max * 0.7) +
    (avg * 0.2) +
    (windows * 0.1);

  return { windows, avg, max, score };
};


    let bestBurstName = rows[0].name;
let bestBurst = { windows: 0, avg: 0, max: 0, score: -Infinity };

for (const r of rows) {
  const b = burstFor(r.name);

  // Primary: weighted score
  // Tie-breakers: max spike, then avg, then windows
  if (
    b.score > bestBurst.score ||
    (b.score === bestBurst.score && b.max > bestBurst.max) ||
    (b.score === bestBurst.score && b.max === bestBurst.max && b.avg > bestBurst.avg) ||
    (b.score === bestBurst.score && b.max === bestBurst.max && b.avg === bestBurst.avg && b.windows > bestBurst.windows)
  ) {
    bestBurstName = r.name;
    bestBurst = b;
  }
}


    // Uptime winner
    const bestUp = [...rows].sort((a, b) => b.uptimePct - a.uptimePct)[0];

    // Survivor: most damage taken (tank) — ONLY eligible if present in every segment
    // Build "segments" from global activity across ALL events (damage/heal/utility), splitting when idle for a while.
    const durSec = Math.max(0, Math.floor(duration));
    const global = new Array(durSec + 1).fill(false) as boolean[];
    for (const e of (damageEvents || [])) {
      if (isIncomingDamage(e)) continue;
      const s = clamp(Math.floor(e.t), 0, durSec);
      global[s] = true;
    }
    for (const e of (healEvents || [])) {
      const s = clamp(Math.floor(e.t), 0, durSec);
      global[s] = true;
    }
    for (const e of (utilityEvents || [])) {
      const s = clamp(Math.floor(e.t), 0, durSec);
      global[s] = true;
    }

    const GAP_SPLIT = 8; // seconds of global inactivity to split segments
    const segments: Array<{ start: number; end: number }> = [];
    let i = 0;
    while (i <= durSec) {
      if (!global[i]) { i++; continue; }
      const start = i;
      let end = i;
      let gap = 0;
      i++;
      while (i <= durSec) {
        if (global[i]) {
          end = i;
          gap = 0;
          i++;
        } else {
          gap++;
          if (gap >= GAP_SPLIT) break;
          i++;
        }
      }
      segments.push({ start, end });
    }

    const isPresentAllSegments = (name: string) => {
      if (!segments.length) return true;
      const sec = new Array(durSec + 1).fill(false) as boolean[];
      for (const e of (damageEvents || [])) if (e.src === name && !isIncomingDamage(e)) sec[clamp(Math.floor(e.t), 0, durSec)] = true;
      for (const e of (healEvents || [])) if (e.src === name) sec[clamp(Math.floor(e.t), 0, durSec)] = true;
      for (const e of (utilityEvents || [])) if (e.src === name) sec[clamp(Math.floor(e.t), 0, durSec)] = true;

      for (const seg of segments) {
        let any = false;
        for (let s = seg.start; s <= seg.end; s++) { if (sec[s]) { any = true; break; } }
        if (!any) return false;
      }
      return true;
    };

    const survivorPool = rows.filter(r => isPresentAllSegments(r.name));
    const bestSurv = (survivorPool.length ? survivorPool : rows).slice().sort((a, b) => b.taken - a.taken)[0];

    // Support: most utility uses
    const bestSup = [...rows].sort((a, b) => b.util - a.util)[0];

    return {
      mvp: { name: bestMvp?.name || "—", detail: "Rank blend (DMG/UTIL/TAKEN/UP)" },
      burst: { name: bestBurstName || "—", detail: `${bestBurst.windows || 0} windows • avg ${fmtNum(bestBurst.avg || 0)}` },
      uptime: { name: bestUp?.name || "—", detail: `${fmtPct(bestUp?.uptimePct || 0)} active` },
      survivor: { name: bestSurv?.name || "—", detail: `${fmtNum(bestSurv?.taken || 0)} taken${(bestSurv?.deaths || 0) ? ` (${bestSurv.deaths} deaths)` : ""}` },
      support: { name: bestSup?.name || "—", detail: `${bestSup?.util || 0} utility uses` },
    };
  }, [rosterNames, byPlayer, damageEvents, duration, globalActiveCount]);

    const signatureCompare = useMemo(() => {
    if (!isCompare) return [] as Array<{ ability: string; cells: Array<{ name: string; dmg: number; share: number; critPct: number; pctOfTotal: number }> }>;

    const names = selectedStats.map((s) => s.name);

    // Build per-player maps using full perAbility (not just each player's top10),
    // and normalize ability names to avoid split buckets.
    const perNameMap: Record<string, Map<string, { display: string; dmg: number; critDmg: number }>> = {};
    for (const n of names) {
      perNameMap[n] = new Map();
      const raw = perAbility?.[n] || {};
      for (const [ability, v] of Object.entries(raw)) {
        const key = normalizeAbility(ability);
        if (!key) continue;
        const dmg = (v as any)?.dmg || 0;
        const prev = perNameMap[n].get(key);
        if (!prev) perNameMap[n].set(key, { display: ability, dmg, critDmg: 0 });
        else perNameMap[n].set(key, { display: prev.display, dmg: prev.dmg + dmg, critDmg: prev.critDmg });
      }

      // add crit damage from raw events (more accurate than hit-count)
      const dEvents = (damageEvents || []).filter((e) => e?.src === n);
      for (const e of dEvents) {
        const key = normalizeAbility(e.ability || "");
        if (!key) continue;
        const amt = Number((e as any).amount ?? (e as any).dmg ?? (e as any).value ?? 0);
        if (!Number.isFinite(amt)) continue;
        const isCrit = ((e.flags || "") + "").toLowerCase().includes("crit");
        if (!isCrit) continue;
        const prev = perNameMap[n].get(key);
        if (prev) prev.critDmg += amt;
      }
    }

    const abilityKeys = new Set<string>();
    for (const n of names) for (const k of perNameMap[n].keys()) abilityKeys.add(k);

    const keys = Array.from(abilityKeys);

    // Sort by total damage across selected players (per normalized key)
    keys.sort((a, b) => {
      const sumA = names.reduce((acc, n) => acc + (perNameMap[n].get(a)?.dmg || 0), 0);
      const sumB = names.reduce((acc, n) => acc + (perNameMap[n].get(b)?.dmg || 0), 0);
      return sumB - sumA;
    });

    return keys.slice(0, 10).map((key) => {
      const totalAbilityDmg = names.reduce((acc, n) => acc + (perNameMap[n].get(key)?.dmg || 0), 0);
      // pick a display name from the biggest contributor
      const display = names
        .map((n) => ({ n, dmg: perNameMap[n].get(key)?.dmg || 0, disp: perNameMap[n].get(key)?.display || key }))
        .sort((a, b) => b.dmg - a.dmg)[0]?.disp;

      return {
        ability: display || key,
        cells: names.map((name) => {
          const cell = perNameMap[name].get(key);
          const dmg = cell?.dmg || 0;
          const share = totalAbilityDmg > 0 ? dmg / totalAbilityDmg : 0; // fraction (0-1)
          const total = byPlayer[name]?.totalDamage || 0;
          const pctOfTotal = total > 0 ? dmg / total : 0; // fraction (0-1)
          const critPct = dmg > 0 ? (cell?.critDmg || 0) / dmg : 0; // fraction (0-1)
          return { name, dmg, share, critPct, pctOfTotal };
        }),
      };
    });
  }, [isCompare, selectedStats, byPlayer, perAbility, damageEvents]);

  const utilityCompare = useMemo(() => {
    if (!isCompare) return [] as Array<{ ability: string; cells: Array<{ name: string; count: number; uptime: number; uptimePct: number }> }>;

    const names = selectedStats.map(s => s.name);
    const perNameMap: Record<string, Map<string, { count: number; uptime: number; uptimePct: number }>> = {};
    for (const n of names) {
      const s = byPlayer[n];
      const m = new Map<string, { count: number; uptime: number; uptimePct: number }>();
      (s?.utilities || []).forEach(u => {
        m.set(u.ability, { count: u.count, uptime: u.uptime, uptimePct: u.uptimePct });
      });
      perNameMap[n] = m;
    }

    const abilitySet = new Set<string>();
    for (const n of names) {
      for (const [k] of perNameMap[n].entries()) abilitySet.add(k);
    }
    const abilities = Array.from(abilitySet);
    abilities.sort((a, b) => {
      const sumA = names.reduce((acc, n) => acc + (perNameMap[n].get(a)?.count || 0), 0);
      const sumB = names.reduce((acc, n) => acc + (perNameMap[n].get(b)?.count || 0), 0);
      return sumB - sumA;
    });

    return abilities.map(ability => ({
      ability,
      cells: names.map(name => {
        const v = perNameMap[name].get(ability) || { count: 0, uptime: 0, uptimePct: 0 };
        return { name, ...v };
      }),
    }));
  }, [isCompare, selectedStats, byPlayer]);

  // --- Sorting controls (Signature Abilities + Ability Utility) ---
  type SigSortKey = "damage" | "share" | "totalPct" | "crit" | "name";
  type UtilSortKey = "uses" | "uptime" | "name";

  const [sigSort, setSigSort] = useState<{ key: SigSortKey; dir: "desc" | "asc" }>(() => ({
    key: "damage",
    dir: "desc",
  }));
  const [utilSort, setUtilSort] = useState<{ key: UtilSortKey; dir: "desc" | "asc" }>(() => ({
    key: "uses",
    dir: "desc",
  }));


  // --- Collapsible sections ---
// NOTE: Signature Abilities + Ability Utility are always expanded (no dropdowns).
type SectionId = "fingerprint";
const [sectionOpen, setSectionOpen] = useState<Record<SectionId, boolean>>({
  fingerprint: true,
});
const toggleSection = (id: SectionId) => setSectionOpen((s) => ({ ...s, [id]: !s[id] }));


  // "What won the fight" mode (fight = combat segments separated by >30s inactivity)
  const [whatWonMode, setWhatWonMode] = useState(false);
  const [selectedFightIdx, setSelectedFightIdx] = useState(0);

  // --- Right-panel navigation (sticky + scroll-to + active highlight) ---
  type NavId = "signature" | "fingerprint" | "utility" | "role";
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const navBarRef = useRef<HTMLDivElement>(null);
  const sigRef = useRef<HTMLDivElement>(null);
  const fingerprintRef = useRef<HTMLDivElement>(null);
  const utilRef = useRef<HTMLDivElement>(null);
  const roleRef = useRef<HTMLDivElement>(null);
  const [activeNav, setActiveNav] = useState<NavId>("signature");

  const scrollToNav = (id: NavId) => {
    const root = rightScrollRef.current;
    const map: Record<NavId, React.RefObject<HTMLDivElement>> = {
      signature: sigRef,
      fingerprint: fingerprintRef,
      utility: utilRef,
      role: roleRef,
    };
    const el = map[id].current;
    if (!root || !el) return;

	    // Use bounding rects (not offsetTop) so negative margins / sticky chrome can't throw off the math.
	    const navH = navBarRef.current?.getBoundingClientRect().height ?? 0;
	    const rootRect = root.getBoundingClientRect();
	    const elRect = el.getBoundingClientRect();
	    const extra = 32; // breathing room under the sticky nav (prevents section headers being covered)
	    const top = Math.max(0, root.scrollTop + (elRect.top - rootRect.top) - navH - extra);
	    root.scrollTo({ top, behavior: "smooth" });
  };

  useEffect(() => {
    const root = rightScrollRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;

    const items: Array<{ id: NavId; el: HTMLElement | null }> = [
      { id: "signature", el: sigRef.current },
      { id: "fingerprint", el: fingerprintRef.current },
      { id: "utility", el: utilRef.current },
      { id: "role", el: roleRef.current },
    ];

    // tag nodes so we can map back from observer entry to id
    for (const it of items) {
      if (it.el) it.el.setAttribute("data-nav", it.id);
    }

    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .map((e) => ({
            id: (e.target as HTMLElement).getAttribute("data-nav") as NavId,
            ratio: e.intersectionRatio,
          }))
          .filter((x) => x.id);

        if (!visible.length) return;
        visible.sort((a, b) => b.ratio - a.ratio);
        setActiveNav(visible[0].id);
      },
      {
        root,
        threshold: [0.15, 0.25, 0.35, 0.5, 0.65],
        rootMargin: "-15% 0px -70% 0px",
      }
    );

    for (const it of items) {
      if (it.el) obs.observe(it.el);
    }

    return () => obs.disconnect();
  }, []);

  // Native <select> menus often render with a light dropdown background.
  // Our UI uses light text, so force readable option colors.
  const dropdownOptionStyle = {
    background: "#eef5ff",
    color: "#0b1220",
  } as const;

  const sortedSignatureSingle = useMemo(() => {
    const rows = (primaryStats?.topAbilities ?? []).slice();
    const dir = sigSort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      switch (sigSort.key) {
        case "name":
          return dir * String(a.ability ?? "").localeCompare(String(b.ability ?? ""));
        case "share":
          return dir * ((a.share ?? 0) - (b.share ?? 0));
        case "totalPct":
          return dir * ((a.pctOfTotal ?? 0) - (b.pctOfTotal ?? 0));
        case "crit":
          return dir * ((a.critPct ?? 0) - (b.critPct ?? 0));
        case "damage":
        default:
          return dir * ((a.dmg ?? 0) - (b.dmg ?? 0));
      }
    });
    return rows;
  }, [primaryStats, sigSort.key, sigSort.dir]);

  const sortedSignatureCompare = useMemo(() => {
    const rows = signatureCompare.slice();
    const dir = sigSort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const sum = (x: typeof a) => x.cells.reduce((s, c) => s + (c.dmg || 0), 0);
      const maxShare = (x: typeof a) => Math.max(...x.cells.map((c) => c.share || 0), 0);
      const maxTotal = (x: typeof a) => Math.max(...x.cells.map((c) => c.pctOfTotal || 0), 0);
      const maxCrit = (x: typeof a) => Math.max(...x.cells.map((c) => c.critPct || 0), 0);

      switch (sigSort.key) {
        case "name":
          return dir * String(a.ability ?? "").localeCompare(String(b.ability ?? ""));
        case "share":
          return dir * (maxShare(a) - maxShare(b));
        case "totalPct":
          return dir * (maxTotal(a) - maxTotal(b));
        case "crit":
          return dir * (maxCrit(a) - maxCrit(b));
        case "damage":
        default:
          return dir * (sum(a) - sum(b));
      }
    });
    return rows;
  }, [signatureCompare, sigSort.key, sigSort.dir]);

  const sortedUtilitySingle = useMemo(() => {
    const rows = (primaryStats?.utilities ?? []).slice();
    const dir = utilSort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      switch (utilSort.key) {
        case "name":
          return dir * String(a.ability ?? "").localeCompare(String(b.ability ?? ""));
        case "uptime":
          return dir * ((a.uptimePct ?? 0) - (b.uptimePct ?? 0));
        case "uses":
        default:
          return dir * ((a.count ?? 0) - (b.count ?? 0));
      }
    });
    return rows;
  }, [primaryStats, utilSort.key, utilSort.dir]);

  const maxUtilityUsesSingle = useMemo(() => {
    const counts = (primaryStats?.utilities ?? []).map((u: any) => Number(u?.count ?? 0));
    return Math.max(1, ...counts);
  }, [primaryStats]);

  const sortedUtilityCompare = useMemo(() => {
    const rows = utilityCompare.slice();
    const dir = utilSort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const sumUses = (x: typeof a) => x.cells.reduce((s, c) => s + (c.count || 0), 0);
      const maxUptime = (x: typeof a) => Math.max(...x.cells.map((c) => c.uptimePct || 0), 0);
      switch (utilSort.key) {
        case "name":
          return dir * String(a.ability ?? "").localeCompare(String(b.ability ?? ""));
        case "uptime":
          return dir * (maxUptime(a) - maxUptime(b));
        case "uses":
        default:
          return dir * (sumUses(a) - sumUses(b));
      }
    });
    return rows;
  }, [utilityCompare, utilSort.key, utilSort.dir]);

  // --- Picker UI (custom dropdown so it stays readable on dark theme) ---
  // NOTE: hooks must always run in the same order; do NOT place them after early returns.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = pickerRef.current;
      if (!el) return;
      if (e.target && el.contains(e.target as Node)) return;
      setPickerOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

  const addByName = (name: string) => {
    if (!name) return;
    if (selectedPlayers.includes(name)) return;
    if (selectedPlayers.length >= 5) return;
    onChangeSelectedPlayers([...selectedPlayers, name]);
    setPickerQuery("");
    setPickerOpen(false);
  };

  const filteredPickerOptions = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return playerOptions.filter(p => {
      if (!p?.name) return false;
      // Hide NPC/mobs by default
      const prof = professionOf(p.name);
      if (prof === "Unknown" && !selectedPlayers.includes(p.name)) return false;

      if (!q) return true;
      const hay = `${p.name} ${prof}`.toLowerCase();
      return hay.includes(q);
    });
  }, [playerOptions, pickerQuery, selectedPlayers]);

  if (!open) return null;

  const addPlayer = (name: string) => {
    if (!name) return;
    const next = uniq([...selectedPlayers, name]).slice(0, 5);
    onChangeSelectedPlayers(next);
  };

  const removePlayer = (name: string) => {
    onChangeSelectedPlayers(selectedPlayers.filter(n => n !== name));
  };

  const clearPlayers = () => onChangeSelectedPlayers([]);

  // --- Inline styles (keeps your visual shell without needing CSS files) ---
  const overlay: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,.55)",
    backdropFilter: "blur(6px)",
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  };

  const modal: React.CSSProperties = {
    width: "min(1750px, 95vw)",
    height: "min(1125px, 95vh)",
    borderRadius: 16,
    border: "1px solid rgba(140,190,255,.18)",
    background:
      "radial-gradient(1200px 800px at 18% 15%, rgba(20,120,170,.18), transparent 55%), linear-gradient(180deg, rgba(8,14,22,.98), rgba(6,10,16,.98))",
    boxShadow: "0 18px 60px rgba(0,0,0,.65)",
    overflow: "hidden",
    position: "relative",
  };

  const header: React.CSSProperties = {
    padding: "14px 16px",
    borderBottom: "1px solid rgba(140,190,255,.12)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    letterSpacing: ".12em",
    fontWeight: 800,
  };

  const body: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "480px 1fr",
    gap: 14,
    padding: 14,
    height: "calc(100% - 54px)",
  };

  const panel: React.CSSProperties = {
    borderRadius: 14,
    border: "1px solid rgba(140,190,255,.12)",
    background: "linear-gradient(180deg, rgba(16,24,36,.72), rgba(10,14,22,.72))",
    boxShadow: "inset 0 0 0 1px rgba(0,0,0,.35)",
    overflow: "hidden",
  };

  const panelHeader: React.CSSProperties = {
    padding: "12px 12px 10px",
    borderBottom: "1px solid rgba(140,190,255,.10)",
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
  };

  const panelBody: React.CSSProperties = {
    padding: 12,
  };

  const scrollCol: React.CSSProperties = { height: "100%", overflow: "auto" };

  const pill: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(140,190,255,.16)",
    background: "rgba(10,16,24,.55)",
    fontSize: 12,
    letterSpacing: ".08em",
  };

  const btn: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(140,190,255,.16)",
    background: "rgba(10,16,24,.55)",
    color: "rgba(230,245,255,.92)",
    cursor: "pointer",
    fontWeight: 700,
    letterSpacing: ".06em",
  };

  const small: React.CSSProperties = { fontSize: 12, opacity: 0.75 };

  return (
    <div style={overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modal}>
        <style>{`
          @keyframes ps_fp_sweep { 0% { transform: translateX(-60%); } 100% { transform: translateX(60%); } }
          @keyframes ps_fp_breathe { 0%,100% { opacity: .22; } 50% { opacity: .40; } }
          @keyframes ps_fp_pop { 0% { transform: translateY(6px); opacity: 0; } 100% { transform: translateY(0px); opacity: 1; } }
	          /* Role Insights animations */
	          @keyframes ps_role_fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
	          @keyframes ps_role_barIn { from { transform: scaleX(0); } to { transform: scaleX(1); } }
	          @keyframes ps_role_shimmer { 0% { transform: translateX(-120%); } 100% { transform: translateX(120%); } }
	          @keyframes ps_role_pulse { 0%,100% { filter: drop-shadow(0 0 0 rgba(140,190,255,0)); } 50% { filter: drop-shadow(0 0 10px rgba(140,190,255,.28)); } }
	          @keyframes ps_role_ping { 0% { transform: scale(1); opacity: .75; } 100% { transform: scale(2.2); opacity: 0; } }
          @media (prefers-reduced-motion: reduce) {
            * { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; }
          }
        `}</style>
        <div style={header}>
          <div style={{ fontSize: 18 }}>PLAYER SUMMARY</div>
          <button style={{ ...btn, padding: "6px 10px" }} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div style={body}>
          {/* Left column */}
          <div style={{ ...panel, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={panelHeader}>
              <div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>AFTER ACTION REPORT</div>
                <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4, letterSpacing: ".16em" }}>
                  IMPERIAL COMBAT DOSSIER
                </div>
              </div>
              <div style={{ ...small, textAlign: "right" }}>Choose up to 5</div>
            </div>

            <div style={{ ...panelBody, ...scrollCol }}>
              <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: ".14em", marginBottom: 10 }}>
                SELECT A PLAYER
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
                <div ref={pickerRef} style={{ flex: 1, position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => setPickerOpen(o => !o)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid rgba(140,190,255,.16)",
                      background: "rgba(0,0,0,.25)",
                      color: "rgba(230,245,255,.92)",
                      cursor: "pointer",
                    }}
                  >
                    Add player…
                  </button>

                  {pickerOpen && (
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: "calc(100% + 8px)",
                        zIndex: 50,
                        borderRadius: 12,
                        border: "1px solid rgba(140,190,255,.22)",
                        background: "rgba(7,11,16,.96)",
                        boxShadow: "0 14px 48px rgba(0,0,0,.55)",
                        overflow: "hidden",
                      }}
                    >
                      <div style={{ padding: 10, borderBottom: "1px solid rgba(255,255,255,.08)" }}>
                        <input
                          value={pickerQuery}
                          onChange={(e) => setPickerQuery(e.target.value)}
                          placeholder="Search player…"
                          style={{
                            width: "100%",
                            padding: "10px 10px",
                            borderRadius: 10,
                            border: "1px solid rgba(140,190,255,.18)",
                            background: "rgba(0,0,0,.35)",
                            color: "rgba(230,245,255,.92)",
                            outline: "none",
                          }}
                        />
                      </div>
                      <div style={{ maxHeight: 320, overflow: "auto" }}>
                        {filteredPickerOptions.length === 0 ? (
                          <div style={{ padding: 12, ...small }}>No matches.</div>
                        ) : (
                          filteredPickerOptions.map(p => {
                            const cls = professionOf(p.name);
                            const disabled = selectedPlayers.includes(p.name) || selectedPlayers.length >= 5;
                            return (
                              <button
                                key={p.name}
                                type="button"
                                disabled={disabled}
                                onClick={() => {
                                  addPlayer(p.name);
                                  setPickerOpen(false);
                                }}
                                style={{
                                  width: "100%",
                                  textAlign: "left",
                                  padding: "10px 12px",
                                  background: disabled ? "rgba(255,255,255,.03)" : "transparent",
                                  color: disabled ? "rgba(230,245,255,.35)" : "rgba(230,245,255,.92)",
                                  border: "none",
                                  borderBottom: "1px solid rgba(255,255,255,.06)",
                                  cursor: disabled ? "not-allowed" : "pointer",
                                }}
                                onMouseEnter={(e) => {
                                  if (!disabled) e.currentTarget.style.background = "rgba(90,160,255,.10)";
                                }}
                                onMouseLeave={(e) => {
                                  if (!disabled) e.currentTarget.style.background = "transparent";
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                  <span style={{ fontWeight: 800 }}>{p.name}</span>
                                  <span style={{ opacity: 0.7 }}>{cls}</span>
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <button style={btn} onClick={clearPlayers}>CLEAR</button>
              </div>

              {selected.length === 0 ? (
                <div style={{ ...small, padding: "10px 2px" }}>
                  Tip: Use A/B above or add players here for comparison.
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                  {selected.map(n => (
                    <span key={n} style={pill}>
                      <strong style={{ letterSpacing: ".06em" }}>{n}</strong>
                      <span style={{ opacity: 0.65 }}>
                        {classOf?.[n] || players.find(p => p.name === n)?.profession || "Unknown"}
                      </span>
                      <button
                        onClick={() => removePlayer(n)}
                        style={{
                          border: "none",
                          background: "transparent",
                          color: "rgba(230,245,255,.75)",
                          cursor: "pointer",
                          fontWeight: 900,
                        }}
                        aria-label={`Remove ${n}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Snapshot tiles (above Comparison) */}
              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(140,190,255,.12)",
                  background:
                    "radial-gradient(500px 160px at 20% 0%, rgba(90,160,255,.16), transparent 55%), rgba(0,0,0,.18)",
                  padding: 12,
                  marginBottom: 14,
                  boxShadow: "inset 0 0 0 1px rgba(0,0,0,.35)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".18em", opacity: 0.9 }}>
                    MISSION SNAPSHOT
                  </div>
                  <div style={{ ...small, opacity: 0.75 }}>
                    {selected.length <= 1 ? "Selected player" : `Combined (${selected.length})`}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {([
                    {
                      key: "total",
                      label: "TOTAL DAMAGE",
                      value: primaryStats ? fmtNum(primaryStats.totalDamage) : "—",
                      raw: primaryStats ? Number(primaryStats.totalDamage) || 0 : 0,
                      max: metricMax.maxTotal,
                    },
                    {
                      key: "avg",
                      label: "AVG DPS",
                      value: primaryStats ? fmtNum(primaryStats.avgDps) : "—",
                      raw: primaryStats ? Number(primaryStats.avgDps) || 0 : 0,
                      max: metricMax.maxAvg,
                    },
                    {
                      key: "peak",
                      label: "PEAK 10s",
                      value: primaryStats ? fmtNum(primaryStats.peak10s) : "—",
                      raw: primaryStats ? Number(primaryStats.peak10s) || 0 : 0,
                      max: metricMax.maxPeak,
                    },
                    {
                      key: "apm",
                      label: "APM",
                      value: primaryStats ? fmtNum(primaryStats.apm) : "—",
                      raw: primaryStats ? Number(primaryStats.apm) || 0 : 0,
                      max: metricMax.maxApm,
                    },
                  ] as any[]).map((m) => {
                    const pct = m.max > 0 ? clamp(m.raw / m.max, 0, 1) : 0;
                    return (
                      <div
                        key={m.key}
                        style={{
                          borderRadius: 12,
                          border: "1px solid rgba(140,190,255,.10)",
                          background:
                            "linear-gradient(180deg, rgba(0,0,0,.18), rgba(0,0,0,.28))",
                          padding: "12px 12px",
                          position: "relative",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            background:
                              "radial-gradient(300px 120px at 20% 10%, rgba(120,200,255,.10), transparent 60%)",
                            pointerEvents: "none",
                          }}
                        />

                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ fontSize: 12, opacity: 0.78, letterSpacing: ".16em", fontWeight: 900 }}>
                              {m.label}
                            </div>
                          </div>
                          <div style={{ fontSize: 22, fontWeight: 950, letterSpacing: ".02em" }}>{m.value}</div>
                        </div>

                        {/* progress */}
                        <div
                          style={{
                            marginTop: 10,
                            height: 6,
                            borderRadius: 999,
                            border: "1px solid rgba(140,190,255,.10)",
                            background: "rgba(0,0,0,.28)",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${pct * 100}%`,
                              background:
                                "linear-gradient(90deg, rgba(120,200,255,.55), rgba(120,200,255,.22))",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Comparison cards */}
              {selected.length > 1 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: ".12em" }}>
                      COMPARISON
                    </div>
                    <div style={{ ...small, opacity: 0.75 }}>
                      Side-by-side dossier snapshot
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 10 }}>
                    {(() => {
                      const totalCompareDamage = selected.reduce((a, n) => a + (byPlayer[n]?.totalDamage || 0), 0);
                      return selected.map(n => {
                        const s = byPlayer[n];
                        if (!s) return null;
                        const pct = totalCompareDamage > 0 ? (s.totalDamage || 0) / totalCompareDamage : 0;

                        return (
                          <div
                            key={n}
                            style={{
                              position: "relative",
                              borderRadius: 14,
                              border: "1px solid rgba(140,190,255,.12)",
                              background: "rgba(0,0,0,.20)",
                              overflow: "hidden",
                              boxShadow: "0 10px 26px rgba(0,0,0,.35)",
                            }}
                          >
                            {/* fill bar */}
                            <div
                              style={{
                                position: "absolute",
                                inset: 0,
                                width: `${Math.max(2, Math.min(100, pct * 100))}%`,
                                background: "linear-gradient(90deg, rgba(120,200,255,.22), rgba(120,200,255,.10), rgba(0,0,0,0))",
                                pointerEvents: "none",
                              }}
                            />

                            {/* sheen */}
                            <div
                              style={{
                                position: "absolute",
                                inset: 0,
                                background:
                                  "linear-gradient(135deg, rgba(255,255,255,.10), rgba(255,255,255,0) 32%, rgba(255,255,255,.06) 60%, rgba(255,255,255,0))",
                                opacity: 0.35,
                                pointerEvents: "none",
                              }}
                            />

                            <div
                              style={{
                                position: "relative",
                                zIndex: 1,
                                padding: "10px 12px",
                                display: "grid",
                                gridTemplateColumns: "1.2fr auto",
                                gap: 10,
                                alignItems: "center",
                              }}
                            >
                              <div style={{ minWidth: 0 }}>
                                <div
                                  style={{
                                    fontWeight: 950,
                                    fontSize: 15,
                                    letterSpacing: ".06em",
                                    color: "rgba(235,245,255,.96)",
                                    textShadow: "0 2px 10px rgba(0,0,0,.55)",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                  title={n}
                                >
                                  {n}
                                </div>
<div style={{ ...small, opacity: 0.75, marginTop: 2, color: "rgba(205,225,255,.85)" }}>
                                  {classOf?.[n] || players.find(p => p.name === n)?.profession || "Unknown"}
                                </div>

                                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                                  <div style={{ ...small, opacity: 0.85 }}>
                                    Share: <strong>{(pct * 100).toFixed(1)}%</strong>
                                  </div>
                                  <div style={{ flex: 1, height: 6, borderRadius: 999, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
                                    <div style={{ height: "100%", width: `${Math.min(100, pct * 100)}%`, background: "rgba(255,255,255,.20)" }} />
                                  </div>
                                </div>
                              </div>

                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                                {[
                                  ["TOTAL", fmtNum(s.totalDamage)],
                                  ["DPS", fmtNum(s.avgDps)],
                                  ["APM", fmtNum(s.apm)],
                                ].map(([k, v]) => (
                                  <div
                                    key={k}
                                    style={{
                                      border: "1px solid rgba(180,220,255,.14)",
                                      background: "rgba(0,0,0,.22)",
                                      borderRadius: 999,
                                      padding: "6px 10px",
                                      display: "flex",
                                      gap: 8,
                                      alignItems: "baseline",
                                    }}
                                  >
                                    <span style={{ fontSize: 11, letterSpacing: ".14em", fontWeight: 900, opacity: 0.75 }}>{k}</span>
                                    <span style={{ fontSize: 13, fontWeight: 950 }}>{v}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}

{/* Accolades (global – does not depend on selection) */}
              <div style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 10,
              }}>
                <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: ".12em" }}>ACCOLADES</div>
                <div style={{ ...small, opacity: 0.9 }}>Earned highlights (auto next)</div>
              </div>

              {([
                { key: "MVP", v: accolades.mvp },
                { key: "BURST", v: accolades.burst },
                { key: "UPTIME", v: accolades.uptime },
                { key: "SURVIVOR", v: accolades.survivor },
                { key: "SUPPORT", v: accolades.support },
              ] as const).map(({ key, v }, idx) => {
                const meta = (() => {
                  switch (key) {
                    case "MVP":
                      return { icon: "🏆", label: "MVP", accent: "rgba(255, 214, 122, .55)", glow: "rgba(255, 214, 122, .16)" };
                    case "BURST":
                      return { icon: "💥", label: "Burst", accent: "rgba(255, 140, 140, .50)", glow: "rgba(255, 140, 140, .14)" };
                    case "UPTIME":
                      return { icon: "⏱️", label: "Uptime", accent: "rgba(140, 255, 220, .45)", glow: "rgba(140, 255, 220, .12)" };
                    case "SURVIVOR":
                      return { icon: "🛡️", label: "Survivor", accent: "rgba(170, 190, 255, .45)", glow: "rgba(170, 190, 255, .12)" };
                    case "SUPPORT":
                      return { icon: "🧩", label: "Support", accent: "rgba(255, 190, 255, .42)", glow: "rgba(255, 190, 255, .12)" };
                    default:
                      return { icon: "⭐", label: key, accent: "rgba(140,190,255,.40)", glow: "rgba(140,190,255,.10)" };
                  }
                })();

                const initial = (v?.name || "?").trim().slice(0, 1).toUpperCase();

                return (
                  <div
                    key={key}
                    style={{
                      borderRadius: 14,
                      border: "1px solid rgba(140,190,255,.10)",
                      background:
                        `radial-gradient(900px 180px at 10% 0%, ${meta.glow}, transparent 55%), ` +
                        `linear-gradient(180deg, rgba(0,0,0,.22), rgba(0,0,0,.12))`,
                      padding: "10px 10px",
                      marginBottom: 10,
                      position: "relative",
                      overflow: "hidden",
                      boxShadow: "0 10px 30px rgba(0,0,0,.25)",
                    }}
                  >
                    {/* top sheen */}
                    <div
                      aria-hidden
                      style={{
                        position: "absolute",
                        inset: 0,
                        background:
                          "linear-gradient(120deg, rgba(255,255,255,.06), transparent 28%, transparent 72%, rgba(255,255,255,.04))",
                        pointerEvents: "none",
                      }}
                    />

                    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center" }}>
                      {/* badge */}
                      <div style={{
                        width: 38,
                        height: 38,
                        borderRadius: 12,
                        border: "1px solid rgba(255,255,255,.10)",
                        background: `linear-gradient(180deg, ${meta.glow}, rgba(0,0,0,.20))`,
                        display: "grid",
                        placeItems: "center",
                        boxShadow: `0 0 0 1px ${meta.accent}`,
                      }}>
                        <span style={{ fontSize: 18 }}>{meta.icon}</span>
                      </div>

                      {/* text */}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{
                            fontWeight: 950,
                            letterSpacing: ".12em",
                            fontSize: 12,
                            padding: "4px 8px",
                            borderRadius: 999,
                            border: "1px solid rgba(255,255,255,.10)",
                            background: "rgba(0,0,0,.22)",
                          }}>
                            {meta.label.toUpperCase()}
                          </span>

                          <span style={{
                            fontWeight: 900,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: "100%",
                          }}>
                            {v.name}
                          </span>
                        </div>

                        <div style={{ ...small, opacity: 0.92, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {v.detail}
                        </div>
                      </div>

                      {/* avatar / rank chip */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{
                          width: 34,
                          height: 34,
                          borderRadius: 999,
                          border: "1px solid rgba(255,255,255,.14)",
                          background: `radial-gradient(16px 16px at 30% 25%, rgba(255,255,255,.16), transparent 60%), rgba(0,0,0,.20)`,
                          boxShadow: `0 0 0 1px ${meta.accent}`,
                          display: "grid",
                          placeItems: "center",
                          fontWeight: 950,
                          letterSpacing: ".06em",
                        }}>
                          {initial}
                        </div>

                        <div style={{
                          fontSize: 12,
                          fontWeight: 900,
                          padding: "6px 10px",
                          borderRadius: 999,
                          border: "1px solid rgba(255,255,255,.10)",
                          background: "rgba(0,0,0,.20)",
                          opacity: 0.9,
                        }}>
                          #{idx + 1}
                        </div>
                      </div>
                    </div>

                    {/* bottom accent rule */}
                    <div
                      aria-hidden
                      style={{
                        marginTop: 10,
                        height: 2,
                        borderRadius: 999,
                        background: `linear-gradient(90deg, ${meta.accent}, rgba(255,255,255,.06), transparent)`
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right column */}
          <div style={{ ...panel, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div ref={rightScrollRef} style={{ ...panelBody, ...scrollCol }}>
              

              {/* Quick Nav */}
              <div
                ref={navBarRef}
                style={{
                  position: "sticky",
                  top: -12,
                  zIndex: 20,
                  // panelBody has 12px padding; negative margins let the sticky bar span full width.
                  margin: "0px -12px 0px",
                  padding: "10px 12px 10px",
                  background: "rgba(10,14,22,0.80)",
                  backdropFilter: "blur(10px)",
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                  boxShadow: "0 10px 22px rgba(0,0,0,0.35)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontWeight: 900, letterSpacing: ".12em", fontSize: 12, opacity: 0.9 }}>NAV</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {(
                      [
                        ["signature", "Signature"],
                        ["fingerprint", "Fingerprint"],
                        ["utility", "Utility"],
                        ["role", "Role"],
                      ] as Array<[NavId, string]>
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => scrollToNav(id)}
                        style={{
                          height: 28,
                          borderRadius: 999,
                          padding: "0 10px",
                          background: activeNav === id ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)",
                          border: activeNav === id ? "1px solid rgba(255,255,255,0.22)" : "1px solid rgba(255,255,255,0.10)",
                          color: "rgba(230,240,255,0.92)",
                          fontSize: 12,
                          fontWeight: 800,
                          letterSpacing: ".04em",
                          cursor: "pointer",
                        }}
                        title={`Jump to ${label}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Signature Abilities */}
              <div ref={sigRef} style={panel}>
                <div style={panelHeader}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ fontWeight: 900, letterSpacing: ".12em" }}>SIGNATURE ABILITIES</div>
                    <div style={{ ...small }}>Top 10 contributions</div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ ...small, opacity: 0.9 }}>Sort:</div>
                    <select
                      value={sigSort.key}
                      onChange={(e) => setSigSort((s) => ({ ...s, key: e.target.value as any }))}
                      style={{
                        height: 28,
                        borderRadius: 999,
                        padding: "0 10px",
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.10)",
                        color: "rgba(230,240,255,0.92)",
                        fontSize: 12,
                        fontWeight: 800,
                        letterSpacing: ".04em",
                      }}
                    >
                      <option value="damage" style={dropdownOptionStyle}>Damage</option>
                      <option value="share" style={dropdownOptionStyle}>Share</option>
                      <option value="totalPct" style={dropdownOptionStyle}>% Total</option>
                      <option value="crit" style={dropdownOptionStyle}>Crit%</option>
                      <option value="name" style={dropdownOptionStyle}>Name</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setSigSort((s) => ({ ...s, dir: s.dir === "desc" ? "asc" : "desc" }))}
                      style={{
                        height: 28,
                        minWidth: 36,
                        borderRadius: 999,
                        padding: "0 10px",
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.10)",
                        color: "rgba(230,240,255,0.92)",
                        fontSize: 12,
                        fontWeight: 900,
                        cursor: "pointer",
                      }}
                      title={sigSort.dir === "desc" ? "Descending" : "Ascending"}
                    >
                      {sigSort.dir === "desc" ? "↓" : "↑"}
                    </button>
                  </div>
                </div>

                <div style={{ padding: 10 }}>
                  {!isCompare && (
                    <>
                      {(sortedSignatureSingle?.length ? sortedSignatureSingle : new Array(10).fill(null)).map((row: any, i: number) => {
                        const ability = row?.ability || `Ability Slot ${i + 1}`;
                        const dmg = row ? fmtNum(row.dmg) : "—";
                        const share = row ? fmtPct(row.share) : "—";
                        const crit = row ? fmtPct(row.critPct) : "—";
                        return (
                          <div
                            key={`${ability}-${i}`}
                            style={{
                              borderRadius: 14,
                              border: "1px solid rgba(140,190,255,.10)",
                              background: "rgba(0,0,0,.20)",
                              padding: "10px 10px",
                              marginBottom: 8,
                              display: "grid",
                              gridTemplateColumns: "1.4fr 1fr",
                              gap: 10,
                              alignItems: "center",
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 900, letterSpacing: ".10em" }}>{ability.toUpperCase()}</div>
                              <div style={{ ...small, opacity: 0.85, marginTop: 4 }}>Damage: <strong>{dmg}</strong></div>
                            </div>

                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                              <span style={pill}>% of Total Damage: <strong>{share}</strong></span>
                              <span style={pill}>Crit: <strong>{crit}</strong></span>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}

                  {isCompare && (
                    <div style={{ display: "grid", gap: 10 }}>
                      {/* Legend */}
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 2 }}>
                        {selectedStats.map((s: any, idx: number) => (
                          <span key={s.name} style={{ ...pill, opacity: 0.95 }}>
                            <span style={{ fontWeight: 900 }}>{idx + 1}.</span>&nbsp;{s.name}
                          </span>
                        ))}
                      </div>

                      {sortedSignatureCompare.map((r: any, i: number) => {
                        return (
                          <div
                            key={`${r.ability}-${i}`}
                            style={{
                              borderRadius: 14,
                              border: "1px solid rgba(140,190,255,.10)",
                              background: "rgba(0,0,0,.20)",
                              padding: "10px 10px",
                            }}
                          >
                            <div style={{ fontWeight: 900, letterSpacing: ".10em" }}>{r.ability.toUpperCase()}</div>

                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: `repeat(${selectedStats.length}, minmax(0, 1fr))`,
                                gap: 8,
                                marginTop: 8,
                              }}
                            >
                              {r.cells.map((c: any, idxCell: number) => {
                                // c.share is 0..1 -> width in %
                                const w = Math.max(0, Math.min(100, c.share * 100));

                                const rgb =
                                  idxCell === 0 ? [66, 175, 255] :
                                  idxCell === 1 ? [255, 176, 96] :
                                  idxCell === 2 ? [140, 255, 170] :
                                  [200, 160, 255];

                                return (
                                  <div
                                    key={`${c.name}-${idxCell}`}
                                    style={{
                                      borderRadius: 12,
                                      border: "1px solid rgba(140,190,255,.10)",
                                      background: "rgba(0,0,0,.25)",
                                      padding: "8px 8px",
                                      position: "relative",
                                      overflow: "hidden",
                                    }}
                                  >
                                    <div
                                      style={{
                                        position: "absolute",
                                        left: 0,
                                        top: 0,
                                        bottom: 0,
                                        width: `${w}%`,
                                        background: `linear-gradient(90deg, rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.32), rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.06))`,
                                      }}
                                    />
                                    <div style={{ position: "relative", zIndex: 1 }}>
                                      <div style={{ ...small, opacity: 0.85 }}>{c.name}</div>
                                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                                        <span style={pill}>Damage: <strong>{fmtNum(c.dmg)}</strong></span>
                                        <span style={pill}>Share: <strong>{fmtPct(c.share)}</strong></span>
                                        <span style={pill}>% of Total Damage: <strong>{fmtPct(c.pctOfTotal)}</strong></span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Combat Fingerprint */}
              <div ref={fingerprintRef} style={{ ...panel, marginBottom: 12 }}>
                <div style={panelHeader}>
                  <button type="button" onClick={() => toggleSection("fingerprint")} style={{ display: "flex", alignItems: "center", gap: 10, background: "transparent", border: 0, padding: 0, color: "rgba(230,240,255,.92)", cursor: "pointer", fontWeight: 900, letterSpacing: ".12em" }} aria-expanded={sectionOpen.fingerprint}><span style={{ height: 28, width: 28, borderRadius: 999, display: "grid", placeItems: "center", border: "1px solid rgba(255,255,255,.10)", background: "rgba(255,255,255,.06)", transform: sectionOpen.fingerprint ? "rotate(180deg)" : "rotate(0deg)", transition: "transform .18s ease", fontWeight: 900 }}>▾</span><span>COMBAT FINGERPRINT</span></button>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ ...small }}>Engagement • Burst • Tempo</div>
                    <button
                      type="button"
                      onClick={() => {
                        setWhatWonMode((v) => {
                          const next = !v;
                          if (next && fights.length) setSelectedFightIdx(fights.length - 1);
                          return next;
                        });
                      }}
                      style={{
                        height: 28,
                        borderRadius: 999,
                        padding: "0 10px",
                        background: whatWonMode ? "rgba(140,255,210,.18)" : "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        color: "rgba(235,244,255,0.95)",
                        fontSize: 12,
                        fontWeight: 900,
                        letterSpacing: ".08em",
                        cursor: "pointer",
                      }}
                      title="Analyze decisive moments (fight = >30s no actions)"
                    >
                      {whatWonMode ? "WHAT WON (ON)" : "WHAT WON"}
                    </button>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateRows: sectionOpen.fingerprint ? "1fr" : "0fr", transition: "grid-template-rows .28s ease" }}><div style={{ overflow: "hidden", minHeight: 0 }}><div style={{ padding: 10 }}>
                  {!primaryStats ? (
                    <div style={{ ...small, padding: "8px 2px" }}>Select a player to view engagement + burst profile.</div>
                  ) : (
                    <>
                      {whatWonMode && (
                        <div
                          style={{
                            borderRadius: 14,
                            border: "1px solid rgba(140,255,210,.14)",
                            background: "linear-gradient(180deg, rgba(0,0,0,.24), rgba(0,0,0,.16))",
                            padding: 12,
                            marginBottom: 10,
                            position: "relative",
                            overflow: "hidden",
                          }}
                        >
                          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.40 }}>
                            <div style={{ position: "absolute", inset: 0, background: "radial-gradient(700px 260px at 20% 0%, rgba(140,255,210,.18), transparent 60%)" }} />
                            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(140,255,210,.10), rgba(255,255,255,0))", animation: "ps_fp_sweep 6.5s linear infinite", transform: "translateX(-65%)" }} />
                          </div>

                          <div style={{ position: "relative", zIndex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                              <div style={{ fontWeight: 950, letterSpacing: ".10em" }}>WHAT WON THE FIGHT</div>
                              {fights.length ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ ...small, opacity: 0.85 }}>Fight:</span>
                                  <select
                                    value={selectedFightIdx}
                                    onChange={(e) => setSelectedFightIdx(Number(e.target.value))}
                                    style={{
                                      height: 28,
                                      borderRadius: 999,
                                      padding: "0 10px",
                                      background: "rgba(0,0,0,0.35)",
                                      border: "1px solid rgba(255,255,255,0.14)",
                                      color: "rgba(235,244,255,0.92)",
                                      fontSize: 12,
                                      outline: "none",
                                      maxWidth: 260,
                                    }}
                                  >
                                    {fights.map((f, i) => (
                                      <option key={i} value={i} style={dropdownOptionStyle}>
                                        {`#${i + 1}  ${fmtTime(f.start)}–${fmtTime(f.end)}  (${fmtNum(f.duration)}s)`}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ) : (
                                <div style={{ ...small, opacity: 0.85 }}>No fights detected yet.</div>
                              )}
                            </div>

                            {fights.length ? (() => {
                              const f = fights[selectedFightIdx];
                              const names = selected.length ? selected : rosterNames;

                              // Focus on selected players when possible.
                              const totalSel = names.reduce((a, n) => a + (f.totalDamageByPlayer[n] || 0), 0) || 0;
                              const decSel = names.reduce((a, n) => a + (f.decisiveDamageByPlayer[n] || 0), 0) || 0;

                              const mvp = [...names]
                                .map((n) => ({ n, v: (f.decisiveDamageByPlayer[n] || 0) }))
                                .sort((a, b) => b.v - a.v)[0];
                              const mvpName = mvp?.n || "—";
                              const mvpVal = mvp?.v || 0;

                              const topPlayers = [...names]
                                .map((n) => ({ name: n, dmg: (f.decisiveDamageByPlayer[n] || 0), total: (f.totalDamageByPlayer[n] || 0) }))
                                .sort((a, b) => (b.dmg - a.dmg) || (b.total - a.total))
                                .slice(0, Math.min(5, names.length));
                              const maxDec = Math.max(1, ...topPlayers.map(p => p.dmg));

                              return (
                                <>
                                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                                    <span style={pill}>Deaths in fight: <strong>{fmtNum(f.deaths.length)}</strong></span>
                                    <span style={pill} title="Total selected damage during this fight">Selected DMG: <strong>{fmtNum(totalSel)}</strong></span>
                                    <span style={pill} title="Damage done in the 5s before each death">Decisive DMG: <strong>{fmtNum(decSel)}</strong></span>
                                    <span style={pill} title="Top decisive contributor among selected">MVP: <strong>{mvpName}</strong> ({fmtNum(mvpVal)})</span>
                                    <span style={pill} title="Fight segmentation rule">Split: <strong>{"30s idle"}</strong></span>
                                  </div>

                                  <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 10 }}>
                                    {/* Decisive players */}
                                    <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(0,0,0,.20)", padding: 10 }}>
                                      <div style={{ fontWeight: 900, letterSpacing: ".10em", marginBottom: 8 }}>DECISIVE PLAYERS</div>
                                      <div style={{ display: "grid", gap: 8 }}>
                                        {topPlayers.map((p, idx) => {
                                          const w = Math.max(0, Math.min(100, (p.dmg / maxDec) * 100));
                                          return (
                                            <div key={p.name} style={{ position: "relative", borderRadius: 10, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(0,0,0,.22)", overflow: "hidden", padding: 8 }}>
                                              <div style={{ position: "absolute", inset: 0, width: `${w}%`, background: "linear-gradient(90deg, rgba(140,255,210,.30), rgba(140,255,210,0.06))" }} />
                                              <div style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "space-between", gap: 10 }}>
                                                <div style={{ fontWeight: 900 }}>{idx + 1}. {p.name}</div>
                                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                                                  <span style={pill}>Decisive: <strong>{fmtNum(p.dmg)}</strong></span>
                                                  <span style={pill}>Fight: <strong>{fmtNum(p.total)}</strong></span>
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                      {!f.deaths.length && (
                                        <div style={{ ...small, opacity: 0.85, marginTop: 8 }}>
                                          No deaths found in this fight. Decisive DMG will be low; use cadence + peak 10s to interpret pressure.
                                        </div>
                                      )}
                                    </div>

                                    {/* Decisive abilities */}
                                    <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(0,0,0,.20)", padding: 10 }}>
                                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                                        <div style={{ fontWeight: 900, letterSpacing: ".10em" }}>WINNING ABILITIES</div>
                                        <div style={{ ...small, opacity: 0.85 }}>5s before deaths</div>
                                      </div>
                                      {f.decisiveTopAbilities.length ? (
                                        <div style={{ display: "grid", gap: 8 }}>
                                          {f.decisiveTopAbilities.map((a, idx) => {
                                            const w = Math.max(0, Math.min(100, a.share * 100));
                                            return (
                                              <div key={`${a.ability}-${idx}`} style={{ position: "relative", borderRadius: 10, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(0,0,0,.22)", overflow: "hidden", padding: 8 }}>
                                                <div style={{ position: "absolute", inset: 0, width: `${w}%`, background: "linear-gradient(90deg, rgba(80,190,255,.26), rgba(80,190,255,0.06))" }} />
                                                <div style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "space-between", gap: 10 }}>
                                                  <div style={{ fontWeight: 900, letterSpacing: ".06em" }}>{a.ability}</div>
                                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                                                    <span style={pill}>DMG: <strong>{fmtNum(a.dmg)}</strong></span>
                                                    <span style={pill}>Share: <strong>{fmtPct(a.share)}</strong></span>
                                                  </div>
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      ) : (
                                        <div style={{ ...small, opacity: 0.85 }}>No decisive-window abilities detected for this fight.</div>
                                      )}
                                    </div>
                                  </div>
                                </>
                              );
                            })() : null}
                          </div>
                        </div>
                      )}
                      {selected.length > 1 && (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 10, marginBottom: 10 }}>
                          {selected
                            .map((n) => ({ name: n, s: byPlayer[n] }))
                            .filter((x): x is any => !!x.s)
                            .map((x: any, idx: number) => {
                              const s = x.s as any;
                              return (
                                <div
                                  key={x.name}
                                  style={{
                                    borderRadius: 14,
                                    border: "1px solid rgba(140,190,255,.10)",
                                    background: "rgba(0,0,0,.22)",
                                    padding: 10,
                                    position: "relative",
                                    overflow: "hidden",
                                    animation: `ps_fp_pop 520ms ease ${(idx * 60)}ms both`,
                                  }}
                                >
                                  <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.28 }}>
                                    <div style={{ position: "absolute", inset: 0, background: "radial-gradient(600px 200px at 20% 0%, rgba(80,190,255,.18), transparent 55%)" }} />
                                    <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.04) 1px, rgba(0,0,0,0) 3px, rgba(0,0,0,0) 6px)", opacity: 0.22 }} />
                                  </div>

                                  <div style={{ position: "relative", zIndex: 1 }}>
                                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                                      <div style={{ fontWeight: 900, letterSpacing: ".10em" }}>{x.name.toUpperCase()}</div>
                                      <div style={{ ...small, opacity: 0.85 }}>{professionOf(x.name)}</div>
                                    </div>

                                    <div style={{ display: "grid", gridTemplateColumns: `repeat(${(s.dmgBars?.length || 1)}, 1fr)`, gap: 2, height: 18, marginTop: 8 }}>
                                      {(s.dmgBars || []).map((v: number, i: number) => (
                                        <div
                                          key={i}
                                          style={{
                                            borderRadius: 6,
                                            background: `linear-gradient(180deg, rgba(80,190,255,${0.14 + v * 0.42}), rgba(80,190,255,${0.06 + v * 0.16}))`,
                                            border: "1px solid rgba(0,0,0,.28)",
                                            transformOrigin: "bottom",
                                            transform: `scaleY(${0.35 + v * 0.65})`,
                                          }}
                                        />
                                      ))}
                                    </div>

                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                                      <span style={pill}>Uptime: <strong>{fmtPct(s.uptime)}</strong></span>
                                      <span style={pill}>APM: <strong>{fmtNum(s.apm)}</strong></span>
                                      <span style={pill}>Peak 10s: <strong>{fmtNum(s.peak10s)}</strong></span>
                                      <span style={pill}>Burst: <strong>{s.burstiness ? s.burstiness.toFixed(2) : "0.00"}</strong></span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      )}

                      {/* Damage cadence */}
                      <div style={{
                        borderRadius: 14,
                        border: "1px solid rgba(140,190,255,.10)",
                        background: "linear-gradient(180deg, rgba(0,0,0,.18), rgba(0,0,0,.28))",
                        padding: 10,
                        position: "relative",
                        overflow: "hidden",
                        marginBottom: 10,
                      }}>
                        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.55, mixBlendMode: "screen" }}>
                          <div style={{
                            position: "absolute",
                            inset: 0,
                            background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(120,210,255,.10), rgba(255,255,255,0))",
                            animation: "ps_fp_sweep 5.2s linear infinite",
                            transform: "translateX(-60%)",
                          }} />
                          <div style={{
                            position: "absolute",
                            inset: 0,
                            background: "repeating-linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.05) 1px, rgba(0,0,0,0) 3px, rgba(0,0,0,0) 6px)",
                            opacity: 0.18,
                          }} />
                        </div>

                        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 8, position: "relative", zIndex: 1 }}>
                          <div style={{ fontWeight: 900, letterSpacing: ".10em" }}>DAMAGE CADENCE</div>
                          <div style={{ ...small, opacity: 0.85 }}>
                            Bars show relative damage intensity over time (normalized).
                          </div>
                        </div>

                        <div style={{
                          display: "grid",
                          gridTemplateColumns: `repeat(${(primaryStats.dmgBars?.length || 1)}, 1fr)`,
                          gap: 2,
                          height: 26,
                          position: "relative",
                          zIndex: 1,
                        }}>
                          {(primaryStats.dmgBars || []).map((v: number, idx: number) => (
                            <div
                              key={idx}
                              title={`Intensity ${(v * 100).toFixed(0)}%`}
                              style={{
                                borderRadius: 6,
                                background: `linear-gradient(180deg, rgba(80,190,255,${0.16 + v * 0.45}), rgba(80,190,255,${0.06 + v * 0.18}))`,
                                border: "1px solid rgba(0,0,0,.28)",
                                transformOrigin: "bottom",
                                transform: `scaleY(${0.35 + v * 0.65})`,
                                transition: "transform 280ms ease, filter 280ms ease",
                                filter: v > 0.75 ? "drop-shadow(0 0 8px rgba(80,190,255,.25))" : "none",
                              }}
                            />
                          ))}
                        </div>

                        {/* Activity pips */}
                        <div style={{ marginTop: 10, position: "relative", zIndex: 1 }}>
                          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                            <div style={{ fontWeight: 900, letterSpacing: ".10em" }}>ENGAGEMENT</div>
                            <div style={{ ...small, opacity: 0.85 }}>Active seconds (damage/heal/utility) condensed.</div>
                          </div>
                          <div style={{
                            display: "grid",
                            gridTemplateColumns: `repeat(${(primaryStats.activePips?.length || 1)}, 1fr)`,
                            gap: 2,
                            height: 14,
                          }}>
                            {(primaryStats.activePips || []).map((on: boolean, idx: number) => (
                              <div
                                key={idx}
                                style={{
                                  borderRadius: 6,
                                  background: on ? "rgba(140,255,210,.40)" : "rgba(255,255,255,.06)",
                                  border: "1px solid rgba(0,0,0,.25)",
                                  boxShadow: on ? "0 0 10px rgba(140,255,210,.10)" : "none",
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Stat pills */}
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <span style={pill}>Active Time: <strong>{fmtNum(primaryStats.activeSeconds)}s</strong></span>
                        <span style={pill}>Uptime: <strong>{fmtPct(primaryStats.uptime)}</strong></span>
                        <span style={pill}>APM: <strong>{fmtNum(primaryStats.apm)}</strong></span>
                        <span style={pill}>Peak 10s: <strong>{fmtNum(primaryStats.peak10s)}</strong></span>
                        <span style={pill} title="Std/mean of per-second damage. Higher = spikier burst.">Burstiness: <strong>{(primaryStats.burstiness || 0).toFixed(2)}</strong></span>
                        <span style={pill}>Longest Idle: <strong>{fmtNum(primaryStats.longestIdle)}s</strong></span>
                        <span style={pill}>Longest Streak: <strong>{fmtNum(primaryStats.longestActive)}s</strong></span>
                        <span style={pill}>First Action: <strong>{primaryStats.firstAction >= 0 ? fmtNum(primaryStats.firstAction) + "s" : "—"}</strong></span>
                        <span style={pill}>Last Action: <strong>{primaryStats.lastAction >= 0 ? fmtNum(primaryStats.lastAction) + "s" : "—"}</strong></span>
                        <span style={pill}>Deaths: <strong>{fmtNum(primaryStats.deaths)}</strong></span>
                        <span style={pill}>Selected: <strong>{selected.length}/5</strong></span>
                      </div>
                    </>
                  )}
                </div>
            </div></div>
              </div>

              {/* Ability Utility */}
              <div ref={utilRef} style={{ ...panel, marginBottom: 12 }}>
                <div style={panelHeader}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ fontWeight: 900, letterSpacing: ".12em" }}>ABILITY UTILITY</div>
                    <div style={{ ...small }}>Non-damage buffs tracked from “performs …”</div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={small}>Sort:</span>
                    <select
                      value={utilSort.key}
                      onChange={(e) => setUtilSort((s) => ({ ...s, key: e.target.value as any }))}
                      style={{
                        background: "rgba(0,0,0,0.35)",
                        border: "1px solid rgba(255,255,255,0.14)",
                        color: "rgba(235,244,255,0.92)",
                        borderRadius: 10,
                        padding: "4px 8px",
                        fontSize: 12,
                        outline: "none",
                      }}
                    >
                      <option value="uses" style={dropdownOptionStyle}>Uses</option>
                      <option value="uptime" style={dropdownOptionStyle}>Uptime %</option>
                      <option value="name" style={dropdownOptionStyle}>Name</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setUtilSort((s) => ({ ...s, dir: s.dir === "desc" ? "asc" : "desc" }))}
                      style={{
                        background: "rgba(0,0,0,0.35)",
                        border: "1px solid rgba(255,255,255,0.14)",
                        color: "rgba(235,244,255,0.92)",
                        borderRadius: 10,
                        padding: "4px 8px",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                      title={utilSort.dir === "desc" ? "Descending" : "Ascending"}
                    >
                      {utilSort.dir === "desc" ? "▼" : "▲"}
                    </button>
                  </div>
                </div>

                <div style={{ padding: 10 }}>
                  {!primary ? (
                    <div style={{ ...small, padding: "8px 2px" }}>
                      Select a player to view utility usage & uptime.
                    </div>
                  ) : !isCompare ? (
                    <>
                      {sortedUtilitySingle.map((u) => {
                        const upPct = Math.max(0, Math.min(1, (u.uptimePct ?? 0) / 100));
                        const usesPct = Math.max(0, Math.min(1, (u.count ?? 0) / maxUtilityUsesSingle));
                        return (
                          <div
                            key={u.ability}
                            style={{
                              borderRadius: 14,
                              border: "1px solid rgba(140,190,255,.12)",
                              background: "linear-gradient(180deg, rgba(0,0,0,.22), rgba(0,0,0,.14))",
                              padding: 12,
                              marginBottom: 10,
                              display: "grid",
                              gridTemplateColumns: "1.35fr 1fr",
                              gap: 12,
                              alignItems: "center",
                              overflow: "hidden",
                            }}
                          >
                            <div style={{ display: "grid", gap: 6 }}>
                              <div style={{ fontWeight: 950, letterSpacing: ".10em" }}>{u.ability}</div>
                              <div style={{ ...small, opacity: 0.85 }}>Utility (non-damage)</div>
                            </div>

                            <div style={{ display: "grid", gap: 10 }}>
                              {/* Uses meter */}
                              <div style={{ display: "grid", gap: 6 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, opacity: 0.95 }}>
                                  <span style={{ opacity: 0.75 }}>Uses</span>
                                  <strong>{fmtNum(u.count)}</strong>
                                </div>
                                <div style={{ height: 8, borderRadius: 999, background: "rgba(140,190,255,.10)", overflow: "hidden" }}>
                                  <div
                                    style={{
                                      width: `${Math.round(usesPct * 100)}%`,
                                      height: "100%",
                                      background: "linear-gradient(90deg, rgba(140,190,255,.55), rgba(140,190,255,.18))",
                                    }}
                                  />
                                </div>
                              </div>
</div>
                          </div>
                        );
                      })}

                      {!primaryStats?.utilities?.length && (
                        <div style={{ ...small, padding: "8px 2px" }}>
                          No tracked utility buffs found yet for this player.
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {utilityCompare.length === 0 ? (
                        <div style={{ ...small, padding: "8px 2px" }}>
                          No tracked utility buffs found yet for these players.
                        </div>
                      ) : (
                        sortedUtilityCompare.map((row) => {
                          const maxUses = Math.max(0, ...row.cells.map((c) => c.count || 0));
                          return (
                            <div
                              key={row.ability}
                              style={{
                                borderRadius: 14,
                                border: "1px solid rgba(140,190,255,.12)",
                                background: "linear-gradient(180deg, rgba(0,0,0,.22), rgba(0,0,0,.14))",
                                padding: 12,
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
                                <div style={{ fontWeight: 950, letterSpacing: ".10em" }}>{row.ability}</div>
                                <div style={{ ...small, opacity: 0.75 }}>Compare uses</div>
                              </div>

                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: `repeat(${row.cells.length}, minmax(0, 1fr))`,
                                  gap: 10,
                                }}
                              >
                                {row.cells.map((c, idxCell) => {
                                  const tint =
                                    idxCell === 0
                                      ? "rgba(66,175,255,.55)"
                                      : idxCell === 1
                                      ? "rgba(255,170,64,.55)"
                                      : "rgba(170,255,120,.50)";

                                  const upPct = Math.max(0, Math.min(1, c.uptimePct ?? 0)); // already 0..1
                                  const usesPct = maxUses ? Math.max(0, Math.min(1, (c.count || 0) / maxUses)) : 0;

                                  return (
                                    <div
                                      key={c.name}
                                      style={{
                                        borderRadius: 12,
                                        border: "1px solid rgba(140,190,255,.12)",
                                        background: "rgba(0,0,0,.22)",
                                        padding: 10,
                                        position: "relative",
                                        overflow: "hidden",
                                      }}
                                    >
                                      {/* accent strip */}
                                      <div
                                        style={{
                                          position: "absolute",
                                          left: 0,
                                          top: 0,
                                          bottom: 0,
                                          width: 4,
                                          background: tint,
                                        }}
                                      />
                                      <div style={{ marginLeft: 6, display: "grid", gap: 10 }}>
                                        <div style={{ fontSize: 11, opacity: 0.8, fontWeight: 900, letterSpacing: ".12em" }}>
                                          {c.name}
                                        </div>

                                        {/* Uses */}
                                        <div style={{ display: "grid", gap: 6 }}>
                                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, opacity: 0.92 }}>
                                            <span style={{ opacity: 0.75 }}>Uses</span>
                                            <strong>{fmtNum(c.count)}</strong>
                                          </div>
                                          <div style={{ height: 8, borderRadius: 999, background: "rgba(140,190,255,.10)", overflow: "hidden" }}>
                                            <div
                                              style={{
                                                width: `${Math.round(usesPct * 100)}%`,
                                                height: "100%",
                                                background: `linear-gradient(90deg, ${tint}, rgba(140,190,255,.10))`,
                                              }}
                                            />
                                          </div>
                                        </div>

                                        
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>
{/* Role breakdown (placeholder) */}
              <div ref={roleRef} style={{ ...panel }}>
                <div style={panelHeader}>
                  <div style={{ fontWeight: 900, letterSpacing: ".12em" }}>ROLE INSIGHTS</div>
                  <div style={{ ...small }}>WCL-style role breakdown</div>
                </div>

                {(() => {
	                  const palette = [
	                    "rgba(120,210,255,.95)",
	                    "rgba(255,190,110,.95)",
	                    "rgba(140,255,210,.95)",
	                    "rgba(210,150,255,.95)",
	                    "rgba(255,120,140,.95)",
	                  ];
	                  const gradeTint = (g: string) => {
	                    switch (g) {
	                      case "S": return "rgba(220,255,190,.95)";
	                      case "A": return "rgba(120,210,255,.95)";
	                      case "B": return "rgba(140,255,210,.95)";
	                      case "C": return "rgba(255,210,140,.95)";
	                      case "D": return "rgba(255,160,120,.95)";
	                      default: return "rgba(255,120,140,.95)";
	                    }
	                  };
	                  const tintForIdx = (idx: number) => palette[idx % palette.length];
                  const roster = Object.values(byPlayer || {});
                  const maxDps = Math.max(1, ...roster.map((s: any) => s?.avgDps ?? 0));
                  const maxBurst = Math.max(1, ...roster.map((s: any) => s?.peak10s ?? 0));
                  const maxApm = Math.max(1, ...roster.map((s: any) => s?.apm ?? 0));
                  const maxUptime = Math.max(1, ...roster.map((s: any) => s?.uptime ?? 0));
                  const maxTaken = Math.max(1, ...roster.map((s: any) => s?.damageTaken ?? 0));
                  const maxDeaths = Math.max(1, ...roster.map((s: any) => s?.deaths ?? 0));

                  const metricDefs = [
                    {
                      key: "DPS",
                      desc: "Sustained damage per second.",
                      get: (s: any) => s?.avgDps ?? 0,
                      max: maxDps,
                      fmt: (v: number) => fmtNum(v),
                      better: "high",
                    },
                    {
                      key: "BURST",
                      desc: "Peak 10s window (WCL-style burst).",
                      get: (s: any) => s?.peak10s ?? 0,
                      max: maxBurst,
                      fmt: (v: number) => fmtNum(v),
                      better: "high",
                    },
                    {
                      key: "ACTIVITY",
                      desc: "Actions per minute.",
                      get: (s: any) => s?.apm ?? 0,
                      max: maxApm,
                      fmt: (v: number) => fmtNum(v),
                      better: "high",
                    },
                    {
                      key: "UPTIME",
                      desc: "Time active (casts + hits) / fight duration.",
                      get: (s: any) => s?.uptime ?? 0,
                      max: maxUptime,
                      fmt: (v: number) => fmtPct(v),
                      better: "high",
                    },
                    {
                      key: "SURVIVABILITY",
                      desc: "Lower is better (damage taken + deaths).",
                      get: (s: any) => {
                        const taken = s?.damageTaken ?? 0;
                        const deaths = s?.deaths ?? 0;
                        // score 0..1 where 1 is best (low taken/deaths)
                        const takenScore = 1 - Math.min(1, taken / maxTaken);
                        const deathScore = 1 - Math.min(1, deaths / maxDeaths);
                        return takenScore * 0.7 + deathScore * 0.3;
                      },
                      max: 1,
                      fmt: (v: number) => `${Math.round(v * 100)}%`,
                      better: "high",
                    },
                  ] as const;

                  const safeSelected = (selectedStats || []).filter(Boolean);
                  if (safeSelected.length === 0) {
                    return (
                      <div style={{ padding: 12, opacity: 0.8, fontSize: 12 }}>
                        Select a player to view WCL-style role insights.
                      </div>
                    );
                  }

                  const calcGrade = (score01: number) => {
                    if (score01 >= 0.9) return "S";
                    if (score01 >= 0.8) return "A";
                    if (score01 >= 0.65) return "B";
                    if (score01 >= 0.5) return "C";
                    if (score01 >= 0.35) return "D";
                    return "F";
                  };

                  const overallScoreFor = (stats: any) => {
                    const dps = Math.min(1, (stats?.avgDps ?? 0) / maxDps);
                    const burst = Math.min(1, (stats?.peak10s ?? 0) / maxBurst);
                    const apm = Math.min(1, (stats?.apm ?? 0) / maxApm);
                    const up = Math.min(1, (stats?.uptime ?? 0) / maxUptime);
                    const surv = metricDefs[4].get(stats);
                    return (dps * 0.35 + burst * 0.2 + apm * 0.15 + up * 0.2 + surv * 0.1);
                  };

                  const cards = safeSelected.map(({ name, stats }: any) => {
                    const score = overallScoreFor(stats);
	                    return { name, stats, score, grade: calcGrade(score) };
                  });
	                  const cardsWithTint = cards.map((c: any, idx: number) => ({ ...c, tint: tintForIdx(idx) }));

	                  return (
	                    <div style={{ padding: 10, display: "grid", gap: 10, animation: "ps_role_fadeUp 220ms ease both" }}>
                      {/* top score strip */}
                      <div style={{
                        display: "grid",
	                        gridTemplateColumns: `repeat(${cardsWithTint.length}, minmax(0, 1fr))`,
                        gap: 10,
                      }}>
	                        {cardsWithTint.map((c: any) => (
                          <div key={c.name} style={{
                            borderRadius: 14,
	                            border: `1px solid rgba(140,190,255,.12)`,
	                            background: `linear-gradient(180deg, rgba(0,0,0,.22), rgba(0,0,0,.14))`,
                            padding: "10px 10px",
	                            position: "relative",
	                            overflow: "hidden",
	                            boxShadow: `inset 0 0 0 1px rgba(0,0,0,.35), 0 0 0 1px rgba(0,0,0,.2)`,
                          }}>
	                            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.22, mixBlendMode: "screen" }}>
	                              <div style={{ position: "absolute", inset: -40, background: `radial-gradient(circle at 20% 10%, ${c.tint}, rgba(0,0,0,0) 55%)` }} />
	                              <div style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.10), rgba(255,255,255,0))`, transform: "translateX(-120%)", animation: "ps_role_shimmer 6.5s linear infinite" }} />
	                            </div>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                              <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 900, letterSpacing: ".12em" }}>{c.name}</div>
	                              <div style={{
                                width: 34,
                                height: 34,
                                borderRadius: 999,
                                display: "grid",
                                placeItems: "center",
                                fontWeight: 1000,
                                letterSpacing: ".06em",
		                                border: `1px solid rgba(255,255,255,.22)`,
		                                background: `linear-gradient(180deg, rgba(0,0,0,.42), rgba(0,0,0,.18))`,
		                                boxShadow: `0 0 0 1px rgba(0,0,0,.35), 0 0 22px ${gradeTint(c.grade)}55`,
	                                position: "relative",
	                                overflow: "hidden",
	                                animation: "ps_role_pulse 2.8s ease-in-out infinite",
	                              }}>
	                                {/* colored glow wash */}
	                                <div style={{ position: "absolute", inset: -10, background: `radial-gradient(circle at 30% 30%, ${gradeTint(c.grade)}55, rgba(0,0,0,0) 60%)`, opacity: 0.9 }} />
	                                {/* moving sheen */}
	                                <div style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.22), rgba(255,255,255,0))`, transform: "translateX(-120%)", animation: "ps_role_shimmer 4.4s linear infinite" }} />
	                                <span style={{ position: "relative" }}>{c.grade}</span>
	                              </div>
                            </div>
                            <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, opacity: 0.92 }}>
                              <span>Role score</span>
                              <strong>{Math.round(c.score * 100)}</strong>
                            </div>
	                            <div style={{ marginTop: 8, height: 7, borderRadius: 999, background: "rgba(255,255,255,.08)", overflow: "hidden", position: "relative" }}>
	                              <div style={{
	                                width: `${Math.round(c.score * 100)}%`,
	                                height: "100%",
	                                background: `linear-gradient(90deg, ${c.tint}, rgba(255,255,255,.10))`,
	                                transformOrigin: "left",
	                                transform: "scaleX(1)",
	                                animation: "ps_role_barIn 520ms cubic-bezier(.2,.9,.2,1) both",
	                                position: "relative",
	                                overflow: "hidden",
	                              }}>
	                                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.20), rgba(255,255,255,0)", transform: "translateX(-120%)", animation: "ps_role_shimmer 3.8s linear infinite" }} />
	                              </div>
	                              <div style={{ position: "absolute", left: `calc(${Math.round(c.score * 100)}% - 3px)`, top: "50%", width: 6, height: 6, borderRadius: 999, background: gradeTint(c.grade), transform: "translateY(-50%)", boxShadow: `0 0 12px ${gradeTint(c.grade)}` }} />
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* metric rows */}
                      <div style={{
                        borderRadius: 16,
                        border: "1px solid rgba(140,190,255,.10)",
                        background: "rgba(0,0,0,.14)",
                        overflow: "hidden",
                      }}>
	                        {metricDefs.map((def, defIdx) => (
                          <div key={def.key} style={{ padding: "10px 10px", borderTop: "1px solid rgba(255,255,255,.06)" }}>
                            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                <div style={{ fontWeight: 900, letterSpacing: ".10em", fontSize: 12 }}>{def.key}</div>
                                <div style={{ fontSize: 11, opacity: 0.72 }}>{def.desc}</div>
                              </div>
                              <div style={{ fontSize: 11, opacity: 0.7 }}>
                                {def.key === "SURVIVABILITY" ? "lower taken/deaths → higher score" : "higher → better"}
                              </div>
                            </div>

	                            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
	                              {cardsWithTint.map((c: any, idx: number) => {
                                const raw = def.get(c.stats);
                                const pct = def.key === "SURVIVABILITY" ? Math.max(0, Math.min(1, raw)) : Math.max(0, Math.min(1, raw / def.max));
                                return (
                                  <div key={c.name} style={{ display: "grid", gridTemplateColumns: "120px 1fr 70px", gap: 10, alignItems: "center" }}>
                                    <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 800 }}>{c.name}</div>
	                                    <div style={{ height: 9, borderRadius: 999, background: "rgba(255,255,255,.08)", overflow: "hidden", position: "relative" }}>
	                                      <div
	                                        style={{
	                                          width: `${Math.round(pct * 100)}%`,
	                                          height: "100%",
	                                          background: `linear-gradient(90deg, ${c.tint}, rgba(255,255,255,.10))`,
	                                          transformOrigin: "left",
	                                          transform: "scaleX(1)",
	                                          animation: `ps_role_barIn ${360 + defIdx * 70}ms cubic-bezier(.2,.9,.2,1) both`,
	                                          position: "relative",
	                                          overflow: "hidden",
	                                        }}
	                                      >
	                                        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.18), rgba(255,255,255,0)", transform: "translateX(-120%)", animation: "ps_role_shimmer 4.6s linear infinite" }} />
	                                      </div>
	                                      <div style={{
	                                        position: "absolute",
	                                        left: `calc(${Math.round(pct * 100)}% - 4px)`,
	                                        top: "50%",
	                                        width: 7,
	                                        height: 7,
	                                        borderRadius: 999,
	                                        background: c.tint,
	                                        transform: "translateY(-50%)",
	                                        boxShadow: `0 0 14px ${c.tint}`,
	                                      }} />
		                                      <div style={{
	                                        position: "absolute",
	                                        left: `calc(${Math.round(pct * 100)}% - 4px)`,
	                                        top: "50%",
	                                        width: 7,
	                                        height: 7,
	                                        borderRadius: 999,
	                                        border: `1px solid rgba(255,255,255,.25)`,
	                                        transform: "translateY(-50%)",
	                                        animation: "ps_role_ping 1.8s ease-out infinite",
		                                        opacity: 0.75,
	                                      }} />
                                    </div>
                                    <div style={{ fontSize: 12, textAlign: "right", opacity: 0.92, fontWeight: 800 }}>{def.fmt(raw)}</div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
