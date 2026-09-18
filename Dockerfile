# docs-site — 独立文档站，VitePress 驱动
FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
# 锁文件是必填：npm ci 只按 package-lock.json 安装，缺锁直接失败；
# npm install 会把"锁不存在"降级成重新解析版本范围，同提交构建出不同依赖。
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# 只带静态产物，运行期不再跑开发预览服务器。
# 站点按 VitePress base=/docs/ 构建，网关 location /docs 原样转发（不改写路径），
# 所以产物必须落在"站点根 site/"下的 docs/ 子目录：URL /docs/x 才对应 site/docs/x。
COPY --from=builder --chown=nextjs:nodejs /app/docs/.vitepress/dist ./site/docs
COPY package.json package-lock.json ./
# 运行期只装生产依赖（sirv-cli），不带 vitepress 等构建期依赖。
RUN npm ci --omit=dev && npm cache clean --force

USER nextjs
EXPOSE 3001
CMD ["npm", "run", "start"]
