# BISCUITS Theme System

**Complete guide to understanding, using, and creating dice themes**

This document explains the architecture of BISCUITS' modular theme system, how to add new themes, and how to troubleshoot common issues.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Material Types](#material-types)
4. [Theme Configuration](#theme-configuration)
5. [Adding New Themes](#adding-new-themes)
6. [Texture Requirements](#texture-requirements)
7. [Debug Tools](#debug-tools)
8. [Current Themes Status](#current-themes-status)
9. [Troubleshooting](#troubleshooting)
10. [Advanced Topics](#advanced-topics)

---

## Overview

The BISCUITS theme system allows dynamic visual customization of dice through:

- **Hot-swappable themes** - Switch themes mid-game without reload
- **Two material types** - Standard (baked textures) and Color (base color + overlay)
- **Per-die-type support** - Themes can support different dice (d4, d6, d8, etc.)
- **Live texture adjustment** - Debug view for fine-tuning UV coordinates
- **Persistent selection** - Theme choice saved to localStorage

**Key Files**:
- `src/services/themeManager.ts` - Core theme loading and management
- `src/render/dice.ts` - Theme application to dice meshes
- `src/render/components/ThemeSelector.ts` - UI for theme switching
- `src/render/components/DebugView.ts` - Live texture adjustment tool
- `src/assets/textures/*/theme.config.json` - Theme definitions

---

## Architecture

### ThemeManager (Singleton)

The `ThemeManager` is responsible for:

1. **Loading theme configs** from `theme.config.json` files
2. **Validating configurations** against schema
3. **Notifying observers** when theme changes (Observer pattern)
4. **Caching loaded themes** for performance
5. **Persisting selection** to localStorage

```typescript
// Usage example
import { themeManager } from './services/themeManager';

// Load a theme
await themeManager.loadTheme('smooth-pip');

// Get current theme
const currentTheme = themeManager.getCurrentTheme();

// Listen for theme changes
themeManager.addObserver((newTheme) => {
  console.log(`Theme changed to: ${newTheme.name}`);
});
```

### DiceRenderer Integration

When a theme changes:

1. `ThemeManager` notifies all registered observers
2. `DiceRenderer` receives notification
3. Each die mesh has materials updated via `applyThemeToMesh()`
4. Textures loaded asynchronously from theme path
5. Material properties (bump, specular, scale) applied
6. Scene re-renders with new appearance

```typescript
// From src/render/dice.ts
private applyThemeToMesh(mesh: Mesh, theme: ThemeConfig) {
  const material = new StandardMaterial(`${theme.systemName}-mat`, this.scene);

  if (theme.material.type === 'color') {
    // Color material: base color + texture overlay
    this.applyColorMaterial(material, theme);
  } else {
    // Standard material: baked texture atlas
    this.applyStandardMaterial(material, theme);
  }

  mesh.material = material;
}
```

---

## Material Types

BISCUITS supports two distinct material types, each suited for different visual styles.

### Standard Material

**Best for**: Realistic dice with baked lighting, complex textures

**Characteristics**:
- Single texture atlas contains all die faces
- Lighting baked into diffuse texture
- Minimal runtime lighting calculation
- Best performance
- Examples: `diceOfRolling`, `wooden`, `rust`, `lava`

**Theme Config**:
```json
{
  "material": {
    "type": "standard",
    "diffuseTexture": {
      "light": "diffuse-light.png",
      "dark": "diffuse-dark.png"
    },
    "bumpTexture": "normal.png",
    "specularTexture": "specular.jpg",
    "specularPower": 32
  }
}
```

**Texture Layout**:
- Each die type (d4, d6, d8, etc.) has pre-arranged face textures
- UV mapping defined in mesh geometry file
- Pips/numbers baked into diffuse texture
- Normal maps provide surface detail

### Color Material

**Best for**: Solid-colored dice with overlaid pips/numbers, customizable colors

**Characteristics**:
- Base die color defined in config or customizable
- Separate transparent texture for pips/numbers
- More flexible for color variations
- Examples: `default`, `smooth-pip`, `gemstone` (⚠️ transparency issue)

**Theme Config**:
```json
{
  "material": {
    "type": "color",
    "diffuseTexture": {
      "light": "pips-light-rgba.png",
      "dark": "pips-dark-rgba.png"
    },
    "bumpTexture": "pips-normal-rgba.png",
    "diffuseLevel": 1.0,
    "bumpLevel": 0.75,
    "textureScale": { "u": 1.9, "v": 1.9 },
    "textureOffset": { "u": 0.05, "v": 0.05 }
  }
}
```

**Texture Layout**:
- RGBA PNG with transparent background
- Pips/numbers in alpha channel
- Can be tinted/recolored at runtime
- Requires proper alpha blending

**⚠️ Known Issue**: Color materials currently render transparent instead of solid colored base. See [TODO.md](./TODO.md#color-material-transparency-issue) for details.

---

## Theme Configuration

Every theme requires a `theme.config.json` file in its directory.

### Required Fields

```json
{
  "name": "Human-readable theme name",
  "systemName": "folder-name-kebab-case",
  "author": "Creator name",
  "version": 1.0,
  "meshFile": "smoothDice.json",
  "material": { /* see below */ },
  "diceAvailable": ["d4", "d6", "d8", "d10", "d12", "d20", "d100"]
}
```

### Material Configuration

#### For Standard Materials:

```json
{
  "type": "standard",
  "diffuseTexture": {
    "light": "diffuse-light.png",  // Light mode texture
    "dark": "diffuse-dark.png"     // Dark mode texture (optional)
  },
  "bumpTexture": "normal.png",     // Normal map (optional)
  "specularTexture": "specular.jpg", // Specular map (optional)
  "specularPower": 32,             // Shininess (1-128)
  "diffuseLevel": 1.0              // Brightness (0-2)
}
```

#### For Color Materials:

```json
{
  "type": "color",
  "diffuseTexture": {
    "light": "pips-light-rgba.png",
    "dark": "pips-dark-rgba.png"
  },
  "bumpTexture": "pips-normal-rgba.png",
  "diffuseLevel": 1.0,
  "bumpLevel": 0.75,
  "specularPower": 32,
  "textureScale": {
    "u": 1.9,    // Horizontal scale
    "v": 1.9     // Vertical scale
  },
  "textureOffset": {
    "u": 0.05,   // Horizontal offset
    "v": 0.05    // Vertical offset
  }
}
```

### Optional Fields

```json
{
  "themeColor": "#aa4f4a",         // UI accent color (hex)
  "description": "Theme description for marketplace",
  "tags": ["metal", "shiny"],      // Searchable tags
  "thumbnail": "preview.jpg"       // Preview image
}
```

---

## Adding New Themes

### Step-by-Step Guide

#### 1. Create Theme Directory

```bash
mkdir src/assets/textures/my-theme
```

#### 2. Add Required Assets

Minimum files needed:
```
src/assets/textures/my-theme/
├── theme.config.json
├── diffuse-light.png
├── diffuse-dark.png  (optional but recommended)
└── normal.png        (optional)
```

#### 3. Create theme.config.json

Start with this template:

```json
{
  "name": "My Awesome Theme",
  "systemName": "my-theme",
  "author": "Your Name",
  "version": 1.0,
  "meshFile": "smoothDice.json",
  "material": {
    "type": "standard",
    "diffuseTexture": {
      "light": "diffuse-light.png",
      "dark": "diffuse-dark.png"
    },
    "bumpTexture": "normal.png",
    "diffuseLevel": 1.0,
    "specularPower": 32
  },
  "diceAvailable": ["d4", "d6", "d8", "d10", "d12", "d20"]
}
```

#### 4. Copy to Public Folder

For production builds, themes must be in `public/`:

```bash
cp -r src/assets/textures/my-theme public/assets/themes/my-theme
```

**Important**: Update your build script to copy new themes automatically.

#### 5. Test with Debug View

1. Start dev server: `npm run dev`
2. Open game in browser
3. Press `Alt+D` to open DebugView
4. Select your theme from dropdown
5. Adjust texture scale/offset if needed
6. Save updated config values

#### 6. Update Theme List

Add your theme to `src/services/themeManager.ts` available themes list:

```typescript
const AVAILABLE_THEMES = [
  'default',
  'smooth',
  'smooth-pip',
  'wooden',
  'diceOfRolling',
  'rust',
  'lava',
  'my-theme'  // Add here
];
```

---

## Texture Requirements

### File Formats

- **Diffuse/Color**: PNG (RGBA) or JPG
- **Normal Maps**: PNG (RGB)
- **Specular Maps**: JPG or PNG

### Recommended Sizes

- **Standard materials**: 1024x1024 or 2048x2048
- **Color materials**: 512x512 or 1024x1024
- **Mobile optimization**: 512x512 maximum

### Texture Atlases (Standard Material)

Standard materials use texture atlases with all die faces arranged in a grid:

```
+-----+-----+-----+-----+
| d4  | d6  | d8  | d10 |
| (4) | (6) | (8) | (10)|
+-----+-----+-----+-----+
| d12 | d20 |d100 | --- |
| (12)| (20)| (2) | --- |
+-----+-----+-----+-----+
```

- Each cell contains all faces for that die type
- UV coordinates defined in mesh geometry
- Must match layout in mesh file

### Color Material Textures

Color materials use RGBA PNGs:

- **RGB channels**: Pip/number appearance (can be white for tinting)
- **Alpha channel**: Defines visible areas (transparent = die body, opaque = pip)
- Background must be fully transparent
- Sharp edges or anti-aliased (your choice)

**Example workflow**:
1. Create pip/number shapes on transparent background
2. Add subtle edge glow/shadow for depth
3. Export as RGBA PNG
4. Create normal map from height data (optional)

---

## Debug Tools

### DebugView (Alt+D)

Press `Alt+D` in-game to open the debug panel:

**Features**:
- Theme selector dropdown
- Live texture scale sliders (U/V)
- Live texture offset sliders (U/V)
- Real-time preview on dice
- Export button for updated config

**Usage**:
1. Select theme to debug
2. Roll dice to see all faces
3. Adjust sliders until perfectly aligned
4. Click "Export Config" to get updated JSON
5. Copy values to `theme.config.json`

**Keyboard Shortcuts**:
- `Alt+D` - Toggle DebugView
- `R` - Roll dice (to see different faces)
- `Esc` - Close DebugView

### Browser DevTools

Use browser console for deeper debugging:

```javascript
// Get current theme
themeManager.getCurrentTheme()

// Force theme load
await themeManager.loadTheme('my-theme')

// Inspect material properties
scene.meshes.forEach(m => console.log(m.material))

// Check texture loading
scene.textures.forEach(t => console.log(t.name, t.isReady()))
```

### Performance Monitoring

Enable BabylonJS inspector:

```typescript
// Add to src/render/scene.ts
scene.debugLayer.show();
```

---

## Current Themes Status

### ✅ Working Perfectly (Standard Material)

#### diceOfRolling
- **Type**: Standard
- **Style**: Glossy casino dice with red pips
- **Status**: ✅ Perfect
- **Notes**: Original dice-box theme, excellent reference

#### wooden
- **Type**: Standard
- **Style**: Natural wood grain with carved numbers
- **Status**: ✅ Perfect
- **Notes**: Great normal mapping, realistic

#### smooth
- **Type**: Standard
- **Style**: Clean matte finish with modern numerals
- **Status**: ✅ Perfect
- **Notes**: Good for minimalist aesthetic

#### rust
- **Type**: Standard
- **Style**: Weathered metal with orange patina
- **Status**: ✅ Perfect
- **Notes**: Nice specular highlights
- **Color**: `#aa4f4a` (rusty orange)

#### lava
- **Type**: Standard
- **Style**: Molten rock with glowing cracks
- **Status**: ✅ Perfect
- **Notes**: Dramatic emissive effect

### ⚠️ Issues (Color Material)

#### default
- **Type**: Color
- **Style**: Solid colors with pip overlays
- **Status**: ⚠️ Transparency bug
- **Issue**: Die bodies render transparent instead of solid colored
- **Workaround**: Use standard material themes instead

#### smooth-pip
- **Type**: Color
- **Style**: Smooth dice with raised pip textures
- **Status**: ⚠️ Transparency bug
- **Issue**: Same as default theme
- **Notes**: Good UV mapping, just needs material fix

#### gemstone
- **Type**: Color
- **Style**: Translucent gem-like dice
- **Status**: ⚠️ Transparency bug
- **Issue**: Unintentionally fully transparent
- **Notes**: Should be semi-transparent, not invisible

---

## Troubleshooting

### Problem: Textures Not Loading

**Symptoms**: Dice appear white/gray with no details

**Causes**:
1. Incorrect file paths in `theme.config.json`
2. Theme folder not copied to `public/assets/themes/`
3. Texture files missing or wrong format

**Solutions**:
```bash
# Check file paths match exactly
ls public/assets/themes/my-theme/

# Verify config paths (case-sensitive!)
cat public/assets/themes/my-theme/theme.config.json

# Check browser console for 404 errors
# Open DevTools → Console → Look for failed texture loads
```

### Problem: UV Misalignment

**Symptoms**: Pips/numbers off-center on die faces

**Causes**:
1. Wrong `textureScale` values
2. Wrong `textureOffset` values
3. Mesh geometry doesn't match texture layout

**Solutions**:
1. Open DebugView (`Alt+D`)
2. Roll dice to see all faces
3. Adjust scale sliders (typically 1.8-2.0)
4. Adjust offset sliders (typically 0.0-0.1)
5. Export and update config

**Common Values**:
- Most themes: `scale: {u: 1.9, v: 1.9}, offset: {u: 0.05, v: 0.05}`
- Wooden theme: `scale: {u: 1.0, v: 1.0}, offset: {u: 0.0, v: 0.0}`

### Problem: Dice Too Dark/Bright

**Causes**:
1. `diffuseLevel` too low/high
2. Missing or incorrect lighting in scene
3. Wrong `specularPower` value

**Solutions**:
```json
{
  "diffuseLevel": 1.0,  // Try 0.8-1.2 range
  "specularPower": 32,  // Lower = more shine (16), higher = less (64)
  "bumpLevel": 0.75     // Subtle (0.5) to pronounced (1.5)
}
```

### Problem: Performance Issues

**Symptoms**: Low FPS, stuttering when rolling

**Causes**:
1. Textures too large (>2048px)
2. Too many active dice (>20)
3. Heavy normal/specular maps

**Solutions**:
1. Resize textures to 1024x1024 or smaller
2. Use texture compression (consider .ktx2 format)
3. Reduce `bumpLevel` or remove normal maps
4. Lower shadow quality in settings

---

## Advanced Topics

### Custom Mesh Geometry

BISCUITS supports custom dice meshes via `meshFile` property:

```json
{
  "meshFile": "myCustomDice.json"
}
```

**Mesh File Format** (BabylonJS serialized):
- Vertices, normals, UVs for each die type
- Face orientation for value detection
- Collision geometry

**Creating Custom Meshes**:
1. Model dice in Blender/Maya
2. Export as `.glb` or `.babylon`
3. Convert to JSON using BabylonJS tools
4. Define face orientations for scoring

### Dynamic Color Tinting

For color materials, you can tint at runtime:

```typescript
// In DiceRenderer
const material = mesh.material as StandardMaterial;
material.diffuseColor = new Color3(1, 0, 0); // Red tint
```

**Use cases**:
- Player-specific colors in multiplayer
- Color picker UI
- Status indicators (hot/cold streaks)

### Shader-Based Effects

Advanced themes can use custom shaders:

```typescript
import { CustomMaterial } from '@babylonjs/materials';

const material = new CustomMaterial('custom', scene);
material.AddUniform('time', 'float');
material.Fragment_Custom_Diffuse(`
  // Animated effect
  vec3 glow = vec3(sin(time), cos(time), 1.0);
  baseColor.rgb += glow * 0.1;
`);
```

**Examples**:
- Animated lava glow
- Holographic shimmer
- Pulsing highlights

### Theme Variants

Create theme families with shared assets:

```
themes/
├── rust/
│   ├── theme.config.json         (base config)
│   ├── variant-light.config.json
│   └── variant-heavy.config.json
```

Share textures, vary material properties:
```json
{
  "extends": "rust/theme.config.json",
  "name": "Rust - Heavy Weathering",
  "material": {
    "bumpLevel": 1.5,  // Override
    "specularPower": 16
  }
}
```

---

## Best Practices

### Theme Design

1. **Test early, test often** - Use DebugView from the start
2. **Support all die types** - d4, d6, d8, d10, d12, d20 minimum
3. **Provide light/dark variants** - Better UX
4. **Optimize texture sizes** - Mobile users will thank you
5. **Include normal maps** - Adds depth with minimal cost
6. **Pick appropriate material type**:
   - Standard for complex/realistic textures
   - Color for customizable/simple designs

### Performance

1. **Texture budget**: Keep total textures <10MB
2. **Reuse materials**: Share materials between similar dice
3. **Lazy load themes**: Don't load all themes at startup
4. **Compress textures**: Use tools like `pngquant`, `imagemin`
5. **Profile on target devices**: Test on mobile, not just desktop

### Accessibility

1. **High contrast** - Ensure pips/numbers visible
2. **Colorblind-friendly** - Don't rely on color alone
3. **Clear typography** - Readable numbers at distance
4. **Avoid strobing** - No rapid flashing effects

---

## Reference

### ThemeConfig TypeScript Interface

```typescript
export interface ThemeConfig {
  name: string;
  systemName: string;
  author: string;
  version: number;
  meshFile: string;
  material: {
    type: 'standard' | 'color';
    diffuseTexture?: string | { light: string; dark: string };
    bumpTexture?: string;
    specularTexture?: string;
    diffuseLevel?: number;
    bumpLevel?: number;
    specularPower?: number;
    textureScale?: { u: number; v: number };
    textureOffset?: { u: number; v: number };
  };
  themeColor?: string;
  description?: string;
  diceAvailable: DieKind[];
  thumbnail?: string;
}
```

### File Paths

```
Project Structure:
src/assets/textures/{theme}/   - Source themes (development)
public/assets/themes/{theme}/  - Built themes (production)

Theme Files:
{theme}/
├── theme.config.json          - Required
├── diffuse-light.png          - Required
├── diffuse-dark.png           - Recommended
├── normal.png                 - Optional
├── specular.jpg               - Optional
└── preview.jpg                - Optional (for marketplace)
```

---

## Additional Resources

- **BabylonJS Docs**: https://doc.babylonjs.com/
- **dice-box Source**: https://github.com/fantasycalendar/FoundryVTT-FriendsAndFoes
- **Texture Tools**:
  - Normal map generation: https://cpetry.github.io/NormalMap-Online/
  - PBR texture creation: https://www.substance3d.com/
  - UV unwrapping: Blender (free)

---

**Last Updated**: 2026-02-24
**Document Version**: 1.0

**Need Help?**
- See [TODO.md](./TODO.md) for known issues
- Check [ARCHITECTURE.md](./ARCHITECTURE.md) for system overview
- Open GitHub issue for theme-specific problems
