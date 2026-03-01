# BISCUITS - Future Features

**Feature Roadmap & Enhancement Ideas**

This document captures future feature ideas, enhancements, and expansion possibilities for BISCUITS. Each feature includes complexity estimates and AI prompts to restart development work.

---

## 🏗️ Server Platform Evolution

### Server Decoupling - Phase 06 Follow-through
- **Complexity**: Medium
- **Description**: Continue shrinking `api/server.mjs` by extracting admin route use-cases into dedicated admin application services.
- **Why**:
  - Preserve behavior while reducing coupling in the composition root.
  - Improve testability of moderation/admin orchestration paths without full server boot.
- **Candidate Deliverables**:
  - `api/admin/adminModerationService.mjs`
  - `api/admin/adminRoomOpsService.mjs`
  - focused integration tests around role-upsert/session-expire/remove-participant/conduct-clear flows
- **AI Prompt**:
  ```
  Extract admin route orchestration from api/server.mjs into composable admin application services while preserving existing API contracts. Keep route handlers thin, move mutation logic and audit side-effects into services, and add focused tests for role upsert, session expire, participant remove, and conduct clear paths.
  ```

### Server Decoupling - Phase 07 Candidate (Multiplayer Session Control Services)
- **Complexity**: High
- **Description**: Isolate multiplayer session control endpoints (`join`, `heartbeat`, `refresh`, `queue-next`, participant-state updates) into application service modules.
- **Why**:
  - Improves reliability for auth/session lifecycle changes.
  - Makes distributed-store consistency and retries easier to reason about.
- **Candidate Deliverables**:
  - `api/multiplayer/sessionControlService.mjs`
  - `api/multiplayer/sessionAuthRecoveryService.mjs`
  - endpoint-level tests for transient `session_expired` recovery behavior and retry policy boundaries
- **AI Prompt**:
  ```
  Create multiplayer session control services that encapsulate join/heartbeat/refresh/queue-next orchestration currently in api/server.mjs. Preserve existing endpoint responses, move retry/rehydrate policies into service boundaries, and add focused regression tests for transient session_expired recovery paths.
  ```

### Deployment Observability + CI Confidence Lane
- **Complexity**: Medium
- **Description**: Improve deploy diagnostics and CI confidence for distributed Cloud Run behavior.
- **Candidate Deliverables**:
  - Cloud Logging read permission path for deploy workflow diagnostics
  - stronger non-fatal transient signatures and recovery telemetry in smoke output
  - opt-in fail-hard lane for transient session drift checks once consistency work lands
- **AI Prompt**:
  ```
  Harden BISCUITS deploy diagnostics by improving Cloud Run log access and structured smoke telemetry for transient websocket/auth failures. Add a strict CI lane that can be toggled to fail hard on repeated transient session drift once reliability gates are met.
  ```

---

## 🎨 Theme System Enhancements

### Custom Theme Creator
- **Complexity**: High
- **Description**: In-browser theme editor allowing players to create custom dice themes
- **Features**:
  - Upload custom textures (diffuse, normal, specular)
  - Live preview with all die types
  - Color picker for base materials
  - Texture scale/offset adjustment UI
  - Export/import theme configs
  - Share themes with community (URL encoding)
- **Technical Notes**:
  - Extend ThemeManager with validation
  - Add file upload handling
  - Implement theme serialization/deserialization
  - Consider security implications of custom textures
- **AI Prompt**:
  ```
  Implement a custom theme creator UI for BISCUITS. Allow users to upload textures, adjust material properties with live preview, and export theme.config.json files. Add a new "Create Theme" panel to src/render/components/ThemeSelector.ts with file upload, color pickers, and real-time preview.
  ```

### Theme Marketplace
- **Complexity**: Very High
- **Description**: Community-driven theme sharing platform
- **Features**:
  - Browse/download user-created themes
  - Rate and review themes
  - Featured themes section
  - Search/filter by style, color, author
  - One-click theme installation
- **Technical Notes**:
  - Requires backend service (API + storage)
  - CDN for theme assets
  - Moderation system
  - Analytics/download tracking
- **AI Prompt**:
  ```
  Design the architecture for a BISCUITS theme marketplace. Create API specifications for theme upload, browsing, and download. Consider using Supabase or Firebase for backend, implement moderation queues, and design the frontend UI for theme discovery in src/render/components/ThemeMarketplace.ts.
  ```

