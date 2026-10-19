
# Use a lightweight Node.js runtime
FROM node:24-alpine

# Enable pnpm through Corepack
RUN corepack enable

# Set the working directory inside the container
WORKDIR /app

# Copy package metadata and pnpm lockfile
COPY package.json pnpm-lock.yaml ./

# Install dependencies using the frozen lockfile
RUN pnpm install --frozen-lockfile

# Copy application source code
COPY src/ ./src/

# Run as a non-root user for better security
USER node

# Document the application port
EXPOSE 8080

# Start Rolloutary
CMD ["node", "src/index.js"]
