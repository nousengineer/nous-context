# Arquitetura Técnica - ThinkCoffee

## Stack Tecnológica
- **Backend**: Node.js com Express.js
- **Banco de Dados**: TypeORM com suporte a múltiplos bancos (não especificado no código atual)
- **Frontend**: React.js
- **Gerenciador de Pacotes**: PNPM
- **Testes**: Vitest
- **Containerização**: Docker

## Estrutura de Pastas
- **api/**: Endpoints e lógica de API
- **components/**: Componentes React reutilizáveis
- **entities/**: Modelos de dados do TypeORM
- **services/**: Serviços de lógica de negócios
- **src/**: Código principal do servidor
- **docs/**: Documentação
- **architecture/**: Arquivos de arquitetura técnica

## Contratos de API
- **GET /projects**: Retorna a lista de projetos
- **POST /projects**: Cria um novo projeto
- **GET /agents/status**: Retorna o status dos agentes (usado no frontend)

## Modelo de Dados
### Project
- **id**: Identificador único (número)
- **name**: Nome do projeto (string)
- **description**: Descrição do projeto (string)
- **createdAt**: Data de criação (timestamp)

### AgentStatus (Frontend)
- **id**: Identificador único (string)
- **name**: Nome do agente (string)
- **status**: Estado do agente (idle, running, success, error)
- **progress**: Progresso (número)
- **phase**: Fase atual (string)

## Melhorias Propostas
1. **Padronização de Nomes**: Garantir consistência nos nomes de arquivos e pastas.
2. **Documentação**: Expandir a documentação de contratos de API.
3. **Testes**: Adicionar cobertura de testes unitários e de integração.
4. **Configuração**: Centralizar configurações em arquivos `.env`.

---

Este documento será atualizado conforme o progresso do projeto.