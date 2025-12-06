# Multi-stage build for Prompt Collector (client + server)

# ---------- Stage 1: build client ----------
FROM node:20-bookworm-slim AS client-build
WORKDIR /app/client

# Install deps
COPY client/package*.json ./
RUN npm ci --no-audit --no-fund

# Copy sources and build
COPY client/vite.config.js ./
COPY client/index.html ./
COPY client/src ./src
RUN npm run build

# ---------- Stage 2: runtime (server) ----------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

# Install ffmpeg for video processing (thumbnails/transcode)
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy server and install prod deps
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Copy server source
COPY server ./

# Copy built client to /app/client/dist for production static serving
WORKDIR /app
RUN mkdir -p /app/client
COPY --from=client-build /app/client/dist /app/client/dist

# Runtime defaults (can be overridden by docker-compose or env)
ENV NODE_ENV=production \
    PORT=9100 \
    DATA_DIR=/data \
    UPLOAD_DIR=/data/uploads \
    TEMP_FILE_TTL_MINUTES=30

# Ensure data dirs exist
RUN mkdir -p /data/uploads /data/uploads/thumbnails /data/uploads/tmp

EXPOSE 9100
WORKDIR /app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
CMD ["/usr/local/bin/docker-entrypoint.sh"]

