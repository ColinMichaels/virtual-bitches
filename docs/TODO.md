# BISCUITS - TODO List

**Project Status**: Active Development • v1.0 • Last Updated: 2026-02-24

This document tracks all pending work, active bugs, technical debt, and backlog items for the BISCUITS project.

---

## 🔴 High Priority

### Active Bugs

#### Color Material Transparency Issue
- **Status**: ⚠️ WORKAROUND - Themes temporarily disabled
- **Affects**: `default`, `smooth-pip`, `gemstone` themes
- **Problem**: Dice bodies render transparent instead of solid colored base with texture overlay
- **Root Cause**: BabylonJS `StandardMaterial` doesn't support mixing solid base color with texture alpha channel like dice-box's `CustomMaterial` implementation
- **Expected**: Solid colored die body with pip/number texture applied on top
- **Actual**: Transparent die body showing through to background
- **Attempted Solutions**:
  - Tried `opacityTexture` - incorrect behavior (inverts transparency)
  - Tried `diffuseTexture` with `hasAlpha` - renders transparent
  - Tried `emissiveTexture` - lighting issues
  - Attempted `CustomMaterial` from dice-box - incomplete port
- **Current Workaround**: Color material themes disabled in `themeManager.ts`
  - Users can still use 5 working standard material themes
  - `diceOfRolling`, `wooden`, `blueGreenMetal`, `rust`, `smooth` all work perfectly
- **Permanent Solution Needed**: Implement custom shader using BabylonJS `ShaderMaterial` or `CustomMaterial`
  - Shader needs to blend base `diffuseColor` with texture alpha channel
  - Similar to dice-box's `ThemeLoader.js` CustomMaterial implementation
- **AI Prompt** (for custom shader implementation):
  ```
  Implement custom shader material for BISCUITS color material themes. Use BabylonJS ShaderMaterial or CustomMaterial to blend a solid base color with transparent RGBA texture overlays. Study dice-box ThemeLoader.js CustomMaterial implementation and port to BabylonJS. Re-enable default, smooth-pip, and gemstone themes once working.
  ```

#### Texture Offset Misalignment
- **Status**: ✅ Baseline UV coordinates added
- **Completed**: Added default UV coordinates (scale: 1.9/1.9, offset: 0.05/0.05) to all color material themes
- **Files Updated**:
  - `public/assets/themes/default/theme.config.json`
  - `public/assets/themes/gemstone/theme.config.json`
  - `public/assets/themes/smooth-pip/theme.config.json` (already had values)
