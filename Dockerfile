# syntax = docker/dockerfile:1

# Adjust NODE_VERSION as desired
ARG NODE_VERSION=18
FROM node:${NODE_VERSION}-bookworm-slim AS base

LABEL fly_launch_runtime="Node.js"

# Node.js app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"


# Throw-away build stage to reduce size of final image
FROM base AS build

# Install packages needed to build native node modules (e.g., bcrypt)
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3 && \
    rm -rf /var/lib/apt/lists/*

# Install production dependencies with a clean, reproducible install
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .


# Final stage for app image
FROM base

# Ensure runtime directory exists and is writable (app writes to /app/data)
RUN mkdir -p /app/data

# Copy built application and node_modules from build stage
COPY --from=build /app /app

# Drop privileges
USER node

# Start the server by default, this can be overwritten at runtime
EXPOSE 8080
ENV PORT=8080
CMD [ "npm", "run", "start" ]
