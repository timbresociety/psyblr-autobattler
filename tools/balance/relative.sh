#!/bin/zsh
# relative role tune (see README, step 1): ITERS passes of (measure every role's median in two parallel groups, step
# each factor toward the group mean, rescale so the factors' geometric mean is 1). Starts from the numbers in roles.ts.
setopt null_glob
cd "$(dirname "$0")/../.."
O=tools/balance/out
mkdir -p $O
echo '{}' > $O/rel-factors.json
for i in $(seq 1 ${ITERS:-3}); do
  rm -f $O/rel-tank* $O/rel-mark*
  for g in tank,fighter,assassin,mage marksman,support,controller,summoner; do
    TUNE_ROLES=$g npx vitest run --config tools/balance/vitest.config.ts tools/balance/relative.test.ts --silent=false 2>&1 | grep REL &
  done
  wait
  python3 - "$i" <<'PY'
import json, glob, math, sys
O = 'tools/balance/out'
f = json.load(open(f'{O}/rel-factors.json'))
med = {}
for p in glob.glob(f'{O}/rel-tank*.json') + glob.glob(f'{O}/rel-mark*.json'):
    for k, v in json.load(open(p)).items(): med[k] = v['median']
target = sum(med.values()) / len(med)
new = {}
for k, m in med.items():
    step = max(-0.16, min(0.16, 1.4 * (target - m)))
    new[k] = f.get(k, 1) * math.exp(step)
gm = math.exp(sum(math.log(v) for v in new.values()) / len(new))
new = {k: round(v / gm, 3) for k, v in new.items()}
json.dump(new, open(f'{O}/rel-factors.json', 'w'), indent=1)
print(f'PASS {sys.argv[1]} mean median {target:.3f} spread {min(med.values()):.3f}-{max(med.values()):.3f}')
print('  medians', {k: round(v, 3) for k, v in sorted(med.items())})
print('  factors', dict(sorted(new.items())))
PY
done
