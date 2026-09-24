# STRIKEPOINT game server (static client + WebSocket rooms). Works on Render, Fly.io, Railway, any VPS.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY scripts ./scripts
# production deps only; postinstall downloads the default rigged soldier model
RUN npm ci --omit=dev
COPY . .
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
