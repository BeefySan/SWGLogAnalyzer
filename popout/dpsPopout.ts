
export type OpenArgs = {
  fileHandle: FileSystemFileHandle;
  player?: string | null;
  makeWorker: () => Worker;
  pollMs?: number;                 // e.g., 1000
  view?: 'top5' | 'single';        // default 'top5'
  window?: 'rolling' | 'encounter';// here we use 'rolling'
  rollingSec?: number;             // e.g., 10
  gapSec?: number;
};

function supportsDocumentPiP(): boolean {
  return typeof (document as any).pictureInPicture !== 'undefined'
      || typeof (window as any).documentPictureInPicture !== 'undefined';
}

async function requestPiPWindow(width=420, height=340): Promise<Window> {
  const api: any = (document as any).pictureInPicture || (window as any).documentPictureInPicture;
  const w: Window = await api.requestWindow({ width, height });
  return w;
}

function fallbackPopup(width=420, height=340): Window {
  const w = window.open('', 'dps_popout', `width=${width},height=${height},resizable=yes`)!;
  return w;
}

const baseCss = `
html, body { margin:0; background:#0b1426; color:#cfe3ff; font-family: ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica, Arial; }
.root { padding:10px 12px; min-width:340px; }
.header { display:flex; align-items:baseline; justify-content:space-between; margin-bottom:6px; gap:8px; }
.title { font-size:12px; text-transform:uppercase; letter-spacing:.12em; opacity:.85; }
.time { font-size:12px; opacity:.85; }
.row { display:flex; align-items:center; gap:8px; margin:6px 0; cursor:pointer; }
.rank { width:18px; text-align:right; font-size:12px; opacity:.7; }
.name { flex:0 0 140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; }
.value { width:80px; text-align:right; font-variant-numeric: tabular-nums; }
.bar-bg { flex:1; height:8px; background:#12203a; border-radius:999px; overflow:hidden; }
.bar { height:100%; width:0%; background:linear-gradient(90deg,#21d4fd,#b721ff); }
.footer { font-size:11px; opacity:.7; margin-top:6px; display:flex; justify-content:space-between; gap:8px; }
.badge { font-size:10px; padding:2px 6px; border:1px solid rgba(255,255,255,.18); border-radius:999px; opacity:.9; }
.link { font-size:11px; opacity:.9; cursor:pointer; text-decoration: underline; }
`;

function injectTop5Html(w: Window) {
  const doc = w.document;
  doc.open();
  doc.write(`<!doctype html>
<html><head><meta charset="utf-8" />
<title>DPS Top 5</title>
<style>${baseCss}</style>
</head>
<body>
  <div class="root">
    <div class="header">
      <div class="title">DPS — Top 5 <span class="badge" id="mode">Live</span></div>
      <div class="time" id="time">00:00</div>
    </div>
    <div id="list"></div>
    <div class="footer"><span id="enc">Window:</span><span id="updated">—</span></div>
  </div>
</body></html>`);
  doc.close();
}

function injectSingleHtml(w: Window) {
  const doc = w.document;
  doc.open();
  doc.write(`<!doctype html>
<html><head><meta charset="utf-8" />
<title>DPS</title>
<style>${baseCss}</style>
</head>
<body>
  <div class="root">
    <div class="header">
      <div class="title"><span class="link" id="back">← Top 5</span> • DPS <span class="badge" id="mode">Live</span></div>
      <div class="time" id="time">00:00</div>
    </div>
    <div class="row" style="cursor:default"><div class="name" id="who">Player</div><div class="value" id="val">—</div><div class="bar-bg"><div class="bar" id="bar"></div></div></div>
    <div class="footer"><span id="enc">Window:</span><span id="updated">—</span></div>
  </div>
</body></html>`);
  doc.close();
}

function fmtTime(sec: number){
  const m = Math.floor(sec/60);
  const s = Math.floor(sec%60);
  return `${m}:${String(s).padStart(2,'0')}`;
}

type DpsRow = { name: string; dps: number };

function buildLastHitMap(evs: any[]): Record<string, number>{
  const map: Record<string, number> = {};
  for (const e of evs){
    if (!e || !Number.isFinite(e.t) || !e.src) continue;
    if (map[e.src] === undefined || e.t > map[e.src]) map[e.src] = e.t;
  }
  return map;
}

function dpsForPlayer(evs: any[], player: string, sec: number, tEnd: number): number{
  const tStart = tEnd - sec;
  let dmg = 0;
  for (const e of evs){
    if (e.src !== player) continue;
    const t = e.t;
    if (!Number.isFinite(t)) continue;
    if (t >= tStart - 1e-3 && t <= tEnd + 1e-3){
      const a = Number(e.amount || 0);
      if (a > 0) dmg += a;
    }
  }
  return dmg / Math.max(1, sec);
}

