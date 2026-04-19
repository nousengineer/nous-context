# Tarefa: Corrigir `markRead` em `packages/core/src/chat.ts`

## Problema identificado

O método `markRead(messageId)` na linha ~97 de `packages/core/src/chat.ts` tem dois problemas sérios:

### 1. Performance O(n) desnecessária
Toda vez que uma mensagem é marcada como lida, o método:
- Lê o arquivo JSONL inteiro na memória
- Reescreve o arquivo inteiro com todas as mensagens

Para um chat com 1000 mensagens, marcar 1 como lida relê e reescreve tudo.

### 2. Race condition
O arquivo `.jsonl` é append-only por design, mas `markRead` faz uma reescrita completa (`writeFileSync`).
Se dois processos (ex: Claude Desktop + Cursor) chamarem `markRead` simultaneamente, o segundo sobrescreve o trabalho do primeiro — mensagens podem ser perdidas.

---

## Solução proposta

Adotar um arquivo separado de "lidos": `default.read.json`

```
~/.thinkcoffee/chat/default.jsonl       ← append-only, nunca reescrito
~/.thinkcoffee/chat/default.read.json   ← { "ids": Set<string> }
```

### Implementação

```typescript
// Caminho do arquivo de lidos
private readFile: string;

constructor(channel: string = 'default') {
  this.filePath = getChatFile(channel);
  this.backupPath = getBackupFile(channel);
  this.readFile = path.join(getChatDir(), `${channel.replace(/[^a-zA-Z0-9_-]/g, '_')}.read.json`);
  if (!fs.existsSync(this.filePath)) {
    fs.writeFileSync(this.filePath, '', 'utf-8');
  }
}

private getReadIds(): Set<string> {
  try {
    const raw = fs.readFileSync(this.readFile, 'utf-8');
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

private saveReadIds(ids: Set<string>): void {
  fs.writeFileSync(this.readFile, JSON.stringify([...ids]), 'utf-8');
}

markRead(messageId: string): void {
  const ids = this.getReadIds();
  ids.add(messageId);
  this.saveReadIds(ids);
}

markAllRead(): void {
  const msgs = this.getHistory();
  const ids = this.getReadIds();
  for (const m of msgs) {
    if (m.sender === 'programmer') ids.add(m.id);
  }
  this.saveReadIds(ids);
}

getUnread(): ChatMessage[] {
  const readIds = this.getReadIds();
  return this.getHistory().filter(m =>
    m.sender === 'programmer' && m.type === 'request' && !readIds.has(m.id)
  );
}
```

### Benefícios
- `markRead` vira O(1) no arquivo de lidos — não toca o JSONL principal
- O JSONL principal fica append-only para sempre — sem risco de corrupção
- Dois processos podem marcar mensagens como lidas simultaneamente sem conflito

---

## Arquivos a modificar
- `packages/core/src/chat.ts` — implementar a solução acima

Por favor implemente e faça o build com `pnpm build`.
