# REORGANIZATION.md

## Padrão de Organização Adotado

**Clean Architecture Modularizada**

- Separação clara entre domínio, infraestrutura, serviços, entidades e interfaces.
- Cada contexto (core, frontend, backend, extensão VSCode) isolado em seu pacote.
- Contratos, tipos e ferramentas dos agentes centralizados em `packages/core/src/agents`.
- Serviços, entidades e API organizados em subpastas específicas.

## Estrutura Antes

- src/
  - agents/
  - entities/
  - services/
  - components/
  - pages/
  - api/
  - index.ts
- packages/core/src/agents/
  - contracts/
  - tools/
  - config/
  - index.ts
- __tests__/
- packages/
- docs/
- ...

## Estrutura Depois

- packages/
  - core/
    - src/
      - agents/
        - contracts/
        - tools/
        - config/
        - index.ts
      - pipeline/
        - contracts/
        - index.ts
      - entities/
      - services/
      - api/
      - index.ts
  - cli/
  - mcp-server/
  - vscode/
- src/ (frontend)
  - components/
  - pages/
  - services/
  - entities/
  - api/
  - index.ts
- __tests__/
- docs/
- ...

## Mudanças Realizadas

1. **Padronização Clean Architecture Modularizada** para todos os pacotes.
2. **Centralização dos contratos, tipos e ferramentas dos agentes** em `packages/core/src/agents`.
3. **Separação clara de responsabilidades**: entidades, serviços, API, componentes e páginas em subpastas específicas.
4. **Remoção de arquivos soltos**: arquivos como `agent-config.ts`, `chat.ts`, `pipeline.ts` migrados para seus contextos corretos.
5. **Ajuste de nomes e imports** para refletir a nova estrutura.
6. **Documentação atualizada** neste arquivo.

## Observações

- Caso surjam novos domínios ou contextos, criar subpastas dentro de `packages/core/src`.
- Imports relativos foram ajustados para refletir a nova estrutura.
- Não houve remoção de código funcional, apenas reorganização estrutural.

---

Organização concluída conforme padrões profissionais e Clean Architecture.