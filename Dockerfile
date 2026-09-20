# Dev container for the Storm Clusters sandbox.
# Everything runs client-side, so this image only ever serves the Nuxt dev server.
FROM node:24-alpine

RUN corepack enable
WORKDIR /srv/app

# dependencies first so edits to app/ do not invalidate the install layer
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --no-frozen-lockfile

COPY . .

ENV NUXT_TELEMETRY_DISABLED=1 \
    NITRO_HOST=0.0.0.0 \
    NITRO_PORT=3000 \
    CHOKIDAR_USEPOLLING=true

EXPOSE 3000
CMD ["pnpm", "dev", "--host", "0.0.0.0", "--port", "3000"]
