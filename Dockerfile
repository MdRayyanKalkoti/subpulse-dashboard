# ── SubPulse Dashboard — Dockerfile ──────────────────────────────────────────
# Node 18 Alpine = tiny image, fast build, secure

FROM node:18-alpine

# Set working directory inside container
WORKDIR /app

# Copy package files first (better Docker layer caching)
# If package.json hasn't changed, npm install is skipped on rebuild
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy all project files
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Health check — Render uses this to know the app is alive
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Start the server
CMD ["node", "server.js"]