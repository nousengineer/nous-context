# Build e Instalacao da Extensao VS Code

## Pre-requisitos

- Node.js >= 18
- pnpm (gerenciador de pacotes do monorepo)

## 1. Instalar dependencias (raiz do monorepo)

```bash
cd thinkcoffee
pnpm install
```

## 2. Build do core (dependencia da extensao)

```bash
pnpm --filter @thinkcoffee/core build
```

## 3. Build da extensao

```bash
cd packages/vscode
node esbuild.js
```

Saida esperada:

```
Copied sqlite3 to dist/native/
Copied bindings to dist/native/
Copied file-uri-to-path to dist/native/
Build successful!
```

## 4. Empacotar VSIX

```bash
cd packages/vscode
pnpm exec vsce package --no-dependencies
```

Gera `thinkcoffee-vscode-1.0.0.vsix` no diretorio atual.

## 5. Instalar no VS Code

```bash
code --install-extension thinkcoffee-vscode-1.0.0.vsix --force
```

Reinicie o VS Code apos a instalacao.

## Comando unico (build + package + install)

```bash
cd packages/vscode
node esbuild.js && pnpm exec vsce package --no-dependencies && code --install-extension thinkcoffee-vscode-1.0.0.vsix --force
```

## Notas

- O `esbuild.js` copia automaticamente as dependencias nativas (sqlite3, bindings, file-uri-to-path) para `dist/native/`
- O `vsce package` executa o script `vscode:prepublish` que roda `node esbuild.js` novamente
- Use `pnpm exec vsce` para garantir que o binario da versao do lockfile seja utilizado
- A flag `--no-dependencies` evita bundlar dependencias do workspace no VSIX
