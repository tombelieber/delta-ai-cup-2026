FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY index.html vite.config.mjs ./
COPY src ./src
COPY extension ./extension
COPY public ./public
COPY server/learning-sources.mjs ./server/learning-sources.mjs
RUN pnpm build
RUN pnpm prune --prod

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 AI_GENERATION_DISABLED=true GEMINI_FREE_TIER_ONLY=true
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY server ./server
USER node
EXPOSE 8080
CMD ["node", "server/index.mjs"]