### Animated Themes
- **Complexity**: High
- **Description**: Themes with animated textures or particle effects
- **Features**:
  - Animated diffuse textures (e.g., flowing lava, twinkling stars)
  - Particle effects on roll (e.g., sparkles, flames, ice crystals)
  - Shader-based effects (e.g., holographic, glitch)
  - Sound effects tied to themes
- **Technical Notes**:
  - Extend material system for animation
  - Add particle system to DiceRenderer
  - Implement custom shaders
  - Performance considerations (mobile)
- **AI Prompt**:
  ```
  Add animated texture support to BISCUITS themes. Create a "Galaxy" theme with animated nebula textures and particle effects. Extend src/render/dice.ts to support texture animation and integrate BabylonJS ParticleSystem for roll effects.
  ```

### Theme Unlocks/Progression
- **Complexity**: Medium
- **Description**: Unlock premium themes through gameplay achievements
- **Features**:
  - Achievement system (score milestones, play streaks)
  - Theme unlock conditions
  - Progress tracking UI
  - "Coming soon" locked theme previews
- **Technical Notes**:
  - Add achievement tracking to state
  - Persist unlocks to localStorage
  - Update ThemeSelector to show locked/unlocked states
- **AI Prompt**:
  ```
  Implement theme unlock progression in BISCUITS. Add an achievement system to src/engine/achievements.ts that tracks milestones (total score, games played, streaks). Update ThemeSelector to show locked themes with unlock conditions and progress bars.
  ```

---

## 🎲 Gameplay Variations

### Multiple Game Modes

#### D4 Mode - "Lucky Fours"
- **Complexity**: Medium
- **Description**: Fast-paced variant using only d4 dice
- **Rules**:
  - 8 dice per roll (instead of 6)
  - Score straight 1-2-3-4 = 100 bonus
  - All matching = 200 bonus
  - 3 rolls maximum
- **AI Prompt**:
  ```
  Create a "Lucky Fours" game mode for BISCUITS using only d4 dice. Add a mode selector to the main menu, create game rules in src/engine/modes/luckyFours.ts, and update the scoring system to include d4-specific bonuses.
  ```

#### D20 Mode - "High Stakes"
- **Complexity**: Medium
- **Description**: RPG-inspired variant using d20 dice
- **Rules**:
  - 3 dice per roll
  - Natural 20s = 50 points
  - Critical fails (1s) = lose all points
  - Advantage/disadvantage mechanic (roll twice, take best/worst)
- **AI Prompt**:
  ```
  Implement "High Stakes" d20 mode for BISCUITS. Use 3 d20 dice with special scoring for natural 20s and critical fails. Add advantage/disadvantage mechanic to src/engine/modes/highStakes.ts and create UI toggle in DiceRenderer.
  ```

#### D100 Mode - "Percentile Challenge"
- **Complexity**: High
- **Description**: Two d10s rolled as percentile dice
- **Rules**:
  - Target score goal (e.g., "roll exactly 50")
  - Closest to target wins round
  - Progressive difficulty (targets change)
- **AI Prompt**:
  ```
  Create "Percentile Challenge" mode using d100 dice (two d10s). Implement target-based scoring in src/engine/modes/percentile.ts where players aim for specific numbers. Add round-based progression and accuracy scoring.
  ```

### Difficulty Levels
- **Complexity**: Low
- **Description**: Easy/Normal/Hard modes with adjusted scoring
- **Easy**: More generous scoring, 4 rolls
- **Normal**: Current rules (3 rolls)
- **Hard**: Stricter scoring, 2 rolls, must keep at least 2 dice
- **AI Prompt**:
  ```
  Add difficulty levels to BISCUITS. Create src/engine/difficulty.ts with three presets that adjust roll limits, scoring thresholds, and minimum dice requirements. Add difficulty selector to settings panel.
  ```

### Time Attack Mode
- **Complexity**: Medium
- **Description**: Race against the clock for high scores
- **Features**:
  - 60/90/120 second rounds
  - Bonus points for speed
  - Combo multipliers for quick decisions
  - Leaderboard integration
- **AI Prompt**:
  ```
  Implement Time Attack mode for BISCUITS. Add a countdown timer to src/game/state.ts, create speed-based scoring bonuses, and update UI to show remaining time and combo multipliers in src/render/components/ScorePanel.ts.
  ```

---

## 🎮 UI/UX Improvements

### Tutorial System
- **Complexity**: Medium
- **Description**: Interactive tutorial for new players
- **Status**: 🟡 Partially Complete (interactive flow + replay shipped; continued content polish pending)
- **Features**:
  - ✅ Step-by-step guided play
  - ✅ Highlight relevant UI elements
  - ✅ Practice mode with no penalty
  - ✅ Replay entry points from How To Play and Splash
  - [ ] Expand advanced multiplayer onboarding steps (turn sync edge cases, reconnect strategy)
  - [ ] Optional compressed tutorial path for returning players
