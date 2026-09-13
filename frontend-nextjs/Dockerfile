FROM node:20-alpine AS builder

WORKDIR /app

ARG BACKEND_PROXY_TARGET=http://localhost:8000
ENV BACKEND_PROXY_TARGET=$BACKEND_PROXY_TARGET
# 构建标识（A2）：由 docker-compose build.args 传入，构建期注入页面（NEXT_PUBLIC_BUILD_ID）
ARG APP_BUILD=
ARG APP_VERSION=2.2.0
ARG APP_ENVIRONMENT=development
ENV APP_BUILD=$APP_BUILD
ENV APP_VERSION=$APP_VERSION
ENV APP_ENVIRONMENT=$APP_ENVIRONMENT
ENV NODE_OPTIONS=--max-old-space-size=1024

COPY package*.json ./
RUN npm ci --prefer-offline --no-audit

COPY next.config.mjs tsconfig.json next-env.d.ts ./
COPY app ./app
COPY src ./src
COPY public ./public

RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

ENV HOSTNAME=0.0.0.0
ENV PORT=3000

CMD ["node", "server.js"]
