# Guia de Execução de Testes - Migração Grok → GPT-4.1

## Overview

Este guia fornece instruções detalhadas para executar, validar e debugar a migração do Grok para GPT-4.1 no projeto ThinkCoffee.

---

## 1. Pré-requisitos

```bash
# Node.js >= 18.0.0
node --version

# pnpm >= 8.0.0
pnpm --version

# Dependências instaladas
pnpm install
```

---

## 2. Execução Rápida (Recomendado)

### Script automatizado (linux/mac)

```bash
# Executar validação completa
chmod +x scripts/validate-grok-migration.sh
./scripts/validate-grok-migration.sh
```

**Saída esperada:**
```
╔════════════════════════════════════════════════════════════════╗
║  ✓ VALIDAÇÃO CONCLUÍDA COM SUCESSO                            ║
║  Migração Grok → GPT-4.1 validada e pronta para deploy       ║
╚════════════════════════════════════════════════════════════════╝
```

**Arquivo de log:** `reports/grok-migration-test.log`

---

## 3. Execução Manual (Detalhado)

### 3.1 Testes unitários de configuração

```bash
cd packages/core

# Executar testes específicos de Grok migration
pnpm test -- src/__tests__/grok-migration.test.ts

# Resultado esperado: 27 testes passando
# PASS src/__tests__/grok-migration.test.ts (27)
```

**O que testa:**
- ✅ Remoção completa de Grok
- ✅ Integridade de modelos
- ✅ Consistência de custos
- ✅ Preservação de funcionalidades

### 3.2 Testes de integração

```bash
# Executar testes de integração
pnpm test -- src/__tests__/grok-migration-integration.test.ts

# Resultado esperado: 30 testes passando
# PASS src/__tests__/grok-migration-integration.test.ts (30)
```

**O que testa:**
- ✅ Criação de pipeline sem Grok
- ✅ Atribuição de modelos
- ✅ Pipeline workflow
- ✅ Regressão de funcionalidades
- ✅ Backward compatibility

### 3.3 Executar todos os testes (completo)

```bash
# Todos os testes do core package
pnpm test

# Resultado: Suite de testes completa
# PASS src/__tests__/grok-migration.test.ts (27)
# PASS src/__tests__/grok-migration-integration.test.ts (30)
# PASS src/__tests__/pipeline.test.ts (...)
# ...

# Total: 57+ testes passando
```

### 3.4 Testes com cobertura

```bash
# Cobertura de código
pnpm test -- --coverage

# Resultado esperado:
# ✓ agent-config.ts: 100%
# ✓ pipeline.ts: 95%+
# ✓ Overall: 99%
```

---

## 4. Validação Manual de Código

### 4.1 Buscar referências a Grok

```bash
# MacOS/Linux
grep -r "grok-code-fast-1\|grok-code-fast\|grok-2\|grok-1" \
  packages --include="*.ts" --include="*.tsx" --include="*.js"

# Resultado esperado: NENHUM MATCH (saída vazia)
```

```powershell
# Windows (PowerShell)
Get-ChildItem -Path packages -Include "*.ts", "*.tsx", "*.js" -Recurse `
  | Select-String -Pattern "grok-code-fast-1|grok-code-fast|grok-2|grok-1"

# Resultado esperado: NENHUM MATCH
```

### 4.2 Validar arquivo agent-config.ts

```bash
# Abrir arquivo e verificar:
# 1. Backend model em cafe-soluvel é gpt-5.4-mini
# 2. Nenhuma referência a "grok" em modelos
# 3. Ranking exclui grok

cat packages/core/src/agent-config.ts | grep -i "backend\|grok"

# Saída esperada:
# 'backend': 'gpt-5.4-mini',  // Mini capaz para code (REMOVIDO Grok)
```

---

## 5. Debugging

### 5.1 Teste falhando?

```bash
# Ver output detalhado
pnpm test -- src/__tests__/grok-migration.test.ts --reporter=verbose

# Ver stack trace completo
pnpm test -- src/__tests__/grok-migration.test.ts --reporter=verbose --trace-unhandled
```

### 5.2 Investigar falha específica

```bash
# Rodar um teste específico
pnpm test -- src/__tests__/grok-migration.test.ts -t "should not contain grok"

# Debugar com Node inspector
node --inspect-brk node_modules/vitest/vitest.mjs run src/__tests__/grok-migration.test.ts
```

### 5.3 Logs de execução

```bash
# Ver logs detalhados
cat reports/grok-migration-test.log

# Ou em tempo real
tail -f reports/grok-migration-test.log
```

---

## 6. Validação do Pipeline

### 6.1 Testar pipeline com cafe-soluvel

```typescript
// Criar arquivo temporário: test-pipeline.ts

import { PipelineService } from '@thinkcoffee/core/pipeline';
import { applyQualityPreset } from '@thinkcoffee/core/agent-config';

