import { defineConfig } from 'vitepress';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageRedirects } from './redirects.mjs';

// 导航与侧栏的事实来源是每页 frontmatter 的 group / order / title：
// 页面属于哪个分区、排在第几、显示什么名字，都只写在页面里；本文件只声明
// 分区显示名与分区先后。新增页面只需带上这三个字段，不必回来改清单。
//
// 规则：title == 页面 H1 == 侧栏文字。三者由页面一处声明，缺字段或分组写错
// 会在构建时直接报错，避免侧栏与正文再次跑偏。
// 注意：VitePress 只在 config 变化时热重启，改完 frontmatter 后重启 dev server 才看到新侧栏。

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const sections: { key: string; label: string }[] = [
  { key: 'intro', label: '开始使用' },
  { key: 'participate', label: '参与共建' },
  { key: 'model', label: '理解数据' },
  { key: 'api', label: 'API 与 Agent 接入' },
  { key: 'legal', label: '条款与支持' }
];

interface Page {
  link: string;
  text: string;
  group: string;
  order: number;
}

function readPage(file: string): Page | null {
  const raw = readFileSync(join(srcDir, file), 'utf8').replace(/\r\n/g, '\n');
  const block = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!block) return null;

  const fields = new Map<string, string>();
  for (const line of block[1].split('\n')) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) fields.set(kv[1], kv[2].trim().replace(/^["']|["']$/g, ''));
  }

  // index.md 是首页（layout: home），不进导航
  if (!fields.has('group')) return null;

  const group = fields.get('group') as string;
  const text = fields.get('title');
  const order = Number(fields.get('order'));

  const problems: string[] = [];
  if (!sections.some((item) => item.key === group))
    problems.push(`group "${group}" 不是已声明的分区（${sections.map((s) => s.key).join(' / ')}）`);
  if (!text) problems.push('缺少 title');
  if (!fields.has('order') || !Number.isInteger(order) || order < 0)
    problems.push(`order "${fields.get('order')}" 不是非负整数`);
  if (problems.length)
    throw new Error(`[docs] ${file}: ${problems.join('；')}。导航由 frontmatter 单源生成，请补齐再构建。`);

  return { link: `/${file.replace(/\.md$/, '')}`, text: text as string, group, order };
}

const pages = readdirSync(srcDir)
  .filter((file) => file.endsWith('.md'))
  .map(readPage)
  .filter((page): page is Page => page !== null)
  .sort(
    (a, b) =>
      sections.findIndex((s) => s.key === a.group) -
        sections.findIndex((s) => s.key === b.group) || a.order - b.order
  );

const emptySections = sections.filter(
  (section) => !pages.some((page) => page.group === section.key)
);
if (emptySections.length)
  throw new Error(`[docs] 分区没有页面：${emptySections.map((s) => s.label).join(' / ')}`);

const grouped = sections.map((section) => ({
  ...section,
  items: pages.filter((page) => page.group === section.key).map(({ text, link }) => ({ text, link }))
}));

// 全站侧栏由页面元数据生成；当前分区自动展开，上一篇/下一篇跨分区连续。
const sidebar = grouped.map((group) => ({
  text: group.label,
  collapsed: true,
  items: group.items
}));

export default defineConfig({
  base: '/docs/',
  title: 'MetaFusion 平台文档',
  description: 'MetaFusion 使用指南、编目规范与 API 参考',
  lang: 'zh-CN',
  lastUpdated: false,
  cleanUrls: true,

  // Docker/sirv 提供 .html 及无扩展名地址；旧页面只保留浏览器跳转。
  buildEnd(site) {
    for (const [from, to] of Object.entries(pageRedirects)) {
      const target = `${site.site.base}${to}`;
      writeFileSync(join(site.outDir, `${from}.html`),
        `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${target}"><link rel="canonical" href="${target}"><title>页面已合并</title></head><body><a href="${target}">前往合并后的文档</a></body></html>`, 'utf8');
    }
  },

  themeConfig: {
    siteTitle: 'MetaFusion Docs',
    logo: '/favicon.svg',

    nav: grouped.map((group) => ({ text: group.label, link: group.items[0].link })),

    sidebar,

    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: {
                buttonText: '搜索文档',
                buttonAriaLabel: '搜索文档'
              },
              modal: {
                noResultsText: '未找到相关结果',
                resetButtonTitle: '清除搜索条件',
                footer: {
                  selectText: '选择',
                  navigateText: '切换',
                  closeText: '关闭'
                }
              }
            }
          }
        }
      }
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/MoeclubM/MetaFusion' }
    ],

    footer: {
      message: 'MetaFusion 使用指南与 API 参考',
      copyright: 'Copyright © 2026 MoeClub Ltd'
    },

    docFooter: {
      prev: '上一篇',
      next: '下一篇'
    },

    outline: {
      label: '页面导航',
      level: [2, 3]
    }
  }
});