- **Current**: Interactive tutorial is in production, including guided settings/audio steps and post-tutorial rollback assist.
- **Enhancement**: Continue reducing friction for experienced players while preserving first-time clarity.
- **AI Prompt**:
  ```
  Enhance the BISCUITS tutorial with interactive step-by-step guidance. Implement a tutorial state machine in src/render/components/Tutorial.ts that highlights UI elements, waits for player actions, and provides contextual tips. Add spotlight/overlay effects for focus.
  ```

### Accessibility Features
- **Complexity**: Medium
- **Description**: Make game accessible to all players
- **Features**:
  - Colorblind mode (theme adjustments)
  - Screen reader support (ARIA labels)
  - Keyboard-only navigation
  - High contrast mode
  - Configurable font sizes
  - Reduced motion option
- **AI Prompt**:
  ```
  Improve BISCUITS accessibility. Add colorblind-friendly theme variants, implement full keyboard navigation in src/render/components/*.ts, add ARIA labels for screen readers, and create a reduced-motion mode that disables animations. Follow WCAG 2.1 AA guidelines.
  ```

### Undo/Redo System
- **Complexity**: Low
- **Description**: Allow players to undo dice selections
- **Status**: 🟡 Partially Complete (`Undo` shipped in Easy mode; redo/history UX pending)
- **Features**:
  - ✅ Undo last selection (Easy mode + UI button flow)
  - ✅ Tutorial-completion rollback calls undo so players can re-pick optimally
  - [ ] Redo (Ctrl+Shift+Z)
  - [ ] Show action history
  - [ ] Limit undo depth (last 5 actions)
- **Technical**: Action log foundations exist; redo + explicit history UI are remaining.
- **AI Prompt**:
  ```
  Add undo/redo functionality to BISCUITS dice selection. Use the existing action log in src/game/state.ts to implement time-travel debugging. Add keyboard shortcuts and visual history in ScorePanel showing last 5 actions with undo/redo buttons.
  ```

### Settings Panel
- **Complexity**: Low
- **Description**: Centralized settings management
- **Status**: ✅ Core Delivered (expanded and actively used)
- **Features**:
  - ✅ Sound volume controls (master/music/sfx + toggles)
  - ✅ Graphics quality and visual readability controls
  - ✅ Gameplay and accessibility toggles
  - ✅ Account/profile section with sync indicators
  - ✅ Admin Console launcher from Account tab (feature-flagged)
  - [ ] Data management (clear/export user data)
  - [ ] Credits/about section
- **AI Prompt**:
  ```
  Extend BISCUITS settings with account data-management controls and credits/about metadata. Keep the current tabbed settings architecture and add safe export/reset actions with confirmation modals and analytics-safe logging.
  ```

### Statistics Dashboard
- **Complexity**: Medium
- **Description**: Detailed gameplay statistics
- **Features**:
  - Total games played
  - Win rate / average score
  - Favorite themes
  - Most/least lucky die faces
  - Score distribution histogram
  - Play time tracking
- **AI Prompt**:
  ```
  Build a statistics dashboard for BISCUITS. Extend src/services/scoreHistory.ts to track detailed gameplay metrics. Create src/render/components/StatsPanel.ts with charts (using Chart.js) showing score trends, die face distribution, and player achievements over time.
  ```

---

## 🌐 Social Features

### Friends + Presence System (Planned, Deferred)
- **Complexity**: High
- **Description**: Persistent friend graph, online presence, and friend-to-room invites for multiplayer retention.
- **Status**: Scaffolded contracts and architecture are documented; execution deferred until multiplayer mechanics stabilize.
- **Primary Spec**: `docs/FRIENDS-SYSTEM-PLAN.md`
- **Initial Deliverables (when unblocked)**:
  - Friends graph endpoints (request/accept/decline/remove/block)
  - Presence heartbeat + batched presence queries
  - Private-room invites for accepted friends
  - Lobby online-friends panel
- **AI Prompt**:
  ```
  Implement Phase 1 of BISCUITS friends system using docs/FRIENDS-SYSTEM-PLAN.md. Start with backend friend graph endpoints and block-list semantics, then add client wiring to display friends/incoming/outgoing requests with no room-invite behavior yet.
  ```

