# syntax=docker/dockerfile:1
FROM node:26.13.1-bookworm-slim AS build

WORKDIR /app
ENV NX_DAEMON=false \
    NX_ISOLATE_PLUGINS=false \
    NX_NO_CLOUD=true \
    NG_CLI_ANALYTICS=false

RUN npm install --global npm@12.2.3 --ignore-scripts --no-audit --no-fund

COPY package.json package-lock.json ./
COPY imx-modules/ ./imx-modules/
COPY docker/prepare-packages.mjs ./docker/prepare-packages.mjs
# Resolve the bundled packages from the supplied archives.
RUN node docker/prepare-packages.mjs \
    && npm install --ignore-scripts --no-audit --no-fund

COPY angular.json nx.json tsconfig.json ./
COPY projects/ ./projects/
COPY shared/ ./shared/
COPY custom-theme/ ./custom-theme/
COPY build/ ./build/
COPY scripts/ ./scripts/
RUN npx --no-install nx build qer-app-portal --configuration=production --parallel=2

FROM nginx:1.30.6-alpine AS runtime

ENV NGINX_ENVSUBST_FILTER=^API_SERVER_ \
    API_SERVER_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt

COPY --from=build /app/dist/qer-app-portal/ /usr/share/nginx/html/
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/15-configure-api.envsh /docker-entrypoint.d/15-configure-api.envsh
RUN chmod 755 /docker-entrypoint.d/15-configure-api.envsh

EXPOSE 80
