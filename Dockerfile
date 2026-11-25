# One service: Flask serves the API and the built frontend, so the session
# cookie is same-origin. Account data lives in the database DATABASE_URL names
# (a hosted Postgres in production), never on this container's disk.

FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY public public
COPY src src
RUN npm run build

FROM python:3.12-slim
# Keystone is built from source on Linux, which needs a compiler and CMake.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential cmake \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend backend
COPY --from=frontend /app/dist dist
ENV PORT=8000 FRONTEND_DIST=/app/dist PYTHONUNBUFFERED=1
# One worker: submissions are judged on a thread inside it, one at a time.
# Threads let other requests carry on while a submission is graded.
CMD gunicorn --chdir backend --workers 1 --threads 8 --timeout 120 --bind 0.0.0.0:${PORT} app:app
