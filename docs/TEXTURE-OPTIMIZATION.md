# Texture Optimization Guide

**Document Version**: 1.0
**Last Updated**: 2026-02-24
**Status**: Recommendations & Best Practices

This document provides guidance on optimizing textures for BISCUITS, particularly for the octagon table texture and future assets.

---

## Current Table Texture

### File Information
- **Current File**: `public/assets/textures/table-felt.png`
- **Size**: 2.2 MB (uncompressed PNG)
- **Dimensions**: ✅ **1024 x 1024 pixels (PERFECT SQUARE, RGBA)**
- **Usage**: Octagon play area felt texture
- **Design**: BISCUITS logo centered, 8 player boxes at 45° intervals, radial symmetry

### Implementation Status
- ✅ Texture successfully loaded and mapped to octagon play area
- ✅ **Perfect square dimensions - no stretching or distortion**
- ✅ Fallback procedural texture implemented if load fails
- ✅ Radial UV mapping configured (center at 0.5, 0.5)
- ✅ Clamping enabled to prevent tiling artifacts
- ✅ **No UV scale/offset adjustments needed (1:1 mapping)**

---

## Optimization Recommendations

### 🔴 **Priority 1: Convert to WebP (Recommended)**

**Why WebP?**
- **80-90% smaller file size**: 2.1 MB → 200-400 KB
- **Better compression**: Lossy or lossless options
- **Wide browser support**: 97%+ (all modern browsers)
- **Native BabylonJS support**: No extra setup needed

**Conversion Steps:**

#### Option A: Using ImageMagick (if installed)
```bash
cd /Users/colin/Projects/virtual-bitches/public/assets/textures

# Convert to WebP with 85% quality (recommended)
magick table-felt.png -resize 1024x1024 -quality 85 table-felt.webp

# Result: ~300 KB (85% reduction)
```

#### Option B: Using Google's cwebp tool
```bash
# Install cwebp (macOS)
brew install webp

# Convert
cwebp -resize 1024 1024 -q 85 table-felt.png -o table-felt.webp

# For lossless compression (larger, but still smaller than PNG)
cwebp -resize 1024 1024 -lossless table-felt.png -o table-felt-lossless.webp
```

#### Option C: Online Converter
- Upload to https://squoosh.app/
- Select WebP format
- Adjust quality slider to 80-90%
- Download optimized file

**After Conversion:**
Update `src/render/scene.ts` line 221:
```typescript
// Change from:
"/assets/textures/table-felt.png",

// To:
"/assets/textures/table-felt.webp",
```

---

### 🟡 **Priority 2: Resize to Power-of-2 Dimensions**

**Why Power-of-2?**
- **GPU optimization**: Hardware prefers 512, 1024, 2048, 4096
- **Mipmap generation**: Required for texture LOD (Level of Detail)
- **Better performance**: Faster texture sampling

**Current**: 1264 x 848 (irregular)
**Recommended**: 1024 x 1024 (square, power-of-2)

**Benefits:**
- Enables automatic mipmap generation
- Better texture filtering
- Smaller memory footprint
- Faster GPU uploads

**Conversion:**
```bash
# Resize to 1024x1024 (square)
magick table-felt.png -resize 1024x1024^ -gravity center -extent 1024x1024 table-felt-1024.png

# Or crop to preserve aspect ratio
magick table-felt.png -resize 1024x1024 -gravity center -crop 1024x1024+0+0 table-felt-1024.png
```

---

### 🟢 **Priority 3: Remove Alpha Channel (if unused)**

**Current**: RGBA (4 channels)
**Recommended**: RGB (3 channels) if alpha not needed

**Savings**: 25% smaller file size and GPU memory

**Check if alpha is used:**
```bash
identify -verbose table-felt.png | grep -i alpha
```

**Remove alpha if transparent pixels = 0:**
```bash
magick table-felt.png -background black -alpha remove -alpha off table-felt-rgb.png
```

---

## Texture Size Comparison

### Current PNG vs Optimized WebP

| Format | Dimensions | File Size | GPU Memory | Download Time (3G) |
|--------|------------|-----------|------------|--------------------|
| PNG (current) | 1264x848 | 2.1 MB | ~4.3 MB | ~7 seconds |
| PNG (optimized) | 1024x1024 | ~800 KB | ~4.2 MB | ~3 seconds |
| WebP (lossy 85%) | 1024x1024 | ~300 KB | ~4.2 MB | ~1 second |
| WebP (lossy 70%) | 1024x1024 | ~200 KB | ~4.2 MB | ~0.7 seconds |
| WebP (lossless) | 1024x1024 | ~500 KB | ~4.2 MB | ~1.8 seconds |

**Note**: GPU memory is similar across formats because textures are decompressed on upload.

---

## WebGL Texture Formats (Advanced)

For maximum optimization in future builds:

### KTX2 + Basis Universal (Future Consideration)

