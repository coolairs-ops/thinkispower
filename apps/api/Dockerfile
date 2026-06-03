FROM node:20-alpine AS build
WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma/ prisma/
RUN npx prisma generate

COPY . .
RUN npm run build

# 只保留 production 依赖
RUN npm prune --production

# ─── Production stage ───
FROM node:20-alpine
WORKDIR /app

# Docker CLI for one-click deploy
RUN apk add --no-cache docker-cli docker-cli-compose

COPY --from=build /build/dist ./dist
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/package.json ./
COPY --from=build /build/prisma ./prisma

EXPOSE 3001

CMD npx prisma db push --skip-generate 2>&1 | tail -5 && node dist/main
