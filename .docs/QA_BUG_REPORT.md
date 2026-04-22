# Relatório de Bugs - Testes Unitários e de Integração

## Resumo
Durante a execução dos testes unitários e de integração, foram identificados diversos erros que precisam ser corrigidos. Abaixo estão os detalhes dos problemas encontrados.

---

## Detalhes dos Bugs

### 1. **Erro no módulo `EventBus`**
- **Descrição:** O módulo `EventBus` não foi encontrado durante a execução dos testes.
- **Arquivo:** `packages/core/src/events/index.ts`
- **Linha:** 1
- **Mensagem de erro:** `Cannot find module './EventBus'`
- **Impacto:** Afeta a inicialização de eventos no pipeline.

### 2. **Falha no teste `ChatService > getUnread`**
- **Descrição:** O teste espera 2 mensagens não lidas, mas recebeu 3.
- **Arquivo:** `packages/core/src/__tests__/chat.test.ts`
- **Linha:** 213
- **Mensagem de erro:** `expected [ { id: '1', …(5) }, …(2) ] to have a length of 2 but got 3`
- **Impacto:** Afeta a funcionalidade de mensagens não lidas.

### 3. **Erro de parsing em `ChatService > getHistory`**
- **Descrição:** O teste falha ao lidar com linhas corrompidas no histórico de chat.
- **Arquivo:** `packages/core/src/__tests__/chat.test.ts`
- **Linha:** 2
- **Mensagem de erro:** `Chat line 2 parse error: Unexpected token 'i', "invalid json{" is not valid JSON`
- **Impacto:** Afeta a recuperação de histórico de chat.

### 4. **Falha no teste de integração `grok-migration-integration`**
- **Descrição:** Teste de integração falhou.
- **Arquivo:** `packages/core/src/__tests__/grok-migration-integration.test.ts`
- **Impacto:** Afeta a migração de dados no pipeline.

---

## Ações Recomendadas
1. **Corrigir o módulo `EventBus`:** Verificar se o arquivo `EventBus` está ausente ou mal referenciado.
2. **Ajustar o teste `getUnread`:** Validar a lógica de contagem de mensagens não lidas.
3. **Tratar erros de parsing no histórico de chat:** Implementar validação para lidar com entradas JSON inválidas.
4. **Revisar o teste de integração `grok-migration-integration`:** Garantir que os dados de migração estão consistentes.

---

## Conclusão
Os erros encontrados precisam ser corrigidos para garantir a estabilidade e funcionalidade do sistema. Recomenda-se priorizar os problemas críticos, como o módulo `EventBus` e os erros de parsing no chat.

---

**Autor:** QA Engineer
**Data:** [Insira a data atual]