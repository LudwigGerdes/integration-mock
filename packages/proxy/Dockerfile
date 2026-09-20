FROM node:20-alpine AS build
WORKDIR /app
# Copy the manifests first: corepack reads the pinned pnpm from `packageManager`,
# so the build never asks the registry what "latest" is and stays reproducible.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
RUN corepack enable && corepack prepare --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm -r build

FROM node:20-alpine
RUN corepack enable
WORKDIR /app
COPY --from=build /app /app
ENV INTEGRATION_MOCK_HOME=/data \
    INTEGRATION_MOCK_PORT=8080 \
    INTEGRATION_MOCK_ADMIN_PORT=8081 \
    INTEGRATION_MOCK_ADMIN_BIND=0.0.0.0
# ADMIN_BIND=0.0.0.0 is required for the port mapping to work inside the container;
# the compose file publishes 8081 bound to the host loopback only. If you run this
# image directly, publish with `-p 127.0.0.1:8081:8081`, never `-p 8081:8081`.
VOLUME ["/data"]
EXPOSE 8080 8081
CMD ["node", "packages/proxy/dist/daemon-main.js"]
