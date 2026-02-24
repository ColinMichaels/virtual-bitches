# BISCUITS - Missing Assets

**Status**: Icons and screenshots need to be created for PWA

---

## PWA Icons (REQUIRED for PWA installation)

### Icons Needed

1. **icon-192.png** (192x192px)
   - Purpose: Android home screen, app icon
   - Format: PNG with transparency
   - Design: BISCUITS logo or dice icon
   - Color scheme: Match app theme (#e94560 red, #1a1a2e dark)

2. **icon-512.png** (512x512px)
   - Purpose: High-res app icon, splash screen
   - Format: PNG with transparency
   - Design: Same as icon-192, higher resolution
   - Color scheme: Match app theme

3. **favicon.ico** (16x16, 32x32, 48x48 multi-size)
   - Purpose: Browser tab icon
   - Format: ICO format with multiple sizes
   - Design: Simplified dice or "B" logo

### Optional (Enhanced PWA)

4. **screenshot-1.png** (1280x720px - wide)
   - Purpose: Desktop PWA install preview
   - Content: Desktop gameplay screenshot showing dice, HUD, score

5. **screenshot-2.png** (750x1334px - narrow)
   - Purpose: Mobile PWA install preview
   - Content: Mobile gameplay screenshot in portrait mode

---

## How to Create Icons

### Option 1: Using Existing Game Screenshot
1. Take screenshot of game with dice mid-roll
2. Crop to square (1024x1024px)
3. Resize to 192x192 and 512x512
4. Ensure good contrast on both light and dark backgrounds

### Option 2: Design Tool (Figma/Canva)
1. Create 512x512 artboard
2. Design dice icon or stylized "B" logo
3. Use app colors (#e94560, #1a1a2e, #fff)
4. Export as PNG with transparency
5. Resize for 192x192 version

### Option 3: AI Image Generator
Prompt: "App icon for dice game called BISCUITS, minimalist 3D dice on dark background, red accent color #e94560, square format, professional, modern"

---

## Temporary Workaround

Until proper icons are created, the PWA will work but show:
- ❌ Browser default icon in home screen
- ❌ Generic placeholder in app switcher
- ⚠️ May affect PWA installability score

---

## File Locations

Place created files in:
```
/public/
  ├── icon-192.png
  ├── icon-512.png
  ├── favicon.ico
  ├── screenshot-1.png (optional)
  └── screenshot-2.png (optional)
```

Referenced in:
- `index.html` - favicon and app icons
- `public/manifest.json` - PWA manifest
- `public/sw.js` - Service worker precache

---

## Quick Icon Generation Commands

### Using ImageMagick (if installed)
```bash
# Create simple placeholder icons from text
convert -size 512x512 xc:'#1a1a2e' \
  -gravity center \
  -pointsize 200 \
  -fill '#e94560' \
  -font Arial-Bold \
  -annotate +0+0 '🎲' \
  public/icon-512.png

convert public/icon-512.png -resize 192x192 public/icon-192.png
```

### Using Online Tools
- https://realfavicongenerator.net/ - Comprehensive favicon generator
- https://favicon.io/ - Simple favicon from text/image
- https://www.pwabuilder.com/ - PWA asset generator

---

**Last Updated**: 2026-02-24
**Priority**: Medium (PWA works without them, but recommended)
