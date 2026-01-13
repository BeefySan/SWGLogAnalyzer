
import React from "react";

type Props = {
  realPathHint?: string;      // optional: user-typed original path
  onClose: () => void;
};

function guessUserFolder(): string {
  return (navigator.platform || '').toLowerCase().includes('mac')
    ? `${'${HOME}'} /Documents/SWGLogs`
    : `%USERPROFILE%\\Documents\\SWGLogs`;
}

export default function LinkSetupModal({ realPathHint = '', onClose }: Props){
  const isWin = navigator.userAgent.includes("Windows");
  const isMac = navigator.userAgent.includes("Mac OS") || navigator.platform === "MacIntel";
  const isLinux = (!isWin && !isMac);

  const linkDir = guessUserFolder();

  const winHardlink = `mklink /H "${linkDir}\\chatlog.txt" "D:\\\\Games\\\\SWG\\\\profiles\\\\...\\\\chatlog.txt"`;
  const winJunction = `mklink /J "${linkDir}" "D:\\\\Games\\\\SWG\\\\profiles\\\\...\\\\logs"`;
  const macLink = `ln -s "/path/to/real/chatlog.txt" "${'$HOME'}/Documents/SWGLogs/chatlog.txt"`;
  const linuxLink = `ln -s "/path/to/real/chatlog.txt" "${'$HOME'}/Documents/SWGLogs/chatlog.txt"`;

  const text = isWin
    ? `Windows options:\n\n` +
      `A) **Hardlink (same drive)**\n${winHardlink}\n\n` +
      `B) **Junction (folder link, any drive)**\n${winJunction}\n\n` +
      `Then, pick the linked path in the file picker: ${linkDir}\\chatlog.txt`
    : isMac
    ? `macOS symlink:\n${macLink}\n\nThen pick: ~/Documents/SWGLogs/chatlog.txt`
    : `Linux symlink:\n${linuxLink}\n\nThen pick: ~/Documents/SWGLogs/chatlog.txt`;

  function copy(txt:string){
    navigator.clipboard?.writeText(txt).catch(()=>{});
  }

  return (
    <div className="link-modal">
      <div className="card">
        <div className="title">Can't read your log where it lives</div>
        <div className="body">
          <p>Your OS blocks websites from opening files inside some system/game folders.
            Create a link in your Documents and select <b>that</b> path—your log will still update live.</p>
          <div className="code">
            <pre>{text}</pre>
          </div>
          <div className="row">
            <button onClick={()=>copy(isWin ? winHardlink : isMac ? macLink : linuxLink)}>Copy command</button>
            <button onClick={onClose}>Close</button>
          </div>
          <p style={{opacity:.8, fontSize:12, marginTop:8}}>
            Tip: Use hardlink if the log is on the same drive. Otherwise use a folder junction (Windows) or symlink (macOS/Linux).
          </p>
        </div>
      </div>
      <style>{`
        .link-modal { position:fixed; inset:0; display:grid; place-items:center; background:rgba(0,0,0,.6); z-index:9999; }
        .card { width: min(720px, 90vw); background: var(--panel,#0e1726); border:1px solid var(--panel-border,#1b2a3d); border-radius:12px; padding:16px; }
        .title { font-weight:700; margin-bottom:8px; color: var(--text,#cfe3ff); }
        .code { background:#0b1426; border-radius:8px; padding:10px; overflow:auto; border: 1px solid rgba(255,255,255,.06); }
        .row { display:flex; gap:8px; justify-content:flex-end; margin-top:10px; }
        button { background:#0c1624; color:#cfe3ff; border:1px solid #1b2a3d; border-radius:8px; padding:8px 12px; cursor:pointer; }
      `}</style>
    </div>
  );
}
