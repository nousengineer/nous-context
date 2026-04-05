#!/usr/bin/env node
/**
 * ThinkCoffee Integration Test
 * Tests core services, CRUD operations, search, export, and cascade delete.
 */
const {
  getDatabase,
  ProjectService,
  ContextService,
  DecisionService,
  exportProject,
  getExportFilename,
} = require('../packages/core/dist');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}`);
    failed++;
  }
}

async function main() {
  console.log('\n=== ThinkCoffee Integration Tests ===\n');

  // --- Database ---
  console.log('Database:');
  const db = await getDatabase();
  assert(db.isInitialized, 'Database initializes');

  const ps = new ProjectService(db);
  const cs = new ContextService(db);
  const ds = new DecisionService(db);

  // --- Project CRUD ---
  console.log('\nProject CRUD:');
  const project = await ps.create({ name: 'test-project', description: 'Integration test project' });
  assert(project.id && project.name === 'test-project', 'Create project');

  const fetched = await ps.get(project.id);
  assert(fetched && fetched.name === 'test-project', 'Get project by ID');

  const byName = await ps.findByName('test-project');
  assert(byName && byName.id === project.id, 'Find project by name');

  const allProjects = await ps.list();
  assert(allProjects.length >= 1, 'List projects');

  // --- Context CRUD ---
  console.log('\nContext CRUD:');
  const ctx1 = await cs.create({
    projectId: project.id,
    key: 'tech-stack',
    value: 'Node.js, TypeScript, SQLite',
    category: 'architecture',
    priority: 3,
  });
  assert(ctx1.id && ctx1.key === 'tech-stack', 'Create context entry');

  const ctx2 = await cs.create({
    projectId: project.id,
    key: 'data-storage',
    value: 'SQLite with TypeORM',
    category: 'dependencies',
    priority: 2,
  });
  assert(ctx2.id, 'Create second context entry');

  const ctxList = await cs.listByProject(project.id);
  assert(ctxList.length === 2, 'List context entries');

  const filtered = await cs.listByProject(project.id, 'architecture');
  assert(filtered.length === 1 && filtered[0].key === 'tech-stack', 'Filter by category');

  const updated = await cs.update(ctx1.id, { priority: 4 });
  assert(updated.priority === 4, 'Update context entry');

  // --- Search ---
  console.log('\nSearch:');
  const results = await cs.search(project.id, 'TypeScript');
  assert(results.length === 1 && results[0].key === 'tech-stack', 'Search context by keyword');

  const noResults = await cs.search(project.id, 'xyznonexistent');
  assert(noResults.length === 0, 'Search returns empty for no match');

  // --- Decision CRUD ---
  console.log('\nDecision CRUD:');
  const dec = await ds.create({
    projectId: project.id,
    title: 'Use MCP Protocol',
    description: 'Use Model Context Protocol for AI integration',
  });
  assert(dec.id && dec.title === 'Use MCP Protocol', 'Create decision');

  const decs = await ds.listByProject(project.id);
  assert(decs.length === 1, 'List decisions');

  const updatedDec = await ds.update(dec.id, { status: 'deprecated' });
  assert(updatedDec.status === 'deprecated', 'Update decision status');

  // --- Export ---
  console.log('\nExport:');
  const full = await ps.get(project.id);
  
  const md = exportProject(full, 'markdown');
  assert(md.includes('# test-project') && md.includes('tech-stack'), 'Export markdown');

  const json = exportProject(full, 'json');
  const parsed = JSON.parse(json);
  assert(parsed.project && parsed.project.name === 'test-project', 'Export JSON');

  const plain = exportProject(full, 'plain');
  assert(plain.toUpperCase().includes('TEST-PROJECT'), 'Export plain text');

  const copilot = exportProject(full, 'copilot');
  assert(copilot.includes('tech-stack'), 'Export copilot format');

  const claude = exportProject(full, 'claude');
  assert(claude.includes('tech-stack'), 'Export claude format');

  const cursor = exportProject(full, 'cursor');
  assert(cursor.includes('tech-stack'), 'Export cursor format');

  assert(getExportFilename('copilot', 'test') === '.github/copilot-instructions.md', 'Copilot filename');
  assert(getExportFilename('claude', 'test') === 'CLAUDE.md', 'Claude filename');
  assert(getExportFilename('cursor', 'test') === '.cursorrules', 'Cursor filename');

  // --- Cascade Delete ---
  console.log('\nCascade Delete:');
  await ps.delete(project.id);
  const afterDelete = await ps.list();
  assert(!afterDelete.find(p => p.id === project.id), 'Project deleted');

  const orphanCtx = await cs.listByProject(project.id);
  assert(orphanCtx.length === 0, 'Context entries cascade-deleted');

  const orphanDec = await ds.listByProject(project.id);
  assert(orphanDec.length === 0, 'Decisions cascade-deleted');

  // --- Summary ---
  await db.destroy();
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