### Chaos Gameplay Mechanics System
- **Complexity**: Very High
- **Description**: Multiplayer "psychosocial warfare" mechanics system with player attacks, distractions, and time pressure
- **Documentation**:
  - See `docs/CHAOS-GAMEPLAY-MECHANICS.md` for complete specification (700+ lines)
  - **Camera Integration**: See `docs/CAMERA-ATTACKS-INTEGRATION.md` for weaponized camera effects (1000+ lines)
- **Features**:
  - 50+ attack abilities across 5 categories (Visual, Audio, UI, Dice, Time)
  - Time Attack variants (Countdown, Speed Bonus, Sudden Death, Time Bomb, etc.)
  - Insult & Taunt System (300+ pre-written taunts, AI generation, emotes, voice lines)
  - Chaos Points economy with ability unlocks and progression
  - 7 game modes (Casual, Competitive, Survival, Team Chaos, etc.)

---

## 🛠️ Live Ops & Admin

### Front Admin Control + Monitoring Dashboard
- **Complexity**: High
- **Description**: Internal dashboard for live room oversight, moderation controls, and operational health checks.
- **Status**: 🟡 Phase 1 Delivered (monitoring + core moderation actions shipped; dedicated web dashboard still pending)
- **Initial Scope**:
  - Room/session table (active players, room type, turn state, idle timers)
  - Global counters (active sessions, ws connections, join failures, turn timeout rate)
  - Room actions (expire room, remove participant, toggle room visibility)
  - Incident panel (error spikes, auth failures, reconnect churn)
- **Delivered Foundation**:
  - ✅ Role-gated `/api/admin/*` endpoint suite (overview/metrics/rooms/storage/audit/roles)
  - ✅ In-app Admin Console modal with live room monitor and owner role management
  - ✅ Controlled moderation actions: expire room, remove participant
  - ✅ Audit trail logging for admin mutations
- **Remaining for Full Target**:
  - [ ] Room visibility toggle
  - [ ] Turn recovery/admin-assisted desync repair actions
  - [ ] Separate internal web dashboard with historical trends/incidents
- **Technical Notes**:
  - Add admin-only API namespace (e.g., `/api/admin/*`) with strict auth/role checks
  - Emit lightweight operational metrics from API loop/session manager
  - Keep read APIs paginated/filterable for high room volume
- **AI Prompt**:
  ```
  Implement Phase 1 of a BISCUITS admin dashboard. Add secure admin API endpoints for room/session summaries and moderation actions, then build a minimal frontend admin panel showing live room health, participant state, and emergency controls (expire room, remove player). Use role-gated auth and audit logging for all admin mutations.
  ```
  - Anti-toxicity systems (report, mute, safe mode, AI moderation)
  - Network protocol for real-time attack broadcasting
- **Design Philosophy**: "Fun frustration" - psychological pressure without toxicity
- **Example Abilities**:
  - **Screen Shake**: Intense camera movement during opponent's turn
  - **Dice Fog**: Semi-transparent overlay obscuring dice visibility
  - **Time Thief**: Steal 5 seconds from opponent's turn timer
  - **Fake Bust**: Display false "BUST!" message
  - **Ghost Dice**: Make opponent's dice semi-transparent
- **Technical Notes**:
  - Requires full multiplayer infrastructure
  - WebSocket protocol for real-time attacks
  - Client-side attack rendering with server validation
  - Balance considerations (cooldowns, diminishing returns, karma system)
  - Extensive playtesting required
- **Dependencies**:
  - Multiplayer mode must be complete
  - User profiles and authentication
  - Backend infrastructure (WebSocket server, database)
  - Time attack game mode variants
- **AI Prompt**:
  ```
  Implement the Chaos Gameplay Mechanics System for BISCUITS multiplayer. Follow the complete specification in docs/CHAOS-GAMEPLAY-MECHANICS.md. Start with core infrastructure: create ability system in src/chaos/abilities.ts with 50+ attack definitions, implement Chaos Points economy in src/chaos/economy.ts, and build UI components in src/chaos/ui/ for ability bar and attack notifications. Ensure all attacks have proper cooldowns, resource costs, and anti-toxicity safeguards.
  ```

### Daily Challenges
- **Complexity**: High
- **Description**: Daily seeded challenges with global leaderboards
- **Features**:
  - Same seed for all players each day
  - 24-hour challenge window
  - Global leaderboard (top 100)
  - Share results to social media
  - Streak tracking (consecutive days played)
- **Technical Notes**:
  - Requires backend for leaderboard
  - Deterministic RNG ensures fairness
  - Consider time zones for "daily" reset
