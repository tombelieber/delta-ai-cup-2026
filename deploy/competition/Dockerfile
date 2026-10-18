ARG NODE_IMAGE=node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY index.html vite.config.mjs ./
COPY src ./src
COPY extension ./extension
COPY public ./public
COPY server ./server
COPY deploy/competition/package-extension.mjs deploy/competition/validate-extension.mjs ./deploy/competition/
RUN pnpm build:extension && node deploy/competition/package-extension.mjs && pnpm build
RUN pnpm prune --prod

FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 AI_GENERATION_DISABLED=true GEMINI_FREE_TIER_ONLY=true \
    STUDY_ENABLED=true STUDY_SOURCE_DIR=/app/private/study-sources STUDY_CACHE_DIR=/app/artifacts/study/cache
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/extension-dist ./release/extension-dist
COPY --from=build /app/extension-package.json ./release/extension-package.json
COPY private/study-sources ./private/study-sources
RUN mkdir -p /app/artifacts/study/cache && chown node:node /app/artifacts/study/cache \
    && chmod 700 /app/artifacts/study/cache \
    && chmod -R a+rX,a-w /app/dist /app/server /app/private /app/release
USER node
EXPOSE 8080
CMD ["node", "server/index.mjs"]
