import React, { useState } from "react";
import { openDpsPopout } from "../popout/dpsPopout";

type Props = {
  makeWorker: () => Worker;
  defaultHandle?: FileSystemFileHandle | null;
};

export default function DpsPopoutButton({ makeWorker, defaultHandle=null }: Props){
  const [busy, setBusy] = useState(false);

  async function onClick(){
    try {
      setBusy(true);
      let handle = defaultHandle ?? null;
      if (!handle && "showOpenFilePicker" in window) {
        // @ts-ignore
        const [h] = await window.showOpenFilePicker({
          types: [{ description:"SWG Combat Logs", accept: { "text/plain":[".txt",".log"] } }],
          excludeAcceptAllOption: false,
          multiple: false
        });
        handle = h;
      }
      if (!handle) { alert("Please select a combat log file."); return; }

      // Force Top 5, Live 10s window, 1s refresh
      await openDpsPopout({
        fileHandle: handle,
        makeWorker,
        view: "top5",
        window: "rolling",
        rollingSec: 10,
        pollMs: 1000
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={onClick} disabled={busy} className="btn">
      {busy ? "Opening…" : "DPS Popout (Live 10s)"}
    </button>
  );
}