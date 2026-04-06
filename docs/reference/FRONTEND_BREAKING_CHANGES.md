# Ajuste de Interface: Substituição do modelo Grok

## Contexto
O preset `cafe-soluvel` estava usando o modelo `grok-code-fast-1` para backend, mas Grok não é gratuito. O correto é usar apenas modelos realmente gratuitos.

## Mudança aplicada
- O modelo do backend no preset `cafe-soluvel` deve ser alterado de `grok-code-fast-1` para `gpt-4.1`.

## Impacto no Frontend
- Não há breaking change na interface do usuário.
- O frontend apenas exibe e permite seleção dos modelos disponíveis conforme definidos em `QUALITY_PRESETS`.
- Nenhum componente ou integração precisa ser alterado, pois a troca é transparente para o usuário final.

## Ação
- Documentação atualizada para rastreabilidade.
- Nenhuma alteração de código frontend necessária.
