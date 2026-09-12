(() => {
  'use strict';

  // ---------- PRESETS ----------
  const PRESETS = [
    { id: 'kickbox',  name: 'Kickboxing Rounds', work: 180, rest: 60,  rounds: 5, detail: '3:00 train / 1:00 rest x5' },
    { id: 'boxing',   name: 'Boxing Rounds',      work: 180, rest: 60,  rounds: 12, detail: '3:00 train / 1:00 rest x12' },
    { id: 'hiit',     name: 'HIIT Intervals',     work: 40,  rest: 20,  rounds: 8, detail: '0:40 train / 0:20 rest x8' },
    { id: 'tabata',   name: 'Tabata',             work: 20,  rest: 10,  rounds: 8, detail: '0:20 train / 0:10 rest x8' },
    { id: 'run',      name: 'Run / Walk Intervals', work: 300, rest: 90, rounds: 6, detail: '5:00 run / 1:30 walk x6' },
    { id: 'strength', name: 'Strength Training',  work: 60,  rest: 90,  rounds: 4, detail: '1:00 reps / 1:30 rest x4 — weights, kettlebells, pushups, etc.' },
  ];

  const STORAGE_KEY = 'rsf_timer_state_v1';

  // ---------- STATE ----------
  let state = load() || {
    presetId: 'kickbox',
    work: 180,
    rest: 60,
    rounds: 5,
    modeName: 'Kickboxing Rounds',
    restOnly: false,
  };

  let phase = 'work';       // 'work' | 'rest'
  let currentRound = 1;
  let secondsLeft = state.work;
  let running = false;
  let tickHandle = null;
  let lastTick = null;
  let wakeLock = null;

  // ---------- DOM ----------
  const el = {
    timeDisplay: document.getElementById('timeDisplay'),
    timeUnit: document.getElementById('timeUnit'),
    phaseLabel: document.getElementById('phaseLabel'),
    roundCount: document.getElementById('roundCount'),
    modeName: document.getElementById('modeName'),
    ringProgress: document.getElementById('ringProgress'),
    startBtn: document.getElementById('startBtn'),
    resetBtn: document.getElementById('resetBtn'),
    modeBtn: document.getElementById('modeBtn'),
    sheet: document.getElementById('sheet'),
    sheetBackdrop: document.getElementById('sheetBackdrop'),
    presetList: document.getElementById('presetList'),
    customWorkMin: document.getElementById('customWorkMin'),
    customWorkSec: document.getElementById('customWorkSec'),
    customRestMin: document.getElementById('customRestMin'),
    customRestSec: document.getElementById('customRestSec'),
    customRounds: document.getElementById('customRounds'),
    applyCustom: document.getElementById('applyCustom'),
    restOnlyToggle: document.getElementById('restOnlyToggle'),
    presetsTabBtn: document.getElementById('presetsTabBtn'),
    customTabBtn: document.getElementById('customTabBtn'),
    presetsPanel: document.getElementById('presetsPanel'),
    customPanel: document.getElementById('customPanel'),
    disclaimerBackdrop: document.getElementById('disclaimerBackdrop'),
    disclaimerSheet: document.getElementById('disclaimerSheet'),
    agreeBtn: document.getElementById('agreeBtn'),
    shareBtn: document.getElementById('shareBtn'),
    shareBackdrop: document.getElementById('shareBackdrop'),
    shareSheet: document.getElementById('shareSheet'),
    shareLinkBtn: document.getElementById('shareLinkBtn'),
  };

  const RING_CIRC = 2 * Math.PI * 90; // matches r=90 in svg

  // ---------- AUDIO (Web Audio API tones, no file needed) ----------
  let audioCtx = null;
  function beep(freq = 880, duration = 0.12, type = 'sine', volume = 0.35) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) { /* audio not available yet — needs a user gesture first */ }
  }
  function vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  // ---------- RENDER ----------
  function formatTime(s) {
    if (s >= 60) {
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return `${m}:${sec.toString().padStart(2, '0')}`;
    }
    return `${s}`;
  }

  function render() {
    el.timeDisplay.textContent = formatTime(secondsLeft);
    el.timeUnit.classList.toggle('visible', secondsLeft < 60);
    if (state.restOnly) {
      el.phaseLabel.textContent = 'REST';
      el.phaseLabel.classList.add('rest');
      el.roundCount.innerHTML = `SET <b>${currentRound}</b> / ${state.rounds}`;
    } else {
      el.phaseLabel.textContent = phase === 'work' ? 'TRAIN' : 'REST';
      el.phaseLabel.classList.toggle('rest', phase === 'rest');
      el.roundCount.innerHTML = `ROUND <b>${currentRound}</b> / ${state.rounds}`;
    }
    el.modeName.textContent = state.modeName.toUpperCase();

    const total = state.restOnly ? state.rest : (phase === 'work' ? state.work : state.rest);
    const fraction = total > 0 ? secondsLeft / total : 0;
    const offset = RING_CIRC * (1 - fraction);
    el.ringProgress.style.strokeDashoffset = offset;
    el.ringProgress.classList.toggle('rest', state.restOnly || phase === 'rest');

    const urgent = secondsLeft <= 10 && running;
    el.timeDisplay.classList.toggle('urgent', urgent && !state.restOnly && phase === 'work');
    el.timeDisplay.classList.toggle('pulsing', urgent);

    el.startBtn.textContent = running ? 'Pause' : (secondsLeft === (state.restOnly ? state.rest : (phase === 'work' ? state.work : state.rest)) && currentRound === 1 ? 'Start' : (state.restOnly ? 'Start Next Rest' : 'Resume'));
  }

  // ---------- TIMER ENGINE ----------
  function tick() {
    const now = performance.now();
    if (!lastTick) lastTick = now;
    if (now - lastTick >= 1000) {
      lastTick += 1000;
      secondsLeft -= 1;

      if (secondsLeft <= 10 && secondsLeft > 0) {
        // Pitch and volume ramp up the closer we get to zero — more urgent near the end
        const urgencyFactor = (11 - secondsLeft) / 10; // 0.1 -> 1.0
        const freq = 500 + (400 * urgencyFactor); // 540 -> 900
        beep(freq, 0.12, 'square', 0.35 + (0.25 * urgencyFactor));
        if (secondsLeft <= 3) vibrate(60);
      }
      if (secondsLeft === 0) {
        advancePhase();
      }
      render();
    }
    if (running) tickHandle = requestAnimationFrame(tick);
  }

  function advancePhase() {
    vibrate(phase === 'work' ? [120, 60, 120] : [200]);
    beep(phase === 'work' ? 440 : 880, 0.25, 'square', 0.5);

    if (state.restOnly) {
      // Rest-Only mode: each "round" is just a rest period the user manually re-triggers after their set.
      if (currentRound >= state.rounds) {
        finishWorkout();
        return;
      }
      currentRound += 1;
      secondsLeft = state.rest;
      running = false;
      cancelAnimationFrame(tickHandle);
      releaseWakeLock();
      render();
      return;
    }

    if (phase === 'work') {
      phase = 'rest';
      secondsLeft = state.rest;
      if (state.rest === 0) { advancePhase(); return; }
    } else {
      if (currentRound >= state.rounds) {
        finishWorkout();
        return;
      }
      currentRound += 1;
      phase = 'work';
      secondsLeft = state.work;
    }
  }

  function finishWorkout() {
    running = false;
    cancelAnimationFrame(tickHandle);
    releaseWakeLock();
    phase = 'work';
    currentRound = state.rounds;
    secondsLeft = 0;
    el.timeDisplay.textContent = 'DONE';
    el.phaseLabel.textContent = 'COMPLETE';
    vibrate([150, 80, 150, 80, 300]);
    beep(990, 0.3, 'square');
    el.startBtn.textContent = 'Start';
  }

  function start() {
    if (secondsLeft === 0 && el.timeDisplay.textContent === 'DONE') {
      resetWorkout();
    }
    running = true;
    lastTick = null;
    requestWakeLock();
    tickHandle = requestAnimationFrame(tick);
    render();
  }

  function pause() {
    running = false;
    cancelAnimationFrame(tickHandle);
    releaseWakeLock();
    render();
  }

  function toggleStart() {
    if (running) pause(); else start();
  }

  function resetWorkout() {
    running = false;
    cancelAnimationFrame(tickHandle);
    releaseWakeLock();
    phase = state.restOnly ? 'rest' : 'work';
    currentRound = 1;
    secondsLeft = state.restOnly ? state.rest : state.work;
    render();
  }

  // ---------- WAKE LOCK ----------
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch (e) { /* not supported / denied — fine, non-critical */ }
  }
  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && running) requestWakeLock();
  });

  // ---------- PRESET SHEET ----------
  function buildPresetList() {
    el.presetList.innerHTML = '';
    PRESETS.forEach(p => {
      const row = document.createElement('div');
      row.className = 'preset' + (p.id === state.presetId ? ' active' : '');
      row.innerHTML = `
        <div>
          <div class="preset-name">${p.name}</div>
          <div class="preset-detail">${p.detail}</div>
        </div>
        <button class="preset-select">${p.id === state.presetId ? 'Selected' : 'Select'}</button>
      `;
      row.querySelector('.preset-select').addEventListener('click', () => applyPreset(p));
      el.presetList.appendChild(row);
    });
  }

  function applyPreset(p) {
    const restOnly = el.restOnlyToggle.checked;
    state = { presetId: p.id, work: p.work, rest: p.rest, rounds: p.rounds, modeName: restOnly ? 'RSF Timer — Rest Only' : p.name, restOnly };
    save();
    resetWorkout();
    buildPresetList();
    closeSheet();
  }

  function applyCustom() {
    const workMin = Math.max(0, parseInt(el.customWorkMin.value, 10) || 0);
    const workSec = Math.max(0, Math.min(59, parseInt(el.customWorkSec.value, 10) || 0));
    const restMin = Math.max(0, parseInt(el.customRestMin.value, 10) || 0);
    const restSec = Math.max(0, Math.min(59, parseInt(el.customRestSec.value, 10) || 0));
    const work = Math.max(1, (workMin * 60) + workSec);
    const rest = Math.max(0, (restMin * 60) + restSec);
    const rounds = Math.max(1, parseInt(el.customRounds.value, 10) || 1);
    const restOnly = el.restOnlyToggle.checked;
    state = { presetId: 'custom', work, rest, rounds, modeName: restOnly ? 'RSF Timer — Rest Only' : 'RSF Timer', restOnly };
    save();
    resetWorkout();
    buildPresetList();
    closeSheet();
  }

  function openSheet() {
    buildPresetList();
    el.restOnlyToggle.checked = !!state.restOnly;
    el.sheet.classList.add('open');
    el.sheetBackdrop.classList.add('open');
  }
  function closeSheet() {
    el.sheet.classList.remove('open');
    el.sheetBackdrop.classList.remove('open');
  }

  // ---------- PERSISTENCE ----------
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // ---------- EVENTS ----------
  el.startBtn.addEventListener('click', toggleStart);
  el.resetBtn.addEventListener('click', resetWorkout);
  el.modeBtn.addEventListener('click', openSheet);
  el.sheetBackdrop.addEventListener('click', closeSheet);
  el.applyCustom.addEventListener('click', applyCustom);
  el.presetsTabBtn.addEventListener('click', () => {
    el.presetsTabBtn.classList.add('active');
    el.customTabBtn.classList.remove('active');
    el.presetsPanel.style.display = '';
    el.customPanel.style.display = 'none';
  });
  el.customTabBtn.addEventListener('click', () => {
    el.customTabBtn.classList.add('active');
    el.presetsTabBtn.classList.remove('active');
    el.customPanel.style.display = '';
    el.presetsPanel.style.display = 'none';
  });
  el.agreeBtn.addEventListener('click', () => {
    try { localStorage.setItem('rsf_timer_disclaimer_agreed_v1', 'true'); } catch (e) {}
    el.disclaimerBackdrop.classList.remove('open');
    el.disclaimerSheet.classList.remove('open');
  });

  const STORE_URL = 'https://rocketstrikefitness.gumroad.com/l/strpt';

  el.shareBtn.addEventListener('click', () => {
    el.shareBackdrop.classList.add('open');
    el.shareSheet.classList.add('open');
  });
  el.shareBackdrop.addEventListener('click', () => {
    el.shareBackdrop.classList.remove('open');
    el.shareSheet.classList.remove('open');
  });
  el.shareLinkBtn.addEventListener('click', async () => {
    const shareData = {
      title: 'RSF Round Timer',
      text: 'Check out RSF Round Timer — a glanceable workout timer from Rocket Strike Fitness.',
      url: STORE_URL,
    };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch (e) { /* user cancelled — fine */ }
    } else {
      try {
        await navigator.clipboard.writeText(STORE_URL);
        el.shareLinkBtn.textContent = 'Link Copied!';
        setTimeout(() => { el.shareLinkBtn.textContent = 'Share Link'; }, 2000);
      } catch (e) { /* clipboard not available — nothing more we can do */ }
    }
  });

  function checkDisclaimer() {
    let agreed = false;
    try { agreed = localStorage.getItem('rsf_timer_disclaimer_agreed_v1') === 'true'; } catch (e) {}
    if (!agreed) {
      el.disclaimerBackdrop.classList.add('open');
      el.disclaimerSheet.classList.add('open');
    }
  }

  // Prevent double-tap zoom on rapid taps
  let lastTouch = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouch <= 300) e.preventDefault();
    lastTouch = now;
  }, { passive: false });

  // ---------- INIT ----------
  secondsLeft = state.work;
  render();
  checkDisclaimer();
})();
