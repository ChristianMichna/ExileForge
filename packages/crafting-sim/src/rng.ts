/** Seeded generator (mulberry32): same seed, same sequence, on every platform. */
export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Index drawn with the given non-negative weights; -1 if the total is 0. */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) return -1;
    let x = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      x -= weights[i] ?? 0;
      if (x < 0) return i;
    }
    return weights.length - 1;
  }
}
