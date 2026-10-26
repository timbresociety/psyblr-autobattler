#!/bin/zsh
setopt null_glob
cd "$(dirname "$0")/../.."
mkdir -p tools/balance/out
rm -f tools/balance/out/size-*.json
for g in ${=GROUPS:-tank,fighter,assassin,mage marksman,support,controller,summoner}; do
  TUNE_ROLES=$g TUNE_DUELS=${DUELS:-12} TUNE_SPAN=${SPAN:-1.3} TUNE_STEPS=${STEPS:-5} npx vitest run --config tools/balance/vitest.config.ts tools/balance/sizes.test.ts --silent=false > tools/balance/out/slog-$g.txt 2>&1 &
done
wait
python3 - <<'PY'
import json, glob
merged={}
for o in glob.glob('tools/balance/out/size-*.json'): merged.update(json.load(open(o)))
json.dump(merged, open('tools/balance/out/sizes.json','w'), indent=1)
for r,v in merged.items(): print(r, {k: (x['mul'], x['rate']) for k,x in v.items()})
PY
