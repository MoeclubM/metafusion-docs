// 导航、首页入口与站内锚点检查。使用 VitePress 渲染器生成锚点，避免另写一套标题规则。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMarkdownRenderer } from 'vitepress';
import { pageRedirects } from '../docs/.vitepress/redirects.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = join(root, 'docs');
const config = readFileSync(join(docsDir, '.vitepress', 'config.mts'), 'utf8');
const groups = [...config.matchAll(/\{\s*key:\s*'([a-z-]+)'\s*,\s*label:/g)].map((m) => m[1]);
if (!groups.length) throw new Error('check-nav: 无法读取分区清单，请同步检查配置与校验器。');

const problems = [];
const add = (file, message) => problems.push(`${file}: ${message}`);
const files = readdirSync(docsDir).filter((file) => file.endsWith('.md'));
const pages = new Map();
const seen = new Map();
const md = await createMarkdownRenderer(docsDir);
let checkedLinks = 0;

for (const file of files) {
  const raw = readFileSync(join(docsDir, file), 'utf8').replace(/\r\n/g, '\n');
  const env = {};
  const html = md.render(raw, env);
  const fields = env.frontmatter ?? {};
  const slug = file.replace(/\.md$/, '');
  const anchors = new Set([...html.matchAll(/<h[1-6][^>]*\bid="([^"]+)"/g)].map((m) => m[1]));
  const links = [...(env.links ?? [])];
  if (fields.layout === 'home') {
    links.push(...(fields.hero?.actions ?? []).map((item) => item.link).filter(Boolean));
    links.push(...(fields.features ?? []).map((item) => item.link).filter(Boolean));
  } else {
    if (!/^---\n/.test(raw)) add(file, '缺 frontmatter');
    if (!fields.title) add(file, '缺 title');
    if (!fields.description) add(file, '缺 description');
    if (!groups.includes(fields.group)) add(file, `未声明的 group "${fields.group ?? ''}"`);
    if (!Number.isInteger(fields.order) || fields.order < 0) add(file, 'order 必须是非负整数');
    const key = `${fields.group}:${fields.order}`;
    if (seen.has(key)) add(file, `order 与 ${seen.get(key)} 重号`);
    else seen.set(key, file);
    const tokens = md.parse(env.content ?? raw, {});
    const h1Index = tokens.findIndex((token) => token.type === 'heading_open' && token.tag === 'h1');
    const h1 = h1Index < 0 ? '' : tokens[h1Index + 1].content.trim();
    if (h1 !== fields.title) add(file, `H1 "${h1}" 与 title "${fields.title ?? ''}" 不一致`);
  }
  pages.set(slug, { file, fields, anchors, links });
}

for (const group of groups) {
  if (![...pages.values()].some((page) => page.fields.group === group))
    add('config.mts', `分区 ${group} 没有页面`);
}

for (const [from, to] of Object.entries(pageRedirects)) {
  if (pages.has(from)) add('redirects.mjs', `旧页面 ${from} 仍有重复正文`);
  if (!pages.has(to)) add('redirects.mjs', `跳转 ${from} 指向不存在的页面 ${to}`);
}

for (const [slug, page] of pages) {
  for (const link of page.links) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(link)) continue;
    const url = new URL(link, `https://docs.invalid/${slug}`);
    const path = decodeURIComponent(url.pathname).replace(/^\/docs\//, '/');
    const target = path.replace(/^\//, '').replace(/\.(?:md|html)$/, '').replace(/\/$/, '') || 'index';
    const destination = pages.get(target);
    if (!destination) {
      if (!existsSync(join(docsDir, 'public', path.replace(/^\//, ''))))
        add(page.file, `站内链接 ${link} 指向不存在的页面或资源`);
      continue;
    }
    checkedLinks++;
    const anchor = decodeURIComponent(url.hash.slice(1));
    if (anchor && !destination.anchors.has(anchor))
      add(page.file, `站内链接 ${link} 的锚点不存在`);
  }
}

if (problems.length) {
  console.error('文档导航检查未通过：');
  for (const problem of problems) console.error('  - ' + problem);
  process.exit(1);
}
console.log(`文档导航检查通过：${pages.size - 1} 个内容页、${groups.length} 个分区、${checkedLinks} 个页面链接、${Object.keys(pageRedirects).length} 个合并跳转；标题、首页入口与锚点可达。`);
