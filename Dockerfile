FROM node:20-alpine

# Install build dependencies for better-sqlite3 (native node module compilation)
RUN apk add --no-repeat --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY . .

# Create persistent storage directory for the SQLite database
# The DB resides in the /app directory by default, which can be mounted as a volume
VOLUME ["/app"]

EXPOSE 8085

ENV NODE_ENV=production

CMD ["npm", "start"]
