import { defineConfig } from 'vitepress';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 导航与侧栏的事实来源是每页 frontmatter 的 group / order / title：
// 页面属于哪个分区、排在第几、显示什么名字，都只写在页面里；本文件只声明
// 分区显示名与分区先后。新增页面只需带上这三个字段，不必回来改清单。
//
// 规则：title == 页面 H1 == 侧栏文字。三者由页面一处声明，缺字段或分组写错
// 会在构建时直接报错，避免侧栏与正文再次跑偏。
// 注意：VitePress 只在 config 变化时热重启，改完 frontmatter 后重启 dev server 才看到新侧栏。

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const sections: { key: string; label: string }[] = [
  { key: 'intro', label: '认识 MetaFusion' },
  { key: 'participate', label: '使用与共建' },
  { key: 'model', label: '数据模型与术语' },
  { key: 'api', label: 'API 与 Agent 接入' },
  { key: 'legal', label: '条款与站务' }
];

interface Page {
  link: string;
  text: string;
  group: string;
  order: number;
}

function readPage(file: string): Page | null {
  const raw = readFileSync(join(srcDir, file), 'utf8');
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
  if (!Number.isFinite(order)) problems.push(`order "${fields.get('order')}" 不是数字`);
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

// 浏览某分区任一页面时，侧栏只显示该分区的页面；分区名作为分组标题。
const sidebar: Record<string, { text: string; items: { text: string; link: string }[] }[]> = {};
for (const group of grouped) {
  for (const item of group.items) sidebar[item.link] = [{ text: group.label, items: group.items }];
}

export default defineConfig({
  ignoreDeadLinks: true,
  base: '/docs/',
  title: 'MetaFusion 平台文档',
  description: 'MetaFusion 开放媒体资源站与元数据共建平台文档中心',
  lang: 'zh-CN',
  lastUpdated: false,
  cleanUrls: true,

  themeConfig: {
    siteTitle: 'MetaFusion Docs',
    logo: '/favicon.svg',

    nav: [
      ...grouped.map((group) => ({ text: group.label, link: group.items[0].link })),
      {
        text: '返回主站',
        link: '/',
        target: '_self'
      }
    ],

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
      message: '基于 Apache-2.0 协议开放 · 社区共建开放元数据资源站',
      copyright: 'Copyright © 2026 MoeClub Ltd · MetaFusion Resource Hub'
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
