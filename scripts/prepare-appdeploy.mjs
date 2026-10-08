import fs from 'node:fs/promises';
import path from 'node:path';

// Derived release package: canonical app/ remains the only product source.
const root = process.cwd();
const output = path.join(root, '.appdeploy-release');
const template = path.join(root, 'deployment/appdeploy/template');
await fs.mkdir(output, { recursive: true });
await fs.cp(template, output, { recursive: true });
const visited = new Set();
async function copySource(filename) {
  if (visited.has(filename)) return;
  visited.add(filename);
  let content = await fs.readFile(path.join(root, filename), 'utf8');
  const imports = [...content.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)];
  for (const [, specifier] of imports) {
    if (!specifier.startsWith('.')) continue;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(filename), specifier));
    let dependency;
    for (const candidate of [base, base + '.ts', base + '.tsx', base + '/index.ts']) {
      if (await fs.stat(path.join(root, candidate)).then(s => s.isFile()).catch(() => false)) { dependency = candidate; break; }
    }
    if (!dependency) throw new Error(`Unresolved ${filename}: ${specifier}`);
    await copySource(dependency);
  }
  if (filename === 'app/audit/page.tsx') content = content.replace(/import Link from "next\/link";/, '').replace(/<Link\b/g, '<a').replace(/<\/Link>/g, '</a>').replace('href="/"', 'href="#terminal"');
  if (filename === 'app/globals.css') content = content.replace('@import "tailwindcss";', '');
  if (filename === 'app/lib/binance-public-transport.ts') {
    const adapter = await fs.readFile(path.join(template, filename), 'utf8');
    const helper = adapter.slice(adapter.indexOf('async function proxyResponse'));
    content = "import { api } from '@appdeploy/client';\n" + content.replace('await fetcher(base + path, { signal: controller.signal, cache: "no-store" })', "(base === BROWSER_REST ? await proxyResponse(path, controller.signal) : await fetcher(base + path, { signal: controller.signal, cache: 'no-store' }))") + '\n' + helper;
  }
  const target = path.join(output, filename);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
  if (filename.endsWith('.module.css')) await fs.writeFile(target + '.d.ts', 'declare const classes: Readonly<Record<string,string>>;\nexport default classes;\n');
}
await copySource('app/components/TerminalV6.tsx');
await copySource('app/audit/page.tsx');
await copySource('app/components/ObservationPanel.tsx');
await copySource('services/market-data/observation-features.ts');
await copySource('app/globals.css');
await fs.writeFile(path.join(output, 'src/vite-env.d.ts'), '/// <reference types="vite/client" />\n');
await fs.writeFile(path.join(output, 'source.json'), JSON.stringify({ source: 'SanChi117/smoke-trading-terminal', canonical: 'main', generated: true }, null, 2));
console.log(`Prepared ${visited.size} canonical source files in ${output}`);
