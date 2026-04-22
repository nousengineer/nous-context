# Multi-stage build para otimizar tamanho da imagem

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copiar arquivos de dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm ci --only=production && \
    npm cache clean --force

# Copiar codigo-fonte
COPY . .

# Build da aplicacao
RUN npm run build || true

# Stage 2: Runtime
FROM node:20-alpine

# Variaveis de ambiente
ENV NODE_ENV=production \
    APP_PORT=3000 \
    LOG_LEVEL=info

WORKDIR /app

# Instalar curl para health checks
RUN apk add --no-cache curl

# Copiar node_modules do builder
COPY --from=builder /app/node_modules ./node_modules

# Copiar codigo compilado e arquivos necessarios
COPY --from=builder /app/dist ./dist 2>/dev/null || true
COPY --from=builder /app/public ./public 2>/dev/null || true
COPY package*.json ./

# Criar usuario nao-root para seguranca
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start application
CMD ["node", "dist/main.js"]