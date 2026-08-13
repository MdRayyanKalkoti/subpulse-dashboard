/* ─── client.js ─────────────────────────────────────────────────────────────
   Main dashboard client: Socket.io + animations + confetti + SOUND ENGINE
   ─────────────────────────────────────────────────────────────────────────── */

(function () {
  "use strict";

  // ─── State ─────────────────────────────────────────────────────────────────
  const state = {
    subscribers: 0,
    goal: 10000,
    chatMsgCount: 0,
    doneDetected: 0,
    milestones: [],
    reachedMilestones: new Set(),
    popupTimer: null,
    alertTimer: null,
    soundEnabled: true,
    masterVolume: 0.7,
    audioCtx: null,   // lazy-init on first user gesture
    // Shorts views
    views: 0,
    viewsGoal: 1000,
    // DONE queue
    doneQueue: [],
    doneQueueProcessing: false,
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  🔊  WEB AUDIO SOUND ENGINE
  //  All sounds synthesized — zero external files, works in OBS browser source
  // ═══════════════════════════════════════════════════════════════════════════

  function getAudioCtx() {
    if (!state.audioCtx) {
      state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.audioCtx.state === "suspended") state.audioCtx.resume();
    return state.audioCtx;
  }

  /**
   * Core note scheduler.
   * Each note: { freq, time, duration, type, vol, attack, release }
   */
  function playNotes(notes, baseVol = 1.0) {
    if (!state.soundEnabled) return;
    const ac = getAudioCtx();
    const masterGain = ac.createGain();
    masterGain.gain.setValueAtTime(state.masterVolume * baseVol, ac.currentTime);
    masterGain.connect(ac.destination);

    notes.forEach(({ freq, time, duration, type = "sine", vol = 1, attack = 0.01, release = 0.1 }) => {
      const osc  = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ac.currentTime + time);
      gain.gain.setValueAtTime(0, ac.currentTime + time);
      gain.gain.linearRampToValueAtTime(vol, ac.currentTime + time + attack);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + time + duration + release);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(ac.currentTime + time);
      osc.stop(ac.currentTime + time + duration + release + 0.05);
    });
  }

  /** Reverb tail via noise-burst convolver */
  function addReverb(sourceNode, ac, wetGain, duration) {
    const conv       = ac.createConvolver();
    const sampleRate = ac.sampleRate;
    const len        = Math.floor(sampleRate * duration);
    const impulse    = ac.createBuffer(2, len, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    }
    conv.buffer = impulse;
    const wet = ac.createGain();
    wet.gain.value = wetGain;
    sourceNode.connect(conv);
    conv.connect(wet);
    wet.connect(ac.destination);
  }

  // ── 🔔 SUBSCRIBER DING — bright C-E-G-C bell arpeggio + reverb ─────────────
  function playSubscribeDing() {
    if (!state.soundEnabled) return;
    const ac = getAudioCtx();

    function bell(freq, startTime, vol) {
      [
        { type: "sine",     freqMult: 1,    vMult: 1.00 },
        { type: "triangle", freqMult: 2.76, vMult: 0.15 },
        { type: "sine",     freqMult: 5.40, vMult: 0.08 },
      ].forEach(({ type, freqMult, vMult }) => {
        const osc  = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = type;
        osc.frequency.value = freq * freqMult;
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(vol * vMult * state.masterVolume, startTime + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 1.8);
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.start(startTime);
        osc.stop(startTime + 2.0);
      });
    }

    // C5 → E5 → G5 → C6 arpeggio
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => bell(f, ac.currentTime + i * 0.08, 0.28));

    // Shimmer tail with reverb
    const shimOsc  = ac.createOscillator();
    const shimGain = ac.createGain();
    shimOsc.type = "sine";
    shimOsc.frequency.value = 1046.5;
    shimGain.gain.setValueAtTime(0.05 * state.masterVolume, ac.currentTime + 0.24);
    shimGain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 2.5);
    shimOsc.connect(shimGain);
    addReverb(shimGain, ac, 0.2, 2.0);
    shimGain.connect(ac.destination);
    shimOsc.start(ac.currentTime + 0.24);
    shimOsc.stop(ac.currentTime + 3.0);
  }

  // ── 🏆 MILESTONE FANFARE — heroic 4-note brass motif + kick ────────────────
  function playMilestoneFanfare() {
    if (!state.soundEnabled) return;
    playNotes([
      { freq: 261.63, time: 0.00, duration: 0.18, type: "sawtooth", vol: 0.30, attack: 0.01,  release: 0.08 },
      { freq: 329.63, time: 0.15, duration: 0.18, type: "sawtooth", vol: 0.30, attack: 0.01,  release: 0.08 },
      { freq: 392.00, time: 0.30, duration: 0.18, type: "sawtooth", vol: 0.30, attack: 0.01,  release: 0.08 },
      { freq: 523.25, time: 0.45, duration: 0.50, type: "sawtooth", vol: 0.35, attack: 0.02,  release: 0.20 },
      { freq: 392.00, time: 0.45, duration: 0.50, type: "sawtooth", vol: 0.20, attack: 0.02,  release: 0.20 },
      { freq: 659.25, time: 0.45, duration: 0.50, type: "sawtooth", vol: 0.18, attack: 0.02,  release: 0.20 },
      { freq: 65.41,  time: 0.45, duration: 0.40, type: "square",   vol: 0.25, attack: 0.005, release: 0.15 },
    ], 1.0);
    playKick(0.45);
  }

  // ── 💬 CHAT DONE CHIME — soft two-tone ping ─────────────────────────────────
  function playChatDing() {
    if (!state.soundEnabled) return;
    playNotes([
      { freq: 880,  time: 0.00, duration: 0.12, type: "sine", vol: 0.18, attack: 0.005, release: 0.15 },
      { freq: 1320, time: 0.10, duration: 0.12, type: "sine", vol: 0.14, attack: 0.005, release: 0.18 },
    ], 1.0);
  }

  // ── 🥁 KICK DRUM ────────────────────────────────────────────────────────────
  function playKick(delay) {
    if (!state.soundEnabled) return;
    delay = delay || 0;
    const ac = getAudioCtx();
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    const t    = ac.currentTime + delay;
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(0.001, t + 0.35);
    gain.gain.setValueAtTime(state.masterVolume * 0.8, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  // ── ⚡ COUNTER BLIP — tiny rising tick when sub count increases ──────────────
  function playCounterBlip() {
    if (!state.soundEnabled) return;
    playNotes([
      { freq: 440, time: 0,    duration: 0.06, type: "sine", vol: 0.12, attack: 0.004, release: 0.06 },
      { freq: 660, time: 0.06, duration: 0.06, type: "sine", vol: 0.10, attack: 0.004, release: 0.06 },
    ], 1.0);
  }

  // ── ✅ CONNECTION ONLINE chime ───────────────────────────────────────────────
  function playConnectChime() {
    if (!state.soundEnabled) return;
    playNotes([
      { freq: 392, time: 0,    duration: 0.10, type: "sine", vol: 0.15, attack: 0.01, release: 0.10 },
      { freq: 523, time: 0.12, duration: 0.10, type: "sine", vol: 0.15, attack: 0.01, release: 0.10 },
    ], 1.0);
  }

  // ── ❌ DISCONNECT WARNING buzz ───────────────────────────────────────────────
  function playDisconnectBuzz() {
    if (!state.soundEnabled) return;
    playNotes([
      { freq: 220, time: 0,    duration: 0.15, type: "sawtooth", vol: 0.20, attack: 0.01,  release: 0.10 },
      { freq: 180, time: 0.18, duration: 0.25, type: "sawtooth", vol: 0.20, attack: 0.01,  release: 0.15 },
    ], 1.0);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  DOM REFS
  // ═══════════════════════════════════════════════════════════════════════════

  const $ = (id) => document.getElementById(id);

  const els = {
    subCount:          $("subCountDisplay"),
    subDelta:          $("subDelta"),
    goalDisplay:       $("goalDisplay"),
    remainingDisplay:  $("remainingDisplay"),
    progressFill:      $("progressFill"),
    progressPct:       $("progressPct"),
    milestoneMarkers:  $("milestoneMarkers"),
    milestonesRow:     $("milestonesRow"),
    statPercent:       $("statPercent"),
    statRemaining:     $("statRemaining"),
    statDetected:      $("statDetected"),
    chatFeed:          $("chatFeed"),
    chatCount:         $("chatCount"),
    notificationPopup: $("notificationPopup"),
    popupUsername:     $("popupUsername"),
    flashOverlay:      $("flashOverlay"),
    connectionBar:     $("connectionBar"),
    socketStatus:      $("socketStatus"),
    socketStatusText:  $("socketStatusText"),
    apiStatus:         $("apiStatus"),
    apiStatusText:     $("apiStatusText"),
    alertBanner:       $("alertBanner"),
    clockDisplay:      $("clockDisplay"),
    soundToggle:       $("soundToggle"),
    volumeSlider:      $("volumeSlider"),
    volumeValue:       $("volumeValue"),
    // Shorts views
    viewsDisplay:      $("viewsDisplay"),
    viewsDelta:        $("viewsDelta"),
    viewsGoalDisplay:  $("viewsGoalDisplay"),
    viewsRemainingDisplay: $("viewsRemainingDisplay"),
    viewsProgressFill: $("viewsProgressFill"),
    viewsProgressPct:  $("viewsProgressPct"),
    // Feature 1: viewer count
    viewerCount:       $("viewerCount"),
    viewerCountBadge:  $("viewerCountBadge"),
    // Feature 3: milestone countdown
    mcbSubsNeeded:     $("mcbSubsNeeded"),
    mcbNextPct:        $("mcbNextPct"),
    mcbMiniFill:       $("mcbMiniFill"),
    mcbMiniPct:        $("mcbMiniPct"),
    milestoneCountdownBar: $("milestoneCountdownBar"),
    // DONE queue
    doneQueueBar:      $("doneQueueBar"),
    doneQueueCount:    $("doneQueueCount"),
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  SOUND TOGGLE + VOLUME SLIDER WIRING
  // ═══════════════════════════════════════════════════════════════════════════

  // Unlock AudioContext on first interaction (browser autoplay policy)
  function unlockAudio() {
    getAudioCtx();
    document.removeEventListener("click",   unlockAudio);
    document.removeEventListener("keydown", unlockAudio);
  }
  document.addEventListener("click",   unlockAudio);
  document.addEventListener("keydown", unlockAudio);

  window.toggleSound = function () {
    state.soundEnabled = !state.soundEnabled;
    const btn = els.soundToggle;
    if (!btn) return;
    if (state.soundEnabled) {
      btn.textContent = "🔔 SOUND ON";
      btn.classList.remove("sound-off");
      playConnectChime();
    } else {
      btn.textContent = "🔇 SOUND OFF";
      btn.classList.add("sound-off");
    }
  };

  window.testSound = function () {
    state.soundEnabled = true;
    if (els.soundToggle) {
      els.soundToggle.textContent = "🔔 SOUND ON";
      els.soundToggle.classList.remove("sound-off");
    }
    playSubscribeDing();
  };

  if (els.volumeSlider) {
    els.volumeSlider.addEventListener("input", function(e) {
      state.masterVolume = parseFloat(e.target.value);
      if (els.volumeValue) els.volumeValue.textContent = Math.round(state.masterVolume * 100) + "%";
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  CLOCK
  // ═══════════════════════════════════════════════════════════════════════════

  function updateClock() {
    if (els.clockDisplay) {
      els.clockDisplay.textContent = new Date().toLocaleTimeString("en-US", {
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      });
    }
  }
  updateClock();
  setInterval(updateClock, 1000);

  // ═══════════════════════════════════════════════════════════════════════════
  //  ANIMATED COUNTER
  // ═══════════════════════════════════════════════════════════════════════════

  function animateCounter(el, from, to, duration) {
    duration = duration || 800;
    var start = performance.now();
    var diff  = to - from;
    function step(now) {
      var elapsed  = now - start;
      var progress = Math.min(elapsed / duration, 1);
      var eased    = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(from + diff * eased).toLocaleString();
      if (progress < 1) requestAnimationFrame(step);
      else              el.textContent = to.toLocaleString();
    }
    requestAnimationFrame(step);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  INITIAL STATE LOAD
  // ═══════════════════════════════════════════════════════════════════════════

  fetch("/api/state")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      state.goal        = data.goal;
      state.subscribers = data.subscribers;
      state.milestones  = data.milestones || [];

      if (data.isApiConfigured) {
        els.apiStatus.className        = "status-dot online";
        els.apiStatusText.textContent  = "API ✓";
      } else {
        els.apiStatus.className        = "status-dot warning";
        els.apiStatusText.textContent  = "DEMO MODE";
      }

      buildMilestones(data.milestones, data.goal);
      updateUI(data.subscribers, data.goal, 0);

      // Load shorts views
      if (data.viewsGoal) state.viewsGoal = data.viewsGoal;
      updateViewsUI(data.shortsViews || 0, data.viewsGoal || 1000, 0);
    })
    .catch(function() {
      if (els.apiStatus)     els.apiStatus.className        = "status-dot";
      if (els.apiStatusText) els.apiStatusText.textContent  = "API ERR";
    });

  // ═══════════════════════════════════════════════════════════════════════════
  //  MILESTONE UI
  // ═══════════════════════════════════════════════════════════════════════════

  function buildMilestones(milestones, goal) {
    els.milestonesRow.innerHTML    = "";
    els.milestoneMarkers.innerHTML = "";

    milestones.forEach(function(m) {
      var pct  = Math.round((m / goal) * 100);

      var chip = document.createElement("div");
      chip.className = "milestone-chip";
      chip.id        = "milestone-chip-" + pct;
      chip.innerHTML = "<span class=\"chip-pct\">" + pct + "%</span>" + m.toLocaleString();
      els.milestonesRow.appendChild(chip);

      var mark      = document.createElement("div");
      mark.className  = "milestone-mark";
      mark.style.left = pct + "%";
      els.milestoneMarkers.appendChild(mark);
    });

    var goalLabel = $("goalLabelBottom");
    if (goalLabel)       goalLabel.textContent      = goal.toLocaleString();
    if (els.goalDisplay) els.goalDisplay.textContent = goal.toLocaleString();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  UI UPDATE
  // ═══════════════════════════════════════════════════════════════════════════

  function updateUI(count, goal, gained) {
    var pct       = Math.min(100, Math.round((count / goal) * 100));
    var remaining = Math.max(0, goal - count);

    animateCounter(els.subCount, state.subscribers, count);
    state.subscribers = count;

    if (gained > 0) {
      els.subDelta.textContent = "+" + gained;
      els.subDelta.classList.add("show");
      setTimeout(function() { els.subDelta.classList.remove("show"); }, 4000);

      els.subCount.classList.add("flash");
      setTimeout(function() { els.subCount.classList.remove("flash"); }, 2000);

      screenFlash();
      playCounterBlip();   // ⚡ tiny blip per gained sub

      // Log each new subscriber (name unknown from API — only DONE chat gives real names)
      for (var g = 0; g < gained; g++) {
        var subNum = count - (gained - 1 - g);
        logSubscriber("Subscriber #" + subNum + " (name unknown — ask them to type DONE)");
      }
    }

    els.progressFill.style.width      = pct + "%";
    els.progressPct.textContent        = pct + "%";
    els.statPercent.textContent        = pct + "%";
    els.statRemaining.textContent      = remaining.toLocaleString();
    els.remainingDisplay.textContent   = remaining.toLocaleString();

    state.milestones.forEach(function(m) {
      var mpct = Math.round((m / goal) * 100);
      var chip = $("milestone-chip-" + mpct);
      if (chip && count >= m) chip.classList.add("reached");
    });

    // Update next milestone countdown
    updateMilestoneCountdown(count, goal, state.milestones);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  VIEWS UI UPDATE
  // ═══════════════════════════════════════════════════════════════════════════

  function updateViewsUI(views, viewsGoal, gained) {
    state.views    = views;
    state.viewsGoal = viewsGoal;
    var pct       = Math.min(100, Math.round((views / viewsGoal) * 100));
    var remaining = Math.max(0, viewsGoal - views);

    if (els.viewsDisplay)      animateCounter(els.viewsDisplay, state.views - gained, views);
    if (els.viewsGoalDisplay)  els.viewsGoalDisplay.textContent = viewsGoal.toLocaleString();
    if (els.viewsRemainingDisplay) els.viewsRemainingDisplay.textContent = remaining.toLocaleString();
    if (els.viewsProgressFill) els.viewsProgressFill.style.width = pct + "%";
    if (els.viewsProgressPct)  els.viewsProgressPct.textContent = pct + "%";

    if (gained > 0 && els.viewsDelta) {
      els.viewsDelta.textContent = "+" + gained;
      els.viewsDelta.classList.add("show");
      setTimeout(function() { els.viewsDelta.classList.remove("show"); }, 4000);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SCREEN FLASH
  // ═══════════════════════════════════════════════════════════════════════════

  function screenFlash() {
    els.flashOverlay.classList.add("flash");
    setTimeout(function() { els.flashOverlay.classList.remove("flash"); }, 200);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  NOTIFICATION POPUP
  // ═══════════════════════════════════════════════════════════════════════════

  function showNotification(username) {
    var popup = els.notificationPopup;
    els.popupUsername.textContent = username;

    popup.classList.remove("show", "hide");
    void popup.offsetWidth; // force reflow

    popup.classList.add("show");
    screenFlash();
    spawnConfetti(180);
    playSubscribeDing();   // 🔔 THE MAIN DING

    if (state.popupTimer) clearTimeout(state.popupTimer);
    state.popupTimer = setTimeout(function() {
      popup.classList.remove("show");
      popup.classList.add("hide");
    }, 5500);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ALERT BANNER
  // ═══════════════════════════════════════════════════════════════════════════

  function showAlertBanner(msg) {
    els.alertBanner.textContent = msg;
    els.alertBanner.classList.add("show");
    if (state.alertTimer) clearTimeout(state.alertTimer);
    state.alertTimer = setTimeout(function() {
      els.alertBanner.classList.remove("show");
    }, 4000);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  CHAT FEED
  // ═══════════════════════════════════════════════════════════════════════════

  function addChatMessage(author, text, isDone) {
    isDone = isDone || false;
    state.chatMsgCount++;
    els.chatCount.textContent = state.chatMsgCount + " MSG";

    var msg = document.createElement("div");
    msg.className = "chat-msg" + (isDone ? " done-msg" : "");
    msg.innerHTML =
      "<div class=\"chat-author\">" + escapeHtml(author) + "</div>" +
      "<div class=\"chat-text\">" + escapeHtml(text) +
      (isDone ? " <span class=\"done-badge\">DONE</span>" : "") + "</div>";

    els.chatFeed.appendChild(msg);
    while (els.chatFeed.children.length > 80) els.chatFeed.removeChild(els.chatFeed.firstChild);
    els.chatFeed.scrollTop = els.chatFeed.scrollHeight;

    if (isDone) playChatDing();   // 💬 soft chime on DONE keyword
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  CONFETTI
  // ═══════════════════════════════════════════════════════════════════════════

  var confettiCanvas = $("confetti-canvas");
  var confCtx        = confettiCanvas.getContext("2d");
  var confParticles  = [];
  var confAnimId     = null;

  function resizeConfettiCanvas() {
    confettiCanvas.width  = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
  }
  resizeConfettiCanvas();
  window.addEventListener("resize", resizeConfettiCanvas);

  var CONF_COLORS = ["#ff2200","#ffb700","#00e676","#00d4ff","#ffffff","#ff6644","#aa00ff","#ffdd00"];

  function spawnConfetti(n) {
    n = n || 150;
    for (var i = 0; i < n; i++) {
      confParticles.push({
        x: Math.random() * confettiCanvas.width,
        y: -20 - Math.random() * 100,
        w: Math.random() * 14 + 4,
        h: Math.random() * 7  + 3,
        color: CONF_COLORS[Math.floor(Math.random() * CONF_COLORS.length)],
        angle: Math.random() * Math.PI * 2,
        spin:  (Math.random() - 0.5) * 0.25,
        vx:    (Math.random() - 0.5) * 8,
        vy:    Math.random() * 6 + 2,
        gravity: 0.15,
        alpha: 1,
        decay: Math.random() * 0.006 + 0.002,
      });
    }
    if (!confAnimId) animateConfetti();
  }

  function animateConfetti() {
    confCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    confParticles = confParticles.filter(function(p) { return p.alpha > 0.01; });

    confParticles.forEach(function(p) {
      p.x += p.vx; p.y += p.vy; p.vy += p.gravity; p.vx *= 0.99;
      p.angle += p.spin; p.alpha -= p.decay;
      confCtx.save();
      confCtx.translate(p.x, p.y);
      confCtx.rotate(p.angle);
      confCtx.globalAlpha = Math.max(0, p.alpha);
      confCtx.fillStyle   = p.color;
      confCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      confCtx.restore();
    });

    confAnimId = confParticles.length > 0 ? requestAnimationFrame(animateConfetti) : null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SOCKET.IO
  // ═══════════════════════════════════════════════════════════════════════════

  var socket = io();

  socket.on("connect", function() {
    console.log("🔌 Connected:", socket.id);
    els.connectionBar.className      = "connection-bar";
    els.socketStatus.className       = "status-dot online";
    els.socketStatusText.textContent = "CONNECTED";
    playConnectChime();   // ✅ connected sound
  });

  socket.on("disconnect", function() {
    console.log("🔌 Disconnected");
    els.connectionBar.className      = "connection-bar disconnected";
    els.socketStatus.className       = "status-dot";
    els.socketStatusText.textContent = "DISCONNECTED";
    showAlertBanner("⚠ Connection lost — reconnecting...");
    playDisconnectBuzz(); // ❌ disconnected buzz
  });

  socket.on("reconnect", function() {
    showAlertBanner("✓ Reconnected to server");
    playConnectChime();
  });

  socket.on("subscriberUpdate", function(data) {
    state.goal = data.goal;
    updateUI(data.count, data.goal, data.gained);
  });

  socket.on("subscriberDetected", function(data) {
    console.log("🔔 Subscriber detected:", data.username);
    state.doneDetected++;
    els.statDetected.textContent = state.doneDetected;
    addChatMessage(data.username, "DONE", true);
    logSubscriber(data.username);

    // Add to DONE queue
    state.doneQueue.push(data.username);
    updateQueueUI();
    processQueue();
  });

  socket.on("chatMessage", function(data) {
    var isDone = /\bDONE\b/i.test(data.text);
    addChatMessage(data.author, data.text, isDone);
    // playChatDing() called inside addChatMessage when isDone
  });

  socket.on("viewsUpdate", function(data) {
    updateViewsUI(data.views, data.viewsGoal, data.gained);
  });

  // Feature 1: Live viewer count
  socket.on("viewerUpdate", function(data) {
    if (els.viewerCount) els.viewerCount.textContent = data.viewers.toLocaleString();
    if (els.viewerCountBadge) {
      els.viewerCountBadge.style.color = data.viewers > 0 ? "var(--green)" : "var(--text-dim)";
    }
  });

  socket.on("milestoneReached", function(data) {
    console.log("🏆 Milestone:", data.percent + "%");
    spawnConfetti(350);
    playMilestoneFanfare();   // 🏆 fanfare
    showAlertBanner("🏆 MILESTONE: " + data.percent + "% reached — " + data.count.toLocaleString() + " subscribers!");

    var chip = $("milestone-chip-" + data.percent);
    if (chip) {
      chip.classList.add("reached");
      chip.style.transform = "scale(1.1)";
      setTimeout(function() { chip.style.transform = ""; }, 600);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  TEST CONTROLS (global functions called from HTML onclick)
  // ═══════════════════════════════════════════════════════════════════════════

  window.triggerTestSubscriber = function () {
    var username = ($("testUsername").value.trim()) || "TestViewer";
    fetch("/api/trigger-subscriber", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username }),
    }).catch(console.error);
  };

  window.bumpSubs = function () {
    fetch("/api/bump-subs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 1 }),
    }).catch(console.error);
  };

  window.clearChat = function () {
    var feed = $("chatFeed");
    if (!feed) return;
    // Remove all messages
    feed.innerHTML = "";
    // Reset counter
    state.chatMsgCount = 0;
    var countEl = $("chatCount");
    if (countEl) countEl.textContent = "0 MSG";
    // Add a "cleared" system notice
    var msg = document.createElement("div");
    msg.className = "chat-msg chat-cleared-notice";
    msg.innerHTML =
      "<div class='chat-author'>SYSTEM</div>" +
      "<div class='chat-text'>Chat cleared — new messages will appear below</div>";
    feed.appendChild(msg);
  };

  $("testUsername").addEventListener("keydown", function(e) {
    if (e.key === "Enter") window.triggerTestSubscriber();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  ⏱  LIVE STREAM COUNTDOWN TIMER
  // ═══════════════════════════════════════════════════════════════════════════

  var timerInterval  = null;
  var timerRemaining = 0;   // seconds remaining
  var timerRunning   = false;

  function pad(n) { return String(n).padStart(2, "0"); }

  function timerFormat(secs) {
    var h = Math.floor(secs / 3600);
    var m = Math.floor((secs % 3600) / 60);
    var s = secs % 60;
    return pad(h) + ":" + pad(m) + ":" + pad(s);
  }

  function timerUpdateDisplay() {
    var el = $("timerCountdown");
    if (!el) return;
    el.textContent = timerFormat(timerRemaining);

    // Colour states
    el.className = "timer-countdown";
    if (!timerRunning && timerRemaining === 0) {
      el.classList.add("done");
    } else if (timerRunning) {
      if (timerRemaining <= 30)       el.classList.add("danger");
      else if (timerRemaining <= 120) el.classList.add("warning");
      else                            el.classList.add("running");
    }
  }

  function timerReadInputs() {
    var h = parseInt($("timerHH").value) || 0;
    var m = parseInt($("timerMM").value) || 0;
    var s = parseInt($("timerSS").value) || 0;
    return h * 3600 + m * 60 + s;
  }

  window.timerStart = function() {
    if (timerRunning) return;
    // If timer is at 0 read fresh inputs
    if (timerRemaining <= 0) {
      timerRemaining = timerReadInputs();
      if (timerRemaining <= 0) return;
    }
    timerRunning = true;
    $("timerStartBtn").disabled = true;
    $("timerPauseBtn").disabled = false;

    timerInterval = setInterval(function() {
      if (timerRemaining <= 0) {
        clearInterval(timerInterval);
        timerRunning = false;
        timerRemaining = 0;
        $("timerStartBtn").disabled = false;
        $("timerPauseBtn").disabled = true;
        timerUpdateDisplay();
        // Play fanfare when timer hits zero
        playMilestoneFanfare();
        showAlertBanner("⏱ Stream timer finished!");
        return;
      }
      timerRemaining--;
      timerUpdateDisplay();
    }, 1000);

    timerUpdateDisplay();
  };

  window.timerPause = function() {
    if (!timerRunning) return;
    clearInterval(timerInterval);
    timerRunning = false;
    $("timerStartBtn").disabled = false;
    $("timerPauseBtn").disabled = true;
    timerUpdateDisplay();
  };

  window.timerReset = function() {
    clearInterval(timerInterval);
    timerRunning = false;
    timerRemaining = 0;
    $("timerStartBtn").disabled = false;
    $("timerPauseBtn").disabled = true;
    // Reset display to input values
    var total = timerReadInputs();
    timerRemaining = total;
    timerUpdateDisplay();
  };

  // Sync countdown display when user changes inputs
  ["timerHH","timerMM","timerSS"].forEach(function(id) {
    var el = $(id);
    if (el) el.addEventListener("input", function() {
      if (!timerRunning) {
        timerRemaining = timerReadInputs();
        timerUpdateDisplay();
      }
    });
  });

  // Init display
  timerRemaining = timerReadInputs();
  timerUpdateDisplay();

  // ═══════════════════════════════════════════════════════════════════════════
  //  ⏳  DONE QUEUE — shows popups one by one, never misses a subscriber
  // ═══════════════════════════════════════════════════════════════════════════

  function updateQueueUI() {
    var count = state.doneQueue.length;
    if (els.doneQueueBar) {
      els.doneQueueBar.style.display = count > 0 ? "flex" : "none";
    }
    if (els.doneQueueCount) els.doneQueueCount.textContent = count;
  }

  function processQueue() {
    if (state.doneQueueProcessing || state.doneQueue.length === 0) return;
    state.doneQueueProcessing = true;
    var username = state.doneQueue.shift();
    updateQueueUI();

    showNotification(username);         // show popup + sound
    showAlertBanner("🔥 " + username + " subscribed!");

    // Wait for popup to finish before showing next (6 seconds)
    setTimeout(function() {
      state.doneQueueProcessing = false;
      processQueue();                   // process next in queue
    }, 6000);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ⚡  NEXT MILESTONE COUNTDOWN
  // ═══════════════════════════════════════════════════════════════════════════

  function updateMilestoneCountdown(currentSubs, goal, milestones) {
    if (!els.milestoneCountdownBar) return;

    // Find next milestone not yet reached
    var nextMilestone = null;
    for (var i = 0; i < milestones.length; i++) {
      if (currentSubs < milestones[i]) {
        nextMilestone = milestones[i];
        break;
      }
    }

    if (!nextMilestone) {
      // All milestones reached — show goal
      nextMilestone = goal;
    }

    var nextPct   = Math.round((nextMilestone / goal) * 100);
    var needed    = Math.max(0, nextMilestone - currentSubs);
    var prevMilestone = 0;
    for (var j = 0; j < milestones.length; j++) {
      if (milestones[j] < nextMilestone) prevMilestone = milestones[j];
    }
    var segProgress = Math.min(100, Math.round(
      ((currentSubs - prevMilestone) / (nextMilestone - prevMilestone)) * 100
    ));

    if (els.mcbSubsNeeded) els.mcbSubsNeeded.textContent = needed.toLocaleString();
    if (els.mcbNextPct)    els.mcbNextPct.textContent    = nextPct + "%";
    if (els.mcbMiniFill)   els.mcbMiniFill.style.width   = segProgress + "%";
    if (els.mcbMiniPct)    els.mcbMiniPct.textContent    = segProgress + "%";

    // Pulse when close
    if (needed <= 5 && needed > 0) {
      els.milestoneCountdownBar.classList.add("mcb-pulse");
    } else {
      els.milestoneCountdownBar.classList.remove("mcb-pulse");
    }
  }

  // ─── Seed chat with demo messages ──────────────────────────────────────────
  setTimeout(function() { addChatMessage("System",      "Dashboard is live! Type DONE to trigger alert."); }, 800);
  setTimeout(function() { addChatMessage("StreamFan42", "Let's go! Almost at goal!"); }, 1600);
  setTimeout(function() { addChatMessage("YouTubePro",  "This overlay looks insane 🔥"); }, 2400);

  // ═══════════════════════════════════════════════════════════════════════════
  //  📋  SUBSCRIBER LOG  — persists in localStorage across refreshes
  // ═══════════════════════════════════════════════════════════════════════════

  var LOG_KEY    = "yt_sub_log";
  var logOpen    = false;
  var logEntries = [];          // [ { name, time, ts } ]

  /** Load saved entries from localStorage on boot */
  function loadSubLog() {
    try {
      var raw = localStorage.getItem(LOG_KEY);
      logEntries = raw ? JSON.parse(raw) : [];
    } catch(e) { logEntries = []; }
    renderSubLog();
  }

  /** Persist current entries to localStorage */
  function saveSubLog() {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(logEntries)); } catch(e) {}
  }

  /** Add a new subscriber entry */
  function logSubscriber(username) {
    var now  = new Date();
    var isNamed = username.indexOf("name unknown") === -1;
    var entry = {
      name: username,
      time: now.toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false }),
      ts:   now.getTime(),
      named: isNamed,
    };
    logEntries.unshift(entry);   // newest first
    saveSubLog();
    renderSubLog();
    bumpLogBadge();

    // Auto-flash the tab to draw attention
    var tab = $("subLogTab");
    if (tab) {
      tab.classList.add("tab-flash");
      setTimeout(function() { tab.classList.remove("tab-flash"); }, 1500);
    }
  }

  /** Re-render the list (also used for search filtering) */
  function renderSubLog() {
    var list    = $("subLogList");
    var empty   = $("subLogEmpty");
    var total   = $("subLogTotal");
    var badge   = $("subLogBadge");
    var query   = ($("subLogSearch") ? $("subLogSearch").value.toLowerCase() : "");

    if (total)  total.textContent  = logEntries.length + " total";
    if (badge)  badge.textContent  = logEntries.length;

    // Remove all rows (keep empty placeholder)
    var rows = list.querySelectorAll(".sub-log-row");
    rows.forEach(function(r) { r.remove(); });

    if (logEntries.length === 0) {
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";

    logEntries.forEach(function(entry, idx) {
      var visible = !query || entry.name.toLowerCase().indexOf(query) !== -1;

      var isNamed = entry.named !== false && entry.name.indexOf("name unknown") === -1;
      var row = document.createElement("div");
      row.className = "sub-log-row"
        + (idx === 0 && !query ? " new-entry" : "")
        + (!visible ? " hidden" : "")
        + (!isNamed ? " unnamed-entry" : "");
      var nameDisplay = isNamed
        ? escapeHtml(entry.name)
        : "<span class='sub-log-unknown'>" + escapeHtml(entry.name) + "</span>";
      row.innerHTML =
        "<span class='sub-log-num'>#" + (logEntries.length - idx) + "</span>" +
        "<span class='sub-log-name'>" + nameDisplay + "</span>" +
        "<span class='sub-log-time'>" + escapeHtml(entry.time) + "</span>";
      list.appendChild(row);

      // Remove new-entry highlight after 3s
      if (idx === 0 && !query) {
        setTimeout(function() { row.classList.remove("new-entry"); }, 3000);
      }
    });
  }

  /** Animate the badge counter */
  function bumpLogBadge() {
    var badge = $("subLogBadge");
    if (!badge) return;
    badge.classList.remove("bump");
    void badge.offsetWidth;
    badge.classList.add("bump");
  }

  // ── Global functions wired to HTML onclick ──────────────────────────────────

  window.toggleSubLog = function() {
    logOpen = !logOpen;
    var panel = $("subLogPanel");
    var tab   = $("subLogTab");
    if (logOpen) {
      panel.classList.add("open");
      tab.classList.add("open");
      renderSubLog();  // refresh on open
    } else {
      panel.classList.remove("open");
      tab.classList.remove("open");
    }
  };

  window.filterSubLog = function() { renderSubLog(); };

  window.clearSubLog = function() {
    if (!confirm("Clear all " + logEntries.length + " saved subscriber names?")) return;
    logEntries = [];
    saveSubLog();
    renderSubLog();
  };

  window.exportSubLog = function() {
    if (logEntries.length === 0) { alert("No subscribers saved yet."); return; }
    var lines = ["#,Name,Time"];
    logEntries.forEach(function(e, i) {
      lines.push((logEntries.length - i) + "," + e.name + "," + e.time);
    });
    var blob = new Blob([lines.join("\n")], { type: "text/csv" });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement("a");
    a.href     = url;
    a.download = "subscribers_" + new Date().toISOString().slice(0,10) + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Boot: load saved log on page load
  loadSubLog();

})();