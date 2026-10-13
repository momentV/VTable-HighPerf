import test from 'node:test';
import assert from 'node:assert/strict';
import { baselineRef, createDiffLayout, createPathLayout, loadFunctions } from './pivot-low-risk-perf-helpers.mjs';

const baseline = loadFunctions(baselineRef);
const current = loadFunctions();
const normalize = value => JSON.parse(JSON.stringify(value));

// 对基线作结果对照，覆盖空集合、重复 ID、重排、增删和 SameValueZero 数值语义。
test('grid-tree row diff preserves baseline addresses, ordering, and duplicates', () => {
  const cases = [
    [[], []], [[1, 2], []], [[], [1, 1, 2]],
    [[1, 1, 2, 3], [3, 4, 4, 1]], [[1, 2, 3], [3, 2, 1]],
    [[NaN, 0, -0, 1], [NaN, -0, 2]]
  ];
  let seed = 27;
  for (let n = 0; n < 100; n++) {
    const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % 31; };
    cases.push([Array.from({ length: n }, next), Array.from({ length: 100 - n }, next)]);
  }
  for (const [oldIds, newIds] of cases) {
    const positions = oldIds.map((_, i) => ({ col: 2, row: i + 2 }));
    const args = [2, 3, oldIds, newIds, positions, createDiffLayout()];
    assert.deepStrictEqual(normalize(current.diff(...args)), normalize(baseline.diff(...args)));
  }
});

test('grid-tree diff retains parent update chain and changing corner levels', () => {
  for (const level of [2, 4]) {
    const layout = {
      ...createDiffLayout(),
      rowHeaderLevelCount: level,
      cornerSetting: { titleOnDimension: 'column' },
      _cornerHeaderCellIds: [[1, 2, 3]],
      getParentCellId: (col, row) => row === 5 ? 10 : row === 4 ? 20 : undefined,
      getRowHeaderCellAddressByCellId: id => id === 10 ? { col: 1, row: 4 } : { col: 0, row: 3 }
    };
    const args = [2, 5, [1, 2, 3], [1, 3, 4], [{ col: 2, row: 2 }, { col: 2, row: 3 }, { col: 2, row: 4 }], layout];
    assert.deepStrictEqual(normalize(current.diff(...args)), normalize(baseline.diff(...args)));
  }
});

// 不使用时间阈值：禁止逐项 includes 扫描，防止重新引入平方级成员判断。
test('large row diff does not perform nested array membership scans', () => {
  const oldIds = Array.from({ length: 8000 }, (_, i) => i);
  const newIds = oldIds.slice(1000).concat([8000, 8001]);
  oldIds.includes = newIds.includes = () => { throw new Error('Quadratic membership scan'); };
  const positions = oldIds.map((_, i) => ({ col: 2, row: i + 2 }));
  const result = current.diff(2, 2, oldIds, newIds, positions, createDiffLayout());
  assert.equal(result.removeCellPositionsRowDirection.length, 1000);
  assert.equal(result.addCellPositionsRowDirection.length, 2);
});

// 查询结果必须与基线一致，热缓存和冷路径都不依赖无关的合并区间。
test('header paths preserve baseline results with empty and large merge caches', () => {
  for (const cached of [false, true]) {
    for (const count of [0, 1, 5000]) {
      for (const row of [0, 1, 30, 99]) {
        const actual = current.paths.call(createPathLayout(count, cached), 6, row);
        const expected = baseline.paths.call(createPathLayout(count, cached), 6, row);
        assert.deepStrictEqual(normalize(actual), normalize(expected));
      }
    }
  }
});

test('header paths do not read the unrelated merged-range cache', () => {
  for (const cached of [false, true]) {
    const layout = createPathLayout(5000, cached);
    Object.defineProperty(layout, '_largeCellRangeCache', {
      get() { throw new Error('Unrelated merged-range scan'); }
    });
    assert.equal(current.paths.call(layout, 6, 30).rowHeaderPaths.length, 2);
  }
});

