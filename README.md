# ProHub · Prompt Collector

单用户版 Prompt 收集与管理工具。支持把你在各个平台上用到的 Prompt、截图、视频等素材统一集中整理、打标签、搜索和分享。

> 仓库名为 `prohub`，代码中的包名仍是 `prompt-collector`，后续可根据需要统一命名。

## 功能特性

- 内容管理
  - 支持文本 / 图片 / 视频三种内容类型
  - 文件夹层级管理，收藏标记
  - 标签系统，可为内容添加多个标签
- 搜索与推荐
  - 关键字搜索，标签过滤
  - 基于内容的标签匹配（后端 `tagMatcher`）
- 分享与展示
  - 生成分享链接，可配置标题、描述、过期时间
  - 支持设置访问密码
  - 独立的分享页（支持 SEO），可直接对外访问
- 统计与导出
  - 内容数量、收藏数量、标签数量、占用存储等统计
  - 支持导出 JSON 数据包（含内容及分享信息）
- 上传与媒体处理
  - 图片 / 视频上传，自动生成缩略图
  - 视频转码与封面帧提取（依赖 `ffmpeg`）

## 技术栈

- 前端：React 18 + React Router + React Query + Vite
- 后端：Node.js + Express
- 数据库：SQLite（基于 `better-sqlite3`）
- 其他：Multer（上传）、Sharp（图片处理）、fluent-ffmpeg（视频）、JSON Web Token（JWT）

## 目录结构

```text
.
├── client/              # 前端应用（Vite + React）
│   ├── src/
│   └── dist/            # 构建产物（已在 .gitignore 中忽略）
├── server/              # 后端服务（Express）
│   ├── index.js         # 主入口
│   ├── routes/          # 各类 API 路由（auth/items/tags/search/shares/stats 等）
│   ├── scripts/         # 数据库初始化/修复/统计脚本
│   ├── services/        # 内部服务（如标签匹配）
│   ├── data/            # 本地数据（SQLite、uploads），已在 .gitignore 中忽略
│   ├── .env             # 本地环境变量（已在 .gitignore 中忽略）
│   └── .env.example     # 环境变量示例配置
├── Dockerfile
├── docker-compose.yml
├── docker-entrypoint.sh
├── DEPLOY_DOCKER.md     # Docker 部署说明
├── package.json         # 根脚本（dev/build/start）
└── .gitignore
```

## 本地开发运行

### 前置要求

- Node.js ≥ 18
- npm ≥ 9
- 本地安装 `ffmpeg`（用于视频处理，如不需要可在后端中去掉相关逻辑）

### 安装依赖

在项目根目录执行：

```bash
npm install
```

根目录的 `postinstall` 会自动进入 `server/` 与 `client/` 分别安装依赖。

### 配置环境变量

后端读取 `server/.env`（建议基于示例文件修改）：

```bash
cp server/.env.example server/.env
# 然后根据需要修改其中的账号、密码和 JWT_SECRET
```

关键配置包括：

- `PORT`：后端监听端口（默认 3000）
- `DATA_DIR`：数据目录（默认 `./data`）
- `UPLOAD_DIR`：上传目录（默认 `./data/uploads`）
- `ADMIN_USERNAME`：管理后台登录用户名
- `ADMIN_PASSWORD`：管理后台登录密码
- `JWT_SECRET`：JWT 签名密钥（请务必使用足够随机的字符串）

> 仓库中的 `.env` 只作为示例使用，已被 `.gitignore` 忽略。线上环境请重新设置账号和密钥。

### 启动开发环境

在项目根目录：

```bash
# 同时启动前端和后端
npm run dev
```

默认：

- 后端 API：`http://localhost:3000/api/...`
- 前端（Vite 开发服务器）：`http://localhost:5173`

首个管理员账号为 `.env` 中配置的 `ADMIN_USERNAME` / `ADMIN_PASSWORD`。

## 生产构建与运行（非 Docker）

```bash
# 构建前端
npm run build

# 启动后端（会服务打包后的前端静态文件）
npm run start
```

生产环境建议设置：

- `NODE_ENV=production`
- 根据部署环境调整 `PORT` / `DATA_DIR` / `UPLOAD_DIR` 等变量。

## Docker 部署

本仓库已经提供了 Dockerfile 与 docker-compose 配置，可快速部署到服务器。

简要步骤（Linux 服务器，已安装 Docker & Docker Compose v2）：

```bash
git clone https://github.com/solosvip/prohub.git
cd prohub

docker compose build
docker compose up -d
```

更多细节（环境变量配置、数据备份与还原、常见问题等）参考：

- `DEPLOY_DOCKER.md`

## 数据与隐私

- 所有数据（SQLite 数据库及上传的媒体文件）默认保存在 `server/data/` 目录。
- 该目录已默认加入 `.gitignore`，不会被提交到 Git 仓库。
- 如需备份或迁移，只需要备份 `server/data/` 目录即可。

## License

MIT License，详见 `package.json` 中的 `license` 字段。后续如需要可在仓库根目录补充 `LICENSE` 文件。

