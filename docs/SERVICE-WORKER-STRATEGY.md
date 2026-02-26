# Service Worker & Asset Loading Strategy

**Document Version**: 1.0
**Last Updated**: 2026-02-24
**Status**: Planning & Implementation Roadmap

This document outlines the comprehensive strategy for service workers, asset loading, and performance optimization for BISCUITS, with special focus on multiplayer readiness and progressive enhancement.

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Asset Loading Strategy](#asset-loading-strategy)
3. [Progressive Loading Patterns](#progressive-loading-patterns)
4. [Service Worker Enhancements](#service-worker-enhancements)
5. [Loading Screen Integration](#loading-screen-integration)
6. [Multiplayer Considerations](#multiplayer-considerations)
7. [Performance Metrics](#performance-metrics)
8. [Implementation Phases](#implementation-phases)

---

## Current State Analysis

### Existing Infrastructure

**Service Worker** (`public/sw.js`):
- ✅ Basic service worker registration
- ✅ Cache-first strategy for assets
- ✅ Network-first strategy for API calls
- ✅ Runtime caching for discovered assets
- ✅ Old cache cleanup on activation
- ⚠️ Minimal precache list (only HTML + manifest)
- ⚠️ No progress reporting
- ⚠️ No versioning strategy
- ⚠️ No compression support

**PWA Service** (`src/services/pwa.ts`):
- ✅ Service worker registration and lifecycle
- ✅ Install prompt management
- ✅ Update notifications
- ✅ Periodic update checks (hourly)
- ✅ Manual asset precaching via postMessage
- ⚠️ No loading progress tracking
- ⚠️ No asset size awareness

**Asset Structure**:
```
Bundle Sizes (production):
- babylonjs.js: ~5.1MB (core 3D engine)
- loaders.js: ~213KB (glTF + texture loaders)
- index.js: ~119KB (game code)
- Total gzipped: ~1.2MB

Theme Assets (per theme):
- Geometry: ~500KB (glTF models for d4-d20)
- Textures: ~2-4MB total
  - Diffuse: ~1MB
  - Normal: ~1MB
  - Specular: ~500KB-1MB
  - Fallback theme: additional 2-4MB

Audio Assets:
- Music: ~2-5MB per track
- SFX: ~10-50KB per sound
- Total: ~5-10MB

Total First Load: ~10-15MB (uncompressed)
```

### Current Loading Flow

1. Browser requests `index.html`
2. HTML loads, service worker registers
3. Core JS bundles load (5.5MB total)
4. BabylonJS engine initializes
5. Splash screen displays
6. User clicks "Start Game"
7. Theme system loads (async):
   - Fetch theme config
   - Load geometry (~500KB)
   - Load textures (~2-4MB)
8. Scene renders, game starts

**Problem**: Steps 7-8 are **synchronous** and **blocking**. User sees nothing happening for 2-5 seconds.

---

## Asset Loading Strategy

### Asset Classification

#### Critical Assets (Precache on SW Install)
Must be available immediately for app to function:
- `index.html`
- `manifest.json`
- Core JS bundles (`babylonjs.js`, `loaders.js`, `index.js`)
- Essential CSS (`styles.css`)
- App icons (192px, 512px)
- Loading screen assets (minimal)

**Size**: ~5.5MB
**Strategy**: Precache on service worker install
**Cache Duration**: Until new version deployed

#### High-Priority Assets (Eager Load)
Needed for first game experience:
- Default theme geometry
- Default theme textures (1 theme only)
- Essential audio (click sounds, basic roll SFX)
- Player avatar placeholder textures

**Size**: ~3-5MB
**Strategy**: Load during splash screen, cache on first access
**Cache Duration**: 7 days, stale-while-revalidate

#### Low-Priority Assets (Lazy Load)
Load on-demand or in background:
- Alternative themes (geometry + textures)
- Music tracks
- Additional audio variations
- Future: Player avatar images
- Future: Multiplayer assets

**Size**: ~10-20MB total
**Strategy**: Cache on first use, background prefetch when idle
**Cache Duration**: 30 days, cache-first with network fallback

#### Never Cache
Always fetch fresh from network:
- API calls (`/api/*`)
- Leaderboard data
- Player profiles (future)
- Real-time game state (multiplayer)
- Analytics/telemetry
- Service worker itself

**Strategy**: Network-only or network-first with short TTL

---

## Progressive Loading Patterns

### PRPL Pattern Implementation

**P**reload → **R**ender → **P**re-cache → **L**azy-load

#### Phase 1: Preload Critical Resources
```javascript
// Service Worker Install Event
const CRITICAL_ASSETS = [
  './index.html',
  './manifest.json',
  './assets/index-[hash].js',      // Core game code
  './assets/babylonjs-[hash].js',  // BabylonJS core
  './assets/loaders-[hash].js',    // glTF loaders
  './assets/index-[hash].css',     // Styles
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CRITICAL_ASSETS))
      .then(() => self.skipWaiting())
  );
});
```

**Result**: App shell loads instantly (cached, ~5.5MB)

#### Phase 2: Render Initial Route Quickly
```javascript
// Splash screen displays with minimal dependencies
// Shows immediately using cached assets
// No blocking asset loads
```

**Result**: User sees splash screen in < 500ms

#### Phase 3: Pre-cache Remaining Assets
```javascript
// After splash screen renders, start loading game assets
async function precacheGameAssets() {
  const assets = [
    './assets/themes/default/dice.gltf',
    './assets/themes/default/diffuse.png',
    './assets/themes/default/normal.png',
    './assets/audio/roll.mp3',
    './assets/audio/click.mp3',
  ];

  // Load with progress reporting
  for (let i = 0; i < assets.length; i++) {
    await fetch(assets[i]);
    reportProgress((i + 1) / assets.length * 100);
  }
}
```

**Result**: Loading screen shows progress, 2-5 seconds

#### Phase 4: Lazy-load Non-essential Assets
```javascript
// After game starts, prefetch other themes in background
async function prefetchAlternativeThemes() {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      // Load other themes when browser is idle
      prefetchTheme('gemstone');
      prefetchTheme('rust');
    });
  }
}
```

**Result**: Alternative themes available instantly when selected

---

## Service Worker Enhancements

### Recommended Improvements

#### 1. Workbox Integration

**Why**: Industry-standard SW library with battle-tested strategies

```javascript
// Replace custom SW with Workbox
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

// Precache assets (auto-generated by Workbox CLI)
precacheAndRoute(self.__WB_MANIFEST);

// Theme assets: Cache-first with expiration
registerRoute(
  ({ url }) => url.pathname.includes('/assets/themes/'),
  new CacheFirst({
    cacheName: 'theme-assets',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
      }),
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
  })
);

// Audio: Stale-while-revalidate
registerRoute(
  ({ url }) => url.pathname.includes('/audio/'),
  new StaleWhileRevalidate({
    cacheName: 'audio-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 30,
        maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
      }),
    ],
  })
);

// API: Network-first with timeout
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-cache',
    networkTimeoutSeconds: 5,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 5 * 60, // 5 minutes
      }),
    ],
  })
);
```

**Benefits**:
- Battle-tested caching strategies
- Automatic cache versioning
- Built-in expiration management
- TypeScript support
- Better debugging tools

#### 2. IndexedDB for Large Assets

**Why**: Service Worker cache has size limits (~50MB), IndexedDB is unlimited

```javascript
// Store large assets in IndexedDB
import { openDB } from 'idb';

const ASSET_DB_NAME = 'biscuits-assets';
const ASSET_STORE = 'large-assets';

async function cacheToIndexedDB(url, blob) {
  const db = await openDB(ASSET_DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(ASSET_STORE);
    },
  });

  await db.put(ASSET_STORE, blob, url);
}

async function getFromIndexedDB(url) {
  const db = await openDB(ASSET_DB_NAME, 1);
  return await db.get(ASSET_STORE, url);
}

// Use in service worker
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Large textures go to IndexedDB
  if (url.includes('/textures/') && url.match(/\.(png|jpg)$/)) {
    event.respondWith(
      getFromIndexedDB(url)
        .then(blob => {
          if (blob) return new Response(blob);
          return fetch(event.request)
            .then(response => {
              cacheToIndexedDB(url, response.clone().blob());
              return response;
            });
        })
    );
  }
});
```

**Benefits**:
- Store 100s of MBs of assets
- Better for large textures (1-5MB each)
- Persist across updates
- Faster than Cache API for large files

#### 3. Compression Support

```javascript
// Support Brotli/Gzip compression
registerRoute(
  ({ request }) => request.destination === 'script' || request.destination === 'style',
  new CacheFirst({
    cacheName: 'compressed-assets',
    plugins: [
      {
        // Store compressed responses
        cacheWillUpdate: async ({ response }) => {
          const encoding = response.headers.get('content-encoding');
          if (encoding && (encoding.includes('br') || encoding.includes('gzip'))) {
            return response;
          }
          return response;
        },
      },
    ],
  })
);
```

**Benefits**:
- Reduce bandwidth by 60-80%
- Faster downloads
- Lower server costs

#### 4. Background Sync

**Why**: Queue actions when offline, replay when online

```javascript
// Background sync for score submissions (future multiplayer)
import { BackgroundSyncPlugin } from 'workbox-background-sync';

const bgSyncPlugin = new BackgroundSyncPlugin('scoreQueue', {
  maxRetentionTime: 24 * 60, // Retry for 24 hours
});

registerRoute(
  '/api/scores',
  new NetworkOnly({
    plugins: [bgSyncPlugin],
  }),
  'POST'
);

// Listen for sync event
self.addEventListener('sync', (event) => {
  if (event.tag === 'scoreQueue') {
    event.waitUntil(replayQueuedRequests());
  }
});
```

**Benefits**:
- Offline gameplay score tracking
- Automatic retry on connection
- Better UX for unstable networks

---

## Loading Screen Integration

### Implementation Strategy

#### 1. Create Loading Phases

```typescript
// src/ui/loadingScreen.ts - already created
export enum LoadingPhase {
  INIT = 'Initializing...',
  ENGINE = 'Loading 3D engine...',
  GEOMETRY = 'Loading dice geometry...',
  TEXTURES = 'Loading textures...',
  AUDIO = 'Preparing audio...',
  SCENE = 'Building game scene...',
  READY = 'Ready!',
}
```

#### 2. Progress Reporting

```typescript
// Track loading progress across all systems
class AssetLoadingManager {
  private tasks = new Map<string, { loaded: number; total: number }>();

  registerTask(name: string, totalBytes: number) {
    this.tasks.set(name, { loaded: 0, total: totalBytes });
  }

  updateTask(name: string, loadedBytes: number) {
    const task = this.tasks.get(name);
    if (task) {
      task.loaded = loadedBytes;
      this.notifyProgress();
    }
  }

  getTotalProgress(): number {
    let loaded = 0;
    let total = 0;

    this.tasks.forEach((task) => {
      loaded += task.loaded;
      total += task.total;
    });

    return total > 0 ? (loaded / total) * 100 : 0;
  }

  private notifyProgress() {
    const progress = this.getTotalProgress();
    // Update loading screen
    loadingScreen.setProgress(progress);
  }
}
```

#### 3. BabylonJS Integration

```typescript
// Report BabylonJS asset loading progress
SceneLoader.OnPluginActivatedObservable.add((plugin) => {
  plugin.onProgress = (event) => {
    if (event.lengthComputable) {
      const percent = (event.loaded / event.total) * 100;
      loadingManager.updateTask('geometry', event.loaded);
      loadingScreen.setStatus(`Loading geometry: ${Math.round(percent)}%`);
    }
  };
});

// Texture loading progress
const texture = new Texture(url, scene);
texture.onLoadObservable.add(() => {
  loadingManager.completeTask('texture-' + url);
});
```

#### 4. Service Worker Communication

```typescript
// Service worker reports cache population progress
// SW -> Main Thread
self.clients.matchAll().then(clients => {
  clients.forEach(client => {
    client.postMessage({
      type: 'CACHE_PROGRESS',
      loaded: 5,
      total: 10,
      asset: 'diffuse.png'
    });
  });
});

// Main Thread listens
navigator.serviceWorker.addEventListener('message', (event) => {
  if (event.data.type === 'CACHE_PROGRESS') {
    loadingScreen.setStatus(`Caching: ${event.data.asset}`);
  }
});
```

---

## Multiplayer Considerations

### Asset Offloading with Web Workers

#### Use Cases for Web Workers

1. **Network Message Processing**
   ```typescript
   // worker.ts - Process multiplayer messages off main thread
   self.addEventListener('message', (event) => {
     const { type, data } = event.data;

     if (type === 'PROCESS_STATE_UPDATE') {
       const processedState = processGameState(data);
       self.postMessage({ type: 'STATE_READY', state: processedState });
     }
   });
   ```

2. **Dice Roll Validation (Anti-cheat)**
   ```typescript
   // Verify dice rolls server-side, validate client-side in worker
   function validateRoll(seed: string, rolls: number[]): boolean {
     const rng = new SeededRandom(seed);
     const expectedRolls = generateRolls(rng, rolls.length);
     return arraysEqual(expectedRolls, rolls);
   }
   ```

3. **State Synchronization Diffing**
   ```typescript
   // Calculate state diffs in worker to reduce bandwidth
   function calculateStateDiff(oldState, newState) {
     // Deep diff algorithm
     return diff(oldState, newState);
   }
   ```

4. **Asset Decompression**
   ```typescript
   // Decompress textures in worker
   async function decompressTexture(compressedData: ArrayBuffer) {
     const decompressed = await pako.inflate(compressedData);
     return decompressed;
   }
   ```

### WebSocket Handling

**Never cache WebSocket connections** - they must always be live.

```javascript
// Service worker - skip WebSocket upgrade requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip WebSocket connections
  if (event.request.headers.get('upgrade') === 'websocket') {
    return; // Let it pass through
  }

  // Skip multiplayer endpoints
  if (url.pathname.startsWith('/multiplayer/')) {
    event.respondWith(fetch(event.request)); // Network-only
  }
});
```

### Multiplayer Asset Strategy

#### Player Avatars
```javascript
// Cache player avatars with expiration
registerRoute(
  ({ url }) => url.pathname.includes('/avatars/'),
  new StaleWhileRevalidate({
    cacheName: 'player-avatars',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 100, // Up to 100 player avatars
        maxAgeSeconds: 24 * 60 * 60, // 1 day
      }),
    ],
  })
);
```

#### Tournament Data
```javascript
// Cache tournament brackets/history (static after completion)
registerRoute(
  ({ url }) => url.pathname.includes('/tournaments/') && url.searchParams.has('archived'),
  new CacheFirst({
    cacheName: 'tournament-archives',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year (never changes)
      }),
    ],
  })
);

// Live tournament data - network-first
registerRoute(
  ({ url }) => url.pathname.includes('/tournaments/') && !url.searchParams.has('archived'),
  new NetworkFirst({
    cacheName: 'tournament-live',
    networkTimeoutSeconds: 3,
  })
);
```

### Offline Multiplayer Queue

```typescript
// Queue multiplayer actions when offline
class MultiplayerQueue {
  private queue: Array<MultiplayerAction> = [];

  async enqueue(action: MultiplayerAction) {
    this.queue.push(action);
    await this.saveToLocalStorage();

    // Try to sync immediately
    if (navigator.onLine) {
      this.sync();
    }
  }

  async sync() {
    while (this.queue.length > 0 && navigator.onLine) {
      const action = this.queue[0];

      try {
        await sendToServer(action);
        this.queue.shift();
        await this.saveToLocalStorage();
      } catch (error) {
        // Network error, stop syncing
        break;
      }
    }
  }
}

// Listen for online event
window.addEventListener('online', () => {
  multiplayerQueue.sync();
});
```

---

## Performance Metrics

### What to Track

#### Time to First Render (TTFR)
```typescript
performance.mark('splash-start');
// ... splash screen renders
performance.mark('splash-end');
performance.measure('TTFR', 'splash-start', 'splash-end');

// Target: < 500ms
```

#### Time to Interactive (TTI)
```typescript
performance.mark('game-start');
// ... game becomes playable
performance.mark('game-interactive');
performance.measure('TTI', 'game-start', 'game-interactive');

// Target: < 5 seconds
```

#### Asset Load Times
```typescript
const observer = new PerformanceObserver((list) => {
  list.getEntries().forEach((entry) => {
    if (entry.initiatorType === 'fetch' || entry.initiatorType === 'xmlhttprequest') {
      console.log(`${entry.name}: ${entry.duration}ms`);

      // Send to analytics
      analytics.track('asset-load', {
        url: entry.name,
        duration: entry.duration,
        size: entry.transferSize,
      });
    }
  });
});

observer.observe({ entryTypes: ['resource'] });
```

#### Cache Hit Rate
```typescript
// Service Worker
let cacheHits = 0;
let cacheMisses = 0;

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        cacheHits++;
      } else {
        cacheMisses++;
      }

      // Report every 100 requests
      if ((cacheHits + cacheMisses) % 100 === 0) {
        const hitRate = cacheHits / (cacheHits + cacheMisses) * 100;
        reportToAnalytics('cache-hit-rate', hitRate);
      }

      return response || fetch(event.request);
    })
  );
});
```

#### BabylonJS Instrumentation
```typescript
// Track rendering performance
scene.onBeforeRenderObservable.add(() => {
  const fps = engine.getFps();
  const drawCalls = scene.getActiveMeshes().length;

  // Log if performance degrades
  if (fps < 30) {
    console.warn('Low FPS detected:', fps);
    analytics.track('performance-warning', { fps, drawCalls });
  }
});
```

### Performance Budgets

| Metric | Target | Max Acceptable |
|--------|--------|----------------|
| Time to First Render | < 500ms | < 1s |
| Time to Interactive | < 3s | < 5s |
| First Contentful Paint | < 1s | < 2s |
| Total Bundle Size | < 6MB | < 8MB |
| Theme Load Time | < 2s | < 4s |
| FPS (steady state) | 60 FPS | 30 FPS |
| Memory Usage | < 200MB | < 400MB |
| Cache Hit Rate | > 80% | > 60% |

---

## Implementation Phases

### Phase 1: Foundation (Current - Pre-Multiplayer)

**Goal**: Improve loading experience for single-player

**Tasks**:
- ✅ Add gradient background to splash screen
- ✅ Create loading screen component
- ✅ Document strategy (this file)
- ⬜ Integrate loading screen into game initialization
- ⬜ Add progress reporting for theme loading
- ⬜ Expand service worker precache list
- ⬜ Add asset size awareness to PWA service

**Deliverables**:
- Loading screen shows during theme load
- User sees progress (0-100%)
- Status messages ("Loading textures...")
- Smooth transition: Splash → Loading → Game

**Timeline**: 1-2 weeks

### Phase 2: Service Worker Enhancement (Pre-Multiplayer)

**Goal**: Optimize caching and offline experience

**Tasks**:
- ⬜ Integrate Workbox for advanced caching
- ⬜ Implement IndexedDB for large assets (textures)
- ⬜ Add compression support (Brotli/Gzip)
- ⬜ Implement background prefetch for alternative themes
- ⬜ Add cache versioning by theme
- ⬜ Improve offline fallbacks

**Deliverables**:
- Faster subsequent loads (cache-first)
- Offline gameplay fully supported
- Alternative themes prefetched in background
- Reduced bandwidth usage (compression)

**Timeline**: 2-3 weeks

### Phase 3: Multiplayer Preparation

**Goal**: Infrastructure for real-time multiplayer

**Tasks**:
- ⬜ Create Web Workers for network processing
- ⬜ Implement state diffing in worker
- ⬜ Add dice roll validation worker
- ⬜ Create multiplayer action queue (offline support)
- ⬜ Add WebSocket handling to service worker (skip caching)
- ⬜ Implement player avatar caching strategy
- ⬜ Add background sync for score submissions

**Deliverables**:
- Web Workers offload heavy computation
- Multiplayer actions queue when offline
- Avatar images cached efficiently
- Network message processing doesn't block rendering

**Timeline**: 3-4 weeks

### Phase 4: Performance Optimization

**Goal**: Monitor and optimize for scale

**Tasks**:
- ⬜ Add comprehensive performance tracking
- ⬜ Implement real-time monitoring (analytics)
- ⬜ Optimize asset loading order
- ⬜ Add adaptive loading (adjust quality based on connection)
- ⬜ Implement code splitting for game modes
- ⬜ Add performance budgets to CI/CD

**Deliverables**:
- Performance dashboard
- Automated performance alerts
- Adaptive asset loading based on network
- Code splitting reduces initial bundle

**Timeline**: 2-3 weeks

### Phase 5: Advanced Features (Post-Multiplayer Launch)

**Goal**: Polish and scale

**Tasks**:
- ⬜ Implement CDN for static assets
- ⬜ Add HTTP/2 push for critical assets
- ⬜ Implement streaming assets (large textures)
- ⬜ Add predictive prefetching (ML-based)
- ⬜ Implement asset versioning/rollback
- ⬜ Add A/B testing for loading strategies

**Deliverables**:
- Sub-second load times (cached)
- Intelligent prefetching
- Scalable to 1000s of concurrent users
- Data-driven optimization

**Timeline**: Ongoing

---

## Tools & Resources

### Recommended Tools

1. **Workbox** (Service Worker):
   - https://developers.google.com/web/tools/workbox
   - Install: `npm install workbox-webpack-plugin`

2. **IndexedDB (idb)**:
   - https://github.com/jakearchibald/idb
   - Install: `npm install idb`

3. **Lighthouse** (Performance Audits):
   - Built into Chrome DevTools
   - CLI: `npm install -g lighthouse`

4. **Webpack Bundle Analyzer**:
   - https://github.com/webpack-contrib/webpack-bundle-analyzer
   - Install: `npm install webpack-bundle-analyzer`

5. **PurgeCSS** (Remove unused CSS):
   - https://purgecss.com/
   - Install: `npm install @fullhuman/postcss-purgecss`

### Learning Resources

- [Service Worker Cookbook](https://serviceworke.rs/)
- [Web.dev: Fast load times](https://web.dev/fast/)
- [BabylonJS: Performance tips](https://doc.babylonjs.com/features/featuresDeepDive/scene/optimize_your_scene)
- [PWA Checklist](https://web.dev/pwa-checklist/)

---

## Conclusion

This strategy provides a clear roadmap for improving BISCUITS' loading experience and preparing for multiplayer. The phased approach allows incremental improvements without disrupting current functionality.

**Key Takeaways**:
1. **Now**: Loading screen with progress (better UX)
2. **Soon**: Workbox + IndexedDB (faster loads, offline support)
3. **Later**: Web Workers (multiplayer ready)
4. **Future**: Advanced optimization (scale to 1000s of users)

**Next Steps**:
1. Integrate loading screen into game initialization
2. Add progress reporting to theme loading
3. Begin Workbox migration planning

---

**Questions or Suggestions?**
Open an issue on GitHub or update this document as implementation progresses.