export async function openDpsPopout({
  fileHandle, player=null, makeWorker, pollMs=1000, view='top5', window='rolling', rollingSec=10
}: OpenArgs){
  const useTop5 = view === 'top5' || !player;
  const win = supportsDocumentPiP() ? await requestPiPWindow(useTop5 ? 420 : 380, useTop5 ? 340 : 240) : fallbackPopup();
  if (useTop5) injectTop5Html(win); else injectSingleHtml(win);

  const doc = win.document;
  const els: any = {
    list: doc.getElementById('list'),
    time: doc.getElementById('time'),
    who: doc.getElementById('who'),
    val: doc.getElementById('val'),
    bar: doc.getElementById('bar'),
    updated: doc.getElementById('updated'),
    back: doc.getElementById('back'),
    mode: doc.getElementById('mode'),
    enc: doc.getElementById('enc')
  };

  const sec = Math.max(1, (typeof rollingSec === 'number' ? rollingSec : 10));
  const graceSec = 20; // start decaying only after 20s per-player inactivity

  if (els.mode) els.mode.textContent = `Live ${sec}s`;
  if (els.enc) els.enc.textContent = `Window: last ${sec}s`;

  let pinned: string | null = useTop5 ? null : (player || null);

  // caches
  let payloadCache: any = null;
  let tMaxCache = 0;                // latest event time across all
  let payloadWallMs = 0;            // wall time when payloadCache last updated
  let lastHitBy: Record<string, number> = {};

  function maxEventTime(payload: any): number {
    const evs = (payload?.damageEvents ?? []).filter((e:any)=>Number.isFinite(e?.t));
    if (evs.length === 0) return 0;
    let m = evs[0].t;
    for (let i=1;i<evs.length;i++) if (evs[i].t > m) m = evs[i].t;
    return m;
  }

  async function parseOnce(text: string): Promise<any>{
    const worker = makeWorker();
    return await new Promise((resolve, reject) => {
      const onMsg = (ev: MessageEvent) => {
        const m = ev.data || {};
        if (m.type === 'done') { worker.removeEventListener('message', onMsg); resolve(m.payload); }
        else if (m.type === 'error') { worker.removeEventListener('message', onMsg); reject(m.error || 'worker error'); }
      };
      worker.addEventListener('message', onMsg);
      worker.postMessage({ type: 'parse', text });
    });
  }

  function renderTop(rows: DpsRow[], dur: number){
    if (!els.list) return;
    const max = Math.max(1, ...rows.map(r => r.dps));
    els.list.innerHTML = rows.map((r, i) => {
      const pct = Math.round((r.dps / max) * 100);
      return `<div class="row" data-name="${r.name}">
        <div class="rank">${i+1}</div>
        <div class="name" title="${r.name}">${r.name}</div>
        <div class="value">${Math.round(r.dps).toLocaleString()}</div>
        <div class="bar-bg"><div class="bar" style="width:${pct}%"></div></div>
      </div>`;
    }).join("");
    els.time.textContent = fmtTime(dur);
    if (els.updated) els.updated.textContent = new Date().toLocaleTimeString();
  }

  function renderSingle(row: DpsRow, dur: number){
    if (!els.who || !els.val || !els.bar) return;
    els.who.textContent = row.name;
    els.val.textContent = Math.round(row.dps).toLocaleString();
    els.bar.style.width = '60%';
    els.time.textContent = fmtTime(dur);
    if (els.updated) els.updated.textContent = new Date().toLocaleTimeString();
  }

  function computeTopRowsWithPerPlayerEnd(allEvs: any[], names: string[], nowSynth: number): DpsRow[]{
    const rows: DpsRow[] = [];
    for (const name of names){
      const last = lastHitBy[name] ?? 0;
      const tEnd = (nowSynth - last < graceSec) ? last : nowSynth;
      if (tEnd <= 0) continue;
      const dps = dpsForPlayer(allEvs, name, sec, tEnd);
      if (!Number.isFinite(dps)) continue;
      rows.push({ name, dps });
    }
    rows.sort((a,b)=>b.dps - a.dps);
    return rows.slice(0, 5);
  }

  function computeSingleWithPerPlayerEnd(allEvs: any[], name: string, nowSynth: number): DpsRow{
    const last = lastHitBy[name] ?? 0;
    const tEnd = (nowSynth - last < graceSec) ? last : nowSynth;
    const dps = dpsForPlayer(allEvs, name, sec, tEnd);
    return { name, dps };
  }

  async function recompute(nowSynth: number){
    if (!payloadCache) return;
    const all = (payloadCache?.damageEvents ?? []).filter((e:any)=>Number.isFinite(e?.t) && e.src);
    const names = Object.keys(lastHitBy);
    if (pinned){
      const row = computeSingleWithPerPlayerEnd(all, pinned, nowSynth);
      renderSingle(row, sec);
    } else {
      const rows = computeTopRowsWithPerPlayerEnd(all, names, nowSynth);
      renderTop(rows, sec);
    }
  }

  async function tick(){
    try {
      const f = await fileHandle.getFile();
      const changed = (f.size !== lastSize) || (f.lastModified !== lastMod);
      const nowMs = Date.now();

      if (changed) {
        const text = await f.text();
        lastSize = f.size; lastMod = f.lastModified;
        payloadCache = await parseOnce(text);
        tMaxCache = maxEventTime(payloadCache);
        payloadWallMs = nowMs;
        lastHitBy = buildLastHitMap((payloadCache?.damageEvents ?? []));
      }

      const deltaSec = Math.max(0, (nowMs - payloadWallMs) / 1000);
      const nowSynth = tMaxCache + deltaSec;

      await recompute(nowSynth);

    } catch (err){
      console.error(err);
    }
  }

  // Prime once
  let lastSize = -1;
  let lastMod = -1;
  try {
    const f = await fileHandle.getFile();
    lastSize = f.size; lastMod = f.lastModified;
    const text = await f.text();
    payloadCache = await parseOnce(text);
    tMaxCache = maxEventTime(payloadCache);
    payloadWallMs = Date.now();
    lastHitBy = buildLastHitMap((payloadCache?.damageEvents ?? []));
    await recompute(tMaxCache);
  } catch {}

  const timer = (win as any).setInterval(tick, pollMs ?? 1000);
  win.addEventListener('unload', () => { if (timer) (win as any).clearInterval(timer); });
}
