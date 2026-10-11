# Lightweight official Node.js 20 LTS runtime (Debian slim)
FROM node:20-slim

WORKDIR /app

# Install Python 3 & minimal system utilities for scripts
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set up global Python virtual environment
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Install lightweight Python helper dependencies
RUN pip install --no-cache-dir requests

# Copy dependency manifests & install Node production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy project source files
COPY . .

# Environment configuration (Render dynamically sets PORT at runtime)
ENV PORT=10000
ENV NODE_ENV=production
ENV RENDER=true
ENV DISABLE_LOCAL_BROWSER=true
ENV LOW_MEMORY=true
ENV NODE_OPTIONS="--max-old-space-size=384"
ENV PYTHON_PATH=/opt/venv/bin/python3
EXPOSE 10000

# Start unified Node engine with aggressive GC to keep RAM strictly within 512MB
CMD ["node", "--max-old-space-size=384", "server.js"]
