# Official Microsoft Playwright image with Ubuntu 24.04 (Noble), Node.js 20, and all browser OS dependencies
FROM mcr.microsoft.com/playwright:v1.48.0-noble

WORKDIR /app

# Install Python 3, pip, venv, and system utilities
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

# Install Camoufox stealth anti-detect browser engine and fetch browser binary
RUN pip install --no-cache-dir camoufox requests
RUN python3 -m camoufox fetch

# Copy dependency manifests & install Node production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Install Playwright Chromium browser
RUN npx playwright install chromium

# Copy project source files
COPY . .

# Environment configuration (Render dynamically sets PORT at runtime)
ENV PORT=10000
ENV NODE_ENV=production
ENV PYTHON_PATH=/opt/venv/bin/python3
EXPOSE 10000

# Start unified Node engine (auto-supervises Camoufox daemon, Turnstile keeper, and Radar)
CMD ["node", "server.js"]

