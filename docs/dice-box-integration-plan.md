# dice-box Integration Plan - Phase 1

## Overview
Integrating high-quality textures and rendering techniques from the dice-box open-source project to improve dice visibility and visual quality in BISCUITS.

**Source**: https://github.com/3d-dice/dice-box  
**License**: MIT  
**Author**: Frank Ali

---

## Phase 1: Texture Integration ✅ COMPLETE

### Goal
Replace procedural textures with UV-mapped textures for better readability and visual quality.

### Assets Copied

dice-box/themes/smooth-pip/ → src/assets/textures/smooth-pip/ ├── pips-light.png (white numbers/pips on transparent) ├── pips-dark.png (black numbers/pips on transparent) └── pips-normal.png (normal map for surface depth)

### Implementation Steps

#### ✅ Step 1: Asset Setup (COMPLETED)
- Created `src/assets/textures/smooth-pip/` directory
- Copied 3 texture files from dice-box
- Created `src/assets/textures/ATTRIBUTION.md`

#### ✅ Step 2: Update Dice Renderer (COMPLETED)

**File**: `src/render/dice.ts`

**Changes Required**:

1. **Add texture loading at class level**:
```typescript
export class DiceRenderer {
  private meshes = new Map<string, Mesh>();
  private selectedMeshes = new Set<string>();
  private shadowGenerator: ShadowGenerator | null = null;
  private highlightLayer: HighlightLayer;
  private colorIndex = 0;
  private dieColors = new Map<string, string>();
  
  // NEW: Add texture cache
  private diffuseTextureLightCache: Texture | null = null;
  private diffuseTextureDarkCache: Texture | null = null;
  private normalTextureCache: Texture | null = null;
```

1. **Add texture loading method**:
2. /**
    * Load UV-mapped textures from dice-box smooth-pip theme
    * Textures adapted from dice-box by Frank Ali
    * @see https://github.com/3d-dice/dice-box
    * @license MIT
      */
      private loadTextures(): void {
      const basePath = "/src/assets/textures/smooth-pip";

   // Load diffuse textures (light and dark variants)
   this.diffuseTextureLightCache = new Texture(`${basePath}/pips-light.png`, this.scene);
   this.diffuseTextureLightCache.hasAlpha = true;

   this.diffuseTextureDarkCache = new Texture(`${basePath}/pips-dark.png`, this.scene);
   this.diffuseTextureDarkCache.hasAlpha = true;

   // Load normal map for surface detail
   this.normalTextureCache = new Texture(`${basePath}/pips-normal.png`, this.scene);
   }
3. **Call loadTextures in constructor**:
   constructor(private scene: Scene) {
   const generators = this.scene.lights
   .map((light) => light.getShadowGenerator())
   .filter((gen): gen is ShadowGenerator => gen !== null);
   this.shadowGenerator = generators[0] || null;

   // Create highlight layer for selection glow
   this.highlightLayer = new HighlightLayer("highlight", this.scene);
   this.highlightLayer.blurHorizontalSize = 1.0;
   this.highlightLayer.blurVerticalSize = 1.0;

   // NEW: Load textures
   this.loadTextures();
   }

5. **Update applyTexture method** (around line 185):

Replace the entire `applyTexture` method with:

/**
* Apply UV-mapped textures to dice material
* Uses textures from dice-box smooth-pip theme
  */
  private applyTexture(die: DieState, mat: StandardMaterial) {
  const baseColor = mat.diffuseColor;

    // Determine if we need light or dark numbers based on base color brightness
    const brightness = (baseColor.r + baseColor.g + baseColor.b) / 3;
    const useLightTexture = brightness < 0.5; // Dark dice get light numbers
    
    // Apply diffuse texture with alpha blending
    mat.diffuseTexture = useLightTexture 
      ? this.diffuseTextureLightCache! 
      : this.diffuseTextureDarkCache!;
    mat.diffuseTexture.hasAlpha = true;
    mat.useAlphaFromDiffuseTexture = true;
    
    // Apply normal map for depth
    mat.bumpTexture = this.normalTextureCache!;
    mat.bumpTexture.level = 0.5; // Subtle depth effect
    
    // Enhance material properties for better appearance
    mat.specularPower = 32; // Moderate shininess
    mat.specularColor = new Color3(0.3, 0.3, 0.3); // Subtle highlights
    
    // Keep emissive for slight glow effect
    mat.emissiveTexture = mat.diffuseTexture;
    mat.emissiveColor = new Color3(0.1, 0.1, 0.1);
}

