# Reorganização do Projeto ThinkCoffee

## Padrão Escolhido
- **Padrão MVC (Model-View-Controller)** foi escolhido para organizar a estrutura do projeto.

## Estrutura Antes
```
__tests__/
api/
architecture/
components/
docker/
docs/
logs/
packages/
pages/
reports/
reviews/
scripts/
src/
index.ts
services/
entities/
```  

## Estrutura Depois
```
__tests__/
api/
architecture/
components/
docker/
docs/
logs/
packages/
pages/
reports/
reviews/
scripts/
src/
  ├── controllers/
  ├── entities/
  ├── routes/
  ├── services/
  ├── middlewares/
  ├── config/
  ├── utils/
  └── index.ts
```  

## Lista de Mudanças
- Criadas pastas para `controllers`, `routes`, `middlewares`, `config`, `utils` dentro de `src/`.
- Implementado o padrão MVC com a criação de `ProjectController`, `projectRoutes` e reorganização do `index.ts`.
- Arquivos foram movidos e reestruturados para seguir o padrão escolhido.