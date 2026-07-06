# ----- Base image -----
# Node 22 on Debian Bookworm. We pick the full image (not alpine)
# because OpenCV and MediaPipe need system-level C libraries
# that don't exist on Alpine without painful manual compilation.
FROM node:22-bookworm

# ----- System dependencies -----
# These are Linux packages that Python libraries need:
# - python3, python3-venv, pip: to run your photo validation script
# - libgl1, libglib2.0-0: OpenCV needs these to work on Linux
#   (on Windows these come built-in, on Linux they must be installed manually)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# ----- Working directory -----
# Everything from here on happens inside /app
WORKDIR /app

# ----- Node dependencies -----
# Copy package files first, install, THEN copy source code.
# Why this order? Docker caches each step. If your source code changes
# but package.json didn't, Docker reuses the cached node_modules
# instead of reinstalling everything — saves minutes on every rebuild.
COPY package.json package-lock.json ./
RUN npm ci

# ----- Python virtual environment -----
# Copy requirements.txt first (same caching trick as above).
# python3 -m venv creates a virtual environment at /app/venv.
# On Linux, the python binary lives at venv/bin/python (not venv/Scripts/python.exe).
# Our code already handles this via the isWindows check we just added.
COPY requirements.txt ./
RUN python3 -m venv venv && \
    venv/bin/pip install --no-cache-dir -r requirements.txt


# ----- Copy the rest of your source code -----
COPY src ./src


# ----- Prisma setup -----
# Prisma needs the schema file and config to generate its client.
# We copy just these first, generate the client, then copy everything else.
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate


# ----- Download MediaPipe model -----
# Your Python script expects this file at src/scripts/models/
# It's already in your source code, so COPY src above handles it.
# If it's ever missing, this is where you'd add a RUN wget/curl command.

# ----- Port -----
# Tells Docker (and hosting platforms) which port the app listens on.
# This doesn't actually open the port — it's documentation for the platform.
EXPOSE 3000

# ----- Start the app -----
# This runs when the container starts.
CMD ["npm", "start"]