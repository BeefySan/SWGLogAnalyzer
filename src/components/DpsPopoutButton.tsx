
import React, { useState } from "react";
import { openDpsPopout } from "../popout/dpsPopout";
import LinkSetupModal from "./LinkSetupModal";

type Props = {
  getSelectedPlayer: () => string | null;
  makeWorker: () => Worker;
  defaultHandle?: FileSystemFileHandle | null;
};

export default function DpsPopoutButton({ getSelectedPlayer, makeWorker, defaultHandle=null }: Props){
  const [busy, setBusy] = useState(false);
  const [showLinkHelp, setShowLinkHelp] = useState(false);

  async function onClick(){
    try {
      setBusy(true);
      let handle = defaultHandle ?? null;
      if (!handle && 'showOpenFilePicker' in window) {
        try {
          // @ts-ignore
          const [h] = await window.showOpenFilePicker({
            types: [{ description:'SWG Combat Logs', accept: { 'text/plain':['.txt','.log'] } }],
            excludeAcceptAllOption: false, multiple: false
          });
          handle = h;
        } catch (err:any) {
          // SecurityError / NotAllowedError often means "system folder" — show link helper
          const name = (err && err.name) || '';
          const msg = String(err?.message || err);
          if (/SecurityError|NotAllowedError/i.test(name) || /system files/i.test(msg)) {
            setShowLinkHelp(true);
            return;
          }
          throw err;
        }
      }
      if (!handle) { setShowLinkHelp(true); return; }

      const player = getSelectedPlayer ? getSelectedPlayer() : null;
      await openDpsPopout({ fileHandle: handle, player, makeWorker });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button onClick={onClick} disabled={busy} className="btn">
        {busy ? 'Opening…' : 'DPS Popout (Always on Top)'}
      </button>
      {showLinkHelp && <LinkSetupModal onClose={()=>setShowLinkHelp(false)} />}
    </>
  );
}
