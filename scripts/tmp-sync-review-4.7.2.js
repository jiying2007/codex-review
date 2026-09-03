'use strict';

const fs=require('fs');

const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
for(const key of ['check','test:unit']) {
  const marker='node test/semantic-platform.test.js &&';
  if(!pkg.scripts[key].includes('node test/semantic-output-bounds.test.js')) {
    if(!pkg.scripts[key].includes(marker)) throw new Error(`missing ${key} semantic test marker`);
    pkg.scripts[key]=pkg.scripts[key].replace(marker,`${marker} node test/semantic-output-bounds.test.js &&`);
  }
}
fs.writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n');

const contract=JSON.parse(fs.readFileSync('product-contract.json','utf8'));
contract.productVersion='4.7.2';
fs.writeFileSync('product-contract.json',JSON.stringify(contract,null,2)+'\n');

const changelog=fs.readFileSync('CHANGELOG.md','utf8');
if(!changelog.startsWith('## 4.7.2 - 2026-09-03')) {
  fs.writeFileSync('CHANGELOG.md',`## 4.7.2 - 2026-09-03\n\n- Bound index-pinned semantic symbol discovery at the source: enumerate matching files with NUL-safe \`git grep -l\`, recursively split over-broad symbol batches, cap broad-symbol candidates, and inspect only size-preflighted index blobs.\n- Add a real regression fixture whose legacy \`git grep -n\` output exceeds 4 MiB, proving Review completes bounded semantic discovery instead of failing with \`Child process stdout exceeded the limit (4194304 bytes)\`.\n- Preserve Core 4.13.1 structured Codex transcript limits, Review judgment/evidence publication contracts, staged-only authority, and fail-closed evidence validation.\n\n${changelog}`);
}
