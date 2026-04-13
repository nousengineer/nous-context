# Quick Start para Desenvolvedor ThinkCoffee

## Setup Inicial (5 min)

### 1. Pré-requisitos
- Docker Desktop instalado
- Node.js 18+ ou 20+
- Git configurado

### 2. Primeiro Deploy Local

\\\ash
# 1. Copiar variáveis de ambiente
cp .env.example .env

# 2. Levantar infraestrutura
docker-compose up -d

# 3. Instalar dependências
npm install

# 4. Rodar aplicação
npm run dev
\\\

### 3. Acessar Serviços

| Serviço | URL/Porta |
|---------|-----------|
| Aplicação | http://localhost:3000 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |
| pgAdmin | http://localhost:5050 |

### 4. Troubleshooting

**Erro "port already in use"**
\\\ash
# Verificar processos usando porta 3000
netstat -ano \| findstr :3000

# Ou refazer containers
docker-compose restart
\\\

**Erro de conexão com banco**
\\\ash
# Checar logs do postgres
docker-compose logs postgres

# Reiniciar serviço
docker-compose restart postgres
\\\

## CI/CD Pipeline

O pipeline é executado automaticamente em:
- **Push para main/develop**: Build + Test + Docker + Deploy
- **Pull Requests**: Build + Test apenas

Acompanhe em: Actions → Workflow mais recente

## Deploy em Produção

1. Merger PR para \main\
2. GitHub Actions executa automaticamente:
   - ✓ Testa código
   - ✓ Constrói imagem Docker
   - ✓ Push para Docker Hub
   - ✓ Deploy no servidor de produção
   - ✓ Valida saúde da aplicação

Logs estão em: .github/workflows/ci.yml

