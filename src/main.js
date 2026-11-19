import { EARTH_YEAR_DAYS, PLANETS } from './data/planets.js';
import { getAllPlanetStates } from './physics/kepler.js';
import { SolarSystemRenderer } from './render/renderer.js';
import { ObservatoryUI, MIN_SPEED_DPS, MAX_SPEED_DPS } from './ui/controls.js';

const VALID_PLANET_IDS = new Set(PLANETS.map((p) => p.id));
const COMPLETION_RETENTION_MS = 1500;

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function normalizeBodyId(target) {
  if (target === null || target === undefined || target === '') {
    return null;
  }
  if (typeof target === 'number' && Number.isInteger(target)) {
    if (target === 0) return 'sun';
    const match = PLANETS.find((p) => p.order === target);
    return match ? match.id : null;
  }
  const id = String(target).toLowerCase();
  if (id === 'sun' || VALID_PLANET_IDS.has(id)) {
    return id;
  }
  return null;
}

function initSolarSystemApp() {
  const canvas = document.getElementById('solar-canvas');
  if (!canvas) {
    throw new Error('Missing #solar-canvas element');
  }

  // Central simulation state
  const simState = {
    elapsedDays: 0,
    playing: true,
    direction: 1, // +1 forward, -1 reverse
    daysPerSecond: 30, // Mercury completes an orbit in ~2.9s, Earth in ~12.2s
    scaleMode: 'compressed', // 'compressed' | 'true'
    startMode: 'aligned', // 'aligned' | 'j2000'
    viewPreset: '3d', // '3d' | 'top'
    selectedPlanetId: null,
    followTargetId: null,
    overlays: {
      showOrbits: true,
      showLabels: true,
      showTrails: true,
      showStartLine: true,
      showAsteroidBelt: true,
    },
  };

  // Track previous revolutions for orbit-completion detection & active completion flashes
  const prevOrbitsById = new Map();
  const recentCompletions = new Map();

  let latestPlanetStates = [];
  let lastFrameMs = performance.now();

  function computeStates({ detectCompletions = false, nowMs = performance.now() } = {}) {
    const nextStates = getAllPlanetStates(simState.elapsedDays, {
      startMode: simState.startMode,
      scaleMode: simState.scaleMode,
    });

    for (const state of nextStates) {
      const id = state.planet.id;
      const newOrbits = state.orbitsCompleted;

      if (detectCompletions && prevOrbitsById.has(id)) {
        const prevOrbits = prevOrbitsById.get(id);
        if (Math.floor(Math.abs(newOrbits)) > Math.floor(Math.abs(prevOrbits))) {
          recentCompletions.set(id, nowMs);
        }
      }

      prevOrbitsById.set(id, newOrbits);
    }

    // Prune expired completion timestamps
    for (const [id, ts] of recentCompletions.entries()) {
      if (nowMs - ts > COMPLETION_RETENTION_MS) {
        recentCompletions.delete(id);
      }
    }

    latestPlanetStates = nextStates;
    return nextStates;
  }

  function renderNow(nowMs = performance.now()) {
    renderer.render(simState, latestPlanetStates, {
      scaleMode: simState.scaleMode,
      startMode: simState.startMode,
      showOrbits: simState.overlays.showOrbits,
      showLabels: simState.overlays.showLabels,
      showTrails: simState.overlays.showTrails,
      showStartLine: simState.overlays.showStartLine,
      showAsteroidBelt: simState.overlays.showAsteroidBelt,
      selectedPlanetId: simState.selectedPlanetId,
      recentCompletions,
    });
    ui.updateTelemetry(simState, latestPlanetStates, recentCompletions, nowMs);
  }

  // ---- Simulation Actions ----

  function setPlaying(playing) {
    simState.playing = Boolean(playing);
    lastFrameMs = performance.now();
    ui.syncControls(simState);
    renderNow(lastFrameMs);
  }

  function togglePlay() {
    setPlaying(!simState.playing);
  }

  function toggleDirection() {
    simState.direction = simState.direction >= 0 ? -1 : 1;
    ui.syncControls(simState);
    renderNow();
  }

  function setSpeed(daysPerSecond) {
    const numeric = Number(daysPerSecond);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    simState.daysPerSecond = clamp(numeric, MIN_SPEED_DPS, MAX_SPEED_DPS);
    ui.syncControls(simState);
  }

  function stepDays(deltaDays) {
    const delta = Number(deltaDays);
    if (!Number.isFinite(delta)) return;
    const nowMs = performance.now();
    simState.elapsedDays += delta * simState.direction;
    computeStates({ detectCompletions: true, nowMs });
    ui.syncControls(simState);
    renderNow(nowMs);
  }

  function setElapsedDays(days) {
    const numeric = Number(days);
    if (!Number.isFinite(numeric)) return;
    const nowMs = performance.now();
    simState.elapsedDays = numeric;
    recentCompletions.clear();
    renderer.clearTrails();
    computeStates({ detectCompletions: false, nowMs });
    ui.syncControls(simState);
    renderNow(nowMs);
  }

  function resetTime() {
    setElapsedDays(0);
  }

  function setScaleMode(mode) {
    if (mode !== 'compressed' && mode !== 'true') return;
    if (simState.scaleMode === mode) return;
    simState.scaleMode = mode;
    renderer.clearTrails();
    renderer.setScaleMode(mode);
    computeStates({ detectCompletions: false });
    ui.syncControls(simState);
    renderNow();
  }

  function setStartMode(mode) {
    if (mode !== 'aligned' && mode !== 'j2000') return;
    if (simState.startMode === mode) return;
    simState.startMode = mode;
    recentCompletions.clear();
    renderer.clearTrails();
    computeStates({ detectCompletions: false });
    ui.syncControls(simState);
    renderNow();
  }

  function setViewPreset(preset) {
    if (preset !== '3d' && preset !== 'top') return;
    simState.viewPreset = preset;
    renderer.setViewPreset(preset);
    ui.syncControls(simState);
    renderNow();
  }

  function resetView() {
    simState.followTargetId = null;
    renderer.resetCamera(simState.scaleMode);
    renderer.setViewPreset(simState.viewPreset);
    ui.syncControls(simState);
    renderNow();
  }

  function toggleOverlay(overlayKey) {
    if (!(overlayKey in simState.overlays)) return;
    simState.overlays[overlayKey] = !simState.overlays[overlayKey];
    if (overlayKey === 'showTrails' && !simState.overlays.showTrails) {
      renderer.clearTrails();
    }
    ui.syncControls(simState);
    renderNow();
  }

  function selectPlanet(targetIdOrNull, { focus = true } = {}) {
    const normalized = normalizeBodyId(targetIdOrNull);
    simState.selectedPlanetId = normalized;

    if (normalized === 'sun') {
      simState.followTargetId = null;
      renderer.focusTarget(null);
    } else if (normalized && focus) {
      simState.followTargetId = normalized;
      renderer.focusTarget(normalized);
    }

    ui.syncControls(simState);
    renderNow();
  }

  function toggleFollowSelected() {
    const selected = simState.selectedPlanetId;
    if (!selected || selected === 'sun') return;

    if (simState.followTargetId === selected) {
      simState.followTargetId = null;
      renderer.focusTarget(null);
    } else {
      simState.followTargetId = selected;
      renderer.focusTarget(selected);
    }
    ui.syncControls(simState);
    renderNow();
  }

  function centerOnSun({ selectSun = false } = {}) {
    simState.followTargetId = null;
    if (selectSun) {
      simState.selectedPlanetId = 'sun';
    }
    renderer.focusTarget(null);
    ui.syncControls(simState);
    renderNow();
  }

  // ---- Instantiate Renderer & UI ----

  const renderer = new SolarSystemRenderer(canvas, {
    onSelectPlanet: (bodyId) => {
      if (bodyId === null || bodyId === undefined) {
        selectPlanet(null, { focus: false });
      } else {
        selectPlanet(bodyId, { focus: true });
      }
    },
  });

  const ui = new ObservatoryUI({
    onTogglePlay: togglePlay,
    onToggleDirection: toggleDirection,
    onStepDays: stepDays,
    onResetTime: resetTime,
    onSetSpeed: setSpeed,
    onSetScaleMode: setScaleMode,
    onSetStartMode: setStartMode,
    onSetViewPreset: setViewPreset,
    onResetView: resetView,
    onToggleOverlay: toggleOverlay,
    onSelectPlanet: selectPlanet,
    onToggleFollow: toggleFollowSelected,
    onCenterSun: () => centerOnSun({ selectSun: false }),
  });

  // Apply initial view & scale configuration
  renderer.resize();
  renderer.setScaleMode(simState.scaleMode);
  renderer.setViewPreset(simState.viewPreset);

  computeStates({ detectCompletions: false, nowMs: lastFrameMs });
  ui.syncControls(simState);
  renderNow(lastFrameMs);

  // ---- Keyboard Shortcuts ----
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const target = e.target;
    const tagName = target && target.tagName ? target.tagName.toUpperCase() : '';
    const isTextInput =
      (tagName === 'INPUT' && target.type !== 'range') ||
      tagName === 'TEXTAREA' ||
      tagName === 'SELECT' ||
      Boolean(target && target.isContentEditable);

    if (isTextInput) return;

    if (e.code === 'Space') {
      // Allow Space on planet list items to activate them via their own keydown listener
      if (target && target.classList && target.classList.contains('planet-row')) return;
      e.preventDefault();
      togglePlay();
      return;
    }

    const key = e.key;
    if (key === 'r' || key === 'R') {
      e.preventDefault();
      resetTime();
    } else if (key === 'v' || key === 'V') {
      e.preventDefault();
      setViewPreset(simState.viewPreset === '3d' ? 'top' : '3d');
    } else if (key === '0') {
      e.preventDefault();
      centerOnSun({ selectSun: true });
    } else if (key >= '1' && key <= '8') {
      e.preventDefault();
      const order = Number(key);
      const planet = PLANETS.find((p) => p.order === order);
      if (planet) {
        selectPlanet(planet.id, { focus: true });
      }
    } else if (key === 'Escape') {
      if (simState.selectedPlanetId !== null) {
        selectPlanet(null, { focus: false });
      }
    }
  });

  // ---- Animation Loop ----
  function tick(nowMs) {
    const dtSec = Math.min(Math.max((nowMs - lastFrameMs) / 1000, 0), 0.1);
    lastFrameMs = nowMs;

    if (simState.playing && dtSec > 0) {
      simState.elapsedDays += simState.direction * simState.daysPerSecond * dtSec;
      computeStates({ detectCompletions: true, nowMs });
    } else if (recentCompletions.size > 0) {
      // Expire active completion pulses smoothly even when paused
      for (const [id, ts] of recentCompletions.entries()) {
        if (nowMs - ts > COMPLETION_RETENTION_MS) {
          recentCompletions.delete(id);
        }
      }
    }

    renderNow(nowMs);
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);

  // ---- Read-only State & Deterministic Verification Hook ----
  window.__SOLAR_SIM__ = Object.freeze({
    getState: () => ({
      elapsedDays: simState.elapsedDays,
      elapsedYears: simState.elapsedDays / EARTH_YEAR_DAYS,
      playing: simState.playing,
      direction: simState.direction,
      daysPerSecond: simState.daysPerSecond,
      scaleMode: simState.scaleMode,
      startMode: simState.startMode,
      viewPreset: simState.viewPreset,
      selectedPlanetId: simState.selectedPlanetId,
      followTargetId: simState.followTargetId,
      overlays: { ...simState.overlays },
      planets: latestPlanetStates.map((s) => ({
        order: s.planet.order,
        id: s.planet.id,
        name: s.planet.name,
        semiMajorAxisAU: s.planet.semiMajorAxisAU,
        periodDays: s.planet.periodDays,
        periodYears: s.planet.periodYears,
        orbitsCompleted: s.orbitsCompleted,
        wholeOrbits: s.wholeOrbits,
        phaseProgress: s.phaseProgress,
        distanceAU: s.distanceAU,
        speedKmS: s.speedKmS,
        keplerRatio: s.keplerRatio,
        positionAU: { ...s.positionAU },
        scenePosition: { ...s.scenePosition },
      })),
    }),
    setElapsedDays,
    setPlaying,
    setScaleMode,
    setStartMode,
    setViewPreset,
    selectPlanet: (id) => selectPlanet(id, { focus: Boolean(id && id !== 'sun') }),
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSolarSystemApp, { once: true });
} else {
  initSolarSystemApp();
}
