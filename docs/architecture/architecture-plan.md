# Plano de Arquitetura para Substituir o Grok

## Objetivo
Substituir o uso do Grok por uma solução gratuita e eficiente, mantendo a funcionalidade e a qualidade do pipeline.

---

## Stack Proposta
- **Linguagem**: TypeScript
- **Framework Backend**: Node.js com Express
- **IA Provider**: OpenAI API (modelos gratuitos como GPT-3.5-turbo)
- **Banco de Dados**: PostgreSQL
- **Ferramentas de Teste**: Vitest
- **Gerenciador de Pacotes**: pnpm
- **Containerização**: Docker

---

## Estrutura de Pastas
```
thinkcoffee/
├── docs/                # Documentação
├── packages/
│   ├── core/           # Lógica central
│   │   ├── src/
│   │   │   ├── agents/ # Abstração de agentes
│   │   │   ├── utils/  # Utilitários
│   │   │   └── index.ts
│   ├── vscode/         # Integração com VSCode
├── scripts/            # Scripts auxiliares
├── test/               # Testes unitários e de integração
└── docker-compose.yml  # Configuração de containers
```

---

## Abstração de Providers de IA
Criar uma camada de abstração para facilitar a troca de provedores de IA no futuro. Exemplo:

```typescript
// packages/core/src/agents/IAProvider.ts
export interface IAProvider {
  generateResponse(prompt: string): Promise<string>;
}

export class OpenAIProvider implements IAProvider {
  async generateResponse(prompt: string): Promise<string> {
    // Implementação usando OpenAI API
  }
}
```

---

## Contratos de API
### Endpoint: `/generate`
- **Método**: POST
- **Descrição**: Gera uma resposta baseada no prompt fornecido.
- **Request Body**:
  ```json
  {
    "prompt": "string"
  }
  ```
- **Response**:
  ```json
  {
    "response": "string"
  }
  ```

---

## Configurações Necessárias
1. **Chave de API**: Configurar a chave da OpenAI no `.env`.
2. **Docker**: Atualizar `docker-compose.yml` para incluir as dependências necessárias.
3. **Testes**: Criar testes unitários para validar a integração com o novo provider.

---

## Próximos Passos
1. Implementar a camada de abstração para provedores de IA.
2. Atualizar os arquivos de configuração para remover referências ao Grok.
3. Testar a nova integração com o OpenAI.
4. Documentar o processo de migração.

---

**Responsável**: Architect
**Data**: [Insira a data atual]