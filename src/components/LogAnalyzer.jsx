import React, { useState, useMemo } from 'react';
import { saveAs } from 'file-saver';

function parseEncounters(events, gapMs = 30000) {
  const encounters = [];
  let current = [];
  let lastTs = null;
  for (const ev of events) {
    if (lastTs && ev.ts - lastTs > gapMs && current.length) {
      encounters.push(current);
      current = [];
    }
    current.push(ev);
    lastTs = ev.ts;
  }
  if (current.length) encounters.push(current);
  return encounters;
}

function exportCSV(events) {
  const headers = ['Timestamp', 'Type', 'Ability', 'Amount', 'Source', 'Target', 'DamageType'];
  const rows = events.map(ev => [
    new Date(ev.ts).toISOString(),
    ev.type,
    ev.ability || '',
    ev.amount || '',
    ev.source || '',
    ev.target || '',
    ev.damageType || ''
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  saveAs(blob, 'combat_log.csv');
}

function computeCombatStats(events) {
  const isAttack = (t) => t === 'damage_done' || t === 'crit' || t === 'glance' || t === 'miss';
  const attacks = events.filter(e => isAttack(e.type));
  const hits = events.filter(e => e.type === 'damage_done');
  const crits = events.filter(e => e.type === 'crit' || e?.flags?.crit);
  const glances = events.filter(e => e.type === 'glance' || e?.flags?.glance);
  const misses = events.filter(e => e.type === 'miss');

  const penetrations = events.map(e => e?.mitigation?.penetration).filter(v => typeof v === 'number');
  const blocks = events.map(e => e?.mitigation?.blocked).filter(v => typeof v === 'number');
  const evades = events.map(e => e?.mitigation?.evaded).filter(v => typeof v === 'number');

  const avg = (arr: number[]) => arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : 0;

  return {
    totalAttacks: attacks.length || 0,
    hitCount: hits.length || 0,
    critCount: crits.length || 0,
    glanceCount: glances.length || 0,
    missCount: misses.length || 0,
    stCount: penetrations.length || 0,
    critRate: attacks.length ? crits.length/attacks.length : 0,
    glanceRate: attacks.length ? glances.length/attacks.length : 0,
    missRate: attacks.length ? misses.length/attacks.length : 0,
    stAvg: avg(penetrations),
    blockAvg: avg(blocks),
    evadeAvg: avg(evades),
    blockCount: blocks.length || 0,
    evadeCount: evades.length || 0,
  };
}

export default function LogAnalyzer({ events }) {
  const [player, setPlayer] = useState('');
  const [target, setTarget] = useState('');
  const [ability, setAbility] = useState('');
  const [gapSec, setGapSec] = useState(30);
  const [encounters, setEncounters] = useState([]);

  const allPlayers = useMemo(() => Array.from(new Set(events.map(e => e.source).filter(Boolean))).sort(), [events]);
  const allTargets = useMemo(() => Array.from(new Set(events.map(e => e.target).filter(Boolean))).sort(), [events]);
  const allAbilities = useMemo(() => Array.from(new Set(events.map(e => e.ability).filter(Boolean))).sort(), [events]);

  const filteredEvents = useMemo(() => {
    return events.filter(e => (
      (!player  || e.source === player) &&
      (!target  || e.target === target) &&
      (!ability || e.ability === ability)
    ));
  }, [events, player, target, ability]);

  const stats = useMemo(() => computeCombatStats(filteredEvents), [filteredEvents]);

  const handleSplitEncounters = () => {
    const split = parseEncounters(filteredEvents, Math.max(1, gapSec) * 1000);
    setEncounters(split);
  };

  const clearFilters = () => { setPlayer(''); setTarget(''); setAbility(''); };

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#999' }}>Player</label>
          <select value={player} onChange={(e) => setPlayer(e.target.value)}>
            <option value=''>All</option>
            {allPlayers.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#999' }}>Target</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value=''>All</option>
            {allTargets.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#999' }}>Ability</label>
          <select value={ability} onChange={(e) => setAbility(e.target.value)}>
            <option value=''>All</option>
            {allAbilities.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <button onClick={clearFilters}>Clear filters</button>
        <div style={{ marginLeft: 'auto' }}>
          <label style={{ display: 'block', fontSize: 12, color: '#999' }}>Encounter gap (sec)</label>
          <input type="number" min={1} value={gapSec} onChange={(e)=> setGapSec(Number(e.target.value)||1)} style={{ width: 100 }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button onClick={handleSplitEncounters}>Split Encounters</button>
        <button onClick={() => exportCSV(filteredEvents)}>Export CSV</button>
      </div>

      <div style={{marginTop: 12, padding: 12, border: '1px solid #333', borderRadius: 8}}>
        <h3>Hit Quality Breakdown</h3>
        <table style={{width:'100%', borderCollapse:'collapse'}}>
          <thead>
            <tr>
              <th style={{textAlign:'left', borderBottom:'1px solid #444'}}>Metric</th>
              <th style={{textAlign:'right', borderBottom:'1px solid #444'}}>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Total attacks</td><td style={{textAlign:'right'}}>{stats.totalAttacks}</td></tr>
            <tr><td>Hits</td><td style={{textAlign:'right'}}>{stats.hitCount}</td></tr>
            <tr><td>Crits</td><td style={{textAlign:'right'}}>{stats.critCount} ({(stats.critRate*100).toFixed(1)}%)</td></tr>
            <tr><td>Glances</td><td style={{textAlign:'right'}}>{stats.glanceCount} ({(stats.glanceRate*100).toFixed(1)}%)</td></tr>
            <tr><td>Misses</td><td style={{textAlign:'right'}}>{stats.missCount} ({(stats.missRate*100).toFixed(1)}%)</td></tr>
            <tr><td>Strikes through (count / avg %)</td><td style={{textAlign:'right'}}>{stats.stCount} / {stats.stAvg.toFixed(1)}%</td></tr>
            <tr><td>Blocks (count / avg points)</td><td style={{textAlign:'right'}}>{stats.blockCount} / {Math.round(stats.blockAvg)}</td></tr>
            <tr><td>Evades (count / avg %)</td><td style={{textAlign:'right'}}>{stats.evadeCount} / {stats.evadeAvg.toFixed(1)}%</td></tr>
          </tbody>
        </table>
        <p style={{color:'#999', fontSize:12, marginTop:8}}>Note: Strikethrough/blocked/evaded values appear only if your logs include mitigation details.</p>
      </div>

      {encounters.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3>Encounters</h3>
          {encounters.map((enc, idx) => (
            <div key={idx} style={{marginBottom: '1rem'}}>
              <h4>Encounter {idx + 1} ({enc.length} events)</h4>
              <ul>
                {enc.map((e, i) => (
                  <li key={i}>{e.source} {e.type} {e.target} {e.amount != null ? `for ${e.amount}` : ''}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
