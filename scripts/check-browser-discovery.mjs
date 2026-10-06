import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Keep both required engines explicit: discovery in Chromium cannot stand in for WebKit.
export const REQUIRED_BROWSER_PROJECTS = Object.freeze(['webkit-ui', 'chromium']);

export function requireBrowserDiscovery(report) {
  if (!report || !Array.isArray(report.suites) || !Array.isArray(report.config?.projects)) {
    throw new Error('Invalid Playwright discovery report');
  }
  if (report.errors?.length) throw new Error('Playwright discovery reported errors');
  const configured = new Set(report.config.projects.map(project => project.name));
  const counts = Object.fromEntries(REQUIRED_BROWSER_PROJECTS.map(project => [project, 0]));
  const visit = suite => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        // List-mode results have status=skipped even for runnable tests; use the declaration.
        if (Object.hasOwn(counts, test.projectName) && test.expectedStatus === 'passed') {
          counts[test.projectName] += 1;
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites) visit(suite);
  for (const project of REQUIRED_BROWSER_PROJECTS) {
    if (!configured.has(project)) throw new Error(`Required browser project is missing: ${project}`);
    if (counts[project] === 0) throw new Error(`Required browser project discovered no runnable tests: ${project}`);
  }
  return counts;
}

export function checkBrowserDiscovery() {
  const require = createRequire(import.meta.url);
  const env = { ...process.env };
  // Always consume JSON from stdout, independent of a caller's report-file settings.
  delete env.PLAYWRIGHT_JSON_OUTPUT_FILE;
  delete env.PLAYWRIGHT_JSON_OUTPUT_NAME;
  delete env.PLAYWRIGHT_JSON_OUTPUT_DIR;
  const result = spawnSync(process.execPath, [
    require.resolve('@playwright/test/cli'), 'test', '--list', '--reporter=json',
  ], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Playwright discovery failed (exit ${result.status}, signal ${result.signal ?? 'none'}): ${result.stderr}`);
  }
  const counts = requireBrowserDiscovery(JSON.parse(result.stdout));
  for (const [project, count] of Object.entries(counts)) console.log(`${project}: ${count} runnable tests discovered`);
  return counts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { checkBrowserDiscovery(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