- **AI Prompt**:
  ```
  Implement daily challenges for BISCUITS. Create a backend API (Supabase/Firebase) to serve daily seeds and store scores. Add src/game/dailyChallenge.ts to fetch challenges, submit scores, and display global leaderboards. Use deterministic RNG to ensure all players get identical rolls.
  ```

### 8-Player Octagon Multiplayer
- **Complexity**: Very High
- **Description**: Real-time multiplayer with 8 player seats around octagon game board
- **Features**:
  - 8 player seats positioned around octagon table
  - Player avatars with customization (profile pic, username, rank badge)
  - Live player info displays (current score, turn indicator, status)
  - Real-time game state synchronization
  - Turn-based or simultaneous roll variants
  - Player emotes and reactions
  - Spectator mode with free camera orbit around table
  - Seat selection and room management
- **Technical Notes**:
  - WebSocket server (Socket.io or Colyseus recommended)
  - State synchronization protocol for 8 concurrent players
  - Server-authoritative dice rolls for cheat prevention
  - Player session management and reconnection handling
  - Octagon geometry provides natural 8-seat layout (45° spacing)
- **Dependencies**:
  - Requires octagon game board implementation (see Phase 1)
  - Player profile system with avatar storage
  - Backend infrastructure (API + database + WebSocket server)
- **AI Prompt**:
  ```
  Design 8-player multiplayer mode for BISCUITS around octagon game board. Create WebSocket server with room management supporting 8 concurrent players. Implement player seat assignment using octagon's 8 positions (calculated at 45° intervals). Build UI for player avatars and info displays positioned around octagon perimeter in src/multiplayer/PlayerSeats.ts. Sync game state across all clients with turn management in src/multiplayer/TurnManager.ts. Ensure server-authoritative dice rolls to prevent cheating.
  ```

### Live Player Updates Notification System
- **Complexity**: Medium
- **Description**: Real-time feed of other players' actions during multiplayer games
- **Features**:
  - Live notifications for player actions ("{Player} rolled 3 dice!")
  - Score celebration notifications ("{Player} scored 50 points!")
  - Positional notifications appearing near player's seat
  - Color-coded per player for easy identification
  - Queue system with priority (extends existing notification service)
  - Animations for dramatic moments (big scores, busts)
  - Filter options (show all players vs. only friends)
- **Technical Notes**:
  - Extends existing `src/ui/notifications.ts` system
  - WebSocket events trigger notifications
  - 3D positioning relative to octagon player seats
  - Mobile-responsive (collapsible to icon badges)
- **Dependencies**:
  - Requires multiplayer infrastructure
  - Existing notification system provides foundation
- **AI Prompt**:
  ```
  Extend BISCUITS notification system for multiplayer player updates. Enhance src/ui/notifications.ts to support 3D-positioned notifications around octagon player seats. Add WebSocket event listeners in src/multiplayer/EventHandler.ts to trigger notifications for player actions (rolls, scores, emotes). Implement player-specific color coding and priority queue for high-traffic games.
  ```

### Global Leaderboard Integration
- **Complexity**: High
- **Description**: Persistent global rankings with friend competition features
- **Current**: Local-only leaderboard in localStorage
- **Enhancement**:
  - Global leaderboards (all-time, weekly, monthly, daily)
  - Friend rankings and direct challenges
  - Theme-specific leaderboards
  - Mode-specific leaderboards (Easy/Normal/Hard)
  - Verified scores via replay validation
  - Achievement badges displayed on profiles
  - "Beat your friends" competitive features
  - Real-time rank updates during multiplayer
  - Leaderboard spectator mode (watch top players)
- **Technical Notes**:
  - Backend API for score submission and retrieval
  - Replay validation ensures legitimate scores
  - Caching strategy for performance (Redis recommended)
  - Pagination for large datasets
  - Friend system with social graph
- **Dependencies**:
  - Requires user authentication system
  - Replay system for score verification
  - Backend infrastructure
- **AI Prompt**:
  ```
  Upgrade BISCUITS leaderboards to global system with friend competition. Create backend API (Supabase or Firebase) for score submission with replay validation - verify action log produces claimed score before accepting. Build src/services/leaderboardService.ts to fetch/display global, friend, theme-specific, and mode-specific rankings with pagination. Add friend challenge system where players can compete for highest score. Implement real-time rank updates during multiplayer sessions.
  ```

