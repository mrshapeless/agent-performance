/**
 * Nothing to see. — cinematic stage, pointer/keyboard UX
 * Depends on global SaltPhysics from physics.js (no bundler).
 * Public copy stays spare; physics jargon stays out of the UI.
 */
(function () {
  "use strict";

  var P = window.SaltPhysics;
  if (!P) {
    throw new Error("SaltPhysics missing — load physics.js first");
  }

  var canvas = document.getElementById("viewport");
  var ctx = canvas.getContext("2d");
  var dialEl = document.getElementById("dial");
  var statusEl = document.getElementById("status");
  var btnCoin = document.getElementById("btn-coin");
  var btnRestart = document.getElementById("btn-restart");
  var btnMute = document.getElementById("btn-mute");
  var stageCopy = document.getElementById("stage-copy");

  var reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  var state = P.createState(performance.now());
  var dragging = false;
  var activePointerId = null;
  var pendingDragDelta = 0;
  var lastClientX = 0;
  var lastTs = performance.now();
  var keys = Object.create(null);
  var keyHoldStartedAt = null;
  var keyHoldSign = 0;
  var lastStatusText = "";
  var audioCtx = null;
  var muted = false;
  var fogSeed = 0.37;
  var dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));

  function ensureAudio() {
    if (audioCtx) return audioCtx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
    return audioCtx;
  }

  function playClunk() {
    if (muted) return;
    var ac = ensureAudio();
    if (!ac) return;
    if (ac.state === "suspended") ac.resume();

    var t0 = ac.currentTime;
    var master = ac.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(0.4, t0 + 0.008);
    master.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
    master.connect(ac.destination);

    var osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(72, t0);
    osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.18);
    var og = ac.createGain();
    og.gain.value = 0.4;
    osc.connect(og);
    og.connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.32);

    var len = Math.floor(ac.sampleRate * 0.05);
    var buf = ac.createBuffer(1, len, ac.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len) * 0.35;
    }
    var noise = ac.createBufferSource();
    noise.buffer = buf;
    var ng = ac.createGain();
    ng.gain.setValueAtTime(0.25, t0);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
    noise.connect(ng);
    ng.connect(master);
    noise.start(t0);
  }

  function playOpenTick() {
    if (muted) return;
    var ac = ensureAudio();
    if (!ac) return;
    if (ac.state === "suspended") ac.resume();
    var t0 = ac.currentTime;
    var osc = ac.createOscillator();
    var g = ac.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(420, t0);
    osc.frequency.exponentialRampToValueAtTime(210, t0 + 0.1);
    g.gain.setValueAtTime(0.06, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
    osc.connect(g);
    g.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + 0.12);
  }

  function resize() {
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.floor(rect.width * dpr));
    var h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function clearKeyState() {
    keys = Object.create(null);
    keyHoldStartedAt = null;
    keyHoldSign = 0;
  }

  function clearDragState(e) {
    dragging = false;
    activePointerId = null;
    pendingDragDelta = 0;
    canvas.classList.remove("is-dragging");
    if (e && e.pointerId != null) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (_) {
        /* already released */
      }
    }
  }

  function clearInputState(e) {
    clearKeyState();
    clearDragState(e);
  }

  function setStatus(text) {
    if (text === lastStatusText) return;
    lastStatusText = text;
    statusEl.textContent = text;
  }

  function statusFor(now) {
    if (state.shutter === "idle") {
      return "One minute with the fog. Then the view closes.";
    }
    if (state.shutter === "running") {
      if (state.seized) {
        return "The glass resists. Keep dragging.";
      }
      return "Still fog. Keep looking.";
    }
    if (state.shutter === "closing") {
      return "The minute ends.";
    }
    return "The view closed.";
  }

  function syncPhase() {
    if (!stageCopy) return;
    stageCopy.setAttribute("data-phase", state.shutter);
  }

  function updateChrome(now) {
    var progress = P.dialProgress(state, now);
    dialEl.style.setProperty("--progress", String(progress));
    setStatus(statusFor(now));
    syncPhase();
  }

  function beginSession() {
    ensureAudio();
    clearInputState();
    var now = performance.now();
    state = P.startSession(P.createState(now), now);
    playOpenTick();
    updateChrome(now);
  }

  function doRestart() {
    ensureAudio();
    clearInputState();
    var now = performance.now();
    state = P.restart(state, now);
    playOpenTick();
    updateChrome(now);
  }

  function heldKeySign() {
    var left = keys.ArrowLeft || keys.a || keys.A;
    var right = keys.ArrowRight || keys.d || keys.D;
    if (left && !right) return -1;
    if (right && !left) return 1;
    return 0;
  }

  function toggleMute() {
    muted = !muted;
    if (btnMute) {
      btnMute.setAttribute("aria-pressed", muted ? "true" : "false");
      btnMute.textContent = muted ? "Sound off" : "Sound on";
    }
    if (!muted) ensureAudio();
  }

  /* ---------- fog field (procedural; palette from the approved beach still) ---------- */

  function hash2(x, y) {
    var n = Math.sin(x * 127.1 + y * 311.7 + fogSeed) * 43758.5453;
    return n - Math.floor(n);
  }

  function drawField(w, h, now) {
    var pan = state.angle;
    var t = reducedMotion ? 0 : now;

    // Overcast sky → damp sand, soft horizon (informed by Out of frame still).
    var sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#c8ced6");
    sky.addColorStop(0.42, "#9aa1a8");
    sky.addColorStop(0.55, "#8a8680");
    sky.addColorStop(1, "#6f6a64");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    var horizon = h * (0.52 + Math.sin(pan * 0.35) * 0.02);
    ctx.fillStyle = "rgba(120,118,112,0.35)";
    ctx.fillRect(0, horizon, w, h - horizon);

    // Soft cobalt-tinted mist bands that drift with the reluctant pan.
    var bands = 8;
    for (var i = 0; i < bands; i++) {
      var u = i / bands;
      var drift = reducedMotion
        ? pan * 40
        : pan * 55 + Math.sin(t * 0.00012 + i * 1.3) * 28;
      var cx = ((hash2(i, 1) - 0.5) * w * 1.4 + drift + w * 2) % (w * 1.6) - w * 0.3;
      var cy = h * (0.18 + u * 0.7) + Math.sin(pan * 0.5 + i) * 12;
      var rr = Math.min(w, h) * (0.28 + hash2(i, 2) * 0.45);
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
      var cool = 0.1 + hash2(i, 3) * 0.12;
      g.addColorStop(0, "rgba(180,188,198," + (0.22 + cool) + ")");
      g.addColorStop(0.45, "rgba(120,140,180," + (0.08 + cool * 0.4) + ")");
      g.addColorStop(1, "rgba(7,59,237,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Faint wet-sand sheen — almost nothing to see.
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = "#d5d0c8";
    ctx.lineWidth = Math.max(1, h * 0.002);
    ctx.beginPath();
    ctx.moveTo(-20, horizon);
    for (var x = 0; x <= w; x += 24) {
      var y =
        horizon +
        Math.sin(x * 0.01 + pan * 2) * 3 +
        Math.sin(x * 0.03 - pan) * 2;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Soft vignette / condensation at the edges.
    var vig = ctx.createRadialGradient(
      w * 0.5,
      h * 0.45,
      Math.min(w, h) * 0.2,
      w * 0.5,
      h * 0.5,
      Math.max(w, h) * 0.72
    );
    vig.addColorStop(0, "rgba(8,19,43,0)");
    vig.addColorStop(0.7, "rgba(8,19,43,0.12)");
    vig.addColorStop(1, "rgba(6,31,143,0.45)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);

    if (state.shutter === "idle") {
      // Atmospheric stage under the title — fog present, not yet a closed plate.
      ctx.fillStyle = "rgba(7, 59, 237, 0.52)";
      ctx.fillRect(0, 0, w, h);
    } else {
      // Closing plate — warm paper, then cobalt when the minute is over.
      var sp = P.shutterProgress(state, now);
      if (sp > 0) {
        var drop = sp * (h + 8);
        ctx.fillStyle = "#fffdf3";
        ctx.fillRect(0, -4, w, drop);
        ctx.fillStyle = "rgba(7, 59, 237, 0.1)";
        ctx.fillRect(0, Math.max(0, drop - 6), w, 6);
        if (state.shutter === "closed" || sp >= 1) {
          ctx.fillStyle = "#073bed";
          ctx.fillRect(0, 0, w, h);
        }
      }
    }
  }

  function frame(now) {
    var dt = Math.min(0.05, (now - lastTs) / 1000);
    lastTs = now;

    var timerResult = P.updateTimer(state, now);
    if (timerResult.clunk) playClunk();

    if (P.canRotate(state)) {
      var sign = heldKeySign();
      if (sign === 0) {
        keyHoldStartedAt = null;
        keyHoldSign = 0;
      } else if (sign !== keyHoldSign || keyHoldStartedAt == null) {
        keyHoldSign = sign;
        keyHoldStartedAt = now;
      }

      var keyTorque = 0;
      if (sign !== 0 && keyHoldStartedAt != null) {
        var holdSec = (now - keyHoldStartedAt) / 1000;
        keyTorque = sign * P.keyTorqueForHold(holdSec);
      }

      if (pendingDragDelta !== 0) {
        var dragDt = dt > 0.0005 ? dt : 1 / 60;
        P.applyDrag(state, pendingDragDelta, dragDt);
        pendingDragDelta = 0;
        if (keyTorque !== 0) {
          P.applyTorque(state, keyTorque * 0.35, dragDt);
        }
      } else if (keyTorque !== 0) {
        P.applyTorque(state, keyTorque, dt);
      } else {
        P.stepIdle(state, dt);
      }
    } else {
      pendingDragDelta = 0;
    }

    resize();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawField(canvas.width, canvas.height, now);
    updateChrome(now);

    requestAnimationFrame(frame);
  }

  /* ---------- input ---------- */

  canvas.addEventListener("pointerdown", function (e) {
    ensureAudio();
    if (!P.canRotate(state) && state.shutter === "idle") {
      beginSession();
    }
    if (!P.canRotate(state)) return;
    dragging = true;
    activePointerId = e.pointerId;
    pendingDragDelta = 0;
    lastClientX = e.clientX;
    canvas.classList.add("is-dragging");
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", function (e) {
    if (!dragging || !P.canRotate(state)) return;
    if (activePointerId != null && e.pointerId !== activePointerId) return;
    var rect = canvas.getBoundingClientRect();
    var width = Math.max(1, rect.width);
    var dx = e.clientX - lastClientX;
    lastClientX = e.clientX;
    // Horizontal scrub → axle angle; event density only accumulates delta.
    pendingDragDelta += (dx / width) * Math.PI * 1.35;
  });

  function endDrag(e) {
    if (!dragging) return;
    if (
      e &&
      activePointerId != null &&
      e.pointerId != null &&
      e.pointerId !== activePointerId
    ) {
      return;
    }
    clearDragState(e);
  }

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("lostpointercapture", function () {
    dragging = false;
    activePointerId = null;
    canvas.classList.remove("is-dragging");
  });

  canvas.addEventListener("keydown", function (e) {
    if (
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight" ||
      e.key === "a" ||
      e.key === "A" ||
      e.key === "d" ||
      e.key === "D"
    ) {
      if (!keys[e.key]) {
        keys[e.key] = true;
        var sign = heldKeySign();
        if (sign !== 0) {
          keyHoldSign = sign;
          keyHoldStartedAt = performance.now();
        }
      }
      e.preventDefault();
      ensureAudio();
      if (!P.canRotate(state) && state.shutter === "idle") beginSession();
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (state.shutter === "idle" || state.shutter === "closed") beginSession();
    }
    if (e.key === "m" || e.key === "M") {
      toggleMute();
    }
  });

  canvas.addEventListener("keyup", function (e) {
    keys[e.key] = false;
    var sign = heldKeySign();
    if (sign === 0) {
      keyHoldStartedAt = null;
      keyHoldSign = 0;
    } else if (sign !== keyHoldSign) {
      keyHoldSign = sign;
      keyHoldStartedAt = performance.now();
    }
  });

  function onBlur() {
    clearInputState();
  }

  canvas.addEventListener("blur", onBlur);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) clearInputState();
  });

  btnCoin.addEventListener("click", function () {
    beginSession();
  });

  btnRestart.addEventListener("click", function () {
    doRestart();
  });

  if (btnMute) {
    btnMute.addEventListener("click", function () {
      toggleMute();
    });
  }

  window.addEventListener("resize", resize);

  resize();
  updateChrome(performance.now());
  requestAnimationFrame(frame);
})();
