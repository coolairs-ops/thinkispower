FROM node:20-alpine AS build
WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# ─── Production stage ───
FROM node:20-alpine
WORKDIR /app

COPY --from=build /build/dist ./dist
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/package.json ./

EXPOSE 5000

CMD ["node", "dist/index.js"]
