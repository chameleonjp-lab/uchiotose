import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import ts from 'typescript';

export const LONG_SESSION_FILE = 'tests/p8-long-session.test.ts';
export const LONG_SESSION_NAMES = Object.freeze([
  'P8: 30/60/120 fps render schedules produce matching no-input world hashes and bounded pools',
  'P8: five retries start with fresh logical resources and stable capacities',
  'P8: a nonterminal 10-minute world-load fixture keeps entity and resource counts bounded',
]);
const root = fileURLToPath(new URL('..', import.meta.url));
const escapePattern = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Keep every ordinary unit file, excluding only three exact long integrations. */
export function planUnitRun(longSession = false) {
  const files = readdirSync(resolve(root, 'tests'), {withFileTypes: true})
    .filter(entry => entry.isFile() && entry.name.endsWith('.test.ts'))
    .map(entry => `tests/${entry.name}`).sort();
  if (!files.length || !files.includes(LONG_SESSION_FILE)) throw new Error('Required unit test inventory is missing');
  const occurrences = new Map(LONG_SESSION_NAMES.map(name => [name, []]));
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(resolve(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'test'
        && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        occurrences.get(node.arguments[0].text)?.push(file);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  for (const [name, found] of occurrences) {
    if (found.length !== 1 || found[0] !== LONG_SESSION_FILE) {
      throw new Error(`Long-session selection changed; review the exact test before changing the selector: ${name}`);
    }
  }
  const pattern = `^(?:${LONG_SESSION_NAMES.map(escapePattern).join('|')})$`;
  return {
    files: longSession ? [LONG_SESSION_FILE] : files,
    pattern,
    args: ['--import', 'tsx', '--test', `${longSession ? '--test-name-pattern' : '--test-skip-pattern'}=${pattern}`,
      ...(longSession ? [LONG_SESSION_FILE] : files)],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--long-session')) {
    throw new Error('Use no argument for ordinary units, or --long-session for the three long integrations');
  }
  const longSession = process.argv[2] === '--long-session';
  const plan = planUnitRun(longSession);
  console.log(longSession
    ? 'Running the 3 opt-in simulation integrations; the short pool contract remains in npm test.'
    : 'Running all ordinary unit tests. The 3 named long simulation integrations are NOT RUN; use npm run test:long-session.');
  for (const name of LONG_SESSION_NAMES) console.log(`  ${longSession ? 'INCLUDED' : 'OPT-IN, NOT RUN'}: ${name}`);
  const result = spawnSync(process.execPath, plan.args, {cwd: root, stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.signal) console.error(`Unit runner terminated by ${result.signal}`);
  process.exitCode = result.status ?? 1;
}
