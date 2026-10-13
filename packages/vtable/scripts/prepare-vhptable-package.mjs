import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * preparePackage
 * @description 从已验证的构建产物准备独立 vhptable 包，保留 Rush 工作区名称及原许可证。
 * @author baoyujie <nolan8192@outlook.com>
 * @example
 * node packages/vtable/scripts/prepare-vhptable-package.mjs
 */
async function preparePackage() {
  const source = path.join(root, 'packages/vtable');
  const original = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
  const version = '0.1.0-beta.0';
  const destination = path.join(root, '.vtable-visual/packages', 'vhptable-' + version + '-' + Date.now());
  await fs.mkdir(destination, { recursive: true });
  for (const folder of ['es', 'cjs', 'dist']) {
    if (!(await fs.stat(path.join(source, folder))).isDirectory()) throw new Error('Missing build: ' + folder);
    await fs.cp(path.join(source, folder), path.join(destination, folder), { recursive: true });
  }
  // bundler 产物可能缺少声明文件；独立、完整生成声明，保留现有路径转换插件。
  const require = createRequire(path.join(source, 'package.json'));
  const ts = require('typescript');
  const transformPaths = require('typescript-transform-paths').default;
  const configPath = path.join(source, 'tsconfig.json');
  const configuration = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configuration.error) throw new Error(ts.flattenDiagnosticMessageText(configuration.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(configuration.config, ts.sys, source, {
    declaration: true, emitDeclarationOnly: true, outDir: path.join(destination, 'es'),
    tsBuildInfoFile: path.join(destination, '.declarations.tsbuildinfo')
  }, configPath);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, projectReferences: parsed.projectReferences });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].filter(item => item.category === ts.DiagnosticCategory.Error);
  if (diagnostics.length) throw new Error(diagnostics.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('\n'));
  const emitted = program.emit(undefined, undefined, undefined, true, {
    afterDeclarations: [transformPaths(program, { afterDeclarations: true }, { ts })]
  });
  if (emitted.emitSkipped || emitted.diagnostics.some(item => item.category === ts.DiagnosticCategory.Error))
    throw new Error('Declaration generation failed');
  for (const file of ['PivotChart.d.ts', 'scenegraph/utils/text-measure.d.ts', 'scenegraph/component/menu.d.ts'])
    await fs.access(path.join(destination, 'es', file));
  const metadata = {
    ...original, name: 'vhptable', version,
    description: 'Community fork of VTable with low-risk pivot row diff and header lookup performance fixes.',
    repository: { type: 'git', url: 'https://github.com/momentV/VTable-HighPerf.git', directory: 'packages/vtable' },
    homepage: 'https://github.com/momentV/VTable-HighPerf',
    bugs: { url: 'https://github.com/momentV/VTable-HighPerf/issues' },
    unpkg: 'dist/vtable.min.js',
    publishConfig: { access: 'public', registry: 'https://registry.npmjs.org' },
    dependencies: Object.fromEntries(Object.entries(original.dependencies).map(([name, version]) => [
      name, version.startsWith('workspace:') ? version.slice('workspace:'.length) : version
    ]))
  };
  delete metadata.scripts;
  delete metadata.devDependencies;
  await fs.writeFile(path.join(destination, 'package.json'), JSON.stringify(metadata, null, 2) + '\n');
  await fs.copyFile(path.join(root, 'LICENSE'), path.join(destination, 'LICENSE'));
  const fence = String.fromCharCode(96).repeat(3);
  await fs.writeFile(path.join(destination, 'README.md'), [
    '# vhptable', '',
    'Community fork of [VisActor/VTable](https://github.com/VisActor/VTable), maintained in [momentV/VTable-HighPerf](https://github.com/momentV/VTable-HighPerf).',
    'This prerelease is based on the fork develop commit 5c9451acfc70829241e223fc772b966756d3f70c (upstream package version 1.26.8).',
    'It preserves the VTable API and includes two low-risk pivot performance fixes:',
    '- Linear membership checks for grid-tree row address differences, preserving address ordering and duplicates.',
    '- Removal of an unused merged-range scan in header path lookup.',
    '', '## Install', '', fence + 'sh', 'npm install vhptable@next', fence, '',
    fence + 'ts', "import { PivotTable } from 'vhptable';", fence, '',
    'Existing projects may install the package under the original import name using an npm alias:',
    fence + 'sh', 'npm install @visactor/vtable@npm:vhptable@next', fence, '',
    'Check editors, plugins, and export package compatibility when replacing an older upstream version.',
    'Tree layout and grid-tree scenegraph recreation remain unchanged; this package does not claim to remove all pivot performance bottlenecks.',
    '', '## License', '', 'MIT. Original VTable copyright and license are retained in LICENSE.', ''
  ].join('\n'));
  console.log(destination);
}
await preparePackage();