### Tournament Racing System
- **Complexity**: Very High
- **Description**: Competitive tournament mode with live racing events
- **Features**:
  - Tournament lobby with active/upcoming events
  - Race format: fastest to reach target score wins
  - Bracket tournaments (single/double elimination)
  - Swiss-system round-robin tournaments
  - Live tournament feed showing all match results
  - Prize pools (virtual currency or real rewards)
  - Tournament archives and replay library
  - Anti-cheat via server-authoritative validation
  - Tournament spectator mode with split-screen views
  - Entry fees and buy-ins (virtual currency)
  - Automatic bracket generation and seeding
  - Tiebreaker rules (time-to-complete, total rolls)
- **Technical Notes**:
  - Requires full multiplayer infrastructure
  - Bracket generation algorithms (Berger tables for Swiss)
  - Real-time tournament state management
  - Replay storage for all tournament games
  - Payment integration for prize tournaments (Stripe)
  - Tournament scheduling and time zone handling
- **Dependencies**:
  - Multiplayer system must be complete
  - Replay system for verification
  - User profiles and authentication
  - Payment processing (optional, for real prizes)
- **AI Prompt**:
  ```
  Design tournament racing system for BISCUITS. Create bracket generation in src/tournament/BracketManager.ts supporting single/double elimination and Swiss-system formats. Implement tournament lobby in src/tournament/TournamentLobby.ts with registration, match scheduling, and live results feed. Build race-format game mode where players compete to reach target score fastest. Add spectator mode with multi-player camera switching. Ensure all matches use server-authoritative rolls and replay validation for anti-cheat. Integrate with global leaderboard for tournament rankings.
  ```


### Replay System
- **Complexity**: Medium
- **Description**: Watch replays of high-scoring games
- **Features**:
  - Save games to replay file
  - Load and watch replays at adjustable speed
  - Share replay links
  - Annotate interesting moments
  - Leaderboard verification
- **Technical**: Action log already supports this
- **AI Prompt**:
  ```
  Add replay functionality to BISCUITS. Use the existing action log system to save/load complete games. Create src/game/replay.ts to reconstruct game state from action log, add playback controls (play/pause/speed), and generate shareable replay URLs with encoded action logs.
  ```

---

## 🚀 Advanced Features

### Achievement System
- **Complexity**: Medium
- **Description**: Xbox/Steam-style achievements
- **Examples**:
  - "First Blood" - Score your first points
  - "Perfectionist" - Win without busting
  - "Lucky Streak" - Roll 5 matching dice
  - "Theme Collector" - Unlock all themes
  - "Century Club" - Score 100+ in a single turn
  - "Marathon" - Play 100 games
- **Features**:
  - Achievement toast notifications
  - Progress tracking
  - Rarity indicators (common/rare/legendary)
  - Achievement showcase page
- **AI Prompt**:
  ```
  Implement an achievement system for BISCUITS. Create src/engine/achievements.ts with achievement definitions, unlock conditions, and progress tracking. Add toast notifications using src/render/components/AchievementToast.ts and a showcase page displaying earned/locked achievements with rarity badges.
  ```

### Tournament Mode
- **Complexity**: Very High
- **Description**: Bracket-style competitive play
- **Features**:
  - Single/double elimination brackets
  - Swiss-system tournaments
  - Entry fees (virtual currency)
  - Prize pools
  - Tournament history/archives
- **Technical Notes**:
  - Requires full multiplayer infrastructure
  - Bracket generation algorithms
  - Anti-cheat measures
- **AI Prompt**:
  ```
  Design tournament system for BISCUITS. Create bracket generation in src/tournament/brackets.ts supporting single/double elimination and Swiss formats. Implement tournament lobby, match scheduling, and result reporting. Requires multiplayer infrastructure and anti-cheat validation.
  ```

### AI Opponent
- **Complexity**: High
- **Description**: Single-player vs AI mode
- **Difficulty Levels**:
  - **Easy**: Random decisions
  - **Medium**: Rule-based strategy (keep high values)
  - **Hard**: Monte Carlo tree search
- **Features**:
  - AI personality/names
  - Visible AI "thinking"
  - Adjustable difficulty
  - AI move explanation
- **AI Prompt**:
  ```
  Create an AI opponent for BISCUITS single-player mode. Implement three difficulty levels in src/engine/ai/opponent.ts: random (easy), greedy rule-based (medium), and Monte Carlo simulation (hard). Add UI to show AI decision-making process and probability calculations.
  ```

### Mod Support
- **Complexity**: Very High
- **Description**: Allow community-created mods
- **Features**:
  - Custom game rules (JavaScript mods)
  - Custom themes (expanded capabilities)
  - UI modifications
  - Sound packs
  - Mod marketplace
  - Sandboxed execution for security