1. **Remove old texture generation methods**:

Delete these methods (no longer needed):
- `createD6Texture()` (lines ~208-240)
- `createPolyhedralTexture()` (lines ~242-259)
- `drawPipsOnFace()` (lines ~261-303)
- `drawPips()` (lines ~305-348)
- `drawEngravedNumeral()` (lines ~350-390)

1. **Add attribution comment at top of file**:

#### Step 3: Test & Verify
After code changes:
1. Run `npm run dev`
2. Start a game and roll dice
3. Verify:
    - ✅ Pips on d6 are clear and readable
    - ✅ Numbers on d8, d10, d12 are visible
    - ✅ Colors still work correctly
    - ✅ Normal map adds subtle depth
    - ✅ No console errors

### Expected Results
**Before**:
- Procedural white pips hard to see on light dice
- Numbers blend into die color
- Flat appearance

**After**:
- High-contrast pips and numbers
- Automatic light/dark text based on die color
- Subtle 3D depth from normal map
- Professional texture quality

## Phase 2: Geometry & Positioning ✅ COMPLETE
### Goal
Fix d8/d12 sinking into table and improve positioning.

### Assets Added
- ✅ Downloaded `smoothDice.json` from dice-box/dice-themes
- ✅ Created `geometryLoader.ts` module for loading 3D models
- ✅ Integrated d8 and d12 imported geometries with fallback support

### Changes Implemented
- ✅ Created geometry loader that imports d8/d12 3D models from dice-box
- ✅ Updated DiceRenderer to use imported geometries instead of Babylon polyhedra
- ✅ Added colliderFaceMap support for accurate face detection
- ✅ Adjusted landing positions: d8 now lands at 0.65 (was 0.8), d12 at 0.7 (was 0.9)
- ✅ Proper scaling applied to imported meshes (1.5x base size)
- ✅ Fallback to procedural geometry if import fails

### Files Modified
- `src/render/dice.ts` - Updated to use imported geometries
- `src/render/geometryLoader.ts` - New module for loading dice geometry
- `src/assets/textures/smooth-pip/smoothDice.json` - 143KB geometry data file

### Status
✅ **Complete** - d8 and d12 now use proper geometry and sit naturally on table
## Phase 3: Raycasting Face Detection (PLANNED)
### Goal
More accurate face value detection using raycasting technique.
### Implementation
- Adapt `getRollResult()` method from dice-box
- Use raycasting to detect upward-facing mesh face
- Map face ID to die value using colliderFaceMap

### Status
⏸️ **On Hold** - Nice to have, current rotation system works
## License & Attribution
### dice-box License
MIT License
Copyright (c) Frank Ali
### Our Usage
- Textures: smooth-pip theme
- Technique: UV mapping approach
- Modifications: Color integration, Babylon.js adaptation

### Attribution Requirements
- ✅ Source credited in code comments
- ✅ ATTRIBUTION.md created in assets folder
- ✅ License noted in documentation
- ✅ Original author credited (Frank Ali)

## Rollback Plan
If issues occur:``` bash
git checkout main
git branch -D dice-box-integration
```

All changes are isolated to new branch.
 
## Progress Tracking
- ✅ Phase 1 - Step 1: Asset setup
- ✅ Phase 1 - Step 2: Code implementation
- ✅ Phase 1 - Step 3: Testing
- ✅ Phase 2: Geometry improvements
- ⏸️ Phase 3: Raycasting (optional - on hold)
 
Notes
Keep muted color palette (already implemented)
Maintain existing dice animation system
Preserve current game mechanics
Only improve visuals, not gameplay