const service = new PipelineService();
const config = applyQualityPreset('cafe-soluvel');

console.log('Config aplicada:', config);
console.log('Backend model:', config.models['backend']);
// Esperado: gpt-5.4-mini (não grok)

const pipeline = service.create(
  'test-project',
  'Test objective',
  '/workspace'
);

console.log('Pipeline criado:', pipeline.id);
console.log('Status:', pipeline.status);
// Esperado: 'active'
```

```bash
# Executar
npx ts-node test-pipeline.ts

# Resultado esperado:
# Config aplicada: [Object]
# Backend model: gpt-5.4-mini
# Pipeline criado: [UUID]
# Status: active
```

### 6.2 Testar outras presets

```bash
# Executar com cada preset
for preset in cafe-soluvel coado-com-carinho espresso-duplo; do
  pnpm test -- -t "$preset" --reporter=verbose
done
```

---

## 7. Validação em CI/CD

### 7.1 GitHub Actions / GitLab CI

Adicionar ao seu workflow:

```yaml
# .github/workflows/grok-migration-validation.yml
name: Grok Migration Validation

on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'pnpm'
      
      - run: pnpm install
      
      - name: Run Grok Migration Tests
        run: |
          cd packages/core
          pnpm test -- src/__tests__/grok-migration.test.ts
          pnpm test -- src/__tests__/grok-migration-integration.test.ts
      
      - name: Generate Report
        if: always()
        run: cp packages/core/QA_VALIDATION_REPORT.md ./
      
      - name: Upload Report
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: qa-report
          path: QA_VALIDATION_REPORT.md
```

---

## 8. Geração de Relatório

### 8.1 Relatório HTML (se disponível)

```bash
# Gerar relatório em HTML
pnpm test -- --coverage --reporter=html

# Abrir em navegador
open coverage/index.html
```

### 8.2 Conteúdo dos relatórios

**Arquivo:** `packages/core/QA_VALIDATION_REPORT.md`
- Resumo da migração
- Resultados dos testes (57 testes)
- Problemas identificados
- Recomendações

**Arquivo:** `TEST_FUNCTIONALITY_CHECKLIST.md`
- Checklist de funcionalidades
- 12 categorias validadas
- Status de cada feature

**Arquivo:** `reports/grok-migration-test.log`
- Saída detalhada de cada teste
- Timestamps
- Erros e warnings

---

## 9. Performance & Benchmarking

### 9.1 Comparar performance dos modelos

```bash
# Benchmark: gpt-5.4-mini vs gpt-4.1
pnpm test -- src/__tests__/grok-migration.test.ts --duration

# Resultado: Tempo de execução de testes
```

### 9.2 Monitorar regressão de performance

```bash
# Baseline
pnpm test -- --coverage > baseline.txt

# Após mudanças
pnpm test -- --coverage > current.txt

# Comparar
diff baseline.txt current.txt
```

---

## 10. Troubleshooting

### Problema: Testes não encontram módulos

```bash
# Solução: Reconstruir
pnpm clean
pnpm install
pnpm build
pnpm test
```

### Problema: "grok-migration.test.ts not found"

```bash
# Verificar arquivo existe
ls -la packages/core/src/__tests__/grok-migration.test.ts

# Se não existir, copy do template
cp packages/core/src/__tests__/grok-migration.test.ts .
```

### Problema: Erro de tipo TypeScript

```bash
# Reconstruir types
cd packages/core
pnpm tsc --noEmit

# Verificar imports
grep -r "from.*agent-config\|from.*pipeline" src/__tests__
```

### Problema: Falhas aleatórias

```bash
# Rodar testes várias vezes
for i in {1..5}; do pnpm test; done

# Se consistentemente falha, debugar como em 5.2
```

---

## 11. Checklist Pré-Deploy

- [ ] Testes unitários passando (27/27)
- [ ] Testes de integração passando (30/30)
- [ ] Nenhuma referência a Grok no código
- [ ] Relatório gerado (`QA_VALIDATION_REPORT.md`)
- [ ] Cobertura > 95%
- [ ] Sem breaking changes
- [ ] Documentação atualizada
- [ ] Script CI/CD configurado
- [ ] Aprovado por code review
- [ ] Pronto para merge

---

## 12. Contato & Suporte

**Dúvidas sobre testes?**
- Arquivo: `packages/core/src/__tests__/grok-migration.test.ts`
- Arquivo: `packages/core/src/__tests__/grok-migration-integration.test.ts`

**Relatório de bugs?**
- Arquivo: `QA_VALIDATION_REPORT.md` (seção "Problemas Identificados")

**Detalhes técnicos?**
- Arquivo: `packages/core/src/agent-config.ts` (comentários explicativos)

---

**Status:** ✅ Pronto para validação  
**Última atualização:** 2024  
**Versão:** 1.0
