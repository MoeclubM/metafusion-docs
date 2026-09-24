import { defineConfig } from 'vitepress';

// 五个分区按读者与任务划分；侧栏按路径分段，浏览某分区时只显示该分区页面。
const gettingStarted = [
  { text: '平台概览', link: '/overview' },
  { text: '设计理念', link: '/philosophy' },
  { text: '快速上手指南', link: '/quickstart' },
  { text: '常见问题 (FAQ)', link: '/faq' }
];

const usingCommunity = [
  { text: '社区讨论与交流', link: '/community-guide' },
  { text: '资源上传与下载', link: '/upload-download' }
];

const cataloging = [
  { text: '编目与投稿', link: '/contribute-guide' },
  { text: '词条编辑与合并', link: '/editing-guide' },
  { text: '权威编目与审查准则', link: '/curation-guide' },
  { text: '固定层级与动态定义', link: '/catalog' },
  { text: '分类体系与动态标签', link: '/taxonomy' },
  { text: 'IFLA LRM 增强版实体模型', link: '/frbr-model' }
];

const developers = [
  { text: 'API 概览', link: '/api-overview' },
  { text: '认证与凭证', link: '/api-auth' },
  { text: '第三方站点接入 OAuth 授权', link: '/oauth-integration' },
  { text: '实体查询与详情', link: '/api-entities' },
  { text: '检索与多维过滤', link: '/api-search' },
  { text: '词条写入与合并接口', link: '/api-edit' },
  { text: '资源直传与预签名下载', link: '/api-storage' },
  { text: 'AI Agent 协作指南', link: '/agent-integration' },
  { text: 'AI Agent API 与工具规范', link: '/api-agent' }
];

const legal = [
  { text: '服务条款', link: '/terms-of-service' },
  { text: '隐私政策', link: '/privacy' },
  { text: '版权说明与 DMCA', link: '/copyright' },
  { text: '联系站务', link: '/contact' },
  { text: '平台更新日志', link: '/changelog' }
];

function section(text: string, items: { text: string; link: string }[]) {
  return Object.fromEntries(items.map((item) => [item.link, [{ text, items }]]));
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
      { text: '开始使用', link: '/overview' },
      { text: '使用与社区', link: '/community-guide' },
      { text: '编目与共建', link: '/contribute-guide' },
      { text: '开发者与自动化', link: '/api-overview' },
      { text: '条款与站务', link: '/terms-of-service' },
      {
        text: '返回主站',
        link: '/',
        target: '_self'
      }
    ],

    sidebar: {
      ...section('开始使用', gettingStarted),
      ...section('使用与社区', usingCommunity),
      ...section('编目与共建', cataloging),
      ...section('开发者与自动化', developers),
      ...section('条款与站务', legal)
    },

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
