/**
 * salt-seized-turret — stiction / notch / viscous physics + shutter timer
 * Usable from the browser (script tag) and Node (require) with no build step.
 */
(function (root) {
  "use strict";

  /** Radians of torque that must be overcome before a seized axle turns. */
  var BREAKAWAY_TORQUE = 2.85;

  /** Continuous opposing torque while the axle is already moving. */
  var KINETIC_FRICTION = 0.95;

  /**
   * Exponential viscous coefficient (1/s). High value so free spin dies
   * almost immediately when the hand leaves the eyepiece.
   */
  var VISCOUS_DAMPING = 18.5;

  /** Coupling gain translating pointer angular intent into applied torque. */
  var DRAG_GAIN = 14.0;

  /** Soft clamp on |drag torque| so frantic scrubbing still fights the salt. */
  var DRAG_TORQUE_CLAMP = 8;

  /**
   * Keyboard effort: hold builds torque from START (below free breakaway)
   * up past the strongest salt-notch threshold.
   */
  var KEY_TORQUE_START = 2.2;
  var KEY_TORQUE_MAX = 5.4;
  var KEY_RAMP_SECONDS = 0.9;

  /** @deprecated alias — instantaneous floor; prefer keyTorqueForHold. */
  var KEY_TORQUE = KEY_TORQUE_START;

  /** Resting velocity below which the axle re-seizes. */
  var SEIZE_VELOCITY = 0.04;

  /** Coin-op session length in milliseconds — must be exactly 60 seconds. */
  var TIMER_DURATION_MS = 60000;

  /** Shutter fall duration once the timer expires. */
  var SHUTTER_DROP_MS = 380;

  /**
   * Irregular salt-encrusted gear binding notches (radians).
   * Spacing is deliberately uneven.
   */
  var NOTCH_ANGLES = [
    0.22, 0.71, 1.41, 1.95, 2.68, 3.35, 4.02, 4.55, 5.18, 5.76,
  ];

  var NOTCH_HALF_WIDTH = 0.085;
  var NOTCH_BREAKAWAY_BONUS = 1.65;
  var NOTCH_KINETIC_BONUS = 0.75;

  function wrapAngle(a) {
    var tau = Math.PI * 2;
    a = a % tau;
    if (a < 0) a += tau;
    return a;
  }

  function notchBonus(angle) {
    var a = wrapAngle(angle);
    var breakaway = 0;
    var kinetic = 0;
    for (var i = 0; i < NOTCH_ANGLES.length; i++) {
      var d = Math.abs(a - NOTCH_ANGLES[i]);
      if (d > Math.PI) d = Math.PI * 2 - d;
      if (d < NOTCH_HALF_WIDTH) {
        var t = 1 - d / NOTCH_HALF_WIDTH;
        // Soft triangular binding spike.
        var spike = t * t;
        breakaway = Math.max(breakaway, NOTCH_BREAKAWAY_BONUS * spike);
        kinetic = Math.max(kinetic, NOTCH_KINETIC_BONUS * spike);
      }
    }
    return { breakaway: breakaway, kinetic: kinetic };
  }

  /** Peak breakaway anywhere on the ring (notch center). */
  function maxBreakawayThreshold() {
    return BREAKAWAY_TORQUE + NOTCH_BREAKAWAY_BONUS;
  }

  /**
   * Keyboard torque after holding a direction for `holdSeconds`.
   * Ease-in cubic so early presses feel seized; sustained hold clears notches.
   */
  function keyTorqueForHold(holdSeconds) {
    var t = holdSeconds <= 0 ? 0 : holdSeconds / KEY_RAMP_SECONDS;
    if (t > 1) t = 1;
    var eased = t * t * (3 - 2 * t); // smoothstep
    return KEY_TORQUE_START + (KEY_TORQUE_MAX - KEY_TORQUE_START) * eased;
  }

  function createState(now) {
    now = now == null ? 0 : now;
    return {
      angle: 0,
      velocity: 0,
      seized: true,
      sessionActive: false,
      timerStartedAt: null,
      /** "idle" | "running" | "closing" | "closed" */
      shutter: "idle",
      shutterStartedAt: null,
      lastClunkAt: null,
    };
  }

  /**
   * Insert the (virtual) coin / start a session.
   * Opens the shutter and starts the 60s mechanical timer.
   */
  function startSession(state, now) {
    state.sessionActive = true;
    state.timerStartedAt = now;
    state.shutter = "running";
    state.shutterStartedAt = null;
    state.lastClunkAt = null;
    state.angle = 0;
    state.velocity = 0;
    state.seized = true;
    return state;
  }

  function restart(state, now) {
    // Reset fields in place so callers holding a reference stay valid.
    var fresh = createState(now);
    state.angle = fresh.angle;
    state.velocity = fresh.velocity;
    state.seized = fresh.seized;
    state.sessionActive = fresh.sessionActive;
    state.timerStartedAt = fresh.timerStartedAt;
    state.shutter = fresh.shutter;
    state.shutterStartedAt = fresh.shutterStartedAt;
    state.lastClunkAt = fresh.lastClunkAt;
    return startSession(state, now);
  }

  /**
   * Remaining timer ms (0 when expired / shutter closed / not started).
   */
  function remainingMs(state, now) {
    if (!state.sessionActive || state.timerStartedAt == null) return 0;
    if (state.shutter === "closed" || state.shutter === "closing") return 0;
    var elapsed = now - state.timerStartedAt;
    return Math.max(0, TIMER_DURATION_MS - elapsed);
  }

  function dialProgress(state, now) {
    if (!state.sessionActive || state.timerStartedAt == null) return 0;
    var elapsed = Math.min(
      TIMER_DURATION_MS,
      Math.max(0, now - state.timerStartedAt)
    );
    return elapsed / TIMER_DURATION_MS;
  }

  /**
   * 0 = fully open, 1 = fully dropped.
   * Idle (pre-coin) and closed both cover the optic — coherent bathos.
   */
  function shutterProgress(state, now) {
    if (state.shutter === "idle" || state.shutter === "closed") return 1;
    if (state.shutter === "running") return 0;
    var t = (now - state.shutterStartedAt) / SHUTTER_DROP_MS;
    if (t >= 1) return 1;
    // Ease-in: gravity accelerating the plate.
    return t * t;
  }

  /**
   * Advance timer / shutter state machine. Returns { clunk: boolean }.
   * No-op before a session starts (idle).
   */
  function updateTimer(state, now) {
    var clunk = false;
    if (!state.sessionActive) return { clunk: false };

    if (state.shutter === "running") {
      if (now - state.timerStartedAt >= TIMER_DURATION_MS) {
        state.shutter = "closing";
        state.shutterStartedAt = now;
      }
    }

    if (state.shutter === "closing") {
      if (now - state.shutterStartedAt >= SHUTTER_DROP_MS) {
        state.shutter = "closed";
        state.sessionActive = false;
        state.velocity = 0;
        state.seized = true;
        clunk = true;
        state.lastClunkAt = now;
      }
    }

    return { clunk: clunk };
  }

  function canRotate(state) {
    return state.shutter === "running";
  }

  /**
   * Drag torque from angular delta over dt. Same angular rate ⇒ same torque
   * (event-rate independent when callers accumulate deltas per display frame).
   */
  function computeDragTorque(angleDelta, dt) {
    if (dt <= 0) return 0;
    var intentRate = angleDelta / dt;
    var torque = intentRate * (DRAG_GAIN * 0.12);
    if (torque > DRAG_TORQUE_CLAMP) torque = DRAG_TORQUE_CLAMP;
    if (torque < -DRAG_TORQUE_CLAMP) torque = -DRAG_TORQUE_CLAMP;
    return torque;
  }

  /**
   * Apply an external torque for one integration step.
   * Used by pointer drag intent and keyboard nudges.
   */
  function applyTorque(state, torque, dt) {
    if (!canRotate(state) || dt <= 0) return state;

    var n = notchBonus(state.angle);
    var breakaway = BREAKAWAY_TORQUE + n.breakaway;
    var kinetic = KINETIC_FRICTION + n.kinetic;

    if (state.seized) {
      if (Math.abs(torque) < breakaway) {
        state.velocity = 0;
        return state;
      }
      // Breakaway: snap into kinetic regime with a slight lurch.
      state.seized = false;
      state.velocity = (torque > 0 ? 1 : -1) * 0.35;
    }

    var friction = kinetic * (state.velocity >= 0 ? 1 : -1);
    // Oppose motion; if nearly stopped and torque is weak, re-seize.
    var accel = torque - friction - VISCOUS_DAMPING * state.velocity;
    state.velocity += accel * dt;
    state.angle = wrapAngle(state.angle + state.velocity * dt);

    if (
      Math.abs(state.velocity) < SEIZE_VELOCITY &&
      Math.abs(torque) < breakaway * 0.55
    ) {
      state.velocity = 0;
      state.seized = true;
    }

    return state;
  }

  /**
   * Convert a pointer angular delta into a drag torque and integrate once.
   * Prefer accumulating deltas across pointer events, then calling once per frame.
   */
  function applyDrag(state, angleDelta, dt) {
    if (!canRotate(state) || dt <= 0) return state;
    return applyTorque(state, computeDragTorque(angleDelta, dt), dt);
  }

  /**
   * Free-spin / release step: sharp viscous death, no driving torque.
   */
  function stepIdle(state, dt) {
    if (!canRotate(state) || dt <= 0) return state;

    if (state.seized) {
      state.velocity = 0;
      return state;
    }

    var n = notchBonus(state.angle);
    var kinetic = KINETIC_FRICTION + n.kinetic;
    var friction = kinetic * (state.velocity >= 0 ? 1 : -1);
    var accel = -friction - VISCOUS_DAMPING * state.velocity;
    state.velocity += accel * dt;
    state.angle = wrapAngle(state.angle + state.velocity * dt);

    if (Math.abs(state.velocity) < SEIZE_VELOCITY) {
      state.velocity = 0;
      state.seized = true;
    }

    return state;
  }

  /**
   * Probe helper for tests: minimum |torque| needed to break away at angle.
   */
  function breakawayThresholdAt(angle) {
    var n = notchBonus(angle);
    return BREAKAWAY_TORQUE + n.breakaway;
  }

  /**
   * Probe helper: whether a given torque would free a seized axle at angle.
   */
  function wouldBreakAway(angle, torque) {
    return Math.abs(torque) >= breakawayThresholdAt(angle);
  }

  var api = {
    BREAKAWAY_TORQUE: BREAKAWAY_TORQUE,
    KINETIC_FRICTION: KINETIC_FRICTION,
    VISCOUS_DAMPING: VISCOUS_DAMPING,
    DRAG_GAIN: DRAG_GAIN,
    DRAG_TORQUE_CLAMP: DRAG_TORQUE_CLAMP,
    KEY_TORQUE: KEY_TORQUE,
    KEY_TORQUE_START: KEY_TORQUE_START,
    KEY_TORQUE_MAX: KEY_TORQUE_MAX,
    KEY_RAMP_SECONDS: KEY_RAMP_SECONDS,
    SEIZE_VELOCITY: SEIZE_VELOCITY,
    TIMER_DURATION_MS: TIMER_DURATION_MS,
    SHUTTER_DROP_MS: SHUTTER_DROP_MS,
    NOTCH_ANGLES: NOTCH_ANGLES.slice(),
    NOTCH_HALF_WIDTH: NOTCH_HALF_WIDTH,
    NOTCH_BREAKAWAY_BONUS: NOTCH_BREAKAWAY_BONUS,
    wrapAngle: wrapAngle,
    notchBonus: notchBonus,
    maxBreakawayThreshold: maxBreakawayThreshold,
    keyTorqueForHold: keyTorqueForHold,
    createState: createState,
    startSession: startSession,
    restart: restart,
    remainingMs: remainingMs,
    dialProgress: dialProgress,
    shutterProgress: shutterProgress,
    updateTimer: updateTimer,
    canRotate: canRotate,
    computeDragTorque: computeDragTorque,
    applyTorque: applyTorque,
    applyDrag: applyDrag,
    stepIdle: stepIdle,
    breakawayThresholdAt: breakawayThresholdAt,
    wouldBreakAway: wouldBreakAway,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.SaltPhysics = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
