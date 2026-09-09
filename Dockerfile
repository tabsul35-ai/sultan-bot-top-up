# ---------- build stage ----------
FROM node:22-slim AS build
WORKDIR /app

# Prisma butuh openssl
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npx tsc

# ---------- runtime stage ----------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

# schema + migrations dibutuhkan untuk `prisma migrate deploy` saat rilis
COPY prisma ./prisma
RUN npx prisma generate

COPY --from=build /app/dist ./dist

CMD ["node", "dist/index.js"]
