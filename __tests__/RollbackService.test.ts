import { DataSource } from 'typeorm';
import { RollbackService } from '../src/services/RollbackService';
import { SnapshotService } from '../src/services/SnapshotService';
import { ActionLogService } from '../src/services/ActionLogService';

describe('RollbackService', () => {
  let db: DataSource;
  let rollbackService: RollbackService;
  let snapshotService: SnapshotService;
  let actionLogService: ActionLogService;

  beforeAll(async () => {
    db = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [],
      synchronize: true,
    });
    await db.initialize();

    snapshotService = new SnapshotService(db);
    actionLogService = new ActionLogService(db);
    rollbackService = new RollbackService(snapshotService, actionLogService);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('should perform a rollback', async () => {
    const snapshot = await snapshotService.createSnapshot('test-snapshot');
    expect(snapshot).toBeDefined();

    const rollbackResult = await rollbackService.rollback(snapshot.id);
    expect(rollbackResult.success).toBe(true);
  });

  it('should throw an error for invalid snapshot', async () => {
    await expect(rollbackService.rollback('invalid-id')).rejects.toThrow('Snapshot not found');
  });
});