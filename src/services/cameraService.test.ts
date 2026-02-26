import { CameraService } from './cameraService.js';

// Simple test helpers
function assertEqual(actual: any, expected: any, message?: string) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assert(condition: any, message?: string) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

// In-memory mock storage
function createMockStorage() {
  const store: Record<string, string> = {};
  return {
    getItem(key: string) {
      return store[key] ?? null;
    },
    setItem(key: string, value: string) {
      store[key] = value;
    },
    removeItem(key: string) {
      delete store[key];
    },
    clear() {
      for (const k of Object.keys(store)) delete store[k];
    }
  } as Storage;
}

test('CameraService: save and load position', () => {
  const storage = createMockStorage();
  const svc = new CameraService(storage);

  const id = svc.savePosition('Test Pos', { alpha: 1, beta: 0.5, radius: 20, target: { x: 0, y: 1, z: 2 } });
  assert(id !== null, 'Expected id to be returned');

  const list = svc.listPositions();
  assertEqual(list.length, 1);

  const loaded = svc.loadPosition(id!);
  assert(loaded !== null, 'Loaded should not be null');
  assertEqual(loaded!.name, 'Test Pos');
  assertEqual(loaded!.alpha, 1);
});

test('CameraService: delete position', () => {
  const storage = createMockStorage();
  const svc = new CameraService(storage);
  const id = svc.savePosition('ToDelete', { alpha: 0, beta: 0, radius: 10, target: { x: 0, y: 0, z: 0 } });
  assert(id !== null);
  const ok = svc.deletePosition(id!);
  assertEqual(ok, true);
  assertEqual(svc.listPositions().length, 0);
});

test('CameraService: export and import single position', () => {
  const storage = createMockStorage();
  const svc = new CameraService(storage);
  const id = svc.savePosition('ExportMe', { alpha: 0.2, beta: 0.3, radius: 15, target: { x: 1, y: 2, z: 3 } });
  const exported = svc.exportPosition(id!);
  assert(typeof exported === 'string');

  // Import into a fresh service
  const storage2 = createMockStorage();
  const svc2 = new CameraService(storage2);
  const newId = svc2.importPosition(exported!);
  assert(newId !== null, 'Import should return new id');
  assertEqual(svc2.listPositions().length, 1);
});

test('CameraService: tier limits (free = 3)', () => {
  const storage = createMockStorage();
  const svc = new CameraService(storage);
  svc.setTier('free');
  for (let i = 0; i < 3; i++) {
    const id = svc.savePosition(`P${i}`, { alpha: i, beta: i, radius: 10 + i, target: { x: 0, y: 0, z: 0 } });
    assert(id !== null);
  }
  const fourth = svc.savePosition('P3', { alpha: 0, beta: 0, radius: 0, target: { x: 0, y: 0, z: 0 } });
  assertEqual(fourth, null);
});

test('CameraService: events on add/delete', () => {
  const storage = createMockStorage();
  const svc = new CameraService(storage);
  let added = 0;
  const unsub = svc.on('positionAdded', () => { added += 1; });
  svc.savePosition('E1', { alpha: 0, beta: 0, radius: 10, target: { x: 0, y: 0, z: 0 } });
  assertEqual(added, 1);
  unsub();
  svc.savePosition('E2', { alpha: 0, beta: 0, radius: 10, target: { x: 0, y: 0, z: 0 } });
  assertEqual(added, 1);
});

console.log('\nCameraService tests passed! ✓');