- **Notes**:
  - Standard material themes (diceOfRolling, wooden, smooth, rust, blueGreenMetal) use baked texture atlases and don't need UV adjustments
  - Color material themes now have consistent baseline UV coordinates
  - **Fine-tuning still needed** once color material transparency bug is fixed (can't visually verify alignment on transparent dice)
  - Use DebugView (Alt+D) for precise adjustments after transparency fix
- **AI Prompt** (for after transparency fix):
  ```
  Use DebugView (Alt+D) to fine-tune UV coordinates for BISCUITS color material themes. Test each theme with all die types (d4-d20), adjust textureScale and textureOffset sliders until pips/numbers are perfectly centered, then update theme.config.json files with the refined values.
  ```

---

## 🟡 Medium Priority

### In-Progress Work

#### Theme System Polish
- **Status**: 5/5 enabled themes working perfectly ✅
- **Working**: diceOfRolling, wooden, smooth, rust, blueGreenMetal (standard material)
- **Disabled**: default, smooth-pip, gemstone (color material - transparency issue)
- **Tasks**:
  - [x] Added baseline UV coordinates to all themes
  - [x] Disabled problematic color material themes
  - [x] Documented workaround and permanent solution needed
  - [ ] Implement custom shader for color materials (future work)
  - [ ] Test all themes across different dice types (d4, d6, d8, d10, d12, d20)
  - [ ] Verify lighting/shadow consistency

#### Documentation Completion
- **Status**: 4/4 complete ✅
- **Completed**:
  - ✅ ARCHITECTURE.md (comprehensive system overview with logging system docs)
  - ✅ TODO.md (this file - active task tracking)
  - ✅ FUTURE-FEATURES.md (roadmap with AI prompts)
  - ✅ THEME-SYSTEM.md (complete theme development guide)

---

## 🟢 Low Priority / Backlog

### Performance Optimizations

#### Reduce Bundle Size
- **Current**: ~2.5MB production bundle
- **BabylonJS Core**: ~1.8MB (largest dependency)
- **Target**: <2MB total
- **Options**:
  - Tree-shake unused BabylonJS modules
  - Consider ES6 module imports instead of full core
  - Lazy-load theme assets
  - Optimize texture sizes (current: 1024x1024, consider 512x512)
- **AI Prompt**:
  ```
  Optimize the BISCUITS bundle size currently at ~2.5MB. Analyze vite.config.ts and package.json to reduce BabylonJS core imports, implement tree-shaking, and consider lazy-loading theme assets. Target <2MB production bundle.
  ```

#### Improve Frame Rate
- **Current**: 60fps on desktop, ~40fps on mobile
- **Target**: Stable 60fps across all devices
- **Options**:
  - Reduce shadow map resolution
  - Implement LOD for dice meshes
  - Optimize physics calculations
  - Consider worker thread for engine updates
- **AI Prompt**:
  ```
  Profile and optimize BISCUITS rendering performance. Focus on mobile devices where frame rate drops to ~40fps. Consider shadow optimization, LOD systems, and physics calculation improvements in src/render/diceRenderer.ts.
  ```

### Additional Themes

#### Import Community Themes
- **Source**: dice-box library has 20+ themes
- **Status**: 8 themes ported, 12+ available
- **Priority Themes**:
  - Gemstone (needs color material fix first)
  - Metal
  - Glass
  - Neon
- **Tasks**:
  - [ ] Port remaining dice-box themes
  - [ ] Create theme preview gallery
  - [ ] Add theme search/filter UI
- **AI Prompt**:
  ```
  Port additional themes from the dice-box library to BISCUITS. Focus on metal, glass, and neon themes. Each theme requires copying assets to src/assets/textures/{theme-name}/ and creating a theme.config.json following the existing pattern.
  ```

#### Create Original Themes
- **Ideas**:
  - Candy (colorful translucent)
  - Paper (origami style)
  - Ice (frosted transparent)
  - Circuit Board (tech aesthetic)
  - Galaxy (nebula textures)
- **AI Prompt**:
  ```
  Design and implement an original "Galaxy" theme for BISCUITS dice. Create or source nebula/star textures, configure theme.config.json with appropriate material properties, and test across all die types. Follow the theme system architecture in docs/THEME-SYSTEM.md.
  ```

### Mobile Experience

#### Touch Controls
- **Status**: Basic tap/swipe working
- **Improvements Needed**:
  - [ ] Add haptic feedback for rolls/selections
  - [ ] Improve touch target sizes (min 44x44px)
  - [ ] Add multi-touch gesture support
  - [ ] Better visual feedback for touch events
- **AI Prompt**:
  ```
  Enhance mobile touch controls for BISCUITS. Add haptic feedback, increase touch target sizes for die selection, and improve visual feedback. Update src/render/components/DiceRenderer.ts pointer event handlers.
  ```

#### Responsive UI
- **Status**: Layouts adapt but need polish
- **Issues**:
  - Score panel too small on mobile
  - Theme selector cramped
  - Tutorial text hard to read
- **AI Prompt**:
  ```
  Improve responsive design for BISCUITS mobile layout. Focus on score panel visibility, theme selector usability, and tutorial text readability on small screens. Update CSS in src/render/components/*.ts files.
  ```

### Code Quality

#### Test Coverage
- **Current**: 0% (no tests)
- **Target**: >80% coverage
- **Priority**:
  - [ ] Unit tests for engine layer (pure functions)
  - [ ] Integration tests for state management
  - [ ] Visual regression tests for themes
- **AI Prompt**:
  ```
  Set up testing infrastructure for BISCUITS. Create unit tests for src/engine/*.ts pure functions, integration tests for state management, and consider Playwright for visual regression testing of themes.
  ```

#### TypeScript Strictness
- **Current**: `strict: true` in tsconfig.json ✅
- **Improvements**:
  - [ ] Add JSDoc comments to all public APIs
  - [ ] Eliminate remaining `any` types
  - [ ] Add runtime type validation for config files
- **AI Prompt**:
  ```
  Improve TypeScript type safety in BISCUITS. Add JSDoc comments to all public APIs, eliminate any remaining 'any' types, and implement runtime validation for theme.config.json files using Zod or similar.
  ```

#### Refactoring Opportunities

**DiceRenderer.ts**
- **Issue**: 500+ lines, multiple responsibilities
- **Solution**: Extract theme application, animation, and face detection into separate modules
- **Priority**: Low (works well, just large)

**themeManager.ts**
- **Issue**: Texture loading logic could be more robust
- **Solution**: Add error handling, retry logic, and loading state management
- **Priority**: Medium (affects UX when themes fail to load)

**state.ts**
- **Issue**: Action log grows unbounded
- **Solution**: Implement circular buffer or periodic trimming
- **Priority**: Low (only matters for very long sessions)

---

## 📋 Technical Debt

### Cleanup Tasks

- [x] Remove unused imports across codebase
- [ ] Consolidate duplicate color utility functions
- [ ] Standardize error handling patterns
- [x] Add consistent logging with log levels
- [x] Document all magic numbers with constants

### Build System

- [x] Add development/production environment configs
- [ ] Set up automated deployment pipeline (GitHub Actions)
- [x] Add bundle size monitoring
- [x] Configure source maps for production debugging
- [ ] Add pre-commit hooks (lint, format, type-check)

### Dependencies

- [ ] Audit and update all dependencies to latest stable
- [x] Remove unused dependencies (audit package.json)
- [ ] Add dependency vulnerability scanning
- [ ] Document version constraints and upgrade paths

---

## ✅ Recently Completed

### Code Quality & Documentation (2026-02-24)
- ✅ Implemented centralized logging system with environment-aware levels
- ✅ Migrated 79+ console statements to logger utility across 10 files
- ✅ Extracted magic numbers to named constants in dice.ts
- ✅ Added comprehensive JSDoc documentation to engine and game layers
- ✅ Removed unused @babylonjs/materials package
- ✅ Cleaned up backup files (.bak)
- ✅ Enhanced themeManager with retry logic and validation
- ✅ Configured production source maps (hidden) for debugging
- ✅ Completed all project documentation (4/4 docs complete)
  - ARCHITECTURE.md updated with logging system
  - TODO.md updated with all completed work
  - FUTURE-FEATURES.md (comprehensive roadmap)
  - THEME-SYSTEM.md (complete theme dev guide)
- ✅ Added baseline UV coordinates to all color material themes
  - default, gemstone themes now have textureScale/textureOffset properties
  - Consistent 1.9/1.9 scale and 0.05/0.05 offset across color themes
  - Ready for fine-tuning once transparency bug is fixed
- ✅ Disabled problematic color material themes temporarily
  - default, smooth-pip, gemstone themes disabled in themeManager.ts
  - 5 working standard material themes remain available
  - Documented workaround and custom shader solution needed
  - Users have stable, working themes while custom shader is implemented

### Build/Deployment Fixes (2026-02-23)
- ✅ Fixed theme asset paths (changed `/src/assets/textures/` → `/assets/themes/`)
- ✅ Resolved TypeScript build errors (null checks, texture types)
- ✅ Fixed game over crash (added null check for share link element)
- ✅ Copied all 8 theme folders to public/assets/themes/
- ✅ Updated Vite config for proper asset handling

### Theme System Implementation (2026-02-22)
- ✅ Implemented theme hot-swapping with ThemeManager
- ✅ Added 8 working themes (5 standard, 3 color material)
- ✅ Created DebugView for texture adjustment (Alt+D)
- ✅ Added observer pattern for theme change notifications
- ✅ Implemented theme persistence to localStorage

### Documentation (2026-02-24)
- ✅ Created comprehensive ARCHITECTURE.md
- ✅ Created TODO.md (this file)

---

## 🎯 Next Sprint Goals

1. **Fix color material transparency** (HIGH - blocks 3 themes)
2. **Complete documentation** (TODO.md ✅, FUTURE-FEATURES.md, THEME-SYSTEM.md)
3. **Fine-tune all theme UV coordinates** (MEDIUM)
4. **Add 2-3 new themes** (LOW)
5. **Improve mobile touch controls** (MEDIUM)

---

## Notes

- Keep this file updated as work progresses
- Mark items as ✅ when completed, move to "Recently Completed" section
- Add AI prompts for all new features/bugs for easy context restoration
- Link to relevant files/line numbers where possible
- Update "Last Updated" date at top when making changes
