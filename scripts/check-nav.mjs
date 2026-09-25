// 文档站导航守卫：CI 与本地都用 `node scripts/check-nav.mjs` 跑。
//
// 侧栏与导航已由每页 frontmatter 单源生成，所以"检查配置里的侧栏链接"这种
// 老写法会静默变成 0 条通过。这里改查真正会跑偏的四件事：
//   1. 每个内容页都有 title / group / order，group 在 config.mts 声明的分区里，order 是数字；
//   2. 页面第一个 H1 与 title 完全一致（侧栏文字取 title，不一致就是三处口径又分家了）；
//   3. 同一分区内 order 不重号；
//   4. 正文里的站内链接 `](/slug)` 指向真实存在的页面。
// 任何一项不满足都非零退出，并且一条都不静默跳过：解析不到分区清单时直接失败。

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = join(root, 'docs');
const config = readFileSync(join(docsDir, '.vitepress', 'config.mts'), 'utf8');

const problems = [];
const add = (file, msg) => problems.push(`${file}: ${msg}`);

const groups = [...config.matchAll(/\{\s*key:\s*'([a-z-]+)'\s*,\s*label:/g)].map((m) => m[1]);
if (groups.length === 0)
  throw new Error(
    'check-nav: 没能从 config.mts 解析出任何分区 key —— 配置格式变了，请同步改这个检查，不要让它空转'
  );

const files = readdirSync(docsDir).filter((f) => f.endsWith('.md'));
const slugs = new Set(files.map((f) => f.replace(/\.md$/, '')));
const seen = new Map();

for (const file of files) {
  const raw = readFileSync(join(docsDir, file), 'utf8');
  const block = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  const slug = file.replace(/\.md$/, '');

  if (!block) {
    // index.md 是首页（layout: home），本来就不进导航；其余页面缺 frontmatter 即为问题
    if (slug !== 'index') add(file, '缺 frontmatter（导航由 title/group/order 单源生成）');
    continue;
  }

  const fields = new Map();
  for (const line of block[1].split('\n')) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) fields.set(kv[1], kv[2].trim().replace(/^["']|["']$/g, ''));
  }
  if (fields.get('layout') === 'home') continue;

  const title = fields.get('title');
  const group = fields.get('group');
  const order = fields.get('order');

  if (!title) add(file, '缺 title');
  if (!group) add(file, '缺 group');
  else if (!groups.includes(group)) add(file, `group "${group}" 不在分区清单（${groups.join(' / ')}）`);
  if (!order || !/^\d+$/.test(order)) add(file, `order "${order ?? '(空)'}" 不是数字`);

  if (title && group && /^\d+$/.test(order || '')) {
    const key = `${group}:${order}`;
    if (seen.has(key)) add(file, `order ${order} 与 ${seen.get(key)} 重号`);
    else seen.set(key, file);
  }

  if (title) {
    let inFence = false;
    let h1 = null;
    const lines = raw.slice(block[0].length).split('\n');
    for (const line of lines) {
      if (/^```/.test(line)) inFence = !inFence;
      else if (!inFence && /^# /.test(line)) {
        h1 = line.slice(2).trim();
        break;
      }
    }
    if (h1 === null) add(file, '正文没有 H1（页面顶部会缺标题）');
    else if (h1 !== title.trim()) add(file, `H1 "${h1}" 与 title "${title}" 不一致`);
  }

  for (const link of raw.matchAll(/\]\((\/[a-z0-9-]+)(?:#[^)]*)?\)/g)) {
    const target = link[1].slice(1);
    if (!slugs.has(target)) add(file, `站内链接 ${link[1]} 指向不存在的页面`);
  }
}

const contentPages = files.filter((f) => f !== 'index.md').length;
if (problems.length) {
  console.error('文档站导航检查未通过：');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(
  `文档站导航检查通过：${contentPages} 个内容页、${groups.length} 个分区，title 与 H1 一致、站内链接全部可达`
);
