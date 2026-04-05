#!/usr/bin/env node
/**
 * ThinkCoffee API Server - Ponto de entrada HTTP
 * 
 * Inicia o servidor HTTP REST para persistencia do historico de chat.
 * 
 * Uso:
 *   node dist/start-api.js [port]
 * 
 * Variaveis de ambiente:
 *   PORT - Porta do servidor (default: 3456)
 *   THINKCOFFEE_DB_PATH - Caminho do banco SQLite
 *   THINKCOFFEE_DB_LOGGING - Habilita logs do TypeORM (true/false)
 */

import { startServer } from './server';

const port = parseInt(process.env.PORT || process.argv[2] || '3456', 10);

console.log(`[ThinkCoffee] Starting API server on port ${port}...`);

startServer(port).catch((err) => {
  console.error('[ThinkCoffee] Failed to start server:', err);
  process.exit(1);
});
