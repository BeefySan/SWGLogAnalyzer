
import React from "react";

type Props = { show?: boolean; subtitle?: string };

const StarLoader: React.FC<Props> = ({ show = false, subtitle = "Preparing encounter summary" }) => {
  if (!show) return null;
  return (
    <div className="swg-loader" role="status" aria-live="polite">
      <div className="swg-ring-wrap" aria-hidden="true">
        <svg viewBox="0 0 200 200" width="240" height="240">
          <defs>
            <filter id="swg-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <linearGradient id="swg-blue" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#21d4fd"/><stop offset="100%" stopColor="#00b3ff"/>
            </linearGradient>
            <linearGradient id="swg-orange" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffb86c"/><stop offset="100%" stopColor="#ff6b00"/>
            </linearGradient>
          </defs>
          <circle cx="100" cy="100" r="70" stroke="rgba(255,255,255,0.08)" strokeWidth="16" fill="none"/>
          <circle className="swg-arc swg-arc-main" cx="100" cy="100" r="70" stroke="url(#swg-blue)" strokeWidth="16" strokeLinecap="round" strokeDasharray="110 440" fill="none" filter="url(#swg-glow)"/>
          <circle className="swg-arc swg-arc-orange" cx="100" cy="100" r="54" stroke="url(#swg-orange)" strokeWidth="8" strokeLinecap="round" strokeDasharray="70 340" fill="none" filter="url(#swg-glow)"/>
        </svg>
      </div>
      <div className="swg-loader-text">SLICING DATA</div>
      <div className="swg-loader-sub">{subtitle}</div>
      <style>{`
        .swg-loader{position:fixed;inset:0;z-index:99999;display:grid;grid-template-rows:1fr auto auto;align-items:center;justify-items:center;background:radial-gradient(1200px 800px at 50% 30%, rgba(33,212,253,.10), rgba(0,0,0,0)) no-repeat,#070d1a;}
        .swg-ring-wrap{margin-top:8vh;animation:swg-breathe 3.6s ease-in-out infinite;filter:drop-shadow(0 0 20px rgba(98,176,255,.4));}
        .swg-arc{transform-origin:100px 100px;}
        .swg-arc-main{animation:swg-spin 1.8s linear infinite;}
        .swg-arc-orange{animation:swg-spin 2.8s linear infinite reverse;}
        .swg-loader-text{width:100%;text-align:center;letter-spacing:.5rem;color:#e6f1ff;text-shadow:0 0 12px rgba(98,176,255,.45);font-weight:700;font-size:18px;margin-bottom:1.2vh;opacity:.92;}
        .swg-loader-sub{width:100%;text-align:center;color:#9fb7d8;margin-bottom:8vh;font-size:12px;opacity:.9;}
        @keyframes swg-spin{to{transform:rotate(360deg);}}
        @keyframes swg-breathe{0%,100%{transform:scale(1);opacity:.95;}50%{transform:scale(1.03);opacity:1;}}
        @media (prefers-reduced-motion: reduce){.swg-arc-main,.swg-arc-orange{animation-duration:6s;}.swg-ring-wrap{animation:none;}}
      `}</style>
    </div>
  );
};

export default StarLoader;

