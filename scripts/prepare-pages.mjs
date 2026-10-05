import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

// Only creates a reviewable local static artifact. Remote publication is explicit.
const destination = process.argv[2];
if (!destination) throw new Error('Usage: node scripts/prepare-pages.mjs <empty output directory>');
const root = resolve(destination);
await mkdir(root, {recursive: false});
await cp(resolve('dist'), root, {recursive: true});
await writeFile(resolve(root, '.nojekyll'), '');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
await writeFile(resolve(root, 'release.json'), JSON.stringify({commit, rulesVersion: 'uchiotose-1', ranking: false}, null, 2) + '\n');
console.log(`Static artifact prepared: ${root} (${commit})`);
