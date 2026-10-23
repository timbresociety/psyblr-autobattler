#!/bin/zsh
setopt null_glob
# one tuning round: four role groups in parallel, then merge the results into factors.json
cd "$(dirname "$0")/../.."
mkdir -p tools/balance/out
rm -f tools/balance/out/out-*.json
for g in ${=GROUPS:-tank,fighter,assassin,mage marksman,support,controller,summoner}; do
  TUNE_ROLES=$g TUNE_SPAN=${SPAN:-1.5} TUNE_STEPS=${STEPS:-6} TUNE_SAMPLE=${SAMPLE:-4} TUNE_DUELS=${DUELS:-12} npx vitest run --config tools/balance/vitest.config.ts tools/balance/roles.test.ts --silent=false > tools/balance/out/log-$g.txt 2>&1 &
done
wait
python3 - <<'PY'
import json, glob
p='tools/balance/out/factors.json'
try: f=json.load(open(p))
except Exception: f={}
for o in glob.glob('tools/balance/out/out-*.json'):
    for k,v in json.load(open(o)).items(): f[k]=v['factor']; print(k, v)
json.dump(f, open(p,'w'), indent=1)
PY
