# Configuração de CI/CD para ThinkCoffee

## Objetivo
Organizar o pipeline de CI/CD para o projeto ThinkCoffee, garantindo a automação de builds, testes e deploys.

## Estrutura do Pipeline
1. **Build**: Compilar o código e gerar a imagem Docker.
2. **Testes**: Executar testes unitários e de integração.
3. **Deploy**: Realizar o deploy em ambiente de produção.

## Ferramentas Utilizadas
- **GitHub Actions**: Para automação do CI/CD.
- **Docker**: Para containerização da aplicação.

## Exemplo de Workflow do GitHub Actions
```yaml
name: CI/CD Pipeline

on:
  push:
    branches:
      - main

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v2

      - name: Set up Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Build Docker image
        run: docker build -t thinkcoffee:latest .

      - name: Run tests
        run: npm test

      - name: Deploy
        run: echo "Deploying to production..."
```