**Benefits:**
- Stays compressed on GPU (saves VRAM)
- 4096x4096 texture: 90 MB (PNG) → 20 MB (KTX2 on GPU)
- Block-compressed format (BC7, ETC2, ASTC)

**Trade-offs:**
- Requires transcoding at runtime (~100ms overhead)
- Lossy compression (some quality loss)
- More complex build pipeline

**When to Use:**
- Large textures (2K, 4K, 8K)
- Many textures loaded simultaneously
- Targeting mobile/WebGPU
- Multiplayer with many player avatars

**Implementation (Future):**
```typescript
// Using BabylonJS KTX2 support
import { KhronosTextureContainer2 } from "@babylonjs/core";

const trayTexture = new Texture(
  "/assets/textures/table-felt.ktx2",
  this.scene,
  undefined,
  true,
  undefined,
  undefined,
  undefined,
  undefined,
  true // Use KTX2 loader
);
```

**Conversion:**
```bash
# Using Basis Universal command-line tool
basisu -ktx2 -uastc -uastc_level 2 -q 128 table-felt.png -output_file table-felt.ktx2
```

---

## Recommended Workflow

### For Table Texture (Now):

1. **Convert to WebP** (300 KB target)
   ```bash
   cwebp -resize 1024 1024 -q 85 table-felt.png -o table-felt.webp
   ```

2. **Update scene.ts** (change filename to .webp)
   ```typescript
   "/assets/textures/table-felt.webp",
   ```

3. **Test in browser** (check console for load success)

4. **Keep PNG as backup** (for editing/re-exporting)

### For Future Textures:

1. **Start with highest quality source** (PSD, TIFF, etc.)
2. **Export to power-of-2 dimensions** (1024x1024, 2048x2048)
3. **Use WebP for most assets** (80-90% quality)
4. **Use KTX2 for large textures** (4K+ or many textures)
5. **Keep source files** in `src/assets/game-textures/` (not public)
6. **Store optimized files** in `public/assets/textures/`

---

## Performance Targets

### Single Texture:
- **Download time**: < 1 second (3G connection)
- **File size**: < 500 KB per texture
- **Dimensions**: Power-of-2 (1024 recommended for table)

### Total Texture Budget (All Assets):
- **First load**: < 5 MB total textures
- **Total textures**: < 20 MB (all themes + table)
- **Per theme**: < 3 MB (dice + table textures)

---

## Comparison: Other Game Textures

### Current Dice Theme Textures:
| Theme | Diffuse | Normal | Specular | Total |
|-------|---------|--------|----------|-------|
| diceOfRolling | 64 KB | - | - | 64 KB |
| blueGreenMetal | 88 KB | 100 KB | 80 KB | 268 KB |
| wooden | 164 KB | 120 KB | 90 KB | 374 KB |

**Table Texture**: 2.1 MB ❌ (13-33x larger than dice textures)
**Table Texture (WebP)**: ~300 KB ✅ (comparable to dice textures)

---

## Tools & Resources

### Conversion Tools:
- **ImageMagick**: https://imagemagick.org/ (command-line, powerful)
- **cwebp**: https://developers.google.com/speed/webp/download (Google's tool)
- **Squoosh**: https://squoosh.app/ (online, visual comparison)
- **Basis Universal**: https://github.com/BinomialLLC/basis_universal (KTX2)

### Analysis Tools:
- **BabylonJS Inspector**: Press F12 → Babylon tab → Textures
- **Chrome DevTools**: Network tab → Filter by Img
- **Lighthouse**: Performance audit (bundle size warnings)

### Further Reading:
- [Choosing Texture Formats for WebGL](https://www.donmccurdy.com/2024/02/11/web-texture-formats/)
- [BabylonJS: Optimizing Textures](https://doc.babylonjs.com/features/featuresDeepDive/materials/using/texturePerformance)
- [WebP Image Format](https://developers.google.com/speed/webp)

---

## Summary

### ✅ **What's Been Done:**
- Table texture loaded and working
- Fallback system implemented
- UV mapping configured
- File organized in `public/assets/textures/`

### ⚠️ **What Should Be Done (Recommended):**
1. **Convert to WebP** (2.1 MB → 300 KB, 85% reduction)
2. **Resize to 1024x1024** (power-of-2, GPU-friendly)
3. **Remove alpha channel** (if not using transparency)

### 🚀 **Future Optimizations:**
- KTX2/Basis Universal for large textures
- Texture atlasing for multiple small textures
- Lazy loading for alternative themes
- CDN delivery for production

---

**Next Steps:**
Run one of the conversion commands above and update the filename in `scene.ts` line 221. The texture will load ~7x faster with identical visual quality! 🎲

---

**Questions or Issues?**
- Check browser console for "[Scene] Custom table texture loaded successfully"
- If texture fails, procedural fallback will activate automatically
- Test with: http://localhost:5175/
