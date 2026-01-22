# Multi-stage Dockerfile for Tasker Server
# Stage 1: Build
FROM node:22-slim AS builder

WORKDIR /app

# Install build dependencies if needed
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Production
FROM node:22-slim

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled files and assets
COPY --from=builder /app/dist ./dist
# Copy any non-compiled resources (e.g., migrations, templates)
COPY migrations ./migrations
# Ensure migrations are in dist if needed, otherwise copy them here

# Install system dependencies (ffmpeg, etc.)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    opus-tools \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 8080

# Cloud Run uses PORT env var (defaulting to 8080)
ENV PORT=8080
ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
