/**
 * Frame governor for the render loop.
 *
 * A page cannot switch vsync off. `requestAnimationFrame` fires once per display
 * refresh and no amount of GPU headroom changes that, so the only thing the loop
 * controls is whether a given refresh is *used*. That makes a maximum frame rate a
 * real setting (skip a callback when the target interval has not elapsed) and it
 * also puts a hard ceiling the app cannot raise: over Remote Desktop Windows caps
 * the session display at ~30 fps, so a requested 60 renders at whatever the
 * session is allowed, and this module measures that actual refresh so the UI can
 * say so instead of appearing to ignore the setting.
 *
 * The elapsed time of a skipped refresh is carried into the next accepted frame,
 * so the ceiling costs the simulation nothing: it keeps advancing at its own
 * fixed 60 Hz rate whatever the picture does.
 */

/** Frame period attributed to the first frame, where there is nothing to diff. */
const FIRST_FRAME_MS = 16.7
/** Callback gaps outside this band are stalls or coalescing, not a refresh period. */
const MIN_GAP_MS = 2
const MAX_GAP_MS = 100
/** A gap longer than this means the tab was backgrounded: resume, do not catch up. */
const RESTART_MS = 1000
/** Refresh is estimated per window from the shortest gap: a dropped frame makes a
 *  gap a whole multiple of the refresh period, never a fraction of it, so the
 *  window minimum is the refresh and each window starts over to forget one bad read. */
const ESTIMATE_WINDOW_MS = 2000

export interface Frame {
  /** Milliseconds since the previously accepted frame. The caller advances the
   *  simulation by all of it, which is what keeps playback speed independent of
   *  the frame-rate ceiling. Wall-clock time is all this module reports: turning it
   *  into animation units is the renderer's business, and nothing downstream should
   *  be counting frames. */
  dtMs: number
}

/**
 * Whether a frame-rate ceiling can do anything on this display. Within a couple of
 * percent of the refresh rate the loop is already at or under the ceiling, and
 * skipping one callback out of jitter would halve the frame rate to no purpose.
 */
export function capApplies(refreshHz: number, maxFps: number): boolean {
  if (!(maxFps > 0)) return false
  if (!(refreshHz > 0)) return true
  return refreshHz > maxFps * 1.02
}

/** Frame rate a ceiling actually resolves to on this display; 0 means uncapped. */
export function cappedRate(refreshHz: number, maxFps: number): number {
  if (!capApplies(refreshHz, maxFps)) return 0
  return refreshHz > 0 ? Math.min(maxFps, refreshHz) : maxFps
}

export class FrameLimiter {
  /** Requested ceiling in frames per second. 0 renders every refresh. */
  maxFps = 0

  private lastCall = 0
  private lastAccepted = 0
  /** Absolute time the next frame becomes due. Advancing it by the interval rather
   *  than by "interval since now" keeps a requested 60 averaging 60 on a display
   *  whose refresh does not divide into it, instead of drifting to 48. */
  private nextDue = 0
  private estStart = 0
  private estMin = Infinity
  private refreshMs = 0

  /** Estimated refresh rate the browser is pacing callbacks by, 0 until measured. */
  get displayHz(): number {
    return this.refreshMs > 0 ? 1000 / this.refreshMs : 0
  }

  /**
   * Nominal wall-clock milliseconds between accepted frames: the display period, or
   * the ceiling's interval where the ceiling is the binding constraint.
   *
   * This does NOT depend on how long the app takes to produce a frame, which is what
   * makes it safe to budget work against. Budgeting against the *measured* frame
   * interval instead is a feedback loop: spending the slack lengthens the frame,
   * which appears to grant more slack.
   */
  get framePeriodMs(): number {
    const refresh = this.refreshMs > 0 ? this.refreshMs : FIRST_FRAME_MS
    return Math.max(refresh, this.intervalMs())
  }

  /** Frame rate the current ceiling allows on the measured display; 0 = uncapped. */
  get targetFps(): number {
    return cappedRate(this.displayHz, this.maxFps)
  }

  setMaxFps(fps: number): void {
    const next = Number.isFinite(fps) ? Math.min(1000, Math.max(0, fps)) : 0
    if (next === this.maxFps) return
    this.maxFps = next
    // Let the next callback through: after lowering the ceiling the loop should
    // respond at once rather than after a frame period of apparent deadlock.
    this.nextDue = 0
  }

  /** Forget the measured refresh and the pacing grid (new session, resumed tab). */
  reset(): void {
    this.lastCall = 0
    this.lastAccepted = 0
    this.nextDue = 0
    this.estStart = 0
    this.estMin = Infinity
    this.refreshMs = 0
  }

  /**
   * One call per scheduler callback.
   * @returns the frame to render, or null when the ceiling says this refresh is not due.
   */
  read(now: number): Frame | null {
    const first = this.lastCall === 0
    const gap = first ? 0 : now - this.lastCall
    this.lastCall = now
    if (!first) this.observe(gap, now)

    if (first || gap > RESTART_MS) {
      this.lastAccepted = now
      this.nextDue = 0
      return { dtMs: FIRST_FRAME_MS }
    }

    const interval = this.intervalMs()
    if (interval > 0 && this.nextDue > 0 && now + this.toleranceMs(interval) < this.nextDue) return null

    const dtMs = now - this.lastAccepted
    this.lastAccepted = now
    this.nextDue = interval > 0 ? this.dueAfter(now, interval) : 0
    return { dtMs }
  }

  /**
   * Advance the due grid by exactly one interval. Re-basing it on "now" instead
   * would absorb every late arrival, and a 60 fps ceiling on a 144 Hz display —
   * where a frame is always slightly late — would settle at 48 rather than
   * alternating two and three refreshes to average 60.
   */
  private dueAfter(now: number, interval: number): number {
    const next = this.nextDue > 0 ? this.nextDue + interval : now + interval
    // A hitch leaves the grid behind; re-sync rather than rendering every callback
    // until it catches up, which is the burst the ceiling exists to prevent.
    return next <= now ? now + interval : next
  }

  /** Interval between rendered frames, 0 for "every refresh". */
  private intervalMs(): number {
    if (!capApplies(this.displayHz, this.maxFps)) return 0
    return 1000 / this.maxFps
  }

  /**
   * How early a due frame may be taken. Small on purpose: it absorbs timer jitter
   * without letting a target between two refreshes snap up to the faster one,
   * which is how a 45 fps ceiling on a 60 Hz panel turns into 60.
   */
  private toleranceMs(interval: number): number {
    const byDisplay = this.refreshMs > 0 ? this.refreshMs * 0.25 : 2
    return Math.min(byDisplay, interval * 0.15)
  }

  private observe(gap: number, now: number): void {
    if (gap < MIN_GAP_MS || gap > MAX_GAP_MS) return
    if (this.estStart === 0 || now - this.estStart >= ESTIMATE_WINDOW_MS) {
      this.estStart = now
      this.estMin = gap
    } else if (gap < this.estMin) {
      this.estMin = gap
    }
    if (this.estMin !== Infinity) this.refreshMs = this.estMin
  }
}
