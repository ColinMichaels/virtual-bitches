/**
 * Deterministic RNG using xorshift128+
 * Seeded for replay capability
 */
export class SeededRNG {
  private s0: number;
  private s1: number;

  constructor(seed: string) {
    // Hash seed string to two 32-bit numbers
    const h = this.hashString(seed);
    this.s0 = h & 0xFFFFFFFF;
    this.s1 = (h >>> 32) & 0xFFFFFFFF;

    // Ensure non-zero state
    if (this.s0 === 0) this.s0 = 0x9E3779B9;
    if (this.s1 === 0) this.s1 = 0x7F4A7C15;
  }

  private hashString(str: string): number {
    let h = 0x811C9DC5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** Returns integer [0, 2^32) */
  next(): number {
    let s1 = this.s0;
    const s0 = this.s1;
    this.s0 = s0;
    s1 ^= s1 << 23;
    s1 ^= s1 >>> 17;
    s1 ^= s0;
    s1 ^= s0 >>> 26;
    this.s1 = s1;
    return (this.s0 + this.s1) >>> 0;
  }

  /** Returns float [0, 1) */
  nextFloat(): number {
    return this.next() / 0x100000000;
  }

  /** Returns integer [min, max] inclusive */
  nextInt(min: number, max: number): number {
    return Math.floor(this.nextFloat() * (max - min + 1)) + min;
  }

  /** Roll a die with N sides (1..N) */
  rollDie(sides: number): number {
    return this.nextInt(1, sides);
  }

  /** Serialize state for replay */
  getState(): [number, number] {
    return [this.s0, this.s1];
  }

  setState(s0: number, s1: number) {
    this.s0 = s0;
    this.s1 = s1;
  }
}
