import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { baselineRef } from './pivot-low-risk-perf-helpers.mjs';
import { loadCases, executePhase } from './visual/runner.mjs';
import { serve, digest } from './visual/runtime.mjs';
import { saveReport } from '../__tests__/visual/report.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { values: options } = parseArgs({ options: { case: { type: 'string' }, 'self-compare': { type: 'boolean' }, 'baseline-run': { type: 'string' } } });
const runId = 'windows-' + Date.now();
const runDir = path.join(root, '.vtable-visual/runs', runId);
const worktree = path.join(runDir, 'baseline-worktree');
const junctions = [];
const children = new Set();
const report = {
  runId, finalized: false, status: 'error', startedAt: new Date().toISOString(),
  request: { ...options, baseline: baselineRef },
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  timings: {}, cases: [], issues: [], stage: 'preparation'
};
let server;

/**
 * run
 * @description 使用 Windows 隐藏子进程执行原视觉套件，不更改断言或截图阈值。
 * @author baoyujie <nolan8192@outlook.com>
 * @example
 * await run(process.execPath, args, root, log)
 */
async function run(command, args, cwd, log, settings = {}) {
  const handle = await fs.open(log, 'a');
  await handle.write('\n$ ' + command + ' ' + args.join(' ') + '\n');
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd, env: { ...process.env, ...settings.env }, windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      children.add(child);
      child.stdout.on('data', data => void handle.write(data));
      child.stderr.on('data', data => void handle.write(data));
      const timer = setTimeout(() => {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        reject(new Error('Test subprocess timeout'));
      }, settings.timeoutMs ?? 600000);
      child.once('error', error => { clearTimeout(timer); children.delete(child); reject(error); });
      child.once('exit', code => {
        clearTimeout(timer); children.delete(child);
        if (code === 0 || settings.allowFailure) resolve(code);
        else reject(new Error('Command failed (' + code + '), see ' + log));
      });
    });
  } finally { await handle.close(); }
}

/** 对临时路径作绝对边界检查，清理只允许作用于本次测试创建的文件。 */
function assertTemporary(target) {
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(runDir) + path.sep)) throw new Error('Temporary path escaped run directory');
}

/**
 * measureInteractions
 * @description 对真实滚轮和树图标点击记录同步方法耗时，保留单次原始值，不宣称浏览器 FPS。
 * @author baoyujie <nolan8192@outlook.com>
 * @example
 * await measureInteractions(url)
 */