- **Technical Notes**:
  - Security considerations critical
  - Consider Web Workers for sandboxing
  - Mod API design
- **AI Prompt**:
  ```
  Design a mod system for BISCUITS. Create a sandboxed mod API in src/modding/api.ts that allows custom game rules, scoring functions, and UI modifications. Use Web Workers for security isolation. Implement mod loader, version management, and conflict resolution.
  ```

---

## 📱 Platform Expansion

### Progressive Web App (PWA)
- **Complexity**: Low
- **Description**: Installable web app with offline support
- **Features**:
  - Service worker for offline play
  - App manifest for installation
  - Push notifications (daily challenges)
  - Background sync
- **AI Prompt**:
  ```
  Convert BISCUITS to a Progressive Web App. Create service worker in public/sw.js for offline caching of assets and game data. Add manifest.json for installation, implement background sync for leaderboard submissions, and add push notification support for daily challenges.
  ```

### Mobile App
- **Complexity**: Very High
- **Description**: Native iOS/Android app using Capacitor
- **Features**:
  - Native performance
  - App store presence
  - Native notifications
  - IAP for premium themes
  - Haptic feedback
- **AI Prompt**:
  ```
  Port BISCUITS to native mobile using Capacitor. Configure Capacitor project, adapt UI for mobile screen sizes, implement native haptic feedback on rolls, and integrate App Store/Play Store IAP for premium theme purchases. Optimize BabylonJS rendering for mobile GPU.
  ```

### Desktop App
- **Complexity**: Medium
- **Description**: Electron-based desktop application
- **Features**:
  - Native window controls
  - System tray integration
  - Auto-updates
  - Offline mode
  - Better performance than browser
- **AI Prompt**:
  ```
  Create Electron desktop app for BISCUITS. Configure Electron builder, implement native menu bar, system tray icon, and auto-update using electron-updater. Package game for Windows, macOS, and Linux distributions.
  ```

---

## 🎨 Visual Enhancements

### Advanced Graphics Options
- **Complexity**: High
- **Description**: Optional high-fidelity rendering
- **Features**:
  - Real-time ray tracing (WebGPU)
  - SSAO (screen-space ambient occlusion)
  - Bloom/glow effects
  - Depth of field
  - Motion blur on dice rolls
  - 4K texture support
- **AI Prompt**:
  ```
  Implement advanced graphics options for BISCUITS. Add SSAO, bloom, and depth-of-field post-processing to src/render/scene.ts using BabylonJS rendering pipeline. Create graphics quality presets (Low/Medium/High/Ultra) with automatic detection based on device capabilities.
  ```

### Camera System & Machinima Tools
- **Complexity**: Very High
- **Description**: Progressive camera system with position management, flying mode, and professional machinima tools
- **Documentation**: See `docs/CAMERA-SYSTEM.md` for complete specification (800+ lines)
- **Current Status**: ✅ Phase 1 Complete (Basic position management with 3 slots)
- **Feature Tiers**:

#### Phase 1: Basic Camera Positions (✅ COMPLETE)
- Save/load camera positions (3 slots free tier)
- Import/export position JSON
- Keyboard shortcut (C key) access
- Tier-based unlock system (free/unlocked/premium)

#### Phase 2: Enhanced Camera System (Post-TODO)
- **Complexity**: Medium
- **Unlock**: Complete 10 games OR earn "Cinematographer" achievement
- **Features**:
  - 10 saved position slots (up from 3)
  - Smooth camera transitions with Bezier interpolation
  - Configurable easing functions (ease-in, ease-out, elastic)
  - ✅ Mobile quick camera slots now surface top pinned/saved positions (fallback to default presets)
  - Per-player seat positions for multiplayer (8 seats)
  - Replay timeline system with scrubbing
  - Community sharing (export/import preset packs)

#### Phase 3: Flying Camera Mode (Post-Multiplayer)
- **Complexity**: High
- **Unlock**: Achievement "Sky Walker" OR item unlock OR $4.99 Camera Pro pack
- **Features**:
  - Free-flying camera (UniversalCamera)
  - WASD + mouse look controls
  - Q/E for up/down movement
  - Shift for sprint (3x speed), Ctrl for slow (0.3x speed)
  - No-clip mode (pass through geometry)
  - FOV adjustment (60-120°)
  - Optional gamepad support

