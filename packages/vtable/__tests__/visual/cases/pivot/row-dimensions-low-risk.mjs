/** 验证目的：六个行维度、textStick、大合并表头在真实滚动与折叠后保持路径、聚合及展开状态。 */
export default {
  /** 创建确定性的 8192 条记录，并记录用户点击触发的同步折叠耗时。 */
  mount(container) {
    const records = Array.from({ length: 8192 }, (_, i) => ({
      region: 'R' + Math.floor(i / 4096), store: 'S' + Math.floor(i / 512) % 8,
      category: 'C' + Math.floor(i / 64) % 8, color: 'Color' + Math.floor(i / 32) % 2,
      size: 'Size' + Math.floor(i / 8) % 4, sku: 'SKU' + i % 8, amount: 1
    }));
    const rows = ['region', 'store', 'category', 'color', 'size', 'sku'].map(dimensionKey => ({
      dimensionKey, title: dimensionKey, width: 90,
      headerStyle: { textStick: true, textBaseline: 'top', padding: [8, 5, 5, 5] }
    }));
    const table = new window.VTable.PivotTable(container, {
      records, rows, indicators: [{ indicatorKey: 'amount', title: 'Amount', width: 120 }],
      rowHierarchyType: 'grid-tree', rowExpandLevel: 6, widthMode: 'standard', heightMode: 'standard',
      defaultRowHeight: 30, defaultHeaderRowHeight: 35,
      dataConfig: { totals: { row: { showGrandTotals: true, showSubTotals: true,
        subTotalsDimensions: ['region', 'store', 'category', 'color', 'size'],
        grandTotalLabel: 'Grand total', subTotalLabel: 'Subtotal' } } }
    });
    window.__pivotLowRiskMetrics = { initialRowCount: table.rowCount, toggleMs: [], scrollObserved: false };
    const toggle = table.toggleHierarchyState.bind(table);
    table.toggleHierarchyState = (...args) => {
      const start = performance.now();
      const result = toggle(...args);
      window.__pivotLowRiskMetrics.toggleMs.push(performance.now() - start);
      return result;
    };
    return table;
  },
  /** 使用真实滚轮与鼠标树图标点击，折叠再展开第一组。 */
  async exercise(page) {
    await page.locator('#table').hover();
    await page.mouse.wheel(0, 900);
    await page.waitForFunction(() => window.__visualTable.scrollTop > 0);
    await page.evaluate(() => {
      window.__pivotLowRiskMetrics.scrollObserved = true;
      window.__visualTable.setScrollTop(0);
    });
    await page.waitForTimeout(200);
    const point = await page.evaluate(() => {
      const table = window.__visualTable;
      const row = table.columnHeaderLevelCount;
      if (table.getHierarchyState(0, row) !== 'expand') throw new Error('初始组未展开');
      const b = table.getCellRect(0, row).bounds;
      const host = document.getElementById('table').getBoundingClientRect();
      return { x: host.x + b.x1 + 12, y: host.y + b.y1 + 15 };
    });
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(() => {
      const table = window.__visualTable;
      return table.getHierarchyState(0, table.columnHeaderLevelCount) === 'collapse';
    });
    await page.evaluate(() => {
      if (window.__visualTable.rowCount >= window.__pivotLowRiskMetrics.initialRowCount)
        throw new Error('折叠后行数未减少');
    });
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(() => {
      const table = window.__visualTable;
      return table.getHierarchyState(0, table.columnHeaderLevelCount) === 'expand';
    });
  },
  /** 展开行数恢复、路径完整且总计等于源记录数，防止只比较外观。 */
  async verify(page) {
    await page.evaluate(() => {
      const table = window.__visualTable;
      const metrics = window.__pivotLowRiskMetrics;
      if (!metrics.scrollObserved || table.rowCount !== metrics.initialRowCount || metrics.toggleMs.length < 2)
        throw new Error('滚动或折叠展开未完成');
      const bodyCol = table.rowHeaderLevelCount;
      const path = table.getCellHeaderPaths(bodyCol, table.columnHeaderLevelCount).rowHeaderPaths;
      if (path.length !== 6) throw new Error('行维度路径丢失');
      let total;
      for (let row = table.columnHeaderLevelCount; row < table.rowCount; row++) {
        if (table.getCellValue(0, row) === 'Grand total') { total = table.getCellOriginValue(bodyCol, row); break; }
      }
      if (total !== 8192) throw new Error('总计不等于原始记录数');
    });
  }
};
