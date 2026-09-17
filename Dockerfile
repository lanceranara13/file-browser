# syntax=docker/dockerfile:1

FROM node:24-trixie-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-trixie-slim
# ffmpeg: Debian's build carries both h264_vaapi and h264_nvenc, with scale_vaapi
#   and scale_cuda, so one image serves AMD, Intel and NVIDIA.
# mesa-va-drivers: the VAAPI driver for AMD (radeonsi).
# vainfo: for checking a GPU from inside the container.
# libarchive-tools: bsdtar, which unpacks zip, tar.*, 7z, rar and iso from one
#   binary — the whole set of archives this app names, bar dmg.
# NVIDIA's encode and decode libraries are not installed here; the NVIDIA
# container toolkit mounts the host driver's copies at run time.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg mesa-va-drivers vainfo libarchive-tools \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    FILES_ROOT=/files \
    TRANSCODE_DIR=/cache \
    DATA_DIR=/data \
    NVIDIA_DRIVER_CAPABILITIES=compute,video,utility

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
RUN mkdir -p /files /cache /data && chown node:node /files /cache /data

USER node
EXPOSE 3000
CMD ["node", "server.js"]
