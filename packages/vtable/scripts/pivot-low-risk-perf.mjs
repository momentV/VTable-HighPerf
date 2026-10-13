import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { baselineRef, createDiffLayout, createPathLayout, loadFunctions } from './pivot-low-risk-perf-helpers.mjs';

const baseline = loadFunctions(baselineRef);
const current = loadFunctions();

/**
 * measure
 * @description 预热后报告同一输入的中位耗时；时间仅用于对照，不作为易波动的测试断言。
 * @author baoyujie <nolan8192@outlook.com>
 * @example
 * const elapsed = measure(() => run())
 */
function measure(run, samples = 5) {
  run();
  const times = [];
  for (let sample = 0; sample < samples; sample++) {
    const start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b)[Math.floor(times.length / 2)];
}

/**
 * compare
 * @description 输出基线与当前方法耗时及比值，明确这不是完整浏览器帧率。
 * @author baoyujie <nolan8192@outlook.com>
 * @example
 * compare('row-diff', 8000, before, after)
 */
function compare(operation, size, before, after) {
  const baselineMs = measure(before);
  const currentMs = measure(after);
  return { operation, size, baselineMs, currentMs, speedup: baselineMs / currentMs };
}

const results = [];
for (const count of [8000, 16000, 32000]) {
  const oldIds = Array.from({ length: count }, (_, i) => i);
  const newIds = oldIds.filter((_, i) => i % 4 !== 0).concat([count, count + 1]);
  const positions = oldIds.map((_, i) => ({ col: 2, row: i + 2 }));
  const args = [2, 2, oldIds, newIds, positions, createDiffLayout()];
  assert.equal(JSON.stringify(baseline.diff(...args)), JSON.stringify(current.diff(...args)));
  results.push(compare('grid-tree-row-diff', count, () => baseline.diff(...args), () => current.diff(...args)));
}
for (const count of [0, 100, 1000, 5000]) {
  const layout = createPathLayout(count);
  const run = method => { for (let i = 0; i < 20000; i++) method.call(layout, 6, 30); };
  results.push(compare('header-path-20000-queries', count, () => run(baseline.paths), () => run(current.paths)));
}
console.log(JSON.stringify({
  baseline: baselineRef,
  node: process.version,
  measurement: 'Actual source methods in isolated contexts; median of 5 samples; excludes tree rebuild, layout, rendering, and browser scrolling.',
  results
}, null, 2));

