import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const baselineRef = '5c9451acfc70829241e223fc772b966756d3f70c';
const require = createRequire(path.join(root, 'packages/vtable/package.json'));
const ts = require('typescript');

/**
 * loadFunctions
 * @description 直接编译工作区或固定 Git 基线中的两个实际方法，隔离 DOM 以验证算法结果和开销。
 * @author baoyujie <nolan8192@outlook.com>
 * @example
 * const baseline = loadFunctions(baselineRef)
 */
export function loadFunctions(ref) {
  const read = file => ref
    ? execFileSync('git', ['show', ref + ':' + file], { cwd: root, encoding: 'utf8', maxBuffer: 2 ** 22 })
    : fs.readFileSync(path.join(root, file), 'utf8');
  const diffFile = read('packages/vtable/src/tools/diff-cell.ts');
  const layoutFile = read('packages/vtable/src/layout/pivot-header-layout.ts');
  const parsed = ts.createSourceFile('layout.ts', layoutFile, ts.ScriptTarget.Latest, true);
  const layoutClass = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'PivotHeaderLayoutMap');
  const method = layoutClass.members.find(node => node.name?.getText(parsed) === 'getCellHeaderPathsWithTreeNode');
  const source = diffFile + '\nexport const headerPaths = function ' + method.getText(parsed) + ';';
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const context = { exports: {} };
  vm.runInNewContext(compiled, context, { filename: ref ? 'baseline-perf.cjs' : 'current-perf.cjs' });
  return { diff: context.exports.diffCellAddressForGridTree, paths: context.exports.headerPaths };
}

/**
 * createDiffLayout
 * @description 提供地址差异方法所需的父级与角头上下文，不参与成员差异算法。
 * @author baoyujie <nolan8192@outlook.com>
 * @example
 * const layout = createDiffLayout()
 */
export function createDiffLayout() {
  return {
    columnHeaderLevelCount: 2,
    rowHeaderLevelCount: 3,
    rowHierarchyType: 'grid-tree',
    cornerSetting: { titleOnDimension: 'row' },
    getParentCellId: () => undefined,
    getRowHeaderCellAddressByCellId: () => undefined
  };
}

/**
 * createPathLayout
 * @description 构造缓存命中或冷路径查询上下文，用于比较真实方法而不重新实现其算法。
 * @author baoyujie <nolan8192@outlook.com>
 * @example
 * const layout = createPathLayout(1000)
 */
export function createPathLayout(rangeCount = 0, cached = true) {
  const rowPath = [{ dimensionKey: 'region', value: 'R0' }, { dimensionKey: 'store', value: 'S0' }];
  const colPath = [{ dimensionKey: 'period', value: 'P0' }, { indicatorKey: 'amount' }];
  const ranges = Array.from({ length: rangeCount }, (_, i) => ({
    start: { col: 0, row: i * 120 },
    end: { col: 1, row: i * 120 + 119 }
  }));
  return {
    _largeCellRangeCache: ranges,
    currentPageStartIndex: 0,
    rowHierarchyType: 'grid-tree',
    columnHierarchyType: 'grid-tree',
    _rowHeaderCellFullPathIds: Array.from({ length: 100 }, () => [1, 2]),
    _columnHeaderCellFullPathIds: [[3, 3], [4, 4]],
    getColHeaderPathCache: () => cached ? colPath : undefined,
    getRowHeaderPathCache: () => cached ? rowPath : undefined,
    setColHeaderPathCache: () => {},
    setRowHeaderPathCache: () => {},
    getBodyIndexByCol: () => 0,
    getBodyIndexByRow: row => row,
    getTreePathByCellIds: ids => ids.map(id => ({ id, dimensionKey: 'dimension-' + id })),
    getCellLocation: () => 'body'
  };
}

