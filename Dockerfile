# Official Microsoft Playwright image with Ubuntu, Node.js 20, and all browser dependencies pre-installed
FROM mcr.microsoft.com/playwright:v1.48.0-noble

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy project source files
COPY . .

# Set default port (Render dynamically sets PORT)
ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

# Start server
CMD ["node", "server.js"]