#### Phase 4: Machinima Pro Tools (Premium Feature)
- **Complexity**: Very High
- **Unlock**: $14.99 Machinima Pro pack OR Player Level 50
- **Features**:
  - **Camera Path Editor**: Keyframe system with timeline UI
  - **Automated Movements**: Orbit, dolly, crane, shake, follow
  - **Cinematic Effects**: Depth of field, vignette, letterbox, color grading, motion blur
  - **Director Mode**: Multi-camera live switching with hotkeys
  - **Picture-in-Picture**: Show multiple angles simultaneously
  - **Recording & Export**: MP4/WebM video rendering, GIF creation, screenshot gallery
  - **OBS Integration**: Virtual camera output for streaming
  - **Lower Thirds**: Custom text overlays for player names

- **Monetization Strategy**:
  - Free: 3 positions, basic controls
  - Earned: 10 positions via gameplay (10 games completed)
  - Camera Pro ($4.99): Flying mode, 20 positions, FOV control
  - Machinima Pro ($14.99 or $2.99/month): Full toolkit, unlimited positions, video export

- **Use Cases**:
  - Casual players: Better viewing angles during gameplay
  - Competitive players: Consistent tournament views
  - Content creators: Dynamic shots for YouTube/TikTok
  - Esports broadcasters: Professional multi-camera production
  - Machinima artists: Full cinematic control for short films

- **AI Prompt**:
  ```
  Implement Camera System Phase 2 per docs/CAMERA-SYSTEM.md. Add smooth camera transitions using Bezier interpolation in src/services/cameraService.ts. Create CameraInterpolator class with easing functions (linear, ease-in-out, elastic). Update CameraControlsPanel to show transition speed slider. Unlock 10 position slots when player completes 10 games or earns Cinematographer achievement.
  ```

### Customizable Table
- **Complexity**: Medium
- **Description**: Visual customization of play surface
- **Features**:
  - Different table materials (wood, felt, metal)
  - Custom backgrounds
  - Adjustable lighting
  - Room environments (tavern, casino, space)
- **AI Prompt**:
  ```
  Add customizable table environments to BISCUITS. Create src/render/environments/ with different table materials and room settings. Allow players to choose backgrounds, lighting presets, and decorative elements. Integrate with theme system for cohesive aesthetic.
  ```

---

## 🔧 Developer Tools

### Debug Console
- **Complexity**: Low
- **Description**: In-game developer console
- **Features**:
  - Cheat codes (set score, force rolls)
  - Performance metrics (FPS, draw calls)
  - State inspector
  - Console command history
  - Export debug logs
- **Current**: DebugView exists (Alt+D)
- **Enhancement**: Expand to full console
- **AI Prompt**:
  ```
  Expand BISCUITS DebugView into full developer console. Add command parser in src/debug/console.ts supporting commands like /setScore, /forceRoll, /showMetrics. Display performance stats, state tree, and command history. Make toggleable with ~ key.
  ```

### Visual Testing Tools
- **Complexity**: Medium
- **Description**: Tools for theme and UI testing
- **Features**:
  - Screenshot all themes automatically
  - Compare before/after visual diffs
  - Animation timeline scrubbing
  - Bounding box visualization
  - Performance profiling per frame
- **AI Prompt**:
  ```
  Create visual testing suite for BISCUITS. Implement src/test/visualTesting.ts that captures screenshots of all themes and dice types, performs pixel-diff comparisons, and generates regression reports. Add animation timeline controls for debugging dice rolls frame-by-frame.
  ```

---

## 🎯 Priority Recommendations

Based on impact and feasibility:

### Short Term (1-2 months)
1. **Tutorial System** - Improves new player experience
2. **Settings Panel** - Centralized configuration
3. **Undo/Redo** - Quality of life improvement
4. **PWA Conversion** - Easy wins for mobile UX

### Medium Term (3-6 months)
1. **Daily Challenges** - Increases engagement
2. **Achievement System** - Progression hooks
3. **Additional Game Modes** - Content variety
4. **Statistics Dashboard** - Player retention

### Long Term (6+ months)
1. **Multiplayer Mode** - Major feature, high complexity
2. **Theme Marketplace** - Community content
3. **Mobile Apps** - Platform expansion
4. **Tournament System** - Competitive scene

---

## 💡 Community Suggestions

Have an idea for BISCUITS? Consider these when proposing features:

- **Complexity**: How much work to implement?
- **Impact**: How many players benefit?
- **Feasibility**: Technical constraints?
- **Maintainability**: Ongoing support requirements?

Submit feature requests via GitHub Issues with:
- Clear description
- Use case/motivation
- Mockups or examples (if UI-related)
- Technical considerations (if known)

---

**Last Updated**: 2026-03-01
**Document Version**: 1.0
