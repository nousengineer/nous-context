# Arquitetura e Solução para Persistência e Recuperação do Histórico de Chat

## Contexto Atual
O projeto ThinkCoffee possui uma extensão para o Visual Studio Code que implementa um sistema de chat. A análise do código revelou que o histórico de mensagens é gerenciado pelas classes `ChatPanel` e `ChatViewProvider`, localizadas no diretório `packages/vscode/src/chat/`.

### Pontos Relevantes do Código
1. **Histórico de Mensagens:**
   - O histórico é recuperado através do método `getHistory` da classe `ChatService`.
   - As mensagens são enviadas para o front-end via `postMessage`.

2. **Persistência:**
   - Não há evidências claras de persistência em disco ou banco de dados para o histórico de mensagens.
   - O histórico parece ser mantido apenas em memória, o que explica a perda de dados ao reiniciar a extensão.

3. **Recuperação:**
   - A recuperação do histórico é limitada ao escopo da execução atual da extensão.

## Problemas Identificados
1. **Volatilidade do Histórico:**
   - O histórico é perdido ao fechar o VSCode ou reiniciar a extensão.

2. **Ausência de Persistência:**
   - Não há integração com um sistema de armazenamento persistente (ex.: banco de dados ou arquivos).

3. **Escalabilidade:**
   - A abordagem atual não suporta grandes volumes de mensagens devido à limitação de memória.

## Solução Proposta
### Objetivos
1. Implementar persistência para o histórico de mensagens.
2. Garantir recuperação eficiente do histórico ao reiniciar a extensão.
3. Suportar grandes volumes de mensagens de forma escalável.

### Arquitetura Proposta
1. **Persistência em Arquivo:**
   - Utilizar o sistema de arquivos local para armazenar o histórico em formato JSON.
   - Criar um diretório `data/` na raiz do workspace para armazenar os arquivos de histórico.

2. **Estrutura de Dados:**
   - Cada histórico será armazenado em um arquivo separado, nomeado com base no ID do pipeline ou sessão.
   - Exemplo: `data/chat_history_<pipelineId>.json`.

3. **Integração com `ChatService`:**
   - Adicionar métodos para salvar e carregar o histórico de mensagens.
   - Modificar os métodos `clear` e `getHistory` para interagir com o sistema de arquivos.

4. **Recuperação Automática:**
   - Ao iniciar a extensão, carregar automaticamente o histórico do arquivo correspondente.

### Estrutura de Pastas
```plaintext
thinkcoffee/
├── data/
│   ├── chat_history_<pipelineId>.json
├── packages/
│   ├── vscode/
│   │   ├── src/
│   │   │   ├── chat/
│   │   │   │   ├── ChatPanel.ts
│   │   │   │   ├── ChatViewProvider.ts
```

### Contratos de API
#### Métodos Adicionados ao `ChatService`
```typescript
/** Salva o histórico atual em um arquivo JSON */
saveHistoryToFile(pipelineId: string): void;

/** Carrega o histórico de um arquivo JSON */
loadHistoryFromFile(pipelineId: string): void;
```

### Modelo de Dados
```typescript
interface ChatMessage {
  id: string;
  sender: string;
  senderLabel: string;
  content: string;
  type: 'request' | 'response' | 'error' | 'info';
  timestamp: number;
}
```

## Próximos Passos
1. Implementar os métodos de persistência no `ChatService`.
2. Modificar `ChatPanel` e `ChatViewProvider` para utilizar os novos métodos.
3. Testar a solução em diferentes cenários (ex.: reinício da extensão, grandes volumes de mensagens).

---

Este documento será atualizado conforme o progresso da implementação.