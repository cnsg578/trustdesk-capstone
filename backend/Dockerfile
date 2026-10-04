FROM node:20-bullseye

# better-sqlite3 needs a C++ toolchain to build its native binding if no
# prebuilt binary matches this platform.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm install --omit=dev --build-from-source=better-sqlite3

COPY backend/ ./
COPY frontend/ /app/frontend/

RUN chmod +x docker-entrypoint.sh

ENV PORT=4000
ENV API_TOKEN=trustdesk-demo-token
ENV DB_PATH=/app/backend/trustdesk.db 

EXPOSE 4000

ENTRYPOINT ["./docker-entrypoint.sh"]