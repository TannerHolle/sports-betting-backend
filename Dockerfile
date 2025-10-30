FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install dependencies first (leverages Docker layer caching)
COPY package*.json ./
RUN npm ci --only=production

# Copy application source
COPY . .

# Environment
ENV NODE_ENV=production

# Start the server
CMD ["npm", "start"]


