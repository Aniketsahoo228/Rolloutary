
# Use a lightweight Node.js runtime
FROM node:24-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy application metadata
COPY package.json ./

# Copy application source code
COPY src/ ./src/

# Run as a non-root user for better security
USER node

# Document the port used by the application
EXPOSE 8080

# Start the Rolloutary application
CMD ["node", "src/index.js"]
