FROM node:20-alpine
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# Copy source
COPY . .

EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]
