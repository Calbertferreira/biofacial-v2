FROM node:24-slim

WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY . .
RUN pnpm install --frozen-lockfile \
    && pnpm --filter @biofacial/contracts build \
    && pnpm --filter @biofacial/api build

ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@biofacial/api", "start"]