async function measureInteractions(url) {
  const require = createRequire(path.join(root, 'packages/vtable/package.json'));
  const { chromium } = require('@playwright/test');
  const { settings } = await import('../__tests__/visual/settings.mjs');
  const item = (await import('../__tests__/visual/cases/pivot/row-dimensions-low-risk.mjs')).default;
  const browser = await chromium.launch({ headless: true });
  const measurements = {};
  try {
    for (const phase of ['baseline', 'current']) {
      const context = await browser.newContext({
        viewport: settings.viewport, deviceScaleFactor: settings.deviceScaleFactor,
        locale: settings.locale, timezoneId: settings.timezoneId, reducedMotion: 'reduce'
      });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(url + '/suite/page.html?phase=' + phase + '&case=pivot-row-dimensions-low-risk');
        await page.waitForFunction(() => window.__visualReady || window.__visualErrors?.length);
        const readyErrors = await page.evaluate(() => window.__visualErrors);
        if (errors.length || readyErrors.length) throw new Error([...errors, ...readyErrors].join('\n'));
        for (let sample = 0; sample < 3; sample++) { await item.exercise(page); await item.verify(page); }
        measurements[phase] = await page.evaluate(() => window.__pivotLowRiskMetrics);
        if (errors.length) throw new Error(errors.join('\n'));
        await page.evaluate(() => window.__visualTable.release());
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  await fs.writeFile(path.join(runDir, 'browser-perf.json'), JSON.stringify({
    measurement: '8192 records, 6 row dimensions; real wheel and hierarchy-icon clicks; synchronous toggle duration, excludes deferred rendering/FPS.',
    ...measurements
  }, null, 2));
}

try {
  if (process.platform !== 'win32' || process.versions.node.split('.')[0] !== '22') throw new Error('Use Node.js 22 on Windows');
  await fs.mkdir(runDir, { recursive: true });
  console.log('Visual run: ' + runDir);
  await fs.cp(path.join(root, 'packages/vtable/__tests__/visual'), path.join(runDir, 'suite'), { recursive: true });
  await fs.symlink(path.join(root, 'packages/vtable/node_modules'), path.join(runDir, 'node_modules'), 'junction');
  junctions.push(path.join(runDir, 'node_modules'));
  const all = await loadCases(path.join(runDir, 'suite'));
  const selected = options.case
    ? all.filter(item => item.id === options.case)
    : all.filter(item => item.file.startsWith('./pivot/') || item.file.startsWith('./pivot-chart/'));
  if (!selected.length) throw new Error('No selected visual cases');
  report.selection = {
    mode: options.case ? 'case' : 'directory', value: options.case ?? 'pivot and pivot-chart',
    selectedIds: selected.map(item => item.id), selectedCount: selected.length, totalCount: all.length
  };
  report.cases = selected.map(item => ({ ...item, source: {
    path: 'packages/vtable/__tests__/visual/cases/' + item.file.slice(2), line: 1,
    frozenPath: 'suite/cases/' + item.file.slice(2)
  } }));
  const { settings } = await import('../__tests__/visual/settings.mjs');
  report.comparison = settings.comparison;
  Object.assign(report.environment, settings);
  report.local = { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), dirty: true };
  report.baseline = {
    repository: options['self-compare'] ? 'working-tree' : 'https://github.com/momentV/VTable-HighPerf',
    sha: baselineRef, cacheHit: false
  };
  await fs.copyFile(path.join(root, 'packages/vtable/dist/vtable.js'), path.join(runDir, 'current-vtable.js'));
  const needChart = selected.some(item => item.bundles.includes('vchart'));
  if (needChart) {
    const require = createRequire(path.join(root, 'packages/vtable/package.json'));
    const chart = path.join(path.dirname(require.resolve('@visactor/vchart/package.json')), 'build/index.min.js');
    for (const phase of ['baseline', 'current']) await fs.copyFile(chart, path.join(runDir, phase + '-vchart.js'));
  }
  if (options['self-compare']) {
    await fs.copyFile(path.join(runDir, 'current-vtable.js'), path.join(runDir, 'baseline-vtable.js'));
  } else if (options['baseline-run']) {
    const previous = path.resolve(options['baseline-run']);
    if (!previous.startsWith(path.join(root, '.vtable-visual/runs') + path.sep)) throw new Error('Baseline cache escaped runs directory');
    const metadata = JSON.parse(await fs.readFile(path.join(previous, 'summary.json'), 'utf8'));
    const bytes = await fs.readFile(path.join(previous, 'baseline-vtable.js'));
    if (metadata.baseline?.sha !== baselineRef || metadata.baseline?.repository === 'working-tree' || digest(bytes) !== metadata.bundles?.vtable?.baseline) throw new Error('Baseline SHA or bundle checksum mismatch');
    await fs.writeFile(path.join(runDir, 'baseline-vtable.js'), bytes);
    report.baseline.cacheHit = true;
    report.baseline.cacheSource = previous;
  } else {
    report.stage = 'baselineBuild';
    console.log('Build pinned baseline with the same installed dependencies...');
    await run('git', ['-c', 'core.longpaths=true', 'worktree', 'add', '--detach', worktree, baselineRef], root, path.join(runDir, 'build.log'));
    const configuration = JSON.parse(await fs.readFile(path.join(root, 'rush.json'), 'utf8'));
    for (const project of configuration.projects) {
      const dependencyPath = path.join(root, project.projectFolder, 'node_modules');
      if (!(await fs.stat(dependencyPath).catch(() => null))) continue;
      const junction = path.join(worktree, project.projectFolder, 'node_modules');
      assertTemporary(junction);
      await fs.symlink(dependencyPath, junction, 'junction');
      junctions.push(junction);
    }
    await run(process.execPath, [
      path.join(root, 'tools/bundler/bin/index.js'), '-f', 'umd', '--minify=false', '--ignorePostTasks'
    ], path.join(worktree, 'packages/vtable'), path.join(runDir, 'build.log'), {
      env: { NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=10240', NODE_PATH: path.join(root, 'tools/bundler/node_modules') }
    });
    await fs.copyFile(path.join(worktree, 'packages/vtable/dist/vtable.js'), path.join(runDir, 'baseline-vtable.js'));
  }
  report.bundles = { vtable: {
    baseline: digest(await fs.readFile(path.join(runDir, 'baseline-vtable.js'))),
    current: digest(await fs.readFile(path.join(runDir, 'current-vtable.js')))
  } };
  ({ server, url: report.url } = await serve(runDir));
  console.log('Selected ' + selected.length + ' cases; original assertions and zero-difference pixel threshold.');
  for (const phase of ['baseline', 'current']) {
    report.stage = phase;
    console.log(phase + ' screenshots...');
    report[phase + 'Result'] = await executePhase(root, runDir, phase, report.url, selected.map(item => item.id), { run });
  }
  if (selected.some(item => item.id === 'pivot-row-dimensions-low-risk')) {
    report.stage = 'browserPerformance';
    await measureInteractions(report.url);
  }
  report.status = report.currentResult.status;
} catch (error) {
  report.issues.push({ phase: report.stage, category: 'execution', code: 'WINDOWS_VALIDATION_FAILED', message: error.stack });
  console.error(error.message);
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  for (const child of children) {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); }
    catch {}
  }
  for (const junction of junctions.reverse()) {
    try { assertTemporary(junction); await fs.unlink(junction); }
    catch (error) { report.issues.push({ phase: 'cleanup', category: 'execution', code: 'CLEANUP_FAILED', message: String(error) }); }
  }
  if (await fs.stat(worktree).catch(() => null)) {
    try {
      assertTemporary(worktree);
      execFileSync('git', ['-c', 'core.longpaths=true', 'worktree', 'remove', '--force', worktree], { cwd: root, windowsHide: true });
    } catch (error) { report.issues.push({ phase: 'cleanup', category: 'execution', code: 'CLEANUP_FAILED', message: String(error) }); }
  }
  report.finalized = true;
  const result = await saveReport(runDir, report);
  console.log('Result: ' + result.status + '\nReport: ' + path.join(runDir, 'index.html'));
  process.exitCode = result.status === 'passed' ? 0 : result.status === 'diff' ? 1 : 2;
}

