# 透视表低风险性能修复与 vhptable 首版

基线：momentV/VTable-HighPerf develop 的 5c9451acfc70829241e223fc772b966756d3f70c，原包版本号为 1.26.8。

## 文件范围

| 文件（相对 packages/vtable） | 改动和用途 |
| --- | --- |
| src/tools/diff-cell.ts | grid-tree 行地址差异使用 Set 判断成员，保留数组输出顺序、重复项、父级地址及角头变化。 |
| src/layout/pivot-header-layout.ts | 移除表头维度路径查询中不参与返回结果的合并范围扫描。 |
| scripts/pivot-low-risk-perf-helpers.mjs | 从工作区与固定 Git 基线编译实际方法，用于结果和开销对照。 |
| scripts/pivot-low-risk-perf.test.mjs | 五组结果、边界和操作复杂度回归，不使用易波动的时间阈值。 |
| scripts/pivot-low-risk-perf.mjs | 记录不同数据规模的实际方法中位耗时。 |
| __tests__/visual/cases/pivot/row-dimensions-low-risk.mjs | 8192 条记录、六个行维度的真实滚轮与树图标交互；检查展开行数、维度路径及总计。 |
| __tests__/visual/cases/index.mjs | 登记新交互用例。 |
| scripts/pivot-low-risk-visual-windows.mjs | 在 Windows 复用原视觉套件、语义断言及零差异像素阈值；基线与当前使用同一依赖。 |
| scripts/prepare-vhptable-package.mjs | 准备独立发布目录，完整生成并转换声明路径，改包名、处理 workspace 依赖并保留 MIT 许可证。 |
| docs/pivot-low-risk-perf.md | 修复范围、验证边界、性能结果与复现方法。 |

保留 getCellRange 的合并边界算法、原路径缓存策略、全树布局及 grid-tree 场景图重建流程。该版不声称消除了所有透视表卡顿。

## 验证结果（2026-10-13）

- Rush 锁文件安装成功，无依赖版本或构建配置修改。
- 核心包及依赖完整构建通过，原构建工具仍有 sourcemap/ES module this 警告。
- 核心包 tsc --noEmit 通过。
- 五项源码回归通过，覆盖空集合、重复与重排、NaN/正负零、父级更新链、角头层级变化、冷/热路径查询。
- 新交互用例自比较通过；自比较仅证明确定性。
- 固定修复前提交与当前构建的 45 个透视表/透视图用例通过：语义断言通过、截图零差异、资源清理完成。其余 160 个用例未执行。
- tgz 在独立消费者目录安装成功，CommonJS 导出通过。
- 发布目录的 TypeScript 声明重新完整生成。消费者使用 skipLibCheck: true 时类型入口通过，这与当前业务项目设置一致。
- 不启用 skipLibCheck 的严格声明检查与官方 @visactor/vtable@1.26.8 同为 150 项诊断，归一化对照无新增诊断。本轮没有修改这些既有接口定义。

仓库原 visual-test.mjs 在 Windows 预检时报 macOS/Linux 限制。本次通过专用 Windows 入口复用原套件与断言，不能称为原入口在 Windows 通过。首次双侧截图均通过，但临时 checkout 清理因长路径失败；保留失败报告，修复清理并复用经过 SHA/文件摘要校验的基线产物后完整重跑通过。

## 性能证据

Node.js 22.23.3；方法级微基准为预热后五次采样中位数。同一输入对照固定基线与当前实际源码方法。

| 行差异输入规模 | 修复前 | 修复后 |
| --- | ---: | ---: |
| 8000 行 | 20.28 ms | 1.16 ms |
| 16000 行 | 82.98 ms | 1.78 ms |
| 32000 行 | 332.89 ms | 5.35 ms |

表头路径查询也不再随无关合并范围缓存规模增加而扫描整个列表。方法级改善不等同于浏览器 FPS 或整次折叠改善。

真实浏览器场景：8192 条记录、六个行维度、9620 个展开行、固定列宽、开启 textStick。真实鼠标点击折叠与展开三轮共六次，同步 toggleHierarchyState 中位耗时为 160.2 → 152.6 ms，约改善 4.7%。该计时排除了后续异步绘制，不代表完整交互延迟。另一轮观察到更小的改善，不能把 4.7% 当作普遍保证。

结论：本版消除了两处明确的额外开销，但该场景仍有明显折叠耗时。若要显著改善，下一阶段需要单独评估增量树布局与场景图更新。

## 复现

仓库根目录使用 Node.js 22，在 Rush 依赖及 Chromium 已安装的环境运行：

    node --test packages/vtable/scripts/pivot-low-risk-perf.test.mjs
    node packages/vtable/scripts/pivot-low-risk-perf.mjs
    node packages/vtable/scripts/pivot-low-risk-visual-windows.mjs --case pivot-row-dimensions-low-risk --self-compare
    node packages/vtable/scripts/pivot-low-risk-visual-windows.mjs

macOS/Linux 可以使用原视觉入口：

    node packages/vtable/scripts/visual-test.mjs --dir pivot

Windows 入口的成功基线可以使用 --baseline-run <既有运行目录> 复用；复用前校验固定 SHA 和构建文件摘要。结果写入 Git 忽略的 .vtable-visual/runs/，保留双侧截图、差异报告与 browser-perf.json。

## 发布

    node packages/vtable/scripts/prepare-vhptable-package.mjs

脚本只准备本地目录，不执行发布。首版候选为 vhptable@0.1.0-beta.0，使用 next 标签。必须先检查安装包及消费者入口，再发布。保留原许可证与版权，npm 元数据指向本 fork；Rush 工作区内部仍使用原包名，以免改动其他工作区包的依赖关系。

