# Visual Settings Documentation

**Status**: Complete
**Version**: 1.0.0
**Last Updated**: 2026-02-24

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Table Contrast System](#table-contrast-system)
4. [Settings Persistence](#settings-persistence)
5. [Integration Points](#integration-points)
6. [Future Extensions](#future-extensions)

---

## Overview

The **Visual Settings** system provides user-configurable visual parameters to enhance gameplay accessibility and preference. The primary feature is **Table Contrast**, which adjusts the game table brightness to improve dice visibility for players with different visual preferences or lighting conditions.

### Design Goals

1. **Accessibility**: Allow players to adjust visuals for optimal dice readability
2. **Persistence**: Settings survive across browser sessions via localStorage
3. **Real-time Updates**: Changes apply immediately without page reload
4. **Extensibility**: Clean architecture for adding future visual settings
5. **User Experience**: Clear UI with descriptive labels and immediate feedback

### Background

This system was implemented in response to QA user feedback reporting difficulty reading dice on the game board. By allowing users to control table/dice contrast, we support a wider range of visual preferences and accessibility needs.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Settings Service                       │
│  ┌────────────────────────────────────────────────┐    │
│  │         DisplaySettings Interface              │    │
│  │  ┌──────────────────────────────────────┐     │    │
│  │  │     VisualSettings Interface         │     │    │
│  │  │  - tableContrast: "low"|"normal"|"high" │  │    │
│  │  └──────────────────────────────────────┘     │    │
│  └────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
           │                             │
           ▼                             ▼
    ┌────────────┐              ┌─────────────────┐
    │ localStorage│              │  Settings UI    │
    │  (persist) │              │   (controls)    │
    └────────────┘              └─────────────────┘
                                         │
                                         ▼
                                  ┌────────────┐
                                  │  main.ts   │
                                  │ (onChange) │
                                  └────────────┘
                                         │
                                         ▼
                                  ┌────────────┐
                                  │ GameScene  │
                                  │ (rendering)│
                                  └────────────┘
```

### Data Flow

1. **Initialization**: Settings loaded from localStorage, defaults applied if missing
2. **UI Rendering**: Settings modal displays current tableContrast value
3. **User Change**: Select dropdown triggers `updateVisual()` call
4. **Persistence**: New value saved to localStorage
5. **Notification**: All onChange listeners are notified
6. **Scene Update**: `GameScene.updateTableContrast()` adjusts material properties
7. **Immediate Effect**: Table materials updated without scene reload

---

## Table Contrast System

### Contrast Levels

The table contrast system modifies the **specular color** and **roughness** properties of the table felt materials to control how much light they reflect.

| Level | Specular | Roughness | Description | Use Case |
|-------|----------|-----------|-------------|----------|
| **Low** | 0.05 | 0.95 | Brighter table, less contrast | Players who prefer lighter backgrounds |
| **Normal** | 0.035 | 0.96 | Balanced contrast | Middle ground for most users |
| **High** | 0.02 | 0.98 | Maximum contrast, darkest table | Best dice readability (default) |

### Material Properties Explained

- **Specular Color**: RGB values controlling how much light reflects off the surface
  - Lower values = less reflection = darker appearance
  - Range: 0.0 (no reflection) to 1.0 (full reflection)

- **Roughness**: Surface micro-texture affecting light scattering
  - Higher values = more matte = absorbs more light
  - Range: 0.0 (perfectly smooth) to 1.0 (very rough/matte)

### Affected Materials

The contrast setting applies to both table surfaces:

1. **Play Area Felt** (tray): Main octagon dice rolling surface
2. **Scored Area Felt** (scoredArea): Rectangle for scored dice

Both materials are updated simultaneously to maintain visual consistency.

---

## Settings Persistence

### localStorage Structure

```json
{
  "biscuits-settings": {
    "display": {
      "graphicsQuality": "high",
      "shadowsEnabled": true,
      "particlesEnabled": true,
      "particleIntensity": "normal",
      "visual": {
        "tableContrast": "high"
      }
    },
    "audio": { ... },
    "controls": { ... },
    "game": { ... }
  }
}
```

### Backwards Compatibility

The `mergeWithDefaults()` method ensures backwards compatibility:

```typescript
private mergeWithDefaults(loaded: any): Settings {
  return {
    display: {
      ...DEFAULT_SETTINGS.display,
      ...loaded.display,
      visual: {
        ...DEFAULT_SETTINGS.display.visual,
        ...(loaded.display?.visual || {})
      }
    },
    // ... other settings
  };
}
```

If a user has settings saved from before visual settings were added, they will automatically receive the default `tableContrast: "high"` value without data loss.

---

## Integration Points

### 1. Settings Service (`src/services/settings.ts`)

**Interface Definition:**
```typescript
export interface VisualSettings {
  tableContrast: "low" | "normal" | "high";
}

export interface DisplaySettings {
  // ... other display settings
  visual: VisualSettings;
}
```

**Update Methods:**
```typescript
// Update entire display settings (with nested visual merge)
updateDisplay(display: Partial<DisplaySettings>): void

// Convenience method for visual-only updates
updateVisual(visual: Partial<VisualSettings>): void
```

### 2. GameScene (`src/render/scene.ts`)

**Public Method:**
```typescript
updateTableContrast(level: "low" | "normal" | "high"): void
```

**Implementation:**
- Retrieves play area and scored area meshes by name
- Looks up material properties for the specified contrast level
- Updates `specularColor` and `roughness` on both materials
- Changes apply immediately (no render loop needed)

### 3. Settings UI (`src/ui/settings.ts`)

**HTML Structure:**
```html
<div class="settings-section">
  <h3>Visual Settings</h3>
  <p class="setting-description">Adjust table contrast for better dice visibility</p>

  <div class="setting-row">
    <label for="table-contrast">Table Contrast</label>
    <select id="table-contrast">
      <option value="low">Low (Brighter Table)</option>
      <option value="normal">Normal (Balanced)</option>
      <option value="high">High (Best Readability)</option>
    </select>
  </div>
</div>
```

**Event Handler:**
```typescript
tableContrast.addEventListener("change", () => {
  settingsService.updateVisual({
    tableContrast: tableContrast.value as "low" | "normal" | "high"
  });
  audioService.playSfx("click");
});
```

### 4. Main Game Loop (`src/main.ts`)

**Startup Application:**
```typescript
const settings = settingsService.getSettings();
this.scene.updateTableContrast(settings.display.visual.tableContrast);
```

**Real-time Updates:**
```typescript
settingsService.onChange((settings) => {
  // Apply visual settings in real-time
  this.scene.updateTableContrast(settings.display.visual.tableContrast);
  // ... other update logic
});
```

---

## Future Extensions

The visual settings architecture is designed to easily support additional settings:

### Potential Future Settings

1. **Dice Brightness**
   ```typescript
   diceBrightness: "normal" | "bright" | "very-bright"
   ```
   - Adjust dice ambient/emissive colors
   - Further enhance visibility in bright environments

2. **Lighting Intensity**
   ```typescript
   lightingIntensity: "soft" | "normal" | "bright"
   ```
   - Control spotlight intensity multipliers
   - Balance between atmosphere and clarity

3. **Shadow Strength**
   ```typescript
   shadowStrength: "subtle" | "normal" | "strong"
   ```
   - Adjust `shadowGenerator.darkness` property
   - Complement contrast settings

4. **Color Blind Modes**
   ```typescript
   colorMode: "default" | "deuteranopia" | "protanopia" | "tritanopia"
   ```
   - Adjust dice color palette per color vision deficiency
   - Ensure gameplay accessibility for all players

5. **Table Texture**
   ```typescript
   tableTexture: "felt" | "wood" | "marble" | "custom"
   ```
   - Allow texture swapping via dropdown
   - Support custom texture uploads (future multiplayer feature)

### Extension Pattern

To add a new visual setting:

1. **Add to VisualSettings interface**
   ```typescript
   export interface VisualSettings {
     tableContrast: "low" | "normal" | "high";
     newSetting: "value1" | "value2" | "value3";  // Add here
   }
   ```

2. **Update DEFAULT_SETTINGS**
   ```typescript
   visual: {
     tableContrast: "high",
     newSetting: "value1",  // Add default
   }
   ```

3. **Add UI controls** in `settings.ts` HTML template

4. **Add event handler** in `settings.ts` constructor

5. **Add update logic** in `scene.ts` or relevant module
   ```typescript
   updateNewSetting(value: string): void {
     // Implementation
   }
   ```

6. **Wire up in main.ts** startup and onChange handler

---

## Performance Considerations

### Material Updates

- Material property changes are **very lightweight** operations
- No mesh geometry changes, texture uploads, or shader recompilation
- Updates happen in a single frame without visual flicker
- Safe to call during active gameplay

### Memory Impact

- Each contrast level uses the **same textures** (no duplication)
- Only 2 Color3 objects and 2 float values change per update
- Negligible memory footprint (~32 bytes per update)

### Settings Storage

- localStorage writes are **synchronous but fast** (~1ms)
- JSON serialization of entire settings object is minimal
- No network calls or async operations required

---

## Testing Recommendations

### Manual Testing Checklist

- [ ] Verify all three contrast levels render correctly
- [ ] Confirm settings persist after page reload
- [ ] Test real-time switching between levels during gameplay
- [ ] Verify UI select dropdown updates when settings change programmatically
- [ ] Test with clean localStorage (new user experience)
- [ ] Test backwards compatibility (load old settings without visual key)
- [ ] Verify QA feedback addressed (dice more readable on high contrast)

### Accessibility Testing

- [ ] Test with screen readers (labels are descriptive)
- [ ] Verify keyboard navigation works (Tab, Enter)
- [ ] Test with different monitor brightness levels
- [ ] Get feedback from color blind testers
- [ ] Test in various lighting conditions (bright room, dark room)

---

## Troubleshooting

### Settings Not Persisting

**Symptom**: Table contrast resets to default on page reload

**Solutions**:
1. Check browser localStorage is enabled (not in private/incognito mode)
2. Verify no errors in console during settings save
3. Check localStorage quota not exceeded
4. Clear localStorage and test with fresh settings

### Visual Changes Not Applying

**Symptom**: Changing contrast level has no visible effect

**Solutions**:
1. Verify `updateTableContrast()` is called in onChange handler
2. Check GameScene meshes exist ("tray", "scoredArea")
3. Verify materials are StandardMaterial (not ShaderMaterial)
4. Check if custom texture overrides are interfering

### UI Out of Sync

**Symptom**: Select dropdown shows wrong value after external settings change

**Solutions**:
1. Call `settingsModal.refresh()` after programmatic changes
2. Verify refresh() method updates table-contrast select value
3. Check if multiple settings modals are instantiated

---

## Related Documentation

- **Particle System**: `docs/PARTICLE-SYSTEM.md` - Similar settings integration pattern
- **Theme System**: `src/services/themeManager.ts` - Dice visual customization
- **Settings Service**: `src/services/settings.ts` - Core settings architecture

---

## Changelog

### v1.0.0 (2026-02-24)
- Initial implementation of table contrast system
- Three contrast levels: low, normal, high
- Full localStorage persistence
- Real-time updates without page reload
- Settings UI integration
- Documentation created
