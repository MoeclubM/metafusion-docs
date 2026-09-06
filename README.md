# MetaFusion Docs

MetaFusion 官方全量架构指南、IFLA LRM 编目标准与开发者开放 API 独立文档站点。

## 📖 关于本项目

本项目是 MetaFusion 平台的独立文档子系统，采用 [VitePress](https://vitepress.dev/) 纯静态生成（SSG），为开发者、编目考据员与普通用户提供高可读性、响应迅速的技术文档与使用指南。

- **主项目 (Core Catalog)**: [MetaFusion](https://github.com/MoeclubM/MetaFusion)
- **在线访问**: [https://findverse.cc/docs/](https://findverse.cc/docs/)

## 🚀 本地开发与预览

```bash
# 安装依赖
npm install

# 启动本地开发服务
npm run dev

# 编译静态产物
npm run build

# 本地预览构建结果
npm run preview
```

## 🐳 Docker 部署

```bash
docker build -t metafusion-docs .
docker run -d -p 3001:3001 --name metafusion-docs metafusion-docs
```
