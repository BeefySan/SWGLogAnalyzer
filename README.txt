Patch contents:
- App.tsx: wires multi-player Player Summary selection + passes utility stats
- components/PlayerSummary.tsx: visual shell updates (multi-select up to 5 + comparison block + Ability Utility section)
- parser.worker.ts: parses "performs <ability>" lines into utilityEvents
Notes:
- Utility uptime currently uses a duration table: Off the Cuff 20s, End of the Line 30s (can be adjusted).
