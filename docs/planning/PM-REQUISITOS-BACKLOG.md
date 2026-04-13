# ThinkCoffee — Requisitos, Critérios de Aceite e Backlog Prioritário

## Objetivo
Organizar e proteger a documentação e código do projeto ThinkCoffee, garantindo segurança, rastreabilidade e controle total sobre modificações feitas por agentes, via pipeline automatizado.

---

## 1. Requisitos Estruturados

- **REQ-01:** Log estruturado de todas as ações de tools (ActionLogService)
- **REQ-02:** Snapshot automático antes de qualquer modificação (SnapshotService)
- **REQ-03:** Comando de rollback para restaurar estado anterior
- **REQ-04:** Modo dry-run para simulação sem efeitos colaterais
- **REQ-05:** Diff preview antes de gravar arquivos (VSCode)
- **REQ-06:** Confirmação interativa para comandos shell destrutivos
- **REQ-07:** safePath centralizado e corrigido (proteção path traversal)
- **REQ-08:** Tools extraídas e centralizadas no core
- **REQ-09:** Garbage collector de snapshots antigos
- **REQ-10:** Testes unitários e de integração (>=80% cobertura)

---

## 2. Critérios de Aceite

- Cada requisito tem critérios claros, exemplos:
  - Toda tool call gera entrada no log (JSONL)
  - Snapshot ocorre antes de qualquer escrita/deleção
  - Rollback restaura arquivos modificados, deleta criados, restaura deletados
  - Dry-run não altera arquivos, apenas simula
  - Diff preview mostra alterações antes de gravar
  - safePath bloqueia path traversal em todos os contextos
  - Testes cobrem >=80% dos fluxos críticos

---

## 3. Backlog Priorizado

1. **P0** — Fundacional/Safety
   - REQ-07: safePath centralizado
   - REQ-01: ActionLogService
   - REQ-02: SnapshotService
   - REQ-03: RollbackService
   - REQ-04: Dry-run mode
2. **P1** — UX/Segurança
   - REQ-05: Diff preview
   - REQ-06: Confirmação comandos shell
   - REQ-10: Testes unitários
3. **P2** — Arquitetura/Manutenção
   - REQ-08: Tools centralizadas
   - REQ-09: Garbage collector snapshots

---

## 4. User Stories

- US-01: Como dev, quero log de todas as ações dos agentes (REQ-01)
- US-02: Como dev, quero snapshot automático antes de modificações (REQ-02)
- US-03: Como dev, quero rollback de fase do pipeline (REQ-03)
- US-04: Como dev, quero dry-run para simular pipeline (REQ-04)
- US-05: Como dev, quero diff preview antes de gravar (REQ-05)
- US-06: Como dev, quero confirmação antes de comandos destrutivos (REQ-06)
- US-07: Como dev, quero proteção path traversal (REQ-07)
- US-08: Como contribuidor, quero tools centralizadas (REQ-08)
- US-09: Como dev, quero limpeza automática de snapshots (REQ-09)
- US-10: Como contribuidor, quero testes robustos (REQ-10)

---

## 5. Referências
- docs/planning/PM-BACKLOG.md
- docs/planning/PM-USER-STORIES.md
- docs/planning/PM-SPRINT-PLAN.md

---

Este documento consolida os requisitos, critérios de aceite e backlog priorizado para a organização e proteção da documentação/código do ThinkCoffee.
