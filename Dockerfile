# Deploy Render: backend Bun + frontend statis dalam satu image.
FROM oven/bun:1
WORKDIR /app

# backend + frontend
COPY backend/package.json backend/bun.lock ./backend/
WORKDIR /app/backend
RUN bun install --frozen-lockfile

WORKDIR /app
COPY backend ./backend
COPY frontend ./frontend

WORKDIR /app/backend
EXPOSE 3000
CMD ["bun", "src/index.ts"]
