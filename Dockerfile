FROM node:22-slim
RUN apt-get update && apt-get install -y ffmpeg zip && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "dist/server.cjs"]
