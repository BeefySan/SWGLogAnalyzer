
export type OpenArgs = {
  fileHandle: FileSystemFileHandle;
  player: string | null;
  makeWorker: () => Worker;
  pollMs?: number;
};

function supportsDocumentPiP(): boolean {
  return typeof (document as any).pictureInPicture !== 'undefined'
      || typeof (window as any).documentPictureInPicture !== 'undefined';
}

async function requestPiPWindow(width=320, height=160): Promise<Window> {
  const api: any = (document as any).pictureInPicture || (window as any).documentPictureInPicture;
  const w: Window = await api.requestWindow({ width, height });
  return w;
}

function fallbackPopup(width=360, height=200): Window {
  const w = window.open('', 'dps_popout', `width=${width},height=${height},resizable=yes`)!;
  return w;
}

function injectBaseHtml(w: Window) {
  const doc = w.document;
  doc.open();
  doc.write(`<!doctype html>
<html><head><meta charset="utf-8" />
<title>DPS</title>
<style>
html, body { margin:0; background:#0b1426; color:#cfe3ff; font-family: ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica, Arial; }
.dps-root { padding:10px 12px; min-width:300px; }
.row { display:flex; align-items:baseline; justify-content:space-between; }
.row.small { font-size:12px; opacity:.8; margin-top:2px; }
.label { font-size:12px; text-transform:uppercase; letter-spacing:.12em; opacity:.8; }
.value { font-size:28px; font-weight:700; }
.bar-bg { height:8px; background:#12203a; border-radius:999px; overflow:hidden; margin-top:8px; }
.bar { height:100%; width:0%; background:linear-gradient(90deg,#21d4fd,#b721ff); }
</style>
</head>
<body>
  <div id="root" class="dps-root">
    <div class="row">
      <div class="label">DPS</div>
      <div class="value" id="dps">—</div>
    </div>
    <div class="row small">
      <div id="who">All Players</div>
      <div id="time">00:00</div>
    </div>
    <div class="bar-bg"><div class="bar" id="bar"></div></div>
  </div>
</body></html>`);
  doc.close();
}

function fmtTime(sec: number){
  const m = Math.floor(sec/60);
  const s = Math.floor(sec%60);
  return `${m}:${String(s).padStart(2,'0')}`;
}

function computeDps(payload: any, player: string | null){
  const damageEvents = payload?.damageEvents ?? [];
  let tMin = Number.POSITIVE_INFINITY;
  let tMax = 0;
  let dmg = 0;
  for (const e of damageEvents){
    if (typeof e.t === 'number'){
      if (e.t < tMin) tMin = e.t;
      if (e.t > tMax) tMax = e.t;
    }
    if (!player || e.src === player){
      const amt = Number(e.amount || 0);
      if (amt > 0) dmg += amt;
    }
  }
  const dur = Math.max(1, (tMax - tMin));
  const dps = dmg / dur;
  return { dps, dur };
}

export async function openDpsPopout({ fileHandle, player, makeWorker, pollMs=1000 }: OpenArgs){
  const win = supportsDocumentPiP() ? await requestPiPWindow() : fallbackPopup();
  injectBaseHtml(win);

  const E = {
    dps: win.document.getElementById('dps')!,
    who: win.document.getElementById('who')!,
    time: win.document.getElementById('time')!,
    bar: win.document.getElementById('bar')! as HTMLDivElement
  };
  E.who.textContent = player ? player : 'All Players';

  let lastSize = -1;
  let lastMod = -1;
  let timer: number | null = null;

  async function tick(){
    try {
      const f = await fileHandle.getFile();
      const changed = (f.size !== lastSize) || (f.lastModified !== lastMod);
      if (!changed) return;

      const text = await f.text();
      lastSize = f.size;
      lastMod = f.lastModified;

      const worker = makeWorker();
      const result: any = await new Promise((resolve, reject) => {
        const onMsg = (ev: MessageEvent) => {
          const m = ev.data || {};
          if (m.type === 'done') { worker.removeEventListener('message', onMsg); resolve(m.payload); }
          else if (m.type === 'error') { worker.removeEventListener('message', onMsg); reject(m.error || 'worker error'); }
        };
        worker.addEventListener('message', onMsg);
        worker.postMessage({ type: 'parse', text });
      });

      const { dps, dur } = computeDps(result, player);
      const dpsInt = Math.round(dps);
      E.dps.textContent = dpsInt.toLocaleString();
      E.time.textContent = fmtTime(dur);
      const pct = Math.max(0, Math.min(100, (dpsInt / Math.max(1, dpsInt*1.5)) * 100));
      E.bar.style.width = `${pct}%`;
    } catch (err){
      console.error(err);
    }
  }

  // Prime initial
  try {
    const f = await fileHandle.getFile();
    lastSize = f.size; lastMod = f.lastModified;
    const text = await f.text();
    const worker = makeWorker();
    const result: any = await new Promise((resolve, reject) => {
      const onMsg = (ev: MessageEvent) => {
        const m = ev.data || {};
        if (m.type === 'done') { worker.removeEventListener('message', onMsg); resolve(m.payload); }
        else if (m.type === 'error') { worker.removeEventListener('message', onMsg); reject(m.error || 'worker error'); }
      };
      worker.addEventListener('message', onMsg);
      worker.postMessage({ type: 'parse', text });
    });
    const { dps, dur } = computeDps(result, player);
    E.dps.textContent = Math.round(dps).toLocaleString();
    E.time.textContent = fmtTime(dur);
    E.bar.style.width = '60%';
  } catch {}

  timer = (win as any).setInterval(tick, pollMs);
  win.addEventListener('unload', () => { if (timer) (win as any).clearInterval(timer); });
}
