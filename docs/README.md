# Documentação - ThinkCoffee

> Estrutura profissional de documentação do projeto ThinkCoffee, organizada por tema e contexto.

## 📋 Índice de Conteúdo

Este diretório contém toda a documentação do projeto, organizada em 6 categorias principais para facilitar navegação e manutenção.

---

## 📚 Estrutura de Diretórios

### 📖 [guides/](guides/) - Guias e Tutoriais
Documentação prática e procedimentos operacionais do projeto.

| Arquivo | Descrição |
|---------|-----------|
| **TUTORIAL.md** | Tutorial completo de introdução ao ThinkCoffee |
| **DEPLOY_GUIDE.md** | Guia passo-a-passo para deployment em produção |
| **DEPLOYMENT.md** | Procedimentos de deployment e release |
| **BACKUP_PROCESS.md** | Processo de backup e recuperação de dados |
| **MONITORING.md** | Monitoramento, alertas e métricas do sistema |

**Use quando:** Precisar de instruções práticas de como fazer algo no projeto.

---

### 🏗️ [architecture/](architecture/) - Arquitetura e Design
Documentação técnica sobre a arquitetura e design do sistema.

| Arquivo | Descrição |
|---------|-----------|
| **TECH-ARCH-V4.md** | Especificação técnica de arquitetura (v4 - mais recente) |
| **TECH-ARCH-V3.md** | Especificação técnica de arquitetura (v3) |
| **thinkcoffee_architecture.md** | Visão geral da arquitetura do ThinkCoffee |
| **architecture-plan.md** | Plano de arquitetura e evolução do sistema |
| **ARCH-GUARDRAILS.md** | Guardrails e restrições arquiteturais |

**Use quando:** Necessário entender a estrutura técnica, componentes e fluxos do sistema.

---

### 📊 [planning/](planning/) - Planejamento e Roadmap
Documentação de planejamento, backlog e roadmap do projeto.

| Arquivo | Descrição |
|---------|-----------|
| **PM-BACKLOG.md** | Product Backlog consolidado e priorizado (versão final) |
| **PM-SPRINT-PLAN.md** | Plano de sprints e ciclos de desenvolvimento (versão final) |
| **PM-USER-STORIES.md** | User stories do projeto (versão final) |

**Use quando:** Planejando features, analisando roadmap ou consultando backlogs.

**Nota:** Mantém apenas versões final consolidadas. Versões antigas (V2) foram removidas.

---

### 🔍 [diagnostics/](diagnostics/) - Diagnósticos e Setup
Documentação técnica sobre diagnósticos, setup de infraestrutura e troubleshooting.

| Arquivo | Descrição |
|---------|-----------|
| **DIAG-002-setup-infrastructure-final.md** | Diagnóstico final de setup de infraestrutura |
| **setup-infrastructure-diagnostico.md** | Diagnóstico detalhado de infraestrutura |
| **diagnostico-setup-infrastructure.md** | Procedimento de diagnóstico de setup |
| **analise-perda-historico.md** | Análise de perda de histórico - casos e soluções |
| **backend-implement-failure.md** | Diagnóstico de falhas de implementação backend |
| **frontend-implementation-failure.md** | Diagnóstico de falhas de implementação frontend |
| **FRONTEND-FAILURE-DIAGNOSIS.md** | Diagnóstico de falhas frontend |
| **frontend-correction-plan.md** | Plano de correção de issues frontend |

**Use quando:** Investigando problemas, fazendo troubleshooting ou analisando diagnósticos técnicos.

---

### ✅ [reviews/](reviews/) - Code Reviews e Auditorias
Documentação de revisões de código e auditorias técnicas.

| Arquivo | Descrição |
|---------|-----------|
| **CODE-REVIEW-FINAL.md** | Revisão de código final consolidada |

**Use quando:** Consultando resultados de code reviews e auditorias técnicas.

---

### 📝 [reference/](reference/) - Referência Geral
Documentação de referência, mudanças especiais e suplementar.

| Arquivo | Descrição |
|---------|-----------|
| **HISTORY_IMPLEMENTATION.md** | Documentação sobre implementação de histórico |
| **FRONTEND_BREAKING_CHANGES.md** | Mudanças breaking no frontend |
| **restore_chat_history_plan.md** | Procedimento de recovery de histórico de chat |
| **restore_history_status.json** | Status do restore de histórico |

**Use quando:** Consultando mudanças especiais, histórico de implementações ou documentação suplementar.

---

## 📌 Diretrizes para Manutenção

### Adicionando Nova Documentação

1. **Identifique a categoria** - Qual dos 6 diretórios é mais apropriado?
2. **Siga o padrão de nomenclatura:**
   - Use `UPPERCASE-SEPARATED.md` para documentos principais
   - Use `lowercase-separated.md` para documentação suplementar
3. **Atualize o README.md** quando adicionar novos arquivos
4. **Evite versões** - Use V3 ou V4 apenas em transições maiores

### Removendo Documentação Obsoleta

- Versões antigas (V2) são removidas regularmente
- Mantenha apenas versões finais (V3+) em planejamento
- Consolidate duplicatas antes de manter ambas as versões

### Consolidação de Versões

Quando um arquivo tem múltiplas versões:
1. Identifique qual é a mais recente e relevante
2. Archive ou delete versões antigas
3. Renomeie para remover o sufixo de versão (ex: V3 → sem sufixo)

---

## 🔗 Navegação Rápida

```
docs/
├── README.md (você está aqui)
├── guides/                          # 📖 Como fazer coisas
├── architecture/                    # 🏗️ Design técnico
├── planning/                        # 📊 Roadmap e backlog
├── diagnostics/                     # 🔍 Troubleshooting
├── reviews/                         # ✅ Quality assurance
└── reference/                       # 📝 Documentação suplementar
```

---

## 📞 Suporte

Para dúvidas sobre:
- **Como usar o projeto** → Consulte `guides/TUTORIAL.md`
- **Arquitetura técnica** → Consulte `architecture/`
- **Issues técnicos** → Consulte `diagnostics/`
- **Roadmap e planejamento** → Consulte `planning/`

---

**Última atualização:** 2026-04-06  
**Versão de documentação:** 1.0 (Reorganizada)
