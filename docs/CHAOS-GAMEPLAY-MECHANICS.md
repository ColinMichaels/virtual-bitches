# Chaos Gameplay Mechanics System 😈

**Document Version**: 1.0
**Last Updated**: 2026-02-24
**Status**: Design Specification
**Complexity**: Very High
**Dependencies**: Multiplayer Infrastructure, WebSocket Server, Player System

> "BISCUITS: Where rolling dice is the least of your problems. Your opponents will shake your screen, steal your time, mock your failures, and celebrate your defeats. Can you keep your cool under pressure, or will you crumble into... well, biscuits?" 🎲💀

---

## Table of Contents

1. [Philosophy & Design Goals](#philosophy--design-goals)
2. [Core Mechanics Overview](#core-mechanics-overview)
3. [Attack & Distraction System](#attack--distraction-system)
4. [Time Attack & Pressure Mechanics](#time-attack--pressure-mechanics)
5. [Insult & Taunt System](#insult--taunt-system)
6. [Ability Economy & Progression](#ability-economy--progression)
7. [Multiplayer Integration](#multiplayer-integration)
8. [UI/UX Design](#uiux-design)
9. [Game Modes](#game-modes)
10. [Anti-Toxicity & Player Protection](#anti-toxicity--player-protection)
11. [Technical Implementation](#technical-implementation)
12. [Balancing & Playtesting](#balancing--playtesting)

---

## Philosophy & Design Goals

### What is "Chaos Gameplay"?

Chaos Gameplay transforms BISCUITS from a peaceful dice game into a **psychosocial battleground** where players use psychological warfare, time pressure, and disruption mechanics to gain competitive advantage. The goal is to create **"fun frustration"** - stress that's challenging but entertaining, not rage-inducing.

### Design Principles

1. **Competitive Stress, Not Toxicity**
   - Mechanics should frustrate opponents strategically, not personally
   - Attacks target gameplay, not player identity
   - Clear boundaries between banter and bullying

2. **Skill-Based Chaos**
   - Timing and strategy matter more than spamming
   - Cooldowns prevent ability spam
   - Resource management (Chaos Points) adds depth

3. **Opt-In Intensity**
   - Players choose their chaos level (Casual/Competitive/Savage)
   - Safe mode for sensitive players
   - Easy to mute/block disruptive players

4. **Balanced Risk/Reward**
   - Attacking opponents costs resources
   - Victims earn revenge mechanics
   - Overusing abilities has diminishing returns

5. **Fun for Victims Too**
   - Getting attacked is part of the entertainment
   - Counter-attack mechanics empower victims
   - Memorable moments ("I can't believe they did that!")

### Inspiration

- **Clash Royale**: Emote system (psychological warfare)
- **Mario Kart**: Item chaos (strategic disruption)
- **Among Us**: Social deception (tension and betrayal)
- **Overcooked**: Time pressure (controlled panic)
- **Fall Guys**: Obstacle chaos (slapstick frustration)

---

## Core Mechanics Overview

### The Chaos Trinity

```
┌─────────────────────────────────────────┐
│         CHAOS GAMEPLAY SYSTEM           │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────┐   ┌──────────┐  ┌──────┐│
│  │ ATTACKS  │   │   TIME   │  │TAUNTS││
│  │  Visual  │   │ Pressure │  │Insults││
│  │  Audio   │   │ Timers   │  │Emotes││
│  │    UI    │   │  Rush    │  │ Voice││
│  │   Dice   │   │Countdown │  │  AI  ││
│  └────┬─────┘   └────┬─────┘  └───┬──┘│
│       │              │             │   │
│       └──────────────┴─────────────┘   │
│                    │                    │
│              ┌─────▼──────┐            │
│              │   VICTIM   │            │
│              │ EXPERIENCE │            │
│              └────────────┘            │
└─────────────────────────────────────────┘
```

### Chaos Points (CP) Economy

- **Earn CP**: Score points, win rounds, survive attacks
- **Spend CP**: Use abilities, purchase power-ups, unlock taunts
- **Balance**: 100 CP starting pool, earn 10-50 CP per turn
- **Costs**: Abilities range from 20 CP (minor) to 100 CP (ultimate)

### Cooldown System

- **Per-Ability**: Each ability has individual cooldown (15-60s)
- **Global**: 5s cooldown between any abilities (prevent spam)
- **Revenge**: Victims get reduced cooldowns on counter-attacks

### Attack Targeting

- **Single Target**: Click opponent's seat to attack
- **Area of Effect**: Hit adjacent players (45° arc)
- **Random**: Attack random opponent (cheaper cost)
- **Self-Sabotage**: Debug mode attacks yourself (testing)

---

## Attack & Distraction System

### Ability Categories

#### 1. Visual Attacks 👁️

> **📷 Camera System Integration**: Screen effects are now powered by the Camera Attack system. See `docs/CAMERA-ATTACKS-INTEGRATION.md` for complete camera manipulation API, upgrade trees, and drunk vision mechanics.

**Screen Effects**:
- **Screen Shake** (20 CP, 30s CD)
  - Intensity: Mild to violent camera shake
  - Duration: 2-5 seconds
  - Effect: Makes clicking dice harder
  - **Upgrade Path**: 5 levels from "Basic Shake" → "Catastrophe" (see CAMERA-ATTACKS-INTEGRATION.md)

- **Dice Fog** (30 CP, 45s CD)
  - Covers dice in thick fog/smoke
  - Duration: 5 seconds
  - Effect: Obscures die values

- **Flashbang** (40 CP, 60s CD)
  - Bright white flash
  - Duration: 2 seconds blind, 3s afterimage
  - Effect: Temporary vision loss

- **Disco Mode** (50 CP, 90s CD)
  - Rapid color changes, flashing lights
  - Duration: 8 seconds
  - Effect: Seizure warning, disorienting

- **Upside Down** (60 CP, 120s CD)
  - Flips screen 180 degrees
  - Duration: 10 seconds
  - Effect: Muscle memory disruption

**UI Manipulation**:
- **Button Shuffle** (25 CP, 40s CD)
  - Swaps "Roll" and "Score" button positions
  - Duration: Until clicked wrong button
  - Effect: Click errors

- **Fake Notifications** (15 CP, 20s CD)
  - "You Busted!" or "Time's Up!" false alerts
  - Duration: 2 seconds, then fade
  - Effect: Panic response

- **UI Fade** (35 CP, 50s CD)
  - Makes UI elements 50% transparent
  - Duration: 8 seconds
  - Effect: Harder to read

- **HUD Scramble** (45 CP, 60s CD)
  - Moves HUD elements to random positions
  - Duration: 12 seconds
  - Effect: Spatial disorientation

#### 2. Audio Attacks 🔊

- **Airhorn** (10 CP, 15s CD)
  - Loud sudden noise
  - Effect: Startle/distraction

- **Annoying Music** (20 CP, 30s CD)
  - Loops irritating song (10s)
  - Effect: Mental fatigue

- **Ticking Clock** (15 CP, 20s CD)
  - Loud ticking sound (amplifies pressure)
  - Effect: Increased time anxiety

- **Whispers** (25 CP, 40s CD)
  - Creepy whispers, "You're going to lose..."
  - Effect: Psychological unease

- **Wrong Answer Buzzer** (15 CP, 25s CD)
  - Plays game show "wrong" sound after every click
  - Effect: Conditioning negative association

#### 3. Dice Sabotage 🎲

- **Slow Motion Dice** (40 CP, 60s CD)
  - Dice animations play at 50% speed
  - Duration: One roll
  - Effect: Time waste

- **Ghost Dice** (30 CP, 45s CD)
  - Adds 3 fake dice to screen
  - Duration: Until clicked
  - Effect: Confusion about what's real

- **Dice Invisibility** (50 CP, 75s CD)
  - Makes dice transparent/invisible
  - Duration: 5 seconds
  - Effect: Can't see results

- **Anti-Gravity** (45 CP, 60s CD)
  - Dice float upward slowly
  - Duration: Full animation
  - Effect: Disorienting physics

- **Spinning Dice** (35 CP, 50s CD)
  - Dice spin rapidly after landing
  - Duration: 4 seconds
  - Effect: Can't read values

#### 4. Time Manipulation ⏰

- **Time Thief** (50 CP, 90s CD)
  - Steals 5-10 seconds from victim's timer
  - Adds stolen time to attacker
  - Effect: Double punishment

- **Time Freeze** (80 CP, 120s CD)
  - Freezes victim's timer for 3 seconds
  - Victim can't do anything
  - Effect: Dead air panic

- **Rush Mode** (40 CP, 60s CD)
  - Victim's timer counts down 2x speed
  - Duration: 10 seconds
  - Effect: Forced hasty decisions

- **Overtime** (30 CP, 45s CD)
  - Adds 10 seconds to victim's current action
  - Forces victim to wait
  - Effect: Impatience

#### 5. Psychological Warfare 🧠

- **Fake Bust Animation** (25 CP, 35s CD)
  - Plays "You Busted!" animation
  - Reveals it was fake after 1 second
  - Effect: Emotional rollercoaster

- **Score Lie** (20 CP, 30s CD)
  - Shows wrong score (±20 points)
  - Duration: 5 seconds
  - Effect: Strategic confusion

- **Opponent Advantage Alert** (15 CP, 25s CD)
  - "Player X is about to win!"
  - Duration: 3 seconds
  - Effect: False pressure

- **Chat Impersonation** (35 CP, 50s CD)
  - Fake message from another player
  - "Why are you so bad at this?"
  - Effect: Social manipulation

---

## Time Attack & Pressure Mechanics

### Core Time Attack Mode

**Base Rules**:
- Each player has **30 seconds** per turn
- Timer counts down during decision-making
- **Timeout = Auto-bust** (lose all potential points)
- Visual/audio warnings at 10s, 5s, 3-2-1s

### Time Attack Variants

#### 1. **Blitz Mode** ⚡
- **Timer**: 10 seconds per roll
- **Penalty**: Timeout = instant elimination
- **Bonus**: Fastest completion earns +50% points
- **Intensity**: Maximum stress

#### 2. **Rush Hour** 🏃
- **Timer**: Starts at 30s, decreases 2s per turn
- **Minimum**: 5 seconds
- **Effect**: Increasing pressure over time

#### 3. **Time Bank** 💰
- **Pool**: 3 minutes total for entire game
- **Usage**: You choose when to use time
- **Strategy**: Spend wisely on critical turns

#### 4. **Sudden Death** ☠️
- **Timer**: 20 seconds
- **Penalty**: Timeout = immediate game over
- **No second chances**

#### 5. **Countdown Chaos** 🎯
- **Global timer**: 10 minutes for all players
- **End condition**: When timer hits 0, lowest score eliminated
- **Repeat**: Until one player remains

#### 6. **Speed Challenge** 🏁
- **Goal**: First to 100 points
- **Time bonus**: Faster actions = multipliers
- **< 10s = 1.5x, < 5s = 2x, < 3s = 3x**

#### 7. **Stress Test** 💀
- **Combination**: Decreasing timer + increasing attacks
- **Formula**: `timer -= (turn_number * 2)`, `attack_frequency += turn_number`
- **Goal**: Pure torture

### Pressure Escalation

**Visual Stress Indicators**:
```
Time Remaining | Visual Effect
---------------|----------------------------------
> 20s          | Normal (green)
15-20s         | Yellow border
10-15s         | Orange pulse
5-10s          | Red vignette
< 5s           | Screen shake + red flash
< 3s           | Countdown numbers fill screen
0s             | Explosion animation + timeout
```

**Audio Stress Cues**:
- **30-20s**: Calm background music
- **20-10s**: Tempo increases, add percussion
- **10-5s**: Ticking clock overlaid
- **5-3s**: Beeps on each second
- **3-2-1s**: Louder beeps, rising pitch
- **0s**: Buzzer/airhorn

**Physiological Response** (Future: Heart Rate Integration):
- **Fitbit/Apple Watch API**: Read player's heart rate
- **Display**: Show heart rate on screen
- **Dynamic Difficulty**: Adjust timer based on stress level
- **Stress Cap**: Pause if HR > 140 BPM (safety)

---

## Insult & Taunt System

### Pre-Written Taunt Library

#### **General Taunts** (Playful)
1. "Nice try! ...Not really."
2. "Are you even trying?"
3. "Grandma rolls faster than that!"
4. "Did you learn to count yet?"
5. "That's adorable. 🐣"
6. "Ouch, that hurt to watch."
7. "Better luck next time... maybe."
8. "Is this your first time?"
9. "Yikes. Just yikes."
10. "I've seen better rolls from a toddler."

#### **Time Pressure Taunts**
11. "Tick tock, slowpoke! 🐢"
12. "Time's not waiting for you!"
13. "Any day now..."
14. "Make a decision already!"
15. "You're running out of time AND talent!"

#### **Bust Taunts**
16. "BUSTED! Better luck never! 😂"
17. "You just threw away your future!"
18. "That's gonna haunt you forever."
19. "Oops! Did you forget how to play?"
20. "Classic mistake. Classic loser."

#### **High Roll Boasts** (Self-Celebration)
21. "That's how it's done! 😎"
22. "Bow down to the dice master!"
23. "Pure skill, baby!"
24. "Read it and weep!"
25. "Unstoppable!"

#### **Low Roll Mockery**
26. "Really? REALLY?! 🤣"
27. "I rolled better in my sleep!"
28. "Your dice hate you!"
29. "That's the best you can do? Pathetic."
30. "I think your dice are broken."

#### **Winning Taunts**
31. "GG EZ 🏆"
32. "Not even close!"
33. "You never stood a chance."
34. "Flawless victory!"
35. "Go back to solitaire."

#### **Comeback Taunts**
36. "Momentum shift! You're done!"
37. "The tides have turned, loser!"
38. "Comeback of the century!"
39. "You should've finished me when you had the chance!"
40. "This is my house now!"

#### **Spicy Taunts** (PG-13, Opt-In)
41. "Get wrecked, scrub!"
42. "You're an embarrassment to dice everywhere!"
43. "How does it feel to be absolute garbage?"
44. "Your gameplay is as bad as your life choices!"
45. "Sit down and cry about it! 😭"
46. "You're the reason they invented participation trophies."
47. "Choke harder, I dare you!"
48. "Your skills are as fake as your confidence!"
49. "I'd say GG but there was nothing good about your game."
50. "Delete the app. You're done here."

#### **Savage Mode** (R-Rated, Heavy Opt-In)
51. "You're so bad, you make failure look like success."
52. "I've seen roadkill with more game sense than you."
53. "Your dice rolls match your personality: disappointing."
54. "You're not just losing, you're humiliating yourself."
55. "I'd tell you to uninstall, but you'd probably mess that up too."
*(More available, but you get the idea...)*

### AI-Generated Taunts 🤖

**Context-Aware System**:
```typescript
interface TauntContext {
  event: "bust" | "high_roll" | "low_roll" | "timeout" | "win" | "lose";
  victimScore: number;
  attackerScore: number;
  turnNumber: number;
  recentActions: string[];
  playerName: string;
}

// Example prompt to LLM:
`Generate a short, spicy taunt for a dice game. Context:
- Event: Player busted (scored 0 points)
- Victim: ${playerName}, currently at ${victimScore} points
- Attacker: Leading with ${attackerScore} points
- Turn: ${turnNumber}
- Tone: Playful trash talk (PG-13)
- Length: Max 15 words
- Style: Witty, not mean

Generate taunt:`
```

**Example AI Responses**:
- "Bust #3 for you, ${name}! Maybe try a calculator next time?"
- "Zero points? Zero surprise!"
- "Your dice are practicing social distancing from success!"
- "I've seen better decisions from a Magic 8-Ball."

**Benefits**:
- Infinite variety (never repetitive)
- Contextually relevant
- Adapts to player names
- Can reference specific game state

**Implementation**:
- Use OpenAI API or Claude API
- Fallback to pre-written taunts if API fails
- Cache common scenarios (reduce API costs)
- Client-side filtering for inappropriate content

### Emote System

**Animated Emotes**:
1. **Laugh** - Character laughing animation
2. **Cry** - Tears streaming down face
3. **Rage** - Red face, steam from ears
4. **Dance** - Victory dance
5. **Facepalm** - *sigh* gesture
6. **Shrug** - "Idk what to tell you"
7. **Point & Laugh** - Classic mockery
8. **Flex** - Showing off muscles
9. **Yawn** - Boredom
10. **Salute** - Respect (rare)

**Positioning**:
- Appear above attacker's player seat (3D world space)
- Float upward and fade out over 3 seconds
- Scale based on distance from camera
- Can be spammed (3s cooldown per emote)

**Sound Effects**:
- Each emote has unique sound
- Volume scales with distance (spatial audio)
- Can be muted per-player

### Voice Lines (Text-to-Speech)

**Character Voices**:
- **Announcer**: Deep, dramatic voice
- **Villain**: Sinister, menacing
- **Cheerful**: Overly happy, condescending
- **Robotic**: Monotone AI voice
- **British**: Posh, sarcastic accent
- **Custom**: Player uploads their own voice samples

**Sample Voice Lines**:
- Announcer: "DEVASTATING blow to ${victim}!"
- Villain: "Your suffering... is delicious."
- Cheerful: "Aww, don't cry! Actually, do! It's hilarious! 😊"
- Robotic: "Calculating... probability of victory: 0.0001%"
- British: "Quite the rubbish performance, old chap."

---

## Ability Economy & Progression

### Chaos Points (CP) Sources

**Earning CP**:
```
Action                  | CP Earned
------------------------|----------
Roll dice               | +5 CP
Score points            | +1 CP per point scored
Bust                    | +0 CP (no reward for failure)
Win round               | +50 CP
Survive attack          | +10 CP
Successfully attack     | +15 CP
Get revenge             | +25 CP
Complete daily quest    | +100 CP
Win tournament match    | +200 CP
```

**Starting CP**: 100 CP per game

### Ability Costs & Cooldowns

**Tier 1 - Cheap & Spammy** (10-25 CP, 15-30s CD):
- Airhorn, Fake Notification, Button Shuffle, Score Lie

**Tier 2 - Moderate** (30-50 CP, 40-60s CD):
- Screen Shake, Dice Fog, Time Thief, Slow Motion Dice

**Tier 3 - Strong** (60-80 CP, 75-90s CD):
- Flashbang, Upside Down, Rush Mode, Dice Invisibility

**Tier 4 - Ultimate** (90-100 CP, 120s+ CD):
- Time Freeze, Disco Mode, Chat Impersonation

### Unlock Progression

**Level-Based Unlocks**:
```
Level | Unlocks
------|------------------------------------------
1     | Tier 1 abilities (5 abilities)
5     | Tier 2 abilities (8 abilities)
10    | Tier 3 abilities (6 abilities)
15    | Tier 4 ultimates (4 abilities)
20    | Custom taunt editor
25    | Defense abilities (shields, immunity)
30    | Combo abilities (chain 2 attacks)
50    | Prestige skin: Golden Dice 👑
```

**Skill Tree** (Alternative to Linear):
```
                 [CHAOS MASTERY]
                       |
        ┌──────────────┼──────────────┐
        |              |              |
   [VISUAL]       [AUDIO]        [TIME]
        |              |              |
   ┌────┴────┐    ┌────┴────┐   ┌────┴────┐
 [SHAKE] [FOG] [HORN] [MUSIC] [THIEF] [FREEZE]
```

**Specializations**:
- **Illusionist**: Visual attacks cost 20% less CP
- **Tormentor**: Audio attacks have 25% shorter CD
- **Time Lord**: Time abilities 30% more effective
- **Showman**: Taunt emotes earn bonus CP
- **Defender**: Counter-attacks cost no CP

### Defense Abilities

**Counter-Attack Options**:
1. **Shield** (Passive, 50 CP)
   - Blocks next incoming ability
   - Reflects 50% of effect back to attacker

2. **Immunity** (30s, 80 CP)
   - Immune to all attacks
   - Cannot attack others during immunity

3. **Revenge Strike** (Instant, 40 CP)
   - Immediately counter last attacker
   - Doubles the effect of their attack

4. **Chaos Absorb** (Passive, 60 CP)
   - Convert incoming attacks to CP
   - Gain 20 CP per attack absorbed

5. **Decoy** (Passive, 70 CP)
   - Redirect attacks to random player
   - Attacker doesn't know they hit wrong target

### Diminishing Returns

**Spam Prevention**:
- First attack on same victim: Full effect (100%)
- Second attack within 60s: Reduced effect (75%)
- Third attack within 60s: Minimal effect (50%)
- Fourth+ attack: Negligible (25%)

**Karma System**:
- Attacking opponents increases your "Chaos Karma"
- High karma = you become easier to attack
- Low karma (peaceful play) = harder to target
- Karma decays over time

---

## Multiplayer Integration

### 8-Player Octagon Table

**Targeting UI**:
```
     [Seat 1]
[S7]         [S2]

     [YOU]  ← Current player

[S6]         [S3]
     [Seat 4]
```

**Click seat to target, UI shows**:
- Player name
- Current score
- Active effects (debuffed/shielded)
- Last action taken
- Target reticle on selected seat

### Network Protocol

**Attack Message** (Client → Server):
```json
{
  "type": "chaos_attack",
  "gameId": "game-abc123",
  "attackerId": "player-123",
  "targetId": "player-456",
  "abilityId": "screen_shake",
  "intensity": 0.8,
  "chaosPointsCost": 20,
  "timestamp": 1709654321000
}
```

**Attack Broadcast** (Server → All Clients):
```json
{
  "type": "chaos_attack_executed",
  "gameId": "game-abc123",
  "attacker": {
    "id": "player-123",
    "name": "TrollMaster69",
    "seatIndex": 2
  },
  "victim": {
    "id": "player-456",
    "name": "NoobyMcNoobFace",
    "seatIndex": 5
  },
  "ability": {
    "id": "screen_shake",
    "intensity": 0.8,
    "duration": 3000
  },
  "timestamp": 1709654321050
}
```

**Taunt Message**:
```json
{
  "type": "chaos_taunt",
  "gameId": "game-abc123",
  "from": "player-123",
  "to": "player-456",
  "tauntText": "Your dice hate you more than I do!",
  "emoteId": "laugh",
  "voiceLineId": "villain_laugh_01",
  "timestamp": 1709654322000
}
```

### Team Modes

**2v2v2v2** (4 Teams):
- Seats 0+4 vs 1+5 vs 2+6 vs 3+7
- Teams share CP pool
- Can attack own teammate (betrayal mechanic)
- Team score = sum of both players

**4v4** (2 Teams):
- Seats 0-3 vs 4-7
- Coordinated attacks (combo abilities)
- Friendly fire disabled
- Team captain chooses strategy

**Free-For-All**:
- Everyone attacks everyone
- Alliance system (temporary truces)
- Betrayal = bonus CP
- Last player standing wins

---

## UI/UX Design

### Ability Bar

**Layout** (Bottom center of screen):
```
┌─────────────────────────────────────────┐
│  [Q]    [W]    [E]    [R]    [T]    [Y] │
│ Shake  Taunt  Freeze Thief  Shield More │
│  20CP   15CP   80CP  50CP    50CP    ... │
│  ■■■■   ████   ■■■■  ■■■■    ■■■■      │
│  Ready  Ready  45s   Ready   Ready      │
└─────────────────────────────────────────┘
```

**Hotkeys**: Q, W, E, R, T, Y (customizable)
**Visual**: Icon, name, CP cost, cooldown bar
**Hover**: Full description tooltip
**Click**: Select ability, then click target

### Chaos HUD

**Time Bank Display** (Top center):
```
┌───────────────────────────────┐
│   ⏰  00:23  ⏰               │
│   [██████░░░░░░░░░░░░░░]     │
│   Timer: 23 seconds left      │
└───────────────────────────────┘
```

**Chaos Points** (Top right):
```
┌──────────────┐
│ ⚡ 75 CP     │
│ [████████░░] │
└──────────────┘
```

**Active Effects** (Left side):
```
┌──────────────────┐
│ DEBUFFS:         │
│ 🌀 Screen Shake  │
│    └─ 2s left    │
│ 👻 Ghost Dice    │
│    └─ 5s left    │
└──────────────────┘
```

**Attack Log** (Bottom left):
```
┌─────────────────────────────┐
│ Troll69 → You: Screen Shake │
│ You → Noob42: Time Thief    │
│ Beast99 → Troll69: Revenge! │
└─────────────────────────────┘
```

### Victim Feedback

**Attack Incoming Warning**:
```
╔═══════════════════════════════╗
║     ⚠️  ATTACK INCOMING  ⚠️    ║
║   Troll69 is targeting you!   ║
║         (1 second...)          ║
╚═══════════════════════════════╝
```
- Flashes red 1 second before attack lands
- Gives victim chance to use shield
- Audio: Warning siren

**During Attack Effects**:
- Screen borders glow attacker's color
- Attacker's name in large text
- Ability icon displayed
- Visual/audio effects of ability
- Revenge meter fills up

**Post-Attack**:
```
┌──────────────────────────────┐
│ You were attacked by Troll69 │
│ Effect: Screen Shake (3s)    │
│ Revenge Ready!               │
│ [⚔️ COUNTER-ATTACK]           │
└──────────────────────────────┘
```

---

## Game Modes

### 1. **Casual Chaos** ☮️
- **Timer**: 60s per turn (generous)
- **Abilities**: All unlocked, free to use
- **Cooldowns**: Standard (30-120s)
- **CP Cost**: Reduced by 50%
- **Goal**: Fun experimentation, no stakes

### 2. **Competitive Chaos** ⚔️
- **Timer**: 30s per turn
- **Abilities**: Level-locked progression
- **Cooldowns**: Standard
- **CP Cost**: Full price
- **ELO**: Ranked matchmaking
- **Goal**: Climb leaderboards

### 3. **Survival Mode** 💀
- **Players**: 8-player free-for-all
- **Elimination**: Timeout or 3 busts = game over
- **Attacks**: Unlimited (no CP cost)
- **Cooldowns**: Reduced by 50%
- **Winner**: Last player standing
- **Intensity**: Maximum chaos

### 4. **Time Trial** ⏱️
- **Goal**: Complete game under 5 minutes
- **Timer**: Global countdown
- **Attacks**: Disabled (pure speed)
- **Bonus**: Faster completion = higher score multiplier
- **Leaderboard**: Best times

### 5. **Gauntlet** 🏛️
- **Format**: 1 vs 1 AI opponents
- **Progression**: 10 rounds, escalating difficulty
- **AI Behavior**:
  - Round 1-3: Passive (no attacks)
  - Round 4-6: Moderate (1 attack per turn)
  - Round 7-9: Aggressive (2-3 attacks per turn)
  - Round 10: Boss (ultimate abilities, 5s timer)
- **Reward**: Unlock ultimate abilities

### 6. **Team Chaos** 👥
- **Format**: 4v4
- **CP Pool**: Shared between teammates
- **Combo Attacks**: Coordinate for amplified effects
- **Friendly Fire**: Disabled
- **Goal**: Team with highest combined score wins

### 7. **Tournament** 🏆
- **Format**: 8-player bracket
- **Rounds**: Quarter-finals, Semi-finals, Finals
- **Rules**: Competitive Chaos settings
- **Prize**: Virtual currency, cosmetics
- **Replay**: All matches saved for review

---

## Anti-Toxicity & Player Protection

### Report System

**Report Categories**:
1. **Offensive Language**: Slurs, hate speech
2. **Harassment**: Targeted abuse
3. **Excessive Spam**: Ability/taunt spam beyond reasonable
4. **Cheating**: Exploits, hacks
5. **Unsportsmanlike Conduct**: Prolonging games, griefing

**Report Flow**:
1. Player clicks "Report" on offender's seat
2. Selects category + optional comment
3. Auto-capture: Last 30s of gameplay footage
4. Submit to moderation queue
5. Offender receives notification (if confirmed)

**Penalties**:
- **1st offense**: Warning, 24h ability cooldown increase
- **2nd offense**: 7-day chaos mode ban
- **3rd offense**: 30-day ban from multiplayer
- **Severe**: Permanent account ban

### Mute Options

**Per-Player Muting**:
- Mute taunts (text)
- Mute emotes (visual)
- Mute voice lines (audio)
- Mute all (complete silence from player)

**Global Settings**:
- Disable all taunts (play in silence)
- Reduce ability visual effects (photosensitivity)
- Lower audio volumes (hearing sensitivity)

### Safe Mode 🛡️

**Features**:
- Abilities have reduced intensity (50% effects)
- No taunts/insults (emotes only)
- Longer cooldowns (2x standard)
- Automatic shields (free every 60s)
- Opt-out listed (won't be matched with "Savage" mode players)

**For Players Who**:
- Have anxiety/stress disorders
- Are younger players (< 13)
- Want to relax, not compete
- Are new and learning

### AI Moderation

**Content Filtering**:
- **Blocked Words**: Slurs, hate speech, explicit content
- **Pattern Detection**: "kys", "unalive", coded harassment
- **Context Analysis**: AI determines if insult crosses line
- **Auto-Replace**: Offensive words become "[REDACTED]"

**Voice Line Filtering**:
- AI analyzes uploaded voice samples
- Rejects: Offensive audio, impersonation, copyrighted
- Approves: Original, clean content

### Good Sport Rewards

**Positive Behavior Incentives**:
- **No Reports**: +10% CP bonus per game
- **Commended**: +50 CP from other players' endorsements
- **Sportsmanship Badge**: Displayed on profile
- **Priority Matchmaking**: Matched with other good sports

**Commendation System**:
- After game, players can commend opponents
- Categories: "Funny", "Challenging", "Respectful"
- Builds reputation score
- Unlocks exclusive cosmetics

### Ethical Boundaries

**Zero Tolerance**:
- ❌ Racism, sexism, homophobia, ableism
- ❌ Real-world threats or doxxing
- ❌ Encouraging self-harm
- ❌ Sexual content or harassment
- ❌ Scams or phishing

**Encouraged**:
- ✅ Game-related trash talk
- ✅ Playful taunts about gameplay
- ✅ Self-deprecating humor
- ✅ Clever wordplay and puns
- ✅ Celebrating good plays (even opponent's)

**Consent Model**:
- Players explicitly opt-in to "Spicy" or "Savage" modes
- Default is "Playful" (family-friendly)
- Can downgrade mid-game if uncomfortable
- Exit match without penalty if harassment occurs

---

## Technical Implementation

### File Structure

```
src/multiplayer/chaos/
├── types.ts                    # Type definitions
├── ChaosManager.ts             # Core chaos system coordinator
├── AbilitySystem.ts            # Ability definitions and registry
├── AttackController.ts         # Execute attacks, manage effects
├── TimeAttackManager.ts        # Timer and pressure mechanics
├── TauntSystem.ts              # Taunt generation and delivery
├── EffectRenderer.ts           # Visual and audio effects
├── ChaosEconomy.ts             # CP earning, spending, progression
├── DefenseSystem.ts            # Shields, counters, immunity
└── README.md                   # Implementation guide

src/multiplayer/chaos/abilities/
├── VisualAbilities.ts          # Screen shake, fog, etc.
├── AudioAbilities.ts           # Airhorn, music, etc.
├── UIAbilities.ts              # Button shuffle, HUD manipulation
├── DiceAbilities.ts            # Dice-specific attacks
├── TimeAbilities.ts            # Time theft, freeze, rush
├── PsychologicalAbilities.ts   # Fake messages, score lies
└── DefensiveAbilities.ts       # Shields, reflects, immunity

src/ui/chaos/
├── AbilityBar.ts               # Hotkey bar for abilities
├── ChaosHUD.ts                 # Timer, CP, effects display
├── AttackFeedback.ts           # Visual effects on victim
├── TauntDisplay.ts             # Show taunts/emotes
├── TargetSelector.ts           # Click seats to target
└── ChaosSettings.ts            # Mute, safe mode, preferences

src/multiplayer/chaos/effects/
├── ScreenEffects.ts            # Camera shake, color shifts
├── DiceEffects.ts              # Slow motion, invisibility
├── UIEffects.ts                # Button swaps, fake alerts
├── AudioEffects.ts             # 3D spatial audio
└── ParticleEffects.ts          # Visual particles (fog, sparkles)
```

### Type Definitions

```typescript
// types.ts

export type AbilityCategory =
  | "visual"
  | "audio"
  | "ui"
  | "dice"
  | "time"
  | "psychological"
  | "defensive";

export type AbilityTier = 1 | 2 | 3 | 4;

export interface Ability {
  id: string;
  name: string;
  description: string;
  category: AbilityCategory;
  tier: AbilityTier;
  cpCost: number;
  cooldown: number; // seconds
  duration: number; // seconds
  intensity: number; // 0.0 - 1.0
  unlockLevel: number;
  execute: (attacker: Player, target: Player) => Promise<void>;
}

export interface ChaosState {
  chaosPoints: number;
  activeEffects: ActiveEffect[];
  abilityCooldowns: Map<string, number>; // abilityId -> seconds remaining
  karmaLevel: number; // 0.0 - 1.0 (higher = more vulnerable)
  revengePoints: number;
  totalAttacksSent: number;
  totalAttacksReceived: number;
}

export interface ActiveEffect {
  abilityId: string;
  sourcePlayerId: string;
  targetPlayerId: string;
  startTime: number;
  duration: number;
  intensity: number;
}

export interface AttackPayload {
  type: "chaos_attack";
  gameId: string;
  attackerId: string;
  targetId: string;
  abilityId: string;
  intensity: number;
  cpCost: number;
  timestamp: number;
}

export interface TauntPayload {
  type: "chaos_taunt";
  gameId: string;
  from: string;
  to: string;
  tauntText: string;
  emoteId?: string;
  voiceLineId?: string;
  timestamp: number;
}
```

### Integration Points

**PlayerController.ts**:
```typescript
// Add chaos state
export class PlayerController {
  private chaosState: ChaosState;

  handleChaosAttack(attack: AttackPayload): void {
    // Apply effect to this player
  }

  useChaosAbility(abilityId: string, targetId: string): boolean {
    // Check CP, cooldown, execute ability
  }
}
```

**PlayerManager.ts**:
```typescript
// Coordinate attacks between players
export class PlayerManager {
  broadcastChaosAttack(attack: AttackPayload): void {
    // Send attack to all clients
  }

  getTargetablePlayer(seatIndex: number): Player | null {
    // Get player at seat for targeting
  }
}
```

**NotificationService.ts**:
```typescript
// Extend for taunts
export class NotificationService {
  showTaunt(from: string, text: string, emote?: string): void {
    // Display taunt with animation
  }

  showAttackWarning(attacker: string, ability: string): void {
    // "Attack incoming!" warning
  }
}
```

**AudioService.ts**:
```typescript
// Add chaos sound categories
export class AudioService {
  playChaosEffect(effectId: string, position?: Vector3): void {
    // Play attack sound (airhorn, ticking, etc.)
  }

  playVoiceLine(voiceId: string, voice: VoiceType): void {
    // Play taunt voice line
  }
}
```

---

## Balancing & Playtesting

### Playtesting Protocol

**Phase 1: Internal Testing** (Week 1-2)
- Dev team plays 50+ matches
- Test all abilities for bugs
- Measure: Ability usage rates, win rates by playstyle
- Goal: Technical stability

**Phase 2: Alpha Testing** (Week 3-4)
- Invite 20-30 players (friends, family)
- Gather qualitative feedback
- Survey: "Which abilities are most fun? Least fun?"
- Goal: Fun factor assessment

**Phase 3: Beta Testing** (Month 2)
- Public beta (500+ players)
- Analytics: Track all ability usage, CP economy, complaints
- Hotfix overpowered/underpowered abilities
- Goal: Balance tuning

**Phase 4: Soft Launch** (Month 3)
- Limited regions (US, Canada)
- Monitor toxicity reports
- A/B test different CP costs
- Goal: Community feedback

**Phase 5: Full Launch**
- Global release
- Ongoing balance patches
- Seasonal events with new abilities

### Balance Metrics

**Track These Stats**:
```
Metric                    | Ideal Target
--------------------------|------------------
Ability Usage Rate        | 5-15% per ability (no dominant meta)
Win Rate (Attack-Heavy)   | 48-52% (balanced)
Win Rate (Defensive)      | 48-52%
Average Game Length       | 8-12 minutes
Timeout Rate              | < 5% of turns
Toxicity Report Rate      | < 2% of games
Player Retention (Day 7)  | > 40%
```

**Red Flags**:
- ⚠️ One ability used > 30% of the time (nerf it)
- ⚠️ One ability never used (buff it or remove)
- ⚠️ Average game length < 5 min (too fast/stressful)
- ⚠️ Average game length > 15 min (too slow/boring)
- ⚠️ Toxicity reports > 5% (tighten moderation)

### A/B Testing

**Variants to Test**:
1. **CP Economy**: 50 CP vs 100 CP starting pool
2. **Cooldowns**: 30s vs 60s base cooldowns
3. **Timer**: 20s vs 30s vs 45s per turn
4. **Karma Decay**: Fast vs slow decay rate
5. **Taunt Defaults**: Playful vs Spicy default tone

**Measurement**:
- Split players into groups
- Track win rates, fun ratings, retention
- Choose variant with best metrics

### Community Feedback Loop

**Monthly Surveys**:
- "Rate each ability: Too Weak, Balanced, Too Strong"
- "Which abilities frustrate you?"
- "Suggest new abilities!"

**Public Balance Patches**:
- Publish patch notes with reasoning
- "Screen Shake reduced to 2s (was 3s) - too disruptive"
- "Time Thief cost reduced to 40 CP (was 50) - underused"

**Community Voting**:
- Poll players on proposed changes
- "Should we add a new ultimate ability?"
- Build trust by involving community

---

## Future Expansion

### DLC / Seasonal Content

**Ability Packs**:
- "Holiday Hell" (Christmas-themed chaos)
- "Spooky Sabotage" (Halloween effects)
- "Summer Slaughter" (Beach-themed)

**Limited-Time Events**:
- "Chaos Week": All abilities unlocked, no CP cost
- "Revenge Mode": Counter-attacks are free
- "Speedrun Challenge": Leaderboard for fastest games

### Cosmetic Monetization

**Premium Cosmetics** ($2-5):
- Custom emote animations
- Voice packs (celebrity voices)
- Ability VFX skins (gold effects, sparkles)
- Nameplate frames (show prestige)

**Battle Pass** ($10/season):
- 50 tiers of rewards
- Unlock exclusive abilities (cosmetic variants)
- Special taunts and emotes
- Profile badges

### Cross-Promotion

**Twitch Integration**:
- Viewers vote on attacks to use on streamer
- "Twitch Plays BISCUITS Chaos Mode"

**Discord Bot**:
- Link account, display stats
- Challenge friends via bot commands
- Leaderboard in Discord server

---

## Conclusion

The **Chaos Gameplay Mechanics System** transforms BISCUITS from a dice game into a **competitive psychological battleground**. By combining time pressure, disruptive abilities, and trash talk, we create **"fun frustration"** - stress that's entertaining, not enraging.

### Key Takeaways

✅ **Strategic Depth**: Abilities, CP economy, cooldowns add layers of decision-making
✅ **Replayability**: Every match feels different with 50+ abilities and random chaos
✅ **Spectator Value**: Chaos moments create highlight reels and viral clips
✅ **Community Building**: Shared suffering bonds players together
✅ **Monetization Ready**: Cosmetics, battle passes, no pay-to-win

### The Vision

> "In BISCUITS Chaos Mode, winning isn't about luck or skill alone - it's about **staying calm under pressure** while your opponents do everything possible to break you. Can you keep your composure when the screen is shaking, the timer is screaming, and your opponent is laughing at your failures? Only the strongest survive the chaos." 😈🎲

**Welcome to the torture chamber. Roll the dice... if you dare.** 💀

---

**Document End**

**Last Updated**: 2026-02-24
**Version**: 1.0
**Status**: Ready for Implementation
**Next Steps**: Review with team, prioritize Phase 1 features, begin prototyping

**Questions?** Open an issue on GitHub or contact the dev team.

**Let the chaos begin.** 😈
