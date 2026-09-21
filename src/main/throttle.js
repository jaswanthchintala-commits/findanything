'use strict';

/**
 * FindAnything - Intelligent Hardware Throttling
 * -----------------------------------------------
 * Monitors Node.js system metrics and user activity so the background
 * indexer never slows the computer down:
 *
 *  - CPU pressure: 1-minute load average normalized by core count.
 *    Above the high-water mark the indexer pauses; it resumes below the
 *    low-water mark (hysteresis prevents flapping).
 *  - User activity: Electron's powerMonitor system idle time is observed for
 *    telemetry, but does not block indexing. A desktop search tool must build
 *    its initial index while the user is using the computer; otherwise a
 *    first-launch search can remain empty until the user walks away.
 *
 * The monitor polls on a light interval and emits state changes through a
 * callback so the indexer and the UI badge stay in sync.
 */

const os = require('os');

const DEFAULTS = {
  pollIntervalMs: 3000,
  cpuHighWater: 0.55, // pause when normalized load avg exceeds this
  cpuLowWater: 0.35, // resume when it falls back below this
  // Retained as a telemetry threshold for compatibility and future adaptive
  // scheduling. User activity is deliberately not a hard pause condition.
  userActiveIdleSec: process.env.FA_USER_ACTIVE_IDLE_SEC
    ? Number(process.env.FA_USER_ACTIVE_IDLE_SEC)
    : 180
};

class ThrottleMonitor {
  /**
   * @param {object} options
   *   powerMonitor   Electron powerMonitor (optional in tests)
   *   onStateChange  fn(state) where state is 'running' | 'throttled' | 'paused'
   *   overrides      partial DEFAULTS overrides (for tests)
   */
  constructor(options = {}) {
    this.opts = Object.assign({}, DEFAULTS, options.overrides || {});
    this.powerMonitor = options.powerMonitor || null;
    this.onStateChange = options.onStateChange || (() => {});
    this.state = 'running';
    this.timer = null;
    this._manualPause = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this._sample(), this.opts.pollIntervalMs);
    if (this.timer.unref) this.timer.unref();
    this._sample();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Manual pause requested by the user from the settings panel. */
  setManualPause(paused) {
    this._manualPause = paused;
    this._sample();
  }

  /** Normalized CPU pressure: loadavg(1m) / core count, clamped to [0, 1+]. */
  getCpuPressure() {
    const cores = os.cpus().length || 1;
    return os.loadavg()[0] / cores;
  }

  /** Seconds since the user's last keyboard/mouse input (Infinity if unknown). */
  getUserIdleSeconds() {
    try {
      if (this.powerMonitor && typeof this.powerMonitor.getSystemIdleTime === 'function') {
        return this.powerMonitor.getSystemIdleTime();
      }
    } catch (_) {
      /* powerMonitor unavailable (e.g. in tests) */
    }
    return Infinity;
  }

  isUserActive() {
    return this.getUserIdleSeconds() < this.opts.userActiveIdleSec;
  }

  _sample() {
    const prev = this.state;
    const cpu = this.getCpuPressure();
    const userActive = this.isUserActive();

    if (this._manualPause) {
      this.state = 'paused';
    } else if (this.state === 'running') {
      // CPU pressure is a hard pause condition. Do not pause merely because
      // the user is active: on a normal first launch the user is necessarily
      // active while waiting for the index to be created.
      if (cpu > this.opts.cpuHighWater) {
        this.state = 'paused';
      }
    } else {
      // Paused: resume as soon as CPU pressure is low. User activity does not
      // prevent recovery, for the same first-launch reason described above.
      if (cpu < this.opts.cpuLowWater) {
        this.state = 'running';
      }
    }

    if (this.state !== prev) {
      this.onStateChange(this.state, { cpu, userActive });
    }
  }
}

module.exports = ThrottleMonitor;
