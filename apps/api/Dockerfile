FROM node:20-alpine AS build
WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma/ prisma/
RUN npx prisma generate

COPY . .
RUN npm run build

# ─── Production stage ───
FROM node:20-alpine
WORKDIR /app

COPY --from=build /build/dist ./dist
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/package.json ./
COPY --from=build /build/prisma ./prisma

EXPOSE 3001

# 启动时同步数据库结构，然后启动 API
CMD npx prisma db push --skip-generate 2>&1 | tail -5 && node dist/main
