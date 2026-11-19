import { PLANETS, SUN_DATA } from '../data/planets.js';
import { getOrbitPathPoints, mapDistanceToScene } from '../physics/kepler.js';

const TWO_PI = Math.PI * 2;
const DEG_TO_RAD = Math.PI / 180;

const DEFAULT_PITCH_3D = 0.92;
const DEFAULT_PITCH_TOP = 0;
const MIN_PITCH = 0;
const MAX_PITCH = 1.48;

const DEFAULT_VIEW_RADIUS_COMPRESSED = 12.9;
const DEFAULT_VIEW_RADIUS_TRUE = 33.0;
const MIN_VIEW_RADIUS = 0.15;
const MAX_VIEW_RADIUS = 48.0;

const PERSPECTIVE_FACTOR = 2.45;
const COMPLETION_PULSE_MS = 1150;
const MAX_TRAIL_POINTS = 56;
const ORBIT_SEGMENTS = 200;

const FONT_SANS = "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif";
const FONT_MONO = "'JetBrains Mono', 'Cascadia Code', ui-monospace, SFMono-Regular, monospace";

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseHexColor(hex) {
  if (typeof hex !== 'string' || !hex.startsWith('#')) {
    return { r: 200, g: 210, b: 225 };
  }
  const clean = hex.slice(1);
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (clean.length >= 6) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }
  return { r: 200, g: 210, b: 225 };
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = parseHexColor(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function adjustHexBrightness(hex, factor) {
  const { r, g, b } = parseHexColor(hex);
  if (factor >= 1) {
    const t = clamp(factor - 1, 0, 1);
    const nr = Math.round(r + (255 - r) * t);
    const ng = Math.round(g + (255 - g) * t);
    const nb = Math.round(b + (255 - b) * t);
    return `rgb(${nr}, ${ng}, ${nb})`;
  }
  const t = clamp(factor, 0, 1);
  return `rgb(${Math.round(r * t)}, ${Math.round(g * t)}, ${Math.round(b * t)})`;
}

function getCompletionTimestamp(recentCompletions, planetId) {
  if (!recentCompletions) return null;
  if (typeof recentCompletions.get === 'function') {
    const val = recentCompletions.get(planetId);
    return typeof val === 'number' ? val : null;
  }
  const val = recentCompletions[planetId];
  return typeof val === 'number' ? val : null;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function boxesOverlap(a, b, padding = 4) {
  return !(
    a.x + a.w + padding < b.x ||
    b.x + b.w + padding < a.x ||
    a.y + a.h + padding < b.y ||
    b.y + b.h + padding < a.y
  );
}

function pickNiceScaleBarAU(pixelsPerUnit) {
  if (pixelsPerUnit <= 0) return { au: 1, px: 60, label: '1 AU' };
  const targetPx = 78;
  const rawAU = targetPx / pixelsPerUnit;
  const exp = Math.floor(Math.log10(rawAU));
  const base = Math.pow(10, exp);
  const candidates = [1, 2, 5, 10];
  let bestAU = base;
  let bestDiff = Infinity;
  for (const mult of candidates) {
    const au = mult * base;
    const px = au * pixelsPerUnit;
    const diff = Math.abs(px - targetPx);
    if (px >= 38 && px <= 135 && diff < bestDiff) {
      bestDiff = diff;
      bestAU = au;
    }
  }
  const px = bestAU * pixelsPerUnit;
  let label;
  if (bestAU >= 1) {
    label = `${Number(bestAU.toFixed(1))} AU`;
  } else if (bestAU >= 0.1) {
    label = `${bestAU.toFixed(1)} AU`;
  } else {
    label = `${bestAU.toFixed(2)} AU`;
  }
  return { au: bestAU, px, label };
}

function generateStarfield() {
  const rand = mulberry32(0x501a2515);
  const starColors = [
    '#CFE4FF',
    '#E6F0FF',
    '#FFFFFF',
    '#FFF6E5',
    '#FFE5BD',
    '#BFD8FF',
  ];
  const stars = [];

  for (let i = 0; i < 380; i++) {
    const tier = i < 240 ? 0 : i < 350 ? 1 : 2;
    const size =
      tier === 0
        ? 0.55 + rand() * 0.55
        : tier === 1
          ? 0.95 + rand() * 0.6
          : 1.45 + rand() * 0.75;
    const baseAlpha =
      tier === 0
        ? 0.18 + rand() * 0.28
        : tier === 1
          ? 0.36 + rand() * 0.34
          : 0.62 + rand() * 0.32;

    stars.push({
      u: rand(),
      v: rand(),
      size,
      baseAlpha,
      parallax: tier === 0 ? 0.018 : tier === 1 ? 0.036 : 0.06,
      color: starColors[Math.floor(rand() * starColors.length)],
      twinkleSpeed: tier === 2 ? 0.8 + rand() * 1.3 : 0.3 + rand() * 0.6,
      twinklePhase: rand() * TWO_PI,
      hasHalo: tier === 2,
    });
  }
  return stars;
}

function generateAsteroids() {
  const rand = mulberry32(0xa57e201d);
  const tints = ['#9E978B', '#B6AEA0', '#838896', '#A79B88', '#7D7A74'];
  const asteroids = [];

  for (let i = 0; i < 340; i++) {
    // Triangular-ish concentration peaking around 2.68 AU between Mars (1.52) and Jupiter (5.20)
    const u1 = rand();
    const u2 = rand();
    const au = 2.18 + ((u1 + u2) * 0.5) * 1.08;
    const angle0 = rand() * TWO_PI;
    const zRatio = (rand() - 0.5) * 0.095;
    const periodDays = 365.256 * Math.pow(au, 1.5);
    const angularSpeedRadPerDay = TWO_PI / periodDays;

    asteroids.push({
      au,
      angle0,
      zRatio,
      angularSpeedRadPerDay,
      size: 0.65 + rand() * 0.95,
      alpha: 0.16 + rand() * 0.30,
      color: tints[Math.floor(rand() * tints.length)],
    });
  }
  return asteroids;
}

function computeSpinAxisWorld(planet) {
  const tiltRad = (planet.axialTiltDeg || 0) * DEG_TO_RAD;
  // Distinct celestial pole azimuths so Saturn & Uranus look natural in 3D
  const azimuthRad = planet.id === 'uranus' ? 1.15 : 0.52;
  return {
    x: Math.sin(tiltRad) * Math.cos(azimuthRad),
    y: Math.sin(tiltRad) * Math.sin(azimuthRad),
    z: Math.cos(tiltRad),
  };
}

export class SolarSystemRenderer {
  constructor(canvas, { onSelectPlanet } = {}) {
    if (!canvas) {
      throw new Error('SolarSystemRenderer requires a valid canvas element.');
    }

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');
    this.onSelectPlanet = typeof onSelectPlanet === 'function' ? onSelectPlanet : null;

    // Viewport state (CSS pixels)
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this._safeBounds = { left: 0, right: 1, top: 0, bottom: 1 };
    this._inspectorBox = null;
    this._axisLabelBox = null;
    this._hudOverlayBox = null;
    this._viewCx = 0.5;
    this._viewCy = 0.5;
    this._targetViewCx = 0.5;
    this._targetViewCy = 0.5;
    this._hudMeasureCounter = 0;

    // Camera state
    this.viewPreset = '3d';
    this.scaleMode = 'compressed';
    this.yaw = 0;
    this.targetYaw = 0;
    this.pitch = DEFAULT_PITCH_3D;
    this.targetPitch = DEFAULT_PITCH_3D;
    this.viewRadius = DEFAULT_VIEW_RADIUS_COMPRESSED;
    this.targetViewRadius = DEFAULT_VIEW_RADIUS_COMPRESSED;
    this.panX = 0;
    this.targetPanX = 0;
    this.panY = 0;
    this.targetPanY = 0;
    this.focusPos = { x: 0, y: 0, z: 0 };
    this.focusedPlanetId = null;

    // Cached procedural & geometric assets
    this._stars = generateStarfield();
    this._asteroids = generateAsteroids();
    this._asteroidRadiiCache = new Map();
    this._orbitCache = new Map();
    this._planetById = new Map(PLANETS.map((p) => [p.id, p]));
    this._spinAxisCache = new Map(PLANETS.map((p) => [p.id, computeSpinAxisWorld(p)]));

    // Orbital trails
    this._trails = new Map();
    this._lastElapsedDays = null;
    this._lastDeltaSign = 0;
    this._lastScaleMode = null;
    this._lastStartMode = null;

    // Interactive state
    this._hitTargets = [];
    this._hoveredId = null;
    this._activePointers = new Map();
    this._dragMode = null; // 'rotate' | 'pan' | 'pinch' | null
    this._dragStartX = 0;
    this._dragStartY = 0;
    this._lastPointerX = 0;
    this._lastPointerY = 0;
    this._dragDistance = 0;
    this._dragButton = 0;
    this._wasMultiTouch = false;
    this._lastPinchDist = 0;
    this._lastFrameMs = 0;

    // Bound event handlers for clean teardown
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
    this._onPointerLeave = this._handlePointerLeave.bind(this);
    this._onWheel = this._handleWheel.bind(this);
    this._onContextMenu = this._handleContextMenu.bind(this);
    this._onResize = this.resize.bind(this);

    this._bindEvents();
    this.resize();
    this.canvas.style.cursor = 'grab';
    this.canvas.style.touchAction = 'none';
  }

  _bindEvents() {
    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
    this.canvas.addEventListener('pointerleave', this._onPointerLeave);
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('resize', this._onResize);
  }

  destroy() {
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
    this.canvas.removeEventListener('pointerleave', this._onPointerLeave);
    this.canvas.removeEventListener('wheel', this._onWheel);
    this.canvas.removeEventListener('contextmenu', this._onContextMenu);
    window.removeEventListener('resize', this._onResize);
    this._activePointers.clear();
    this._trails.clear();
    this._orbitCache.clear();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const cssWidth = Math.max(
      1,
      Math.round(rect.width || this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || window.innerWidth || 800)
    );
    const cssHeight = Math.max(
      1,
      Math.round(rect.height || this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || window.innerHeight || 600)
    );
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);

    const backingW = Math.max(1, Math.round(cssWidth * dpr));
    const backingH = Math.max(1, Math.round(cssHeight * dpr));

    if (
      this.width !== cssWidth ||
      this.height !== cssHeight ||
      this.dpr !== dpr ||
      this.canvas.width !== backingW ||
      this.canvas.height !== backingH
    ) {
      const wasUninitialized = this.width <= 1 && this.height <= 1;
      this.width = cssWidth;
      this.height = cssHeight;
      this.dpr = dpr;
      this.canvas.width = backingW;
      this.canvas.height = backingH;
      this._refreshHudSafeBounds(wasUninitialized);
    }
  }

  _refreshHudSafeBounds(snapCenter = false) {
    let left = 0;
    let right = this.width;
    let top = 0;
    let bottom = this.height;

    if (typeof document !== 'undefined') {
      const topBar = document.querySelector('.top-bar');
      if (topBar) {
        const r = topBar.getBoundingClientRect();
        if (r.height > 0 && r.bottom < this.height * 0.35) {
          top = Math.max(top, r.bottom + 4);
        }
      }

      const bottomDock = document.getElementById('bottom-dock');
      if (bottomDock) {
        const r = bottomDock.getBoundingClientRect();
        if (r.height > 0 && r.top > this.height * 0.55) {
          bottom = Math.min(bottom, r.top - 4);
        }
      }

      const hudRoot = document.getElementById('hud-root');
      const panelCollapsed = hudRoot ? hudRoot.classList.contains('panel-collapsed') : false;
      const panel = document.getElementById('telemetry-panel');
      if (panel && !panelCollapsed && this.width > 860) {
        const r = panel.getBoundingClientRect();
        if (r.width > 0 && r.left > this.width * 0.45 && r.left < this.width) {
          right = Math.min(right, r.left - 4);
        }
      }
    }

    // Fallback gracefully if viewport is very small
    if (right - left < 240) {
      left = 0;
      right = this.width;
    }
    if (bottom - top < 180) {
      top = 0;
      bottom = this.height;
    }

    this._safeBounds = { left, right, top, bottom };
    this._targetViewCx = (left + right) * 0.5;
    this._targetViewCy = (top + bottom) * 0.5;

    if (snapCenter) {
      this._viewCx = this._targetViewCx;
      this._viewCy = this._targetViewCy;
    }
  }

  _measureInspectorBox(selectedPlanetId = null) {
    if (typeof document === 'undefined') {
      this._inspectorBox = null;
      return;
    }
    const inspector = document.getElementById('inspector-card');
    if (!inspector) {
      this._inspectorBox = null;
      return;
    }

    const cRect = this.canvas.getBoundingClientRect();
    if (!inspector.classList.contains('hidden')) {
      const r = inspector.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        this._inspectorBox = {
          x: r.left - cRect.left,
          y: r.top - cRect.top,
          w: r.width,
          h: r.height,
        };
        return;
      }
    }

    // On the synchronous frame right before UI unhides #inspector-card, reserve its standard top-left slot
    if (selectedPlanetId) {
      this._inspectorBox = {
        x: 12,
        y: Math.max(76, this._safeBounds.top),
        w: Math.min(296, this.width - 24),
        h: Math.min(390, Math.max(220, this.height - 220)),
      };
      return;
    }

    this._inspectorBox = null;
  }

  setViewPreset(preset) {
    const normalized = preset === 'top' ? 'top' : '3d';
    this.viewPreset = normalized;
    this.targetPitch = normalized === 'top' ? DEFAULT_PITCH_TOP : DEFAULT_PITCH_3D;
  }

  setScaleMode(scaleMode) {
    const normalized = scaleMode === 'true' ? 'true' : 'compressed';
    const changed = this.scaleMode !== normalized;
    this.scaleMode = normalized;

    if (normalized === 'true') {
      if (this.focusedPlanetId) {
        const planet = this._planetById.get(this.focusedPlanetId);
        if (planet && planet.semiMajorAxisAU < 3.5) {
          this.targetViewRadius = clamp(planet.semiMajorAxisAU * 3.0, 1.1, 8.0);
        } else {
          this.targetViewRadius = DEFAULT_VIEW_RADIUS_TRUE;
        }
      } else {
        this.targetViewRadius = DEFAULT_VIEW_RADIUS_TRUE;
      }
    } else {
      this.targetViewRadius = DEFAULT_VIEW_RADIUS_COMPRESSED;
    }

    this.targetPanX = 0;
    this.targetPanY = 0;
    if (changed) {
      this.clearTrails();
    }
  }

  focusTarget(planetIdOrNull) {
    const nextId = !planetIdOrNull || planetIdOrNull === 'sun' ? null : planetIdOrNull;
    this.focusedPlanetId = nextId;
    this.targetPanX = 0;
    this.targetPanY = 0;

    if (nextId && this.scaleMode === 'true') {
      const planet = this._planetById.get(nextId);
      if (planet && this.targetViewRadius > planet.semiMajorAxisAU * 10) {
        this.targetViewRadius = clamp(planet.semiMajorAxisAU * 2.8, 0.95, 14.0);
      }
    }
  }

  resetCamera(scaleMode) {
    if (scaleMode === 'true' || scaleMode === 'compressed') {
      this.scaleMode = scaleMode;
    }
    this.targetYaw = 0;
    this.targetPitch = this.viewPreset === 'top' ? DEFAULT_PITCH_TOP : DEFAULT_PITCH_3D;
    this.targetPanX = 0;
    this.targetPanY = 0;
    this.focusedPlanetId = null;
    this.targetViewRadius =
      this.scaleMode === 'true' ? DEFAULT_VIEW_RADIUS_TRUE : DEFAULT_VIEW_RADIUS_COMPRESSED;
  }

  clearTrails() {
    this._trails.clear();
  }

  // ---------------------------------------------------------------------------
  // Pointer & Wheel Interaction
  // ---------------------------------------------------------------------------

  _getCanvasPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  _getPixelsPerUnit(viewRadius = this.viewRadius) {
    const freeW = Math.max(200, this._safeBounds.right - this._safeBounds.left);
    const freeH = Math.max(160, this._safeBounds.bottom - this._safeBounds.top);
    // In 3D oblique view, orbits are foreshortened vertically by ~cos(pitch),
    // so horizontal fit dominates while Top-Down (pitch = 0) respects full vertical height.
    const effectiveSpan = Math.min(freeW, freeH * (1 + 0.34 * Math.sin(this.pitch)));
    return (effectiveSpan * 0.48) / Math.max(0.05, viewRadius);
  }

  _handleContextMenu(event) {
    event.preventDefault();
  }

  _handlePointerDown(event) {
    const pt = this._getCanvasPoint(event);
    this._activePointers.set(event.pointerId, pt);

    if (this._activePointers.size === 2) {
      const pts = Array.from(this._activePointers.values());
      this._lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      this._dragMode = 'pinch';
      this._wasMultiTouch = true;
      return;
    }

    if (this._activePointers.size === 1) {
      this._dragStartX = pt.x;
      this._dragStartY = pt.y;
      this._lastPointerX = pt.x;
      this._lastPointerY = pt.y;
      this._dragDistance = 0;
      this._dragButton = event.button;
      this._wasMultiTouch = false;

      const isPanAction =
        event.button === 2 ||
        event.button === 1 ||
        event.shiftKey ||
        this.viewPreset === 'top';
      this._dragMode = isPanAction ? 'pan' : 'rotate';
      this.canvas.style.cursor = 'grabbing';
    }
  }

  _handlePointerMove(event) {
    const pt = this._getCanvasPoint(event);

    if (this._activePointers.has(event.pointerId)) {
      this._activePointers.set(event.pointerId, pt);

      if (this._dragMode === 'pinch' && this._activePointers.size === 2) {
        const pts = Array.from(this._activePointers.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        if (this._lastPinchDist > 4 && dist > 4) {
          const factor = this._lastPinchDist / dist;
          this.targetViewRadius = clamp(
            this.targetViewRadius * factor,
            MIN_VIEW_RADIUS,
            MAX_VIEW_RADIUS
          );
        }
        this._lastPinchDist = dist;
        return;
      }

      if (this._activePointers.size === 1 && this._dragMode) {
        const dx = pt.x - this._lastPointerX;
        const dy = pt.y - this._lastPointerY;
        this._lastPointerX = pt.x;
        this._lastPointerY = pt.y;
        this._dragDistance += Math.hypot(dx, dy);

        if (this._dragMode === 'rotate') {
          this.targetYaw -= dx * 0.0065;
          this.targetPitch = clamp(this.targetPitch + dy * 0.0065, MIN_PITCH, MAX_PITCH);
        } else if (this._dragMode === 'pan') {
          const ppu = this._getPixelsPerUnit(this.targetViewRadius);
          this.targetPanX = clamp(this.targetPanX + dx / ppu, -65, 65);
          this.targetPanY = clamp(this.targetPanY - dy / ppu, -65, 65);
        }
        return;
      }
    }

    // Hover feedback when not dragging
    if (
      pt.x >= 0 &&
      pt.y >= 0 &&
      pt.x <= this.width &&
      pt.y <= this.height
    ) {
      const hit = this._hitTest(pt.x, pt.y);
      this._hoveredId = hit ? hit.id : null;
      this.canvas.style.cursor = hit ? 'pointer' : 'grab';
    }
  }

  _handlePointerUp(event) {
    const wasTracked = this._activePointers.has(event.pointerId);
    if (!wasTracked) return;

    const pt = this._getCanvasPoint(event);
    this._activePointers.delete(event.pointerId);

    if (this._activePointers.size === 0) {
      const wasClick = !this._wasMultiTouch && this._dragDistance < 6 && this._dragButton === 0;
      this._dragMode = null;

      if (wasClick && this.onSelectPlanet) {
        const hit = this._hitTest(pt.x, pt.y);
        this.onSelectPlanet(hit ? hit.id : null);
      }

      const hoverHit = this._hitTest(pt.x, pt.y);
      this._hoveredId = hoverHit ? hoverHit.id : null;
      this.canvas.style.cursor = hoverHit ? 'pointer' : 'grab';
    } else if (this._activePointers.size === 1) {
      const remaining = Array.from(this._activePointers.values())[0];
      this._lastPointerX = remaining.x;
      this._lastPointerY = remaining.y;
      this._dragMode = null;
    }
  }

  _handlePointerLeave() {
    if (!this._dragMode) {
      this._hoveredId = null;
      this.canvas.style.cursor = 'grab';
    }
  }

  _handleWheel(event) {
    event.preventDefault();
    const pt = this._getCanvasPoint(event);
    const delta = clamp(event.deltaY, -180, 180);
    const factor = Math.exp(delta * 0.00145);

    const oldRadius = this.targetViewRadius;
    const newRadius = clamp(oldRadius * factor, MIN_VIEW_RADIUS, MAX_VIEW_RADIUS);
    if (Math.abs(newRadius - oldRadius) < 1e-6) return;

    // Anchor zoom smoothly toward pointer when viewing Sun (free exploration),
    // or center smoothly when tracking a moving planet.
    if (!this.focusedPlanetId) {
      const cx = this._viewCx;
      const cy = this._viewCy;
      const oldPpu = this._getPixelsPerUnit(oldRadius);
      const newPpu = this._getPixelsPerUnit(newRadius);
      const invDelta = 1 / newPpu - 1 / oldPpu;
      this.targetPanX = clamp(this.targetPanX + (pt.x - cx) * invDelta, -65, 65);
      this.targetPanY = clamp(this.targetPanY - (pt.y - cy) * invDelta, -65, 65);
    }

    this.targetViewRadius = newRadius;
  }

  _hitTest(mx, my) {
    let best = null;
    let bestScore = Infinity;

    for (const target of this._hitTargets) {
      const dx = mx - target.sx;
      const dy = my - target.sy;
      const dist = Math.hypot(dx, dy);
      const hitRadius = Math.max(target.radius + 10, target.id === 'sun' ? 20 : 18);

      if (dist <= hitRadius) {
        // Prefer planets slightly over the Sun when clicking close inner planets near Sun edge
        const sunPenalty = target.id === 'sun' ? 4 : 0;
        const score = dist + sunPenalty - target.depth * 0.001;
        if (score < bestScore) {
          bestScore = score;
          best = target;
        }
      }
    }

    return best;
  }

  // ---------------------------------------------------------------------------
  // 3D Projection & Frustum Clipping
  // ---------------------------------------------------------------------------

  _buildCameraFrame() {
    const cosYaw = Math.cos(this.yaw);
    const sinYaw = Math.sin(this.yaw);
    const cosPitch = Math.cos(this.pitch);
    const sinPitch = Math.sin(this.pitch);

    const cx = this._viewCx;
    const cy = this._viewCy;
    const ppu = this._getPixelsPerUnit(this.viewRadius);
    const viewSpan = this.viewRadius * 2;
    const camDist = viewSpan * PERSPECTIVE_FACTOR;
    const nearDist = camDist * 0.08;

    return {
      cosYaw,
      sinYaw,
      cosPitch,
      sinPitch,
      cx,
      cy,
      ppu,
      camDist,
      nearDist,
      fx: this.focusPos.x,
      fy: this.focusPos.y,
      fz: this.focusPos.z,
      panX: this.panX,
      panY: this.panY,
    };
  }

  _toCameraSpace(wx, wy, wz, cam) {
    const dx = wx - cam.fx;
    const dy = wy - cam.fy;
    const dz = wz - cam.fz;

    const rx = dx * cam.cosYaw - dy * cam.sinYaw;
    const ry = dx * cam.sinYaw + dy * cam.cosYaw;
    const rz = dz;

    const camRight = rx;
    const camUp = ry * cam.cosPitch + rz * cam.sinPitch;
    const camDepth = -ry * cam.sinPitch + rz * cam.cosPitch; // positive = closer to viewer

    return { x: camRight, y: camUp, z: camDepth };
  }

  _projectCameraPoint(c, cam) {
    const distFromCam = cam.camDist - c.z;
    if (distFromCam <= cam.nearDist) {
      return {
        sx: 0,
        sy: 0,
        depth: c.z,
        perspScale: 0,
        visible: false,
      };
    }

    const perspScale = cam.camDist / distFromCam;
    const scale = cam.ppu * perspScale;
    const sx = cam.cx + (c.x + cam.panX) * scale;
    const sy = cam.cy - (c.y + cam.panY) * scale;

    return {
      sx,
      sy,
      depth: c.z,
      perspScale,
      visible: true,
    };
  }

  _projectWorldPoint(wx, wy, wz, cam) {
    const c = this._toCameraSpace(wx, wy, wz, cam);
    return this._projectCameraPoint(c, cam);
  }

  _projectClippedSegment(c1, c2, cam) {
    const d1 = cam.camDist - c1.z;
    const d2 = cam.camDist - c2.z;
    if (d1 <= cam.nearDist && d2 <= cam.nearDist) return null;

    let a = c1;
    let b = c2;

    if (d1 <= cam.nearDist) {
      const t = (cam.nearDist - d1) / (d2 - d1);
      a = {
        x: lerp(c1.x, c2.x, t),
        y: lerp(c1.y, c2.y, t),
        z: cam.camDist - cam.nearDist - 1e-4,
      };
    } else if (d2 <= cam.nearDist) {
      const t = (cam.nearDist - d1) / (d2 - d1);
      b = {
        x: lerp(c1.x, c2.x, t),
        y: lerp(c1.y, c2.y, t),
        z: cam.camDist - cam.nearDist - 1e-4,
      };
    }

    const p1 = this._projectCameraPoint(a, cam);
    const p2 = this._projectCameraPoint(b, cam);
    if (!p1.visible || !p2.visible) return null;
    return { x1: p1.sx, y1: p1.sy, x2: p2.sx, y2: p2.sy };
  }

  // ---------------------------------------------------------------------------
  // Caches & Trail Management
  // ---------------------------------------------------------------------------

  _getOrbitCacheForMode(startMode, scaleMode) {
    const key = `${startMode}:${scaleMode}`;
    let modeMap = this._orbitCache.get(key);
    if (!modeMap) {
      modeMap = new Map();
      for (const planet of PLANETS) {
        const pts = getOrbitPathPoints(planet, {
          startMode,
          scaleMode,
          segments: ORBIT_SEGMENTS,
        });
        modeMap.set(planet.id, pts);
      }
      this._orbitCache.set(key, modeMap);
    }
    return modeMap;
  }

  _getAsteroidSceneRadii(scaleMode) {
    let radii = this._asteroidRadiiCache.get(scaleMode);
    if (!radii) {
      radii = new Float32Array(this._asteroids.length);
      for (let i = 0; i < this._asteroids.length; i++) {
        radii[i] = mapDistanceToScene(this._asteroids[i].au, scaleMode);
      }
      this._asteroidRadiiCache.set(scaleMode, radii);
    }
    return radii;
  }

  _updateTrails(elapsedDays, planetStates, scaleMode, startMode, showTrails) {
    if (this._lastScaleMode !== scaleMode || this._lastStartMode !== startMode) {
      this._trails.clear();
      this._lastScaleMode = scaleMode;
      this._lastStartMode = startMode;
      this._lastElapsedDays = elapsedDays;
      this._lastDeltaSign = 0;
    }

    if (this._lastElapsedDays === null) {
      this._lastElapsedDays = elapsedDays;
    }

    const deltaDays = elapsedDays - this._lastElapsedDays;

    // Clear trails on reset to t = 0, backward jump when playing forward, or direction flip
    if (
      (elapsedDays === 0 && this._lastElapsedDays !== 0) ||
      (deltaDays < 0 && this._lastDeltaSign >= 0) ||
      (deltaDays > 0 && this._lastDeltaSign < 0)
    ) {
      this._trails.clear();
    }

    if (Math.abs(deltaDays) > 1e-9) {
      this._lastDeltaSign = deltaDays > 0 ? 1 : -1;
    }
    this._lastElapsedDays = elapsedDays;

    if (!showTrails) return;

    for (const state of planetStates) {
      const id = state.planet.id;
      const pos = state.scenePosition;
      if (!pos) continue;

      let trail = this._trails.get(id);
      if (!trail) {
        trail = [];
        this._trails.set(id, trail);
      }

      // If single frame step covers too much of this planet's orbit, avoid ugly straight chords
      const phaseStep = Math.abs(deltaDays) / Math.max(1, state.planet.periodDays);
      if (phaseStep > 0.14) {
        trail.length = 0;
        trail.push({ x: pos.x, y: pos.y, z: pos.z });
        continue;
      }

      const last = trail.length > 0 ? trail[trail.length - 1] : null;
      if (!last) {
        trail.push({ x: pos.x, y: pos.y, z: pos.z });
      } else {
        const distSq =
          (pos.x - last.x) ** 2 + (pos.y - last.y) ** 2 + (pos.z - last.z) ** 2;
        const r = Math.hypot(pos.x, pos.y, pos.z);
        const minStep = Math.max(0.008, r * 0.018);

        if (distSq > (r * 0.55) ** 2 && r > 0.05) {
          // Discontinuous teleport/jump
          trail.length = 0;
          trail.push({ x: pos.x, y: pos.y, z: pos.z });
        } else if (distSq >= minStep * minStep) {
          trail.push({ x: pos.x, y: pos.y, z: pos.z });
          if (trail.length > MAX_TRAIL_POINTS) {
            trail.shift();
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Camera Smoothing
  // ---------------------------------------------------------------------------

  _updateCamera(dtSec, planetStates) {
    const smooth = 1 - Math.exp(-9.5 * dtSec);
    const focusSmooth = 1 - Math.exp(-11.0 * dtSec);

    this.yaw = lerp(this.yaw, this.targetYaw, smooth);
    this.pitch = lerp(this.pitch, this.targetPitch, smooth);
    this.viewRadius = lerp(this.viewRadius, this.targetViewRadius, smooth);
    this.panX = lerp(this.panX, this.targetPanX, smooth);
    this.panY = lerp(this.panY, this.targetPanY, smooth);
    this._viewCx = lerp(this._viewCx, this._targetViewCx, smooth);
    this._viewCy = lerp(this._viewCy, this._targetViewCy, smooth);

    let targetX = 0;
    let targetY = 0;
    let targetZ = 0;

    if (this.focusedPlanetId && Array.isArray(planetStates)) {
      const targetState = planetStates.find((s) => s.planet.id === this.focusedPlanetId);
      if (targetState && targetState.scenePosition) {
        targetX = targetState.scenePosition.x;
        targetY = targetState.scenePosition.y;
        targetZ = targetState.scenePosition.z;
      }
    }

    this.focusPos.x = lerp(this.focusPos.x, targetX, focusSmooth);
    this.focusPos.y = lerp(this.focusPos.y, targetY, focusSmooth);
    this.focusPos.z = lerp(this.focusPos.z, targetZ, focusSmooth);
  }

  // ---------------------------------------------------------------------------
  // Main Render Entry Point
  // ---------------------------------------------------------------------------

  render(simState, planetStates = [], options = {}) {
    // Keep HiDPI backing store synced if layout resized
    this.resize();
    // Periodically refresh HUD safe bounds so panel collapse/expand smoothly recenters the scene
    this._hudMeasureCounter = (this._hudMeasureCounter + 1) % 15;
    if (this._hudMeasureCounter === 0) {
      this._refreshHudSafeBounds(false);
    }

    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dtSec =
      this._lastFrameMs > 0
        ? clamp((nowMs - this._lastFrameMs) * 0.001, 0.004, 0.05)
        : 0.016;
    this._lastFrameMs = nowMs;

    const scaleMode = options.scaleMode === 'true' ? 'true' : 'compressed';
    const startMode = options.startMode === 'j2000' ? 'j2000' : 'aligned';
    const showOrbits = options.showOrbits !== false;
    const showLabels = options.showLabels !== false;
    const showTrails = options.showTrails !== false;
    const showStartLine = options.showStartLine !== false;
    const showAsteroidBelt = options.showAsteroidBelt !== false;
    const selectedPlanetId = options.selectedPlanetId ?? null;
    const recentCompletions = options.recentCompletions ?? null;

    // Keep internal scaleMode synced if options changes directly
    if (this.scaleMode !== scaleMode) {
      this.setScaleMode(scaleMode);
    }

    const elapsedDays =
      typeof simState?.elapsedDays === 'number'
        ? simState.elapsedDays
        : typeof planetStates[0]?.elapsedDays === 'number'
          ? planetStates[0].elapsedDays
          : 0;

    this._updateCamera(dtSec, planetStates);
    this._updateTrails(elapsedDays, planetStates, scaleMode, startMode, showTrails);

    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const cam = this._buildCameraFrame();
    const nowSec = nowMs * 0.001;

    // Refresh obstacle rects for collision-free label placement
    this._axisLabelBox = null;
    this._hudOverlayBox = null;
    this._measureInspectorBox(selectedPlanetId);

    // 1. Deep space backdrop + subtle nebula + deterministic parallax starfield
    this._drawSpaceBackground(ctx, nowSec);

    // 2. Subtle ecliptic reference rings / start axis (+X ray)
    if (showStartLine) {
      this._drawStartLine(ctx, cam, scaleMode, startMode);
    }

    // 3. Asteroid belt (2.2 AU – 3.2 AU mapped cleanly via mapDistanceToScene)
    if (showAsteroidBelt) {
      this._drawAsteroidBelt(ctx, cam, scaleMode, elapsedDays);
    }

    // 4. Cached orbital ellipses (selected highlighted)
    if (showOrbits) {
      this._drawOrbits(ctx, cam, startMode, scaleMode, selectedPlanetId);
    }

    // 5. Fading orbital motion trails
    if (showTrails) {
      this._drawTrails(ctx, cam, planetStates, selectedPlanetId);
    }

    // 6. Depth-sorted Sun + 8 planets (with rings, directional shading, completion pulses)
    const labelItems = this._drawCelestialBodies(
      ctx,
      cam,
      planetStates,
      scaleMode,
      selectedPlanetId,
      recentCompletions,
      nowMs,
      nowSec
    );

    // 7. Subtle bottom-left view angle / scale cue overlay (recorded before labels so labels avoid it)
    this._drawHudOverlay(ctx, cam, scaleMode);

    // 8. Crisp non-overlapping planet labels (avoiding axis pill, HUD chip, and open inspector card)
    if (showLabels) {
      this._drawLabels(ctx, labelItems, cam, selectedPlanetId);
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Layer 1: Deep Space Background & Starfield
  // ---------------------------------------------------------------------------

  _drawSpaceBackground(ctx, nowSec) {
    const w = this.width;
    const h = this.height;

    // Base deep-space radial gradient
    const baseGrad = ctx.createRadialGradient(
      w * 0.5,
      h * 0.48,
      Math.min(w, h) * 0.04,
      w * 0.5,
      h * 0.5,
      Math.hypot(w, h) * 0.68
    );
    baseGrad.addColorStop(0, '#091124');
    baseGrad.addColorStop(0.55, '#050916');
    baseGrad.addColorStop(1, '#02040B');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, w, h);

    // Subtle cosmic nebula washes (deep cobalt & violet dust)
    const neb1 = ctx.createRadialGradient(
      w * 0.22,
      h * 0.26,
      0,
      w * 0.22,
      h * 0.26,
      Math.max(w, h) * 0.52
    );
    neb1.addColorStop(0, 'rgba(34, 68, 148, 0.11)');
    neb1.addColorStop(0.55, 'rgba(20, 42, 94, 0.045)');
    neb1.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = neb1;
    ctx.fillRect(0, 0, w, h);

    const neb2 = ctx.createRadialGradient(
      w * 0.78,
      h * 0.72,
      0,
      w * 0.78,
      h * 0.72,
      Math.max(w, h) * 0.48
    );
    neb2.addColorStop(0, 'rgba(96, 48, 134, 0.085)');
    neb2.addColorStop(0.5, 'rgba(42, 28, 82, 0.035)');
    neb2.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = neb2;
    ctx.fillRect(0, 0, w, h);

    // Deterministic parallax starfield
    const yawNorm = this.yaw / TWO_PI;
    const pitchNorm = this.pitch / Math.PI;

    for (let i = 0; i < this._stars.length; i++) {
      const s = this._stars[i];
      const u = ((s.u - yawNorm * s.parallax) % 1 + 1) % 1;
      const v = ((s.v + pitchNorm * s.parallax * 0.65) % 1 + 1) % 1;
      const sx = u * w;
      const sy = v * h;

      const twinkle = 0.85 + 0.15 * Math.sin(nowSec * s.twinkleSpeed + s.twinklePhase);
      const alpha = s.baseAlpha * twinkle;

      if (s.hasHalo) {
        ctx.fillStyle = hexToRgba(s.color, alpha * 0.22);
        ctx.beginPath();
        ctx.arc(sx, sy, s.size * 2.3, 0, TWO_PI);
        ctx.fill();
      }

      ctx.fillStyle = hexToRgba(s.color, alpha);
      if (s.size <= 1.05) {
        ctx.fillRect(sx - s.size * 0.5, sy - s.size * 0.5, s.size, s.size);
      } else {
        ctx.beginPath();
        ctx.arc(sx, sy, s.size * 0.55, 0, TWO_PI);
        ctx.fill();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Layer 2: 0° Reference Start Line (+X Axis)
  // ---------------------------------------------------------------------------

  _drawStartLine(ctx, cam, scaleMode, startMode) {
    const outerAU = 36.0;
    const maxR = mapDistanceToScene(outerAU, scaleMode);
    const steps = 32;

    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = 'rgba(130, 212, 255, 0.42)';
    ctx.beginPath();

    let prevCam = null;
    let labelAnchor = null;
    let labelAngle = 0;

    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * maxR;
      const c = this._toCameraSpace(x, 0, 0, cam);
      if (prevCam) {
        const seg = this._projectClippedSegment(prevCam, c, cam);
        if (seg) {
          ctx.moveTo(seg.x1, seg.y1);
          ctx.lineTo(seg.x2, seg.y2);

          // Track the outermost on-screen point inside safe HUD bounds for placing the axis label cleanly
          if (
            seg.x2 > this._safeBounds.left + 48 &&
            seg.x2 < this._safeBounds.right - 20 &&
            seg.y2 > this._safeBounds.top + 16 &&
            seg.y2 < this._safeBounds.bottom - 16
          ) {
            labelAnchor = { x: seg.x2, y: seg.y2 };
            labelAngle = Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1);
          }
        }
      }
      prevCam = c;
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Perihelion crossing ticks along +X in aligned mode
    if (startMode === 'aligned') {
      for (const planet of PLANETS) {
        const perihelionAU = planet.semiMajorAxisAU * (1 - planet.eccentricity);
        const rScene = mapDistanceToScene(perihelionAU, scaleMode);
        const p = this._projectWorldPoint(rScene, 0, 0, cam);
        if (!p.visible) continue;
        if (p.sx < -20 || p.sx > this.width + 20 || p.sy < -20 || p.sy > this.height + 20) {
          continue;
        }
        ctx.fillStyle = hexToRgba(planet.color, 0.55);
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 2.2, 0, TWO_PI);
        ctx.fill();
      }
    }

    // Axis label pill ("0° Start / Reference Axis") placed well clear of the aligned planet row
    if (labelAnchor) {
      const text = '0° Start / Reference Axis';
      ctx.font = `600 10.5px ${FONT_SANS}`;
      const textW = ctx.measureText(text).width;
      const padX = 8;
      const boxW = textW + padX * 2;
      const boxH = 20;

      const minX = this._safeBounds.left + 12;
      const maxX = Math.max(minX, this._safeBounds.right - boxW - 12);
      const minY = this._safeBounds.top + 10;
      const maxY = Math.max(minY, this._safeBounds.bottom - boxH - 10);

      // Offset generously perpendicular to the +X ray so it stays clear of Neptune/Uranus/Saturn & their labels
      const perpX = -Math.sin(labelAngle);
      const perpY = Math.cos(labelAngle);
      const primarySign = perpY >= 0 ? 1 : -1;
      const perpDist = 52;

      const axisCandidates = [
        // Below (or primary perpendicular side) aligned toward the outer tip of the ray
        {
          x: clamp(labelAnchor.x - boxW + 24 + perpX * primarySign * perpDist, minX, maxX),
          y: clamp(labelAnchor.y + perpY * primarySign * perpDist - boxH * 0.5, minY, maxY),
        },
        // Opposite perpendicular side
        {
          x: clamp(labelAnchor.x - boxW + 24 - perpX * primarySign * perpDist, minX, maxX),
          y: clamp(labelAnchor.y - perpY * primarySign * perpDist - boxH * 0.5, minY, maxY),
        },
        // Past the tip of the ray
        {
          x: clamp(labelAnchor.x + Math.cos(labelAngle) * 14, minX, maxX),
          y: clamp(labelAnchor.y + Math.sin(labelAngle) * 14 - boxH * 0.5, minY, maxY),
        },
      ];

      let chosenAxis = axisCandidates[0];
      if (this._inspectorBox) {
        for (const cand of axisCandidates) {
          const box = { x: cand.x, y: cand.y, w: boxW, h: boxH };
          if (!boxesOverlap(box, this._inspectorBox, 8)) {
            chosenAxis = cand;
            break;
          }
        }
      }

      const lx = chosenAxis.x;
      const ly = chosenAxis.y;

      // Subtle dashed pointer connecting ray tip to the offset axis pill
      const tipAttachX = clamp(labelAnchor.x, lx + 8, lx + boxW - 8);
      const tipAttachY = ly > labelAnchor.y ? ly : ly + boxH;
      ctx.save();
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = 'rgba(130, 212, 255, 0.34)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(labelAnchor.x, labelAnchor.y);
      ctx.lineTo(tipAttachX, tipAttachY);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = 'rgba(8, 17, 36, 0.78)';
      ctx.strokeStyle = 'rgba(130, 212, 255, 0.4)';
      ctx.lineWidth = 1;
      drawRoundedRect(ctx, lx, ly, boxW, boxH, 5);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(165, 224, 255, 0.9)';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(text, lx + padX, ly + boxH * 0.5 + 0.5);

      // Record bounding box so planet labels never overlap the reference axis pill
      this._axisLabelBox = { x: lx, y: ly, w: boxW, h: boxH };
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Layer 3: Asteroid Belt (2.2 – 3.2 AU)
  // ---------------------------------------------------------------------------

  _drawAsteroidBelt(ctx, cam, scaleMode, elapsedDays) {
    const radii = this._getAsteroidSceneRadii(scaleMode);

    // Subtle translucent dusty torus guide ring between 2.25 AU and 3.15 AU
    const innerBeltR = mapDistanceToScene(2.25, scaleMode);
    const outerBeltR = mapDistanceToScene(3.15, scaleMode);
    const midBeltR = (innerBeltR + outerBeltR) * 0.5;
    const beltWidthPx = (outerBeltR - innerBeltR) * cam.ppu;

    if (beltWidthPx > 2.5 && beltWidthPx < this.width * 0.9) {
      ctx.save();
      ctx.strokeStyle = 'rgba(155, 160, 178, 0.065)';
      ctx.lineWidth = clamp(beltWidthPx * 0.75, 2, 34);
      ctx.beginPath();
      const ringSegs = 84;
      let prevC = null;
      for (let i = 0; i <= ringSegs; i++) {
        const a = (i / ringSegs) * TWO_PI;
        const c = this._toCameraSpace(Math.cos(a) * midBeltR, Math.sin(a) * midBeltR, 0, cam);
        if (prevC) {
          const seg = this._projectClippedSegment(prevC, c, cam);
          if (seg) {
            ctx.moveTo(seg.x1, seg.y1);
            ctx.lineTo(seg.x2, seg.y2);
          }
        }
        prevC = c;
      }
      ctx.stroke();
      ctx.restore();
    }

    // Individual deterministic rocky specks drifting slowly at Keplerian rates
    for (let i = 0; i < this._asteroids.length; i++) {
      const rock = this._asteroids[i];
      const rScene = radii[i];
      const angle = rock.angle0 + elapsedDays * rock.angularSpeedRadPerDay;
      const wx = Math.cos(angle) * rScene;
      const wy = Math.sin(angle) * rScene;
      const wz = rock.zRatio * rScene;

      const p = this._projectWorldPoint(wx, wy, wz, cam);
      if (!p.visible) continue;
      if (p.sx < -4 || p.sx > this.width + 4 || p.sy < -4 || p.sy > this.height + 4) {
        continue;
      }

      const sz = clamp(rock.size * Math.pow(p.perspScale, 0.5), 0.7, 2.2);
      ctx.fillStyle = hexToRgba(rock.color, rock.alpha);
      ctx.fillRect(p.sx - sz * 0.5, p.sy - sz * 0.5, sz, sz);
    }
  }

  // ---------------------------------------------------------------------------
  // Layer 4: Cached Orbital Ellipses
  // ---------------------------------------------------------------------------

  _drawOrbits(ctx, cam, startMode, scaleMode, selectedPlanetId) {
    const modeCache = this._getOrbitCacheForMode(startMode, scaleMode);
    const hasSelection = selectedPlanetId && selectedPlanetId !== 'sun';

    for (const planet of PLANETS) {
      const points = modeCache.get(planet.id);
      if (!points || points.length < 2) continue;

      const isSelected = planet.id === selectedPlanetId;
      const isHovered = planet.id === this._hoveredId;

      ctx.save();
      ctx.beginPath();

      let prevCam = null;
      for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        const c = this._toCameraSpace(pt.x, pt.y, pt.z, cam);
        if (prevCam) {
          const seg = this._projectClippedSegment(prevCam, c, cam);
          if (seg) {
            ctx.moveTo(seg.x1, seg.y1);
            ctx.lineTo(seg.x2, seg.y2);
          }
        }
        prevCam = c;
      }

      if (isSelected) {
        // Soft outer luminous glow
        ctx.strokeStyle = hexToRgba(planet.color, 0.28);
        ctx.lineWidth = 5.0;
        ctx.stroke();

        // Crisp highlighted ellipse
        ctx.strokeStyle = hexToRgba(planet.color, 0.92);
        ctx.lineWidth = 1.9;
        ctx.stroke();
      } else if (isHovered) {
        ctx.strokeStyle = hexToRgba(planet.color, 0.68);
        ctx.lineWidth = 1.65;
        ctx.stroke();
      } else {
        ctx.strokeStyle = hasSelection
          ? hexToRgba(planet.color, 0.22)
          : planet.orbitColor || hexToRgba(planet.color, 0.36);
        ctx.lineWidth = 1.15;
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  // ---------------------------------------------------------------------------
  // Layer 5: Fading Orbital Motion Trails
  // ---------------------------------------------------------------------------

  _drawTrails(ctx, cam, planetStates, selectedPlanetId) {
    ctx.save();
    ctx.lineCap = 'round';

    for (const state of planetStates) {
      const planet = state.planet;
      const trail = this._trails.get(planet.id);
      if (!trail || trail.length < 2) continue;

      const isSelected = planet.id === selectedPlanetId;
      const baseAlpha = isSelected ? 0.85 : 0.6;
      const maxWidth = isSelected ? 3.2 : 2.1;

      const n = trail.length;
      let prevCam = this._toCameraSpace(trail[0].x, trail[0].y, trail[0].z, cam);

      for (let i = 1; i < n; i++) {
        const pt = trail[i];
        const curCam = this._toCameraSpace(pt.x, pt.y, pt.z, cam);
        const seg = this._projectClippedSegment(prevCam, curCam, cam);
        prevCam = curCam;

        if (!seg) continue;

        const t = i / (n - 1); // 0 at tail, 1 at planet head
        const alpha = baseAlpha * t * t;
        if (alpha < 0.02) continue;

        ctx.strokeStyle = hexToRgba(planet.color, alpha);
        ctx.lineWidth = 0.6 + maxWidth * t;
        ctx.beginPath();
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Layer 6: Depth-Sorted Sun & Planets
  // ---------------------------------------------------------------------------

  _computeSunRadiusPx(cam, scaleMode, perspScale) {
    if (scaleMode === 'true') {
      return clamp(0.18 * cam.ppu * perspScale, 4.6, 40);
    }
    return clamp(0.56 * cam.ppu * perspScale, 7.5, 32);
  }

  _computePlanetRadiusPx(planet, cam, scaleMode, perspScale) {
    const base = planet.visualRadiusPx || 8;
    const refPpu = scaleMode === 'true' ? 95 : 34;
    const zoomScale = Math.pow(Math.max(0.05, (cam.ppu * perspScale) / refPpu), 0.36);
    const minPx = scaleMode === 'true' ? 2.8 : 3.6;
    const maxPx = base * 2.5;
    return clamp(base * zoomScale, minPx, maxPx);
  }

  _drawCelestialBodies(
    ctx,
    cam,
    planetStates,
    scaleMode,
    selectedPlanetId,
    recentCompletions,
    nowMs,
    nowSec
  ) {
    const sunCam = this._toCameraSpace(0, 0, 0, cam);
    const sunProj = this._projectCameraPoint(sunCam, cam);

    const bodies = [];
    const hitTargets = [];
    const labelItems = [];

    if (sunProj.visible) {
      const sunRadius = this._computeSunRadiusPx(cam, scaleMode, sunProj.perspScale);
      bodies.push({
        kind: 'sun',
        id: SUN_DATA.id,
        sx: sunProj.sx,
        sy: sunProj.sy,
        depth: sunProj.depth,
        radius: sunRadius,
      });
      hitTargets.push({
        id: SUN_DATA.id,
        sx: sunProj.sx,
        sy: sunProj.sy,
        radius: sunRadius,
        depth: sunProj.depth,
      });
      if (selectedPlanetId === 'sun' || this._hoveredId === 'sun') {
        labelItems.push({
          id: 'sun',
          order: 0,
          name: SUN_DATA.name || 'Sun',
          color: SUN_DATA.color || '#FDB813',
          sx: sunProj.sx,
          sy: sunProj.sy,
          radius: sunRadius,
          orbitsCompleted: null,
          isSelected: selectedPlanetId === 'sun',
          isHovered: this._hoveredId === 'sun',
        });
      }
    }

    for (const state of planetStates) {
      const planet = state.planet;
      const pos = state.scenePosition;
      if (!planet || !pos) continue;

      const pCam = this._toCameraSpace(pos.x, pos.y, pos.z, cam);
      const proj = this._projectCameraPoint(pCam, cam);
      if (!proj.visible) continue;

      const radius = this._computePlanetRadiusPx(planet, cam, scaleMode, proj.perspScale);

      // Compute 3D unit lighting direction from planet toward the Sun in camera space
      const lx = sunCam.x - pCam.x;
      const ly = sunCam.y - pCam.y;
      const lz = sunCam.z - pCam.z;
      const len = Math.hypot(lx, ly, lz) || 1;

      bodies.push({
        kind: 'planet',
        id: planet.id,
        state,
        planet,
        sx: proj.sx,
        sy: proj.sy,
        depth: proj.depth,
        radius,
        lightDir: { x: lx / len, y: ly / len, z: lz / len },
        worldPos: pos,
      });

      hitTargets.push({
        id: planet.id,
        sx: proj.sx,
        sy: proj.sy,
        radius,
        depth: proj.depth,
      });

      labelItems.push({
        id: planet.id,
        order: planet.order,
        name: planet.name,
        color: planet.color,
        sx: proj.sx,
        sy: proj.sy,
        radius,
        orbitsCompleted: state.orbitsCompleted,
        isSelected: planet.id === selectedPlanetId,
        isHovered: planet.id === this._hoveredId,
      });
    }

    // Back-to-front depth sort (smaller depth = farther away, drawn first)
    bodies.sort((a, b) => a.depth - b.depth);
    this._hitTargets = hitTargets;

    for (const body of bodies) {
      if (body.kind === 'sun') {
        this._drawSun(ctx, body, selectedPlanetId === 'sun', this._hoveredId === 'sun', nowSec);
      } else {
        this._drawPlanet(
          ctx,
          body,
          cam,
          body.id === selectedPlanetId,
          body.id === this._hoveredId,
          recentCompletions,
          nowMs,
          nowSec
        );
      }
    }

    return labelItems;
  }

  _drawSun(ctx, sun, isSelected, isHovered, nowSec) {
    const { sx, sy, radius } = sun;
    const shimmer = 1 + 0.045 * Math.sin(nowSec * 1.9) + 0.025 * Math.cos(nowSec * 3.1);
    const coreColor = SUN_DATA.color || '#FDB813';
    const glowColor = SUN_DATA.glowColor || '#FF8C00';

    ctx.save();

    // Outer wide solar corona bloom
    const outerR = radius * 4.4 * shimmer;
    const outerGrad = ctx.createRadialGradient(sx, sy, radius * 0.4, sx, sy, outerR);
    outerGrad.addColorStop(0, hexToRgba(coreColor, 0.42));
    outerGrad.addColorStop(0.28, hexToRgba(glowColor, 0.22));
    outerGrad.addColorStop(0.62, hexToRgba(glowColor, 0.065));
    outerGrad.addColorStop(1, 'rgba(255, 140, 0, 0)');
    ctx.fillStyle = outerGrad;
    ctx.beginPath();
    ctx.arc(sx, sy, outerR, 0, TWO_PI);
    ctx.fill();

    // Subtle animated solar corona rays
    const rayCount = 12;
    const baseAngle = nowSec * 0.08;
    ctx.strokeStyle = hexToRgba(coreColor, 0.14);
    ctx.lineWidth = Math.max(1.2, radius * 0.14);
    ctx.lineCap = 'round';
    for (let i = 0; i < rayCount; i++) {
      const a = baseAngle + (i / rayCount) * TWO_PI;
      const rayPulse = 0.85 + 0.2 * Math.sin(nowSec * 1.7 + i * 1.9);
      const r1 = radius * 1.05;
      const r2 = radius * (1.75 + (i % 2) * 0.42) * rayPulse;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(a) * r1, sy + Math.sin(a) * r1);
      ctx.lineTo(sx + Math.cos(a) * r2, sy + Math.sin(a) * r2);
      ctx.stroke();
    }

    // Inner intense chromosphere halo
    const midR = radius * 1.78 * shimmer;
    const midGrad = ctx.createRadialGradient(sx, sy, radius * 0.6, sx, sy, midR);
    midGrad.addColorStop(0, 'rgba(255, 245, 200, 0.85)');
    midGrad.addColorStop(0.45, hexToRgba(coreColor, 0.48));
    midGrad.addColorStop(1, 'rgba(255, 140, 0, 0)');
    ctx.fillStyle = midGrad;
    ctx.beginPath();
    ctx.arc(sx, sy, midR, 0, TWO_PI);
    ctx.fill();

    // Bright photosphere sphere with limb darkening
    const sphereGrad = ctx.createRadialGradient(
      sx - radius * 0.22,
      sy - radius * 0.22,
      radius * 0.08,
      sx,
      sy,
      radius
    );
    sphereGrad.addColorStop(0, '#FFFDF2');
    sphereGrad.addColorStop(0.42, '#FFE680');
    sphereGrad.addColorStop(0.78, coreColor);
    sphereGrad.addColorStop(1, '#E07000');
    ctx.fillStyle = sphereGrad;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, TWO_PI);
    ctx.fill();

    if (isSelected || isHovered) {
      this._drawTargetReticle(ctx, sx, sy, radius + 7, coreColor, isSelected, nowSec);
    }

    ctx.restore();
  }

  _computeRingGeometry(planet, cam) {
    const spin = this._spinAxisCache.get(planet.id) || { x: 0, y: 0, z: 1 };
    // Rotate spin vector by camera yaw & pitch (direction vector, no translation)
    const rx = spin.x * cam.cosYaw - spin.y * cam.sinYaw;
    const ry = spin.x * cam.sinYaw + spin.y * cam.cosYaw;
    const rz = spin.z;

    const cnx = rx;
    const cny = ry * cam.cosPitch + rz * cam.sinPitch;
    const cnz = -ry * cam.sinPitch + rz * cam.cosPitch;

    const xyLen = Math.hypot(cnx, cny);
    const angle = xyLen > 1e-5 ? Math.atan2(cnx, cny) : 0;
    const aspect = clamp(Math.abs(cnz), 0.09, 1.0);
    // When cnz >= 0, upper canvas arc [PI, 2*PI] is behind sphere and lower arc [0, PI] is in front.
    // When cnz < 0, lower canvas arc [0, PI] is behind sphere and upper arc [PI, 2*PI] is in front.
    const backStart = cnz >= 0 ? Math.PI : 0;
    const backEnd = cnz >= 0 ? TWO_PI : Math.PI;
    const frontStart = cnz >= 0 ? 0 : Math.PI;
    const frontEnd = cnz >= 0 ? Math.PI : TWO_PI;

    return { angle, aspect, backStart, backEnd, frontStart, frontEnd };
  }

  _drawRingHalf(ctx, sx, sy, radius, planet, ringGeom, isFront) {
    const spec = planet.ringSpec;
    if (!spec) return;

    const startAngle = isFront ? ringGeom.frontStart : ringGeom.backStart;
    const endAngle = isFront ? ringGeom.frontEnd : ringGeom.backEnd;
    const innerR = radius * spec.innerFactor;
    const outerR = radius * spec.outerFactor;
    const ringColor = spec.color || '#D8C39A';
    const baseOpacity = spec.opacity ?? 0.65;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(ringGeom.angle);
    ctx.scale(1, ringGeom.aspect);

    if (planet.id === 'saturn') {
      // Multi-band Saturn rings with delicate Cassini division
      const bands = [
        { r0: innerR, r1: radius * 1.56, alpha: baseOpacity * 0.45, color: '#B7A27E' },
        { r0: radius * 1.57, r1: radius * 1.90, alpha: baseOpacity * 0.96, color: '#E8D5AC' },
        // Cassini gap around 1.90..1.98
        { r0: radius * 1.98, r1: outerR, alpha: baseOpacity * 0.72, color: ringColor },
      ];
      for (const band of bands) {
        const midR = (band.r0 + band.r1) * 0.5;
        const width = Math.max(0.8, band.r1 - band.r0);
        ctx.strokeStyle = hexToRgba(band.color, band.alpha);
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.arc(0, 0, midR, startAngle, endAngle);
        ctx.stroke();
      }
    } else {
      // Uranus subtle translucent ice rings
      const midR = (innerR + outerR) * 0.5;
      const width = Math.max(0.8, outerR - innerR);
      ctx.strokeStyle = hexToRgba(ringColor, baseOpacity);
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(0, 0, midR, startAngle, endAngle);
      ctx.stroke();
    }

    ctx.restore();
  }

  _drawPlanetSurfaceDetails(ctx, sx, sy, radius, planet, lightScreenX, lightScreenY) {
    if (radius < 3.6) return;

    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, TWO_PI);
    ctx.clip();

    const tiltRad = clamp((planet.axialTiltDeg || 0) * DEG_TO_RAD, -0.55, 0.55);

    switch (planet.id) {
      case 'mercury': {
        ctx.fillStyle = 'rgba(72, 68, 62, 0.34)';
        ctx.beginPath();
        ctx.arc(sx - radius * 0.25, sy - radius * 0.15, radius * 0.26, 0, TWO_PI);
        ctx.arc(sx + radius * 0.28, sy + radius * 0.22, radius * 0.19, 0, TWO_PI);
        ctx.fill();
        break;
      }

      case 'venus': {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(-0.18);
        ctx.fillStyle = 'rgba(255, 244, 214, 0.24)';
        ctx.fillRect(-radius * 1.1, -radius * 0.45, radius * 2.2, radius * 0.28);
        ctx.fillStyle = hexToRgba(planet.accentColor || '#C99A55', 0.28);
        ctx.fillRect(-radius * 1.1, radius * 0.08, radius * 2.2, radius * 0.26);
        ctx.restore();
        break;
      }

      case 'earth': {
        // Subtle green-teal continents
        ctx.fillStyle = hexToRgba(planet.accentColor || '#2E8B57', 0.72);
        ctx.beginPath();
        ctx.ellipse(
          sx - radius * 0.22,
          sy - radius * 0.14,
          radius * 0.36,
          radius * 0.24,
          0.35,
          0,
          TWO_PI
        );
        ctx.fill();

        ctx.beginPath();
        ctx.ellipse(
          sx + radius * 0.26,
          sy + radius * 0.16,
          radius * 0.30,
          radius * 0.22,
          -0.4,
          0,
          TWO_PI
        );
        ctx.fill();

        // Delicate white cloud wisps & polar cap
        ctx.fillStyle = 'rgba(240, 248, 255, 0.36)';
        ctx.beginPath();
        ctx.ellipse(sx, sy - radius * 0.84, radius * 0.45, radius * 0.18, 0, 0, TWO_PI);
        ctx.ellipse(
          sx + radius * 0.08,
          sy - radius * 0.24,
          radius * 0.48,
          radius * 0.11,
          -0.2,
          0,
          TWO_PI
        );
        ctx.fill();

        // Atmospheric blue sheen rim on sunlit side
        const atmoGrad = ctx.createRadialGradient(
          sx + lightScreenX * radius * 0.35,
          sy + lightScreenY * radius * 0.35,
          radius * 0.65,
          sx,
          sy,
          radius * 1.02
        );
        atmoGrad.addColorStop(0, 'rgba(120, 210, 255, 0)');
        atmoGrad.addColorStop(0.8, 'rgba(110, 200, 255, 0.18)');
        atmoGrad.addColorStop(1, 'rgba(135, 220, 255, 0.62)');
        ctx.fillStyle = atmoGrad;
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, TWO_PI);
        ctx.fill();
        break;
      }

      case 'mars': {
        // Rusty darker basalt albedo region
        ctx.fillStyle = hexToRgba(planet.accentColor || '#A84324', 0.45);
        ctx.beginPath();
        ctx.ellipse(sx + radius * 0.15, sy + radius * 0.08, radius * 0.44, radius * 0.26, 0.2, 0, TWO_PI);
        ctx.fill();
        // Tiny north polar ice cap
        ctx.fillStyle = 'rgba(250, 240, 232, 0.55)';
        ctx.beginPath();
        ctx.ellipse(sx, sy - radius * 0.88, radius * 0.34, radius * 0.14, 0, 0, TWO_PI);
        ctx.fill();
        break;
      }

      case 'jupiter': {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(tiltRad);
        const bands = [
          { y: -0.74, h: 0.16, color: 'rgba(176, 128, 88, 0.42)' },
          { y: -0.46, h: 0.20, color: 'rgba(246, 226, 194, 0.46)' },
          { y: -0.22, h: 0.22, color: 'rgba(181, 118, 76, 0.58)' },
          { y: 0.04, h: 0.16, color: 'rgba(248, 232, 204, 0.42)' },
          { y: 0.24, h: 0.22, color: 'rgba(172, 108, 68, 0.52)' },
          { y: 0.52, h: 0.18, color: 'rgba(148, 104, 72, 0.38)' },
        ];
        for (const b of bands) {
          ctx.fillStyle = b.color;
          ctx.fillRect(-radius * 1.1, b.y * radius, radius * 2.2, b.h * radius);
        }
        // Great Red Spot
        ctx.fillStyle = 'rgba(202, 86, 54, 0.72)';
        ctx.beginPath();
        ctx.ellipse(radius * 0.24, radius * 0.28, radius * 0.23, radius * 0.13, 0, 0, TWO_PI);
        ctx.fill();
        ctx.restore();
        break;
      }

      case 'saturn': {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(0.24);
        const bands = [
          { y: -0.58, h: 0.18, color: 'rgba(205, 178, 122, 0.35)' },
          { y: -0.22, h: 0.22, color: 'rgba(250, 238, 206, 0.34)' },
          { y: 0.14, h: 0.20, color: 'rgba(196, 167, 108, 0.42)' },
          { y: 0.48, h: 0.18, color: 'rgba(168, 142, 92, 0.34)' },
        ];
        for (const b of bands) {
          ctx.fillStyle = b.color;
          ctx.fillRect(-radius * 1.1, b.y * radius, radius * 2.2, b.h * radius);
        }
        ctx.restore();
        break;
      }

      case 'uranus': {
        const sheen = ctx.createRadialGradient(
          sx + lightScreenX * radius * 0.3,
          sy + lightScreenY * radius * 0.3,
          radius * 0.1,
          sx,
          sy,
          radius
        );
        sheen.addColorStop(0, 'rgba(210, 250, 255, 0.32)');
        sheen.addColorStop(1, 'rgba(70, 160, 185, 0.08)');
        ctx.fillStyle = sheen;
        ctx.fillRect(sx - radius, sy - radius, radius * 2, radius * 2);
        break;
      }

      case 'neptune': {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(0.28);
        ctx.fillStyle = 'rgba(42, 74, 182, 0.45)';
        ctx.fillRect(-radius * 1.1, -radius * 0.35, radius * 2.2, radius * 0.24);
        ctx.fillRect(-radius * 1.1, radius * 0.12, radius * 2.2, radius * 0.22);
        ctx.fillStyle = 'rgba(170, 210, 255, 0.36)';
        ctx.beginPath();
        ctx.ellipse(-radius * 0.18, -radius * 0.12, radius * 0.34, radius * 0.09, 0, 0, TWO_PI);
        ctx.fill();
        ctx.restore();
        break;
      }

      default:
        break;
    }

    ctx.restore();
  }

  _drawPlanet(ctx, body, cam, isSelected, isHovered, recentCompletions, nowMs, nowSec) {
    const { planet, sx, sy, radius, lightDir, worldPos } = body;

    ctx.save();

    // Subtle 3D inclination drop-line to the ecliptic plane for selected/hovered planets in 3D view
    if ((isSelected || isHovered) && this.pitch > 0.22 && Math.abs(worldPos.z) > 0.015) {
      const foot = this._projectWorldPoint(worldPos.x, worldPos.y, 0, cam);
      if (foot.visible) {
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = hexToRgba(planet.color, 0.45);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(foot.sx, foot.sy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = hexToRgba(planet.color, 0.65);
        ctx.beginPath();
        ctx.arc(foot.sx, foot.sy, 2.1, 0, TWO_PI);
        ctx.fill();
        ctx.restore();
      }
    }

    // Subtle planet outer halo glow (especially rusty glow on Mars, blue rim on Earth, ice glow on Neptune)
    const haloStrength =
      planet.id === 'earth' || planet.id === 'mars' || planet.id === 'neptune' ? 0.28 : 0.16;
    const haloR = radius * (isSelected ? 2.5 : 1.9);
    const haloGrad = ctx.createRadialGradient(sx, sy, radius * 0.7, sx, sy, haloR);
    haloGrad.addColorStop(0, hexToRgba(planet.color, haloStrength));
    haloGrad.addColorStop(1, hexToRgba(planet.color, 0));
    ctx.fillStyle = haloGrad;
    ctx.beginPath();
    ctx.arc(sx, sy, haloR, 0, TWO_PI);
    ctx.fill();

    // Compute 3D ring orientation if planet has rings
    const ringGeom = planet.hasRings && planet.ringSpec ? this._computeRingGeometry(planet, cam) : null;

    // 1. Back half of planetary rings (drawn BEHIND the sphere)
    if (ringGeom) {
      this._drawRingHalf(ctx, sx, sy, radius, planet, ringGeom, false);
    }

    // 2. Sphere base with directional heliocentric lighting (lit side toward Sun)
    // Camera up (+Y) maps to screen up (-sy), so screen light vector is (lightDir.x, -lightDir.y)
    const lightScreenX = lightDir.x;
    const lightScreenY = -lightDir.y;
    const frontLitFactor = clamp((lightDir.z + 1) * 0.5, 0.15, 1.0);

    const litX = sx + lightScreenX * radius * 0.44;
    const litY = sy + lightScreenY * radius * 0.44;

    const sphereGrad = ctx.createRadialGradient(
      litX,
      litY,
      radius * 0.08,
      sx,
      sy,
      radius * 1.15
    );
    sphereGrad.addColorStop(0, adjustHexBrightness(planet.color, 1.28 + 0.16 * frontLitFactor));
    sphereGrad.addColorStop(0.55, planet.color);
    sphereGrad.addColorStop(0.88, adjustHexBrightness(planet.accentColor || planet.color, 0.52));
    sphereGrad.addColorStop(1, '#080D1B');

    ctx.fillStyle = sphereGrad;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, TWO_PI);
    ctx.fill();

    // 3. Distinctive planetary surface details
    this._drawPlanetSurfaceDetails(ctx, sx, sy, radius, planet, lightScreenX, lightScreenY);

    // 4. Night-side hemisphere terminator shadow opposite the Sun
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, TWO_PI);
    ctx.clip();

    const nightX = sx - lightScreenX * radius * 0.72;
    const nightY = sy - lightScreenY * radius * 0.72;
    const nightAlpha = clamp(0.76 - frontLitFactor * 0.24, 0.42, 0.78);
    const nightGrad = ctx.createRadialGradient(
      nightX,
      nightY,
      radius * 0.12,
      nightX,
      nightY,
      radius * 1.42
    );
    nightGrad.addColorStop(0, `rgba(3, 6, 16, ${nightAlpha})`);
    nightGrad.addColorStop(0.58, `rgba(4, 8, 20, ${nightAlpha * 0.55})`);
    nightGrad.addColorStop(1, 'rgba(4, 8, 20, 0)');
    ctx.fillStyle = nightGrad;
    ctx.fillRect(sx - radius - 1, sy - radius - 1, radius * 2 + 2, radius * 2 + 2);

    // Subtle sunlit limb rim highlight
    ctx.strokeStyle = hexToRgba(planet.color, 0.28);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(0.5, radius - 0.45), 0, TWO_PI);
    ctx.stroke();

    ctx.restore();

    // 5. Front half of planetary rings (drawn IN FRONT of the sphere)
    if (ringGeom) {
      this._drawRingHalf(ctx, sx, sy, radius, planet, ringGeom, true);
    }

    // 6. Selection / Hover Reticle
    if (isSelected || isHovered) {
      const reticleR = planet.hasRings && planet.ringSpec ? radius * 1.85 + 4 : radius + 6;
      this._drawTargetReticle(ctx, sx, sy, reticleR, planet.color, isSelected, nowSec);
    }

    // 7. Period T Completion Pulse Ring (when planet completes a full orbit!)
    const completedAt = getCompletionTimestamp(recentCompletions, planet.id);
    if (completedAt !== null) {
      const age = nowMs - completedAt;
      if (age >= 0 && age <= COMPLETION_PULSE_MS) {
        this._drawCompletionPulse(ctx, sx, sy, radius, planet, age / COMPLETION_PULSE_MS);
      }
    }

    ctx.restore();
  }

  _drawTargetReticle(ctx, sx, sy, r, color, isSelected, nowSec) {
    ctx.save();
    ctx.translate(sx, sy);

    if (isSelected) {
      const pulse = 1 + 0.06 * Math.sin(nowSec * 3.6);
      const rr = r * pulse;
      ctx.rotate(nowSec * 0.35);
      ctx.strokeStyle = hexToRgba(color, 0.92);
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 4; i++) {
        const a0 = i * (Math.PI * 0.5) + 0.22;
        const a1 = (i + 1) * (Math.PI * 0.5) - 0.22;
        ctx.beginPath();
        ctx.arc(0, 0, rr, a0, a1);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = hexToRgba(color, 0.6);
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TWO_PI);
      ctx.stroke();
    }

    ctx.restore();
  }

  _drawCompletionPulse(ctx, sx, sy, radius, planet, progress) {
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const fade = 1 - progress;

    ctx.save();

    // Brief warm core flash
    if (progress < 0.26) {
      const flashAlpha = (1 - progress / 0.26) * 0.55;
      const flashGrad = ctx.createRadialGradient(sx, sy, radius * 0.5, sx, sy, radius * 2.8);
      flashGrad.addColorStop(0, `rgba(255, 232, 138, ${flashAlpha})`);
      flashGrad.addColorStop(1, 'rgba(255, 215, 90, 0)');
      ctx.fillStyle = flashGrad;
      ctx.beginPath();
      ctx.arc(sx, sy, radius * 2.8, 0, TWO_PI);
      ctx.fill();
    }

    // Outer expanding golden ring
    const outerR = radius + 4 + easeOut * 42;
    ctx.strokeStyle = `rgba(255, 217, 102, ${fade * 0.92})`;
    ctx.lineWidth = Math.max(0.9, 2.6 * fade);
    ctx.beginPath();
    ctx.arc(sx, sy, outerR, 0, TWO_PI);
    ctx.stroke();

    // Inner expanding planet-colored ring
    const innerR = radius + 2 + easeOut * 26;
    ctx.strokeStyle = hexToRgba(planet.color, fade * 0.8);
    ctx.lineWidth = Math.max(0.8, 1.9 * fade);
    ctx.beginPath();
    ctx.arc(sx, sy, innerR, 0, TWO_PI);
    ctx.stroke();

    // Floating "+1 T" indicator
    ctx.font = `700 10.5px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(255, 230, 128, ${clamp(fade * 1.25, 0, 1)})`;
    ctx.fillText('+1 T', sx, sy - radius - 10 - easeOut * 20);

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Layer 7: Planet Labels with Collision Avoidance
  // ---------------------------------------------------------------------------

  _drawLabels(ctx, labelItems, cam, selectedPlanetId) {
    if (!labelItems || labelItems.length === 0) return;

    ctx.save();

    // Place selected/hovered first so they always win optimal non-overlapping positions
    const sorted = [...labelItems].sort((a, b) => {
      if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
      if (a.isHovered !== b.isHovered) return a.isHovered ? -1 : 1;
      return a.order - b.order;
    });

    // Seed collision avoidance with open inspector card, 0° reference axis pill, and bottom-left HUD chip
    const placedBoxes = [];
    if (this._inspectorBox) {
      placedBoxes.push({
        x: this._inspectorBox.x - 4,
        y: this._inspectorBox.y - 4,
        w: this._inspectorBox.w + 8,
        h: this._inspectorBox.h + 8,
      });
    }
    if (this._axisLabelBox) {
      placedBoxes.push({
        x: this._axisLabelBox.x - 3,
        y: this._axisLabelBox.y - 3,
        w: this._axisLabelBox.w + 6,
        h: this._axisLabelBox.h + 6,
      });
    }
    if (this._hudOverlayBox) {
      placedBoxes.push({
        x: this._hudOverlayBox.x - 3,
        y: this._hudOverlayBox.y - 3,
        w: this._hudOverlayBox.w + 6,
        h: this._hudOverlayBox.h + 6,
      });
    }

    const showOrbitCountGlobally = this.viewRadius < 15.5;

    for (const item of sorted) {
      if (
        item.sx < -40 ||
        item.sx > this.width + 40 ||
        item.sy < -40 ||
        item.sy > this.height + 40
      ) {
        continue;
      }

      // Skip non-selected labels if the planet itself is physically tucked behind the open inspector card
      if (
        !item.isSelected &&
        !item.isHovered &&
        this._inspectorBox &&
        item.sx >= this._inspectorBox.x - 2 &&
        item.sx <= this._inspectorBox.x + this._inspectorBox.w + 2 &&
        item.sy >= this._inspectorBox.y - 2 &&
        item.sy <= this._inspectorBox.y + this._inspectorBox.h + 2
      ) {
        continue;
      }

      const mainText = item.order > 0 ? `#${item.order} ${item.name}` : item.name;
      const showCount =
        item.orbitsCompleted !== null &&
        (item.isSelected || item.isHovered || showOrbitCountGlobally);
      const countText = showCount ? ` ${item.orbitsCompleted.toFixed(2)}×` : '';

      ctx.font = `${item.isSelected ? 700 : 600} 11px ${FONT_SANS}`;
      const mainW = ctx.measureText(mainText).width;
      let countW = 0;
      if (countText) {
        ctx.font = `500 10px ${FONT_MONO}`;
        countW = ctx.measureText(countText).width;
      }

      const padX = 7;
      const boxW = mainW + countW + padX * 2;
      const boxH = 20;
      const r = item.radius;

      // Alternate above/below preference by planet order so aligned planets at t=0 stagger cleanly!
      const preferBelow = item.order % 2 === 0;
      const dyPrimary = preferBelow ? r + 6 : -(r + boxH + 6);
      const dyAlt = preferBelow ? -(r + boxH + 6) : r + 6;
      const dyTier2 = preferBelow ? r + 30 : -(r + boxH + 30);
      const dyTier2Alt = preferBelow ? -(r + boxH + 30) : r + 30;
      const dyTier3 = preferBelow ? r + 54 : -(r + boxH + 54);
      const dyTier3Alt = preferBelow ? -(r + boxH + 54) : r + 54;
      const dyTier4 = preferBelow ? r + 78 : -(r + boxH + 78);
      const dyTier4Alt = preferBelow ? -(r + boxH + 78) : r + 78;

      const candidates = [
        { x: item.sx - boxW * 0.5, y: item.sy + dyPrimary },
        { x: item.sx + r + 8, y: item.sy + dyPrimary },
        { x: item.sx - boxW * 0.5, y: item.sy + dyAlt },
        { x: item.sx + r + 8, y: item.sy + dyAlt },
        { x: item.sx - r - 8 - boxW, y: item.sy + dyPrimary },
        { x: item.sx - r - 8 - boxW, y: item.sy + dyAlt },
        { x: item.sx - boxW * 0.5, y: item.sy + dyTier2 },
        { x: item.sx - boxW * 0.5, y: item.sy + dyTier2Alt },
        { x: item.sx + r + 10, y: item.sy + dyTier2 },
        { x: item.sx - r - 10 - boxW, y: item.sy + dyTier2 },
        { x: item.sx - boxW * 0.5, y: item.sy + dyTier3 },
        { x: item.sx - boxW * 0.5, y: item.sy + dyTier3Alt },
        { x: item.sx + r + 12, y: item.sy + dyTier3 },
        { x: item.sx - r - 12 - boxW, y: item.sy + dyTier3 },
        { x: item.sx - boxW * 0.5, y: item.sy + dyTier4 },
        { x: item.sx - boxW * 0.5, y: item.sy + dyTier4Alt },
      ];

      let chosen = null;
      const minX = this._safeBounds.left + 8;
      const maxX = Math.max(minX, this._safeBounds.right - boxW - 8);
      const minY = this._safeBounds.top + 8;
      const maxY = Math.max(minY, this._safeBounds.bottom - boxH - 8);

      for (const cand of candidates) {
        const box = {
          x: clamp(cand.x, minX, maxX),
          y: clamp(cand.y, minY, maxY),
          w: boxW,
          h: boxH,
        };
        let collides = false;
        for (const existing of placedBoxes) {
          if (boxesOverlap(box, existing, 4)) {
            collides = true;
            break;
          }
        }
        if (!collides) {
          chosen = box;
          break;
        }
      }

      // Always render selected or hovered planet even in extreme clutter (nudged clear of inspector card)
      if (!chosen) {
        if (item.isSelected || item.isHovered) {
          let fx = clamp(item.sx + r + 8, minX, maxX);
          let fy = clamp(item.sy - boxH - r - 6, minY, maxY);
          const fallbackBox = { x: fx, y: fy, w: boxW, h: boxH };
          if (this._inspectorBox && boxesOverlap(fallbackBox, this._inspectorBox, 6)) {
            fx = clamp(this._inspectorBox.x + this._inspectorBox.w + 10, minX, maxX);
          }
          chosen = { x: fx, y: fy, w: boxW, h: boxH };
        } else {
          continue;
        }
      }

      placedBoxes.push(chosen);

      // Subtle hairline leader tick when offset cleanly from the planet
      const boxCenterX = chosen.x + chosen.w * 0.5;
      const boxCenterY = chosen.y + chosen.h * 0.5;
      const leaderDist = Math.hypot(boxCenterX - item.sx, boxCenterY - item.sy);
      if (leaderDist > r + 14) {
        const anchorX = clamp(item.sx, chosen.x + 6, chosen.x + chosen.w - 6);
        const anchorY = boxCenterY < item.sy ? chosen.y + chosen.h : chosen.y;
        ctx.strokeStyle = hexToRgba(item.color, item.isSelected ? 0.65 : 0.34);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(item.sx, item.sy);
        ctx.lineTo(anchorX, anchorY);
        ctx.stroke();
      }

      // Pill container
      ctx.fillStyle = item.isSelected
        ? 'rgba(11, 20, 42, 0.88)'
        : 'rgba(7, 13, 28, 0.74)';
      ctx.strokeStyle = hexToRgba(item.color, item.isSelected ? 0.9 : 0.45);
      ctx.lineWidth = item.isSelected ? 1.3 : 1.0;
      drawRoundedRect(ctx, chosen.x, chosen.y, chosen.w, chosen.h, 5);
      ctx.fill();
      ctx.stroke();

      // Label text
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = `${item.isSelected ? 700 : 600} 11px ${FONT_SANS}`;
      ctx.fillStyle = item.isSelected ? '#FFFFFF' : 'rgba(232, 240, 255, 0.92)';
      ctx.fillText(mainText, chosen.x + padX, chosen.y + chosen.h * 0.5 + 0.5);

      if (countText) {
        ctx.font = `500 10px ${FONT_MONO}`;
        ctx.fillStyle = hexToRgba(item.color, 0.95);
        ctx.fillText(countText, chosen.x + padX + mainW, chosen.y + chosen.h * 0.5 + 0.5);
      }
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Layer 8: Subtle Canvas View Angle / Scale Cue Overlay
  // ---------------------------------------------------------------------------

  _drawHudOverlay(ctx, cam, scaleMode) {
    if (this.width < 320 || this.height < 220) return;

    ctx.save();

    const pitchDeg = Math.round(this.pitch / DEG_TO_RAD);
    const viewText = pitchDeg <= 2 ? 'TOP 0°' : `3D ${pitchDeg}°`;
    const isTrueScale = scaleMode === 'true';
    const scaleBar = isTrueScale ? pickNiceScaleBarAU(cam.ppu) : null;

    const padX = 10;
    const compassR = 8;
    const boxH = 30;
    let scaleContentW = 114;
    if (isTrueScale && scaleBar) {
      ctx.font = `600 10px ${FONT_MONO}`;
      scaleContentW = scaleBar.px + ctx.measureText(scaleBar.label).width + 24;
    }
    const boxW = Math.round(padX * 2 + compassR * 2 + 66 + scaleContentW);

    // Tuck subtly at bottom-left cleanly above the HTML bottom control dock
    let x = Math.max(14, this._safeBounds.left + 14);
    const y = this._safeBounds.bottom - boxH - 8;
    if (this._inspectorBox && this._inspectorBox.y + this._inspectorBox.h + 6 > y) {
      const shiftedX = Math.round(this._inspectorBox.x + this._inspectorBox.w + 12);
      if (shiftedX + boxW < this._safeBounds.right - 8) {
        x = Math.max(x, shiftedX);
      }
    }
    if (y < this._safeBounds.top + 8 || x + boxW > this._safeBounds.right - 8) {
      ctx.restore();
      return;
    }

    this._hudOverlayBox = { x, y, w: boxW, h: boxH };

    ctx.fillStyle = 'rgba(6, 12, 26, 0.62)';
    ctx.strokeStyle = 'rgba(148, 178, 232, 0.2)';
    ctx.lineWidth = 1;
    drawRoundedRect(ctx, x, y, boxW, boxH, 7);
    ctx.fill();
    ctx.stroke();

    // Mini tilt/compass indicator
    const cx = x + padX + compassR;
    const cy = y + boxH * 0.5;
    ctx.strokeStyle = 'rgba(130, 212, 255, 0.55)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, compassR, Math.max(2, compassR * Math.cos(this.pitch)), 0, 0, TWO_PI);
    ctx.stroke();

    // +X pointer inside mini compass
    const rx = Math.cos(this.yaw) * compassR;
    const ry = -Math.sin(this.yaw) * compassR * Math.cos(this.pitch);
    ctx.strokeStyle = 'rgba(255, 210, 102, 0.85)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + rx, cy + ry);
    ctx.stroke();

    // View angle text
    ctx.font = `600 10.5px ${FONT_MONO}`;
    ctx.fillStyle = 'rgba(216, 230, 252, 0.85)';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(viewText, cx + compassR + 8, cy + 0.5);

    // Hairline divider
    const divX = cx + compassR + 62;
    ctx.strokeStyle = 'rgba(148, 178, 232, 0.22)';
    ctx.beginPath();
    ctx.moveTo(divX, y + 7);
    ctx.lineTo(divX, y + boxH - 7);
    ctx.stroke();

    if (isTrueScale && scaleBar) {
      // Dynamic True-AU scale bar
      const barX = divX + 10;
      const barY = cy + 3;
      ctx.strokeStyle = 'rgba(130, 212, 255, 0.85)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(barX, barY - 4);
      ctx.lineTo(barX, barY);
      ctx.lineTo(barX + scaleBar.px, barY);
      ctx.lineTo(barX + scaleBar.px, barY - 4);
      ctx.stroke();

      ctx.font = `600 10px ${FONT_MONO}`;
      ctx.fillStyle = 'rgba(165, 224, 255, 0.9)';
      ctx.fillText(scaleBar.label, barX + scaleBar.px + 7, cy + 0.5);
    } else {
      ctx.font = `500 10px ${FONT_SANS}`;
      ctx.fillStyle = 'rgba(182, 200, 230, 0.78)';
      ctx.fillText('Visual Order Scale', divX + 10, cy + 0.5);
    }

    ctx.restore();
  }
}
