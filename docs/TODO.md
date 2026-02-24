# BISCUITS - TODO List

**Project Status**: Active Development • v1.0 • Last Updated: 2026-02-24

This document tracks all pending work, active bugs, technical debt, and backlog items for the BISCUITS project.

---

## 🔴 High Priority

### Active Bugs

#### Color Material Transparency Issue
- **Status**: BLOCKING for 3 themes
- **Affects**: `default`, `smooth-pip`, `gemstone` themes
- **Problem**: Dice bodies render transparent instead of solid colored base with texture overlay
- **Root Cause**: BabylonJS `StandardMaterial` doesn't support mixing solid base color with texture alpha channel like dice-box's `CustomMaterial` implementation
- **Expected**: Solid colored die body with pip/number texture applied on top
- **Actual**: Transparent die body showing through to background
- **Attempted Solutions**:
  - Tried `opacityTexture` - incorrect behavior
  - Tried `diffuseTexture` alone - no base color
  - Tried `emissiveTexture` - lighting issues
  - Attempted `CustomMaterial` from dice-box - incomplete port
- **Next Steps**: Implement custom shader following dice-box `ThemeLoader.js` pattern
- **AI Prompt**:
  ```
  Fix the color material transparency issue in the BISCUITS theme system. The default, smooth-pip, and gemstone themes should show solid colored dice with texture overlays, but currently render transparent. Study src/services/themeManager.ts and the dice-box CustomMaterial implementation to create a shader that mixes base color with texture alpha channel.
  ```

#### Texture Offset Misalignment
- **Status**: Minor visual issue
- **Affects**: Some themes have slight UV coordinate misalignment
- **Problem**: Pips/numbers don't perfectly center on die faces for all themes
- **Solution**: Use DebugView to fine-tune `textureScale` and `textureOffset` values
- **Files**: `src/assets/textures/*/theme.config.json`
- **AI Prompt**:
  ```
  Review and adjust texture UV coordinates for all BISCUITS themes. Use the DebugView (Alt+D) to test each theme and fine-tune textureScale and textureOffset values in theme.config.json files to ensure perfect alignment of pips/numbers on all die faces.
  ```

---

## 🟡 Medium Priority

### In-Progress Work

#### Theme System Polish
- **Status**: 5/8 themes working perfectly
- **Working**: diceOfRolling, wooden, smooth, rust, lava (standard material)
- **Issues**: default, smooth-pip, gemstone (color material)
- **Tasks**:
  - [ ] Fix color material shader (see above)
  - [ ] Fine-tune UV coordinates for all themes
  - [ ] Test all themes across different dice types (d4, d6, d8, d10, d12, d20)
  - [ ] Verify lighting/shadow consistency

#### Documentation Completion
- **Status**: 1/4 complete
- **Completed**: ✅ ARCHITECTURE.md
- **In Progress**: TODO.md (this file)
- **Pending**: FUTURE-FEATURES.md, THEME-SYSTEM.md

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

- [ ] Remove unused imports across codebase
- [ ] Consolidate duplicate color utility functions
- [ ] Standardize error handling patterns
- [ ] Add consistent logging with log levels
- [ ] Document all magic numbers with constants

### Build System

- [ ] Add development/production environment configs
- [ ] Set up automated deployment pipeline (GitHub Actions)
- [ ] Add bundle size monitoring
- [ ] Configure source maps for production debugging
- [ ] Add pre-commit hooks (lint, format, type-check)

### Dependencies

- [ ] Audit and update all dependencies to latest stable
- [ ] Remove unused dependencies (audit package.json)
- [ ] Add dependency vulnerability scanning
- [ ] Document version constraints and upgrade paths

---

## ✅ Recently Completed

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
