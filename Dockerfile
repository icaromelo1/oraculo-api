FROM node:24-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src

RUN npm run build && npm prune --omit=dev

FROM node:24-slim AS runtime

ARG DOCKER_CLI_VERSAO=27.5.1

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl \
  && arquitetura="$(dpkg --print-architecture)" \
  && case "$arquitetura" in \
       arm64) alvo=aarch64 ;; \
       amd64) alvo=x86_64 ;; \
       *) echo "arquitetura sem cliente docker: $arquitetura" >&2; exit 1 ;; \
     esac \
  && curl -fsSL "https://download.docker.com/linux/static/stable/${alvo}/docker-${DOCKER_CLI_VERSAO}.tgz" \
     | tar -xz -C /usr/local/bin --strip-components=1 docker/docker \
  && apt-get purge -y curl && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV TRANSFORMERS_CACHE=/app/.cache/transformers
ENV DOCKER_HOST=tcp://oraculo-docker:2375

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

EXPOSE 3000

CMD ["node", "dist/main"]
