# Docker 部署指南（端口 9100）

## 前置
- Linux 服务器已安装 Docker 与 Docker Compose v2
- 打开服务器 9100 端口（安全组/防火墙）

## 目录结构
按仓库现状，Docker 相关文件位于 `prompt-tool/`：
- `Dockerfile`：多阶段构建（先打包前端，再构建后端运行镜像，并安装 ffmpeg）
- `docker-compose.yml`：服务编排与数据卷映射、环境变量
- `.dockerignore`：构建上下文瘦身

## 一键部署
```bash
cd prompt-tool
# 首次构建
docker compose build
# 启动（后台运行）
docker compose up -d
# 查看日志
docker compose logs -f
```

访问：http://<你的服务器IP>:9100

## 环境变量
在 `docker-compose.yml` 的 `environment` 中设置：
- `NODE_ENV=production`
- `PORT=9100`（容器内监听）
- `DATA_DIR=/app/server/data`、`UPLOAD_DIR=/app/server/data/uploads`（容器内路径）
- `ADMIN_USERNAME`、`ADMIN_PASSWORD`、`JWT_SECRET`（请务必自定义）
- 可选：`MAX_IMAGE_SIZE`、`MAX_VIDEO_SIZE`、`THUMBNAIL_WIDTH`

也可以通过 `.env` 文件注入：
```env
# 与 docker-compose.yml 同目录下创建 .env（不会进镜像）
ADMIN_USERNAME=admin
ADMIN_PASSWORD=please-change
JWT_SECRET=some-long-random-secret
```

## 数据持久化与备份
- 已将宿主机 `./server/data` 映射到容器 `/app/server/data`，包含 SQLite 与 `uploads/` 媒体文件。
- 备份：直接打包 `prompt-tool/server/data` 即可。
- 恢复：停容器、还原该目录、再启动容器。

## 常见问题
- 数据库初始化：镜像的入口脚本会在启动时自动执行 `node scripts/initDb.js`，因此第一次运行会自动创建 SQLite 与默认顶级文件夹。
- `ffmpeg`：镜像内已安装；若你不需要视频处理可自行去掉安装步骤。
- 首次运行没有 `server/.env`：没关系，容器使用 compose 注入的环境变量。
- 端口占用：如 9100 被占用，修改 compose 的端口映射与 `PORT` 环境变量。
- 权限：若宿主机挂载目录权限问题，可 `chown -R 1000:1000 server/data`（容器内 Node 默认用户为 root，如需非 root 可扩展镜像）。

## 升级（滚动重启）
```bash
# 拉取最新代码、重新构建并重启
cd prompt-tool
docker compose build --no-cache
docker compose up -d
```
