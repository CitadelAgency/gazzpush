# Gazzpush Reels: HyperFrames (Apache-2.0) = HTML + GSAP → MP4 with headless Chrome and FFmpeg.
# Cloudflare Containers runs linux/amd64. Local test: docker build -t redacao-reels . && docker run -p 8080:8080 redacao-reels
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates fonts-liberation libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npx hyperframes browser ensure && npx hyperframes --version
COPY server.mjs ./
ENV NODE_ENV=production HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1
EXPOSE 8080
CMD ["node", "server.mjs"]
