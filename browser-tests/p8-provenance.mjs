import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KAISEN_COMMIT = '3d751051dc6212482a129e8da596ddd349b2f9f5';

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const CANDIDATE_REPO = resolve(scriptDir, '..');

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

async function trackedSourceHash(repo) {
  const files = git(repo, 'ls-files', '-z', '--', 'src').split('\0').filter(Boolean).sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file).update('\0').update(await readFile(resolve(repo, file))).update('\0');
  }
  return hash.digest('hex');
}

export async function collectP8Provenance(side) {
  const candidateCodeCommit = git(CANDIDATE_REPO, 'rev-parse', 'HEAD');
  const candidateCodeTree = git(CANDIDATE_REPO, 'rev-parse', 'HEAD^{tree}');
  const candidateSourceSha256 = await trackedSourceHash(CANDIDATE_REPO);
  const sourceRepository = side === 'reference'
    ? (process.env.P8_REFERENCE_REPO ?? '/workspace/kaisen-reference')
    : CANDIDATE_REPO;
  const sourceCommit = git(sourceRepository, 'rev-parse', 'HEAD');
  const sourceTree = git(sourceRepository, 'rev-parse', 'HEAD^{tree}');
  const sourceSha256 = await trackedSourceHash(sourceRepository);
  if (side === 'reference' && sourceCommit !== KAISEN_COMMIT) {
    throw new Error(`Reference checkout changed: expected ${KAISEN_COMMIT}, got ${sourceCommit}`);
  }
  return {
    candidateCodeCommit,
    candidateCodeTree,
    candidateSourceSha256,
    loadedSourceRepository: sourceRepository,
    loadedSourceCommit: sourceCommit,
    loadedSourceTree: sourceTree,
    loadedSourceSha256: sourceSha256,
    loadedSourceWorktree: git(sourceRepository, 'status', '--porcelain', '--', 'src') || 'clean',
  };
}

export function sameP8Provenance(a, b) {
  return ['candidateCodeCommit', 'candidateCodeTree', 'candidateSourceSha256', 'loadedSourceCommit', 'loadedSourceTree', 'loadedSourceSha256']
    .every((key) => a[key] === b[key]);
}
