/** The clock retains unprocessed time; sustained overload pauses instead of dropping ticks. */
export class FixedClock {
  private previous: number | null = null;
  private accumulator = 0;
  private overloadedFrames = 0;
  readonly stepSeconds = 1 / 60;

  reset(): void {
    this.previous = null;
    this.accumulator = 0;
    this.overloadedFrames = 0;
  }

  frame(nowMilliseconds: number, playing: boolean, step: () => boolean): boolean {
    if (!playing) { this.reset(); return false; }
    if (this.previous === null) { this.previous = nowMilliseconds; return false; }
    const elapsed = Math.max(0, (nowMilliseconds - this.previous) / 1000);
    // Reject suspended time before stale input can advance combat or a result.
    // Preserve the existing inclusive one-second threshold for missing visibility events.
    if (elapsed >= 1) { this.reset(); return true; }
    this.previous = nowMilliseconds;
    this.accumulator += elapsed;
    let steps = 0;
    while (this.accumulator + 1e-10 >= this.stepSeconds && steps < 8) {
      this.accumulator = Math.max(0, this.accumulator - this.stepSeconds);
      steps += 1;
      if (!step()) { this.reset(); return false; }
    }
    if (this.accumulator + 1e-10 >= this.stepSeconds) this.overloadedFrames += 1;
    else this.overloadedFrames = 0;
    // Three budget overruns request a pause; long gaps were rejected above.
    return this.overloadedFrames >= 3;
  }

  get interpolation(): number { return Math.min(1, this.accumulator / this.stepSeconds); }
}
