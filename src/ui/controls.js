import { EARTH_YEAR_DAYS, PLANETS, SUN_DATA } from '../data/planets.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Logarithmic speed slider bounds (days per real second)
export const MIN_SPEED_DPS = 0.25;
export const MAX_SPEED_DPS = 50 * EARTH_YEAR_DAYS; // ~18,262.8 d/s (50 yr/s)
const SLIDER_STEPS = 1000;
const COMPLETION_PULSE_MS = 1250;

const PLANET_SHORT_CODES = {
  mercury: 'Me',
  venus: 'Ve',
  earth: 'Ea',
  mars: 'Ma',
  jupiter: 'Ju',
  saturn: 'Sa',
  uranus: 'Ur',
  neptune: 'Ne',
};

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function normalizeZero(val) {
  return Math.abs(val) < 1e-9 ? 0 : val;
}

export function speedFromSlider(sliderValue) {
  const t = clamp(Number(sliderValue) / SLIDER_STEPS, 0, 1);
  return MIN_SPEED_DPS * Math.pow(MAX_SPEED_DPS / MIN_SPEED_DPS, t);
}

export function sliderFromSpeed(daysPerSecond) {
  const clamped = clamp(daysPerSecond, MIN_SPEED_DPS, MAX_SPEED_DPS);
  const ratio = Math.log(clamped / MIN_SPEED_DPS) / Math.log(MAX_SPEED_DPS / MIN_SPEED_DPS);
  return Math.round(ratio * SLIDER_STEPS);
}

function formatElapsedDays(days) {
  const v = normalizeZero(days);
  return `${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} d`;
}

function formatElapsedYears(days) {
  const y = normalizeZero(days / EARTH_YEAR_DAYS);
  return `${y.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} yr`;
}

function formatPeriodDays(periodDays) {
  if (periodDays >= 10000) {
    return Math.round(periodDays).toLocaleString('en-US');
  }
  if (periodDays >= 1000) {
    return periodDays.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  return periodDays.toFixed(2);
}

function formatSpeed(daysPerSecond, direction = 1, withSign = false) {
  const sign = withSign ? (direction < 0 ? '-' : '+') : '';
  const absSpeed = Math.abs(daysPerSecond);

  if (absSpeed >= EARTH_YEAR_DAYS * 0.985) {
    const yrsPerSec = absSpeed / EARTH_YEAR_DAYS;
    const formatted = yrsPerSec >= 10 ? yrsPerSec.toFixed(1) : yrsPerSec.toFixed(2);
    return `${sign}${formatted} yr/s`;
  }

  const formatted = absSpeed >= 100 ? Math.round(absSpeed).toString() : absSpeed.toFixed(1);
  return `${sign}${formatted} d/s`;
}

function formatOrbits(orbitsCompleted) {
  return `${normalizeZero(orbitsCompleted).toFixed(2)} orbits`;
}

function getKeplerRatio(planet, state) {
  if (state && typeof state.keplerRatio === 'number' && Number.isFinite(state.keplerRatio)) {
    return state.keplerRatio;
  }
  return (planet.periodYears * planet.periodYears) / Math.pow(planet.semiMajorAxisAU, 3);
}

function svgEl(tag, attrs = {}, textContent = null) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  if (textContent !== null) {
    el.textContent = textContent;
  }
  return el;
}

/**
 * ObservatoryUI manages all DOM controls, live planetary order telemetry,
 * Kepler's 3rd Law SVG log-log visualization, and the Selected Body Inspector.
 */
export class ObservatoryUI {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.panelCollapsed = false;
    this.activeTab = 'planets';
    this.renderedInspectorId = undefined;
    this.inspectorRefs = null;

    this.planetRows = new Map();
    this.keplerPoints = new Map();
    this.keplerTableRows = new Map();

    this._cacheElements();
    this._buildPlanetList();
    this._buildKeplerChartAndTable();
    this._bindEvents();
    this._observeTopBarLayout();
  }

  _cacheElements() {
    this.els = {
      hudRoot: document.getElementById('hud-root'),
      topBar: document.querySelector('.top-bar'),

      // Clock
      clockDays: document.getElementById('clock-days'),
      clockYears: document.getElementById('clock-years'),
      clockRate: document.getElementById('clock-rate'),

      // Transport
      btnPlayPause: document.getElementById('btn-play-pause'),
      iconPlay: document.getElementById('icon-play'),
      iconPause: document.getElementById('icon-pause'),
      labelPlayPause: document.getElementById('label-play-pause'),
      btnReverse: document.getElementById('btn-reverse'),
      labelDirection: document.getElementById('label-direction'),
      stepButtons: Array.from(document.querySelectorAll('[data-step-days]')),
      btnResetTime: document.getElementById('btn-reset-time'),
      btnTogglePanel: document.getElementById('btn-toggle-panel'),

      // Right Panel & Tabs
      telemetryPanel: document.getElementById('telemetry-panel'),
      tabPlanets: document.getElementById('tab-planets'),
      tabKepler: document.getElementById('tab-kepler'),
      viewPlanets: document.getElementById('panel-view-planets'),
      viewKepler: document.getElementById('panel-view-kepler'),
      planetList: document.getElementById('planet-list'),
      btnOpenKeplerFooter: document.getElementById('btn-open-kepler-footer'),
      keplerChartContainer: document.getElementById('kepler-chart-container'),
      keplerTableBody: document.getElementById('kepler-table-body'),

      // Inspector Card
      inspectorCard: document.getElementById('inspector-card'),
      inspectorOrderBadge: document.getElementById('inspector-order-badge'),
      inspectorCategoryBadge: document.getElementById('inspector-category-badge'),
      inspectorDot: document.getElementById('inspector-dot'),
      inspectorName: document.getElementById('inspector-name'),
      inspectorDescription: document.getElementById('inspector-description'),
      inspectorMetrics: document.getElementById('inspector-metrics'),
      inspectorKeplerStrip: document.getElementById('inspector-kepler-strip'),
      btnCloseInspector: document.getElementById('btn-close-inspector'),
      btnFollowPlanet: document.getElementById('btn-follow-planet'),
      btnCenterSun: document.getElementById('btn-center-sun'),

      // Bottom Control Dock
      speedSlider: document.getElementById('speed-slider'),
      speedReadout: document.getElementById('speed-readout'),
      speedPresetButtons: Array.from(document.querySelectorAll('#speed-presets [data-speed]')),
      scaleButtons: Array.from(document.querySelectorAll('[data-scale]')),
      startButtons: Array.from(document.querySelectorAll('[data-start]')),
      viewButtons: Array.from(document.querySelectorAll('[data-view]')),
      btnResetView: document.getElementById('btn-reset-view'),
      overlayButtons: Array.from(document.querySelectorAll('[data-overlay]')),
    };
  }

  _buildPlanetList() {
    const fragment = document.createDocumentFragment();

    for (const planet of PLANETS) {
      const li = document.createElement('li');
      li.className = 'planet-row';
      li.dataset.planetId = planet.id;
      li.dataset.planetOrder = String(planet.order);
      li.style.setProperty('--planet-color', planet.color);
      li.setAttribute('tabindex', '0');
      li.setAttribute('role', 'button');
      li.setAttribute(
        'aria-label',
        `#${planet.order} ${planet.name}, period ${formatPeriodDays(planet.periodDays)} days (${planet.periodYears.toFixed(2)} Earth years)`
      );

      // Top line: #order, color dot, name, category, live revolutions
      const topRow = document.createElement('div');
      topRow.className = 'planet-row-top';

      const identity = document.createElement('div');
      identity.className = 'planet-identity';

      const orderBadge = document.createElement('span');
      orderBadge.className = 'order-badge mono';
      orderBadge.textContent = `#${planet.order}`;

      const dot = document.createElement('span');
      dot.className = 'planet-dot';
      dot.style.backgroundColor = planet.color;
      dot.style.color = planet.color;

      const nameEl = document.createElement('span');
      nameEl.className = 'planet-name';
      nameEl.textContent = planet.name;

      const catEl = document.createElement('span');
      catEl.className = 'planet-category';
      catEl.textContent = planet.category;

      identity.append(orderBadge, dot, nameEl, catEl);

      const orbitsEl = document.createElement('span');
      orbitsEl.className = 'planet-orbits-count mono';
      orbitsEl.textContent = '0.00 orbits';

      topRow.append(identity, orbitsEl);

      // Meta line: semi-major axis a (AU) & exact period T (days · years)
      const metaRow = document.createElement('div');
      metaRow.className = 'planet-row-meta mono';

      const axisEl = document.createElement('span');
      axisEl.className = 'planet-axis';
      axisEl.textContent = `a = ${planet.semiMajorAxisAU.toFixed(planet.semiMajorAxisAU < 10 ? 2 : 1)} AU`;

      const periodEl = document.createElement('span');
      periodEl.className = 'planet-period';
      periodEl.textContent = `T = ${formatPeriodDays(planet.periodDays)} d \u00b7 ${planet.periodYears.toFixed(2)} yr`;

      metaRow.append(axisEl, periodEl);

      // Progress track & GPU-transformed fill bar
      const track = document.createElement('div');
      track.className = 'progress-track';
      track.setAttribute('aria-hidden', 'true');

      const fill = document.createElement('div');
      fill.className = 'progress-fill';
      track.appendChild(fill);

      li.append(topRow, metaRow, track);

      const activate = () => {
        this.callbacks.onSelectPlanet?.(planet.id, { focus: true });
      };
      li.addEventListener('click', activate);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      });

      this.planetRows.set(planet.id, {
        rowEl: li,
        orbitsEl,
        progressFillEl: fill,
        wasCompleted: false,
      });

      fragment.appendChild(li);
    }

    this.els.planetList.replaceChildren(fragment);
  }

  _buildKeplerChartAndTable() {
    // 1. Crisp inline SVG log-log plot: log10(a) vs log10(T)
    const width = 330;
    const height = 228;
    const pad = { left: 46, right: 16, top: 18, bottom: 34 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const minLogA = Math.log10(0.25);
    const maxLogA = Math.log10(45);
    const minLogT = Math.log10(0.125);
    const maxLogT = Math.log10(300);

    const mapX = (a) => pad.left + ((Math.log10(a) - minLogA) / (maxLogA - minLogA)) * plotW;
    const mapY = (T) => pad.top + (1 - (Math.log10(T) - minLogT) / (maxLogT - minLogT)) * plotH;

    const svg = svgEl('svg', {
      class: 'kepler-svg',
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': "Log-log plot of orbital period T in Earth years versus semi-major axis a in AU confirming Kepler's 3rd Law T squared equals a cubed",
    });

    // Subtle plot background frame
    svg.appendChild(
      svgEl('rect', {
        x: pad.left,
        y: pad.top,
        width: plotW,
        height: plotH,
        rx: 4,
        fill: 'rgba(15, 23, 42, 0.45)',
        stroke: 'rgba(148, 179, 224, 0.2)',
        'stroke-width': 1,
      })
    );

    // X-axis grid & ticks (AU)
    const aTicks = [0.5, 1, 2, 5, 10, 30];
    for (const tickA of aTicks) {
      const x = mapX(tickA);
      svg.appendChild(
        svgEl('line', {
          x1: x.toFixed(1),
          y1: pad.top,
          x2: x.toFixed(1),
          y2: pad.top + plotH,
          stroke: tickA === 1 ? 'rgba(56, 189, 248, 0.28)' : 'rgba(148, 179, 224, 0.12)',
          'stroke-dasharray': tickA === 1 ? '3 3' : '2 3',
          'stroke-width': 1,
        })
      );
      svg.appendChild(
        svgEl(
          'text',
          {
            x: x.toFixed(1),
            y: pad.top + plotH + 13,
            fill: tickA === 1 ? '#7dd3fc' : '#94a3b8',
            'font-size': 9,
            'font-family': 'var(--font-mono)',
            'text-anchor': 'middle',
          },
          String(tickA)
        )
      );
    }

    // Y-axis grid & ticks (Earth years)
    const tTicks = [0.2, 1, 10, 100];
    for (const tickT of tTicks) {
      const y = mapY(tickT);
      svg.appendChild(
        svgEl('line', {
          x1: pad.left,
          y1: y.toFixed(1),
          x2: pad.left + plotW,
          y2: y.toFixed(1),
          stroke: tickT === 1 ? 'rgba(56, 189, 248, 0.28)' : 'rgba(148, 179, 224, 0.12)',
          'stroke-dasharray': tickT === 1 ? '3 3' : '2 3',
          'stroke-width': 1,
        })
      );
      svg.appendChild(
        svgEl(
          'text',
          {
            x: pad.left - 6,
            y: (y + 3).toFixed(1),
            fill: tickT === 1 ? '#7dd3fc' : '#94a3b8',
            'font-size': 9,
            'font-family': 'var(--font-mono)',
            'text-anchor': 'end',
          },
          String(tickT)
        )
      );
    }

    // Axis titles
    svg.appendChild(
      svgEl(
        'text',
        {
          x: (pad.left + plotW / 2).toFixed(1),
          y: height - 5,
          fill: '#94a3b8',
          'font-size': 9.5,
          'font-weight': 600,
          'text-anchor': 'middle',
        },
        'Semi-major axis a (AU) \u2014 log scale'
      )
    );

    svg.appendChild(
      svgEl(
        'text',
        {
          x: 12,
          y: (pad.top + plotH / 2).toFixed(1),
          fill: '#94a3b8',
          'font-size': 9.5,
          'font-weight': 600,
          'text-anchor': 'middle',
          transform: `rotate(-90 12 ${(pad.top + plotH / 2).toFixed(1)})`,
        },
        'Period T (yr) \u2014 log'
      )
    );

    // Theoretical Kepler 3rd Law line: T = a^(3/2)
    const aStart = 0.28;
    const aEnd = 40;
    const x1 = mapX(aStart);
    const y1 = mapY(Math.pow(aStart, 1.5));
    const x2 = mapX(aEnd);
    const y2 = mapY(Math.pow(aEnd, 1.5));

    svg.appendChild(
      svgEl('line', {
        x1: x1.toFixed(1),
        y1: y1.toFixed(1),
        x2: x2.toFixed(1),
        y2: y2.toFixed(1),
        stroke: 'rgba(56, 189, 248, 0.25)',
        'stroke-width': 5,
        'stroke-linecap': 'round',
      })
    );

    svg.appendChild(
      svgEl('line', {
        x1: x1.toFixed(1),
        y1: y1.toFixed(1),
        x2: x2.toFixed(1),
        y2: y2.toFixed(1),
        stroke: '#38bdf8',
        'stroke-width': 1.5,
        'stroke-dasharray': '5 3',
      })
    );

    // Legend cue in top-left corner of plot
    svg.appendChild(
      svgEl(
        'text',
        {
          x: pad.left + 8,
          y: pad.top + 14,
          fill: '#7dd3fc',
          'font-size': 9.5,
          'font-family': 'var(--font-mono)',
          'font-weight': 600,
        },
        'Theory: T = a^(3/2)'
      )
    );

    // Plot each of the 8 planets on the log-log graph + populate table rows
    const tableFragment = document.createDocumentFragment();

    for (const planet of PLANETS) {
      const px = mapX(planet.semiMajorAxisAU);
      const py = mapY(planet.periodYears);
      const ratio = getKeplerRatio(planet);

      // Alternating label positions so none of the 8 planet tags collide
      const isOdd = planet.order % 2 === 1;
      let labelX;
      let labelY;
      let anchor;
      if (planet.order === 8) {
        // Neptune sits near top-right corner; place tag cleanly below-left
        labelX = px + 4;
        labelY = py + 15;
        anchor = 'end';
      } else if (isOdd) {
        labelX = px - 7;
        labelY = py - 7;
        anchor = 'end';
      } else {
        labelX = px + 8;
        labelY = py + 11;
        anchor = 'start';
      }

      const g = svgEl('g', {
        class: 'kepler-point-group',
        'data-planet-id': planet.id,
        tabindex: 0,
        role: 'button',
      });

      g.appendChild(
        svgEl(
          'title',
          {},
          `#${planet.order} ${planet.name}\na = ${planet.semiMajorAxisAU.toFixed(4)} AU\nT = ${planet.periodYears.toFixed(3)} yr\nT\u00b2 / a\u00b3 = ${ratio.toFixed(4)}`
        )
      );

      // Selection / hover halo ring
      g.appendChild(
        svgEl('circle', {
          class: 'kepler-point-ring',
          cx: px.toFixed(1),
          cy: py.toFixed(1),
          r: 8.5,
          fill: 'none',
          stroke: '#f8fafc',
          'stroke-width': 1.25,
          'stroke-dasharray': '2 2',
        })
      );

      // Planet dot
      g.appendChild(
        svgEl('circle', {
          class: 'kepler-point-dot',
          cx: px.toFixed(1),
          cy: py.toFixed(1),
          r: 4.2,
          fill: planet.color,
          stroke: '#050811',
          'stroke-width': 1.1,
        })
      );

      const code = PLANET_SHORT_CODES[planet.id] || planet.name.slice(0, 2);
      g.appendChild(
        svgEl(
          'text',
          {
            x: labelX.toFixed(1),
            y: labelY.toFixed(1),
            fill: '#e2e8f0',
            'font-size': 8.5,
            'font-family': 'var(--font-mono)',
            'font-weight': 600,
            'text-anchor': anchor,
          },
          `${planet.order} ${code}`
        )
      );

      const selectFromChart = () => {
        this.callbacks.onSelectPlanet?.(planet.id, { focus: true });
      };
      g.addEventListener('click', selectFromChart);
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectFromChart();
        }
      });

      svg.appendChild(g);
      this.keplerPoints.set(planet.id, g);

      // Build corresponding verification table row
      const tr = document.createElement('tr');
      tr.dataset.planetId = planet.id;

      const tdOrder = document.createElement('td');
      tdOrder.className = 'mono';
      tdOrder.textContent = `#${planet.order}`;

      const tdName = document.createElement('td');
      const nameWrap = document.createElement('span');
      nameWrap.className = 'kepler-planet-cell';
      const miniDot = document.createElement('span');
      miniDot.className = 'planet-dot';
      miniDot.style.width = '7px';
      miniDot.style.height = '7px';
      miniDot.style.backgroundColor = planet.color;
      miniDot.style.color = planet.color;
      nameWrap.append(miniDot, document.createTextNode(planet.name));
      tdName.appendChild(nameWrap);

      const tdA = document.createElement('td');
      tdA.className = 'num';
      tdA.textContent = planet.semiMajorAxisAU.toFixed(planet.semiMajorAxisAU < 10 ? 3 : 2);

      const tdT = document.createElement('td');
      tdT.className = 'num';
      tdT.textContent = planet.periodYears.toFixed(2);

      const tdRatio = document.createElement('td');
      tdRatio.className = 'num kepler-ratio-val';
      tdRatio.textContent = ratio.toFixed(4);

      tr.append(tdOrder, tdName, tdA, tdT, tdRatio);
      tr.addEventListener('click', selectFromChart);

      this.keplerTableRows.set(planet.id, tr);
      tableFragment.appendChild(tr);
    }

    this.els.keplerChartContainer.replaceChildren(svg);
    this.els.keplerTableBody.replaceChildren(tableFragment);
  }

  _bindEvents() {
    this.els.btnPlayPause.addEventListener('click', () => {
      this.callbacks.onTogglePlay?.();
    });

    this.els.btnReverse.addEventListener('click', () => {
      this.callbacks.onToggleDirection?.();
    });

    for (const btn of this.els.stepButtons) {
      btn.addEventListener('click', () => {
        const stepDays = Number(btn.dataset.stepDays);
        if (Number.isFinite(stepDays)) {
          this.callbacks.onStepDays?.(stepDays);
        }
      });
    }

    this.els.btnResetTime.addEventListener('click', () => {
      this.callbacks.onResetTime?.();
    });

    this.els.btnTogglePanel.addEventListener('click', () => {
      this.setPanelCollapsed(!this.panelCollapsed);
    });

    // Tabs
    this.els.tabPlanets.addEventListener('click', () => this.setActiveTab('planets'));
    this.els.tabKepler.addEventListener('click', () => this.setActiveTab('kepler'));
    this.els.btnOpenKeplerFooter.addEventListener('click', () => this.setActiveTab('kepler'));

    // Inspector actions
    this.els.btnCloseInspector.addEventListener('click', () => {
      this.callbacks.onSelectPlanet?.(null, { focus: false });
    });

    this.els.btnFollowPlanet.addEventListener('click', () => {
      this.callbacks.onToggleFollow?.();
    });

    this.els.btnCenterSun.addEventListener('click', () => {
      this.callbacks.onCenterSun?.();
    });

    // Speed slider (logarithmic)
    this.els.speedSlider.addEventListener('input', (e) => {
      const speed = speedFromSlider(e.target.value);
      this.callbacks.onSetSpeed?.(speed);
    });

    // Speed preset chips
    for (const btn of this.els.speedPresetButtons) {
      btn.addEventListener('click', () => {
        const speed = Number(btn.dataset.speed);
        if (Number.isFinite(speed)) {
          this.callbacks.onSetSpeed?.(speed);
        }
      });
    }

    // Scale mode segmented buttons
    for (const btn of this.els.scaleButtons) {
      btn.addEventListener('click', () => {
        this.callbacks.onSetScaleMode?.(btn.dataset.scale);
      });
    }

    // Start alignment segmented buttons
    for (const btn of this.els.startButtons) {
      btn.addEventListener('click', () => {
        this.callbacks.onSetStartMode?.(btn.dataset.start);
      });
    }

    // Camera view preset buttons
    for (const btn of this.els.viewButtons) {
      btn.addEventListener('click', () => {
        this.callbacks.onSetViewPreset?.(btn.dataset.view);
      });
    }

    this.els.btnResetView.addEventListener('click', () => {
      this.callbacks.onResetView?.();
    });

    // Overlay toggle chips
    for (const btn of this.els.overlayButtons) {
      btn.addEventListener('click', () => {
        this.callbacks.onToggleOverlay?.(btn.dataset.overlay);
      });
    }
  }

  _observeTopBarLayout() {
    const topBar = this.els.topBar;
    if (!topBar) return;

    const syncOffset = () => {
      const rect = topBar.getBoundingClientRect();
      if (rect.height > 0) {
        const offsetPx = Math.ceil(rect.bottom + 10);
        document.documentElement.style.setProperty('--top-bar-offset', `${offsetPx}px`);
      }
    };

    syncOffset();
    window.addEventListener('resize', syncOffset);
    if (typeof ResizeObserver === 'function') {
      this._topBarObserver = new ResizeObserver(syncOffset);
      this._topBarObserver.observe(topBar);
    }
  }

  setPanelCollapsed(collapsed) {
    this.panelCollapsed = Boolean(collapsed);
    this.els.hudRoot.classList.toggle('panel-collapsed', this.panelCollapsed);
    this.els.btnTogglePanel.setAttribute('aria-expanded', String(!this.panelCollapsed));
  }

  setActiveTab(tabName) {
    this.activeTab = tabName === 'kepler' ? 'kepler' : 'planets';
    const isPlanets = this.activeTab === 'planets';

    this.els.tabPlanets.classList.toggle('active', isPlanets);
    this.els.tabPlanets.setAttribute('aria-selected', String(isPlanets));
    this.els.viewPlanets.classList.toggle('hidden', !isPlanets);

    this.els.tabKepler.classList.toggle('active', !isPlanets);
    this.els.tabKepler.setAttribute('aria-selected', String(!isPlanets));
    this.els.viewKepler.classList.toggle('hidden', isPlanets);
  }

  syncControls(simState) {
    // Play/Pause button
    this.els.iconPlay.classList.toggle('hidden', simState.playing);
    this.els.iconPause.classList.toggle('hidden', !simState.playing);
    this.els.labelPlayPause.textContent = simState.playing ? 'Pause' : 'Play';

    // Reverse direction button
    const isReverse = simState.direction < 0;
    this.els.btnReverse.setAttribute('aria-pressed', String(isReverse));
    this.els.labelDirection.textContent = isReverse ? 'Rev' : 'Fwd';

    // Speed slider & readout
    const sliderVal = sliderFromSpeed(simState.daysPerSecond);
    if (document.activeElement !== this.els.speedSlider) {
      this.els.speedSlider.value = String(sliderVal);
    }
    this.els.speedReadout.textContent = formatSpeed(simState.daysPerSecond, simState.direction, false);

    // Top bar rate status
    if (simState.playing) {
      this.els.clockRate.textContent = formatSpeed(simState.daysPerSecond, simState.direction, true);
      this.els.clockRate.classList.remove('is-paused');
    } else {
      this.els.clockRate.textContent = 'Paused';
      this.els.clockRate.classList.add('is-paused');
    }

    // Highlight matching speed preset
    for (const btn of this.els.speedPresetButtons) {
      const presetVal = Number(btn.dataset.speed);
      const isMatch = Math.abs(simState.daysPerSecond - presetVal) / presetVal < 0.015;
      btn.classList.toggle('active', isMatch);
    }

    // Scale mode segmented buttons
    for (const btn of this.els.scaleButtons) {
      const active = btn.dataset.scale === simState.scaleMode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }

    // Start alignment segmented buttons
    for (const btn of this.els.startButtons) {
      const active = btn.dataset.start === simState.startMode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }

    // Camera view preset buttons
    for (const btn of this.els.viewButtons) {
      const active = btn.dataset.view === simState.viewPreset;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }

    // Visual overlays
    for (const btn of this.els.overlayButtons) {
      const key = btn.dataset.overlay;
      const active = Boolean(simState.overlays[key]);
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }

    // Selected planet highlights across telemetry list, Kepler chart, and Kepler table
    const selectedId = simState.selectedPlanetId;
    for (const [planetId, entry] of this.planetRows.entries()) {
      entry.rowEl.classList.toggle('selected', planetId === selectedId);
    }
    for (const [planetId, svgGroup] of this.keplerPoints.entries()) {
      svgGroup.classList.toggle('selected', planetId === selectedId);
    }
    for (const [planetId, tr] of this.keplerTableRows.entries()) {
      tr.classList.toggle('selected', planetId === selectedId);
    }

    // Follow button state when a planet is inspected
    if (selectedId && selectedId !== 'sun') {
      const isFollowing = simState.followTargetId === selectedId;
      this.els.btnFollowPlanet.classList.remove('hidden');
      this.els.btnFollowPlanet.textContent = isFollowing ? 'Following Orbit' : 'Follow Planet';
      this.els.btnFollowPlanet.setAttribute('aria-pressed', String(isFollowing));
    } else {
      this.els.btnFollowPlanet.classList.add('hidden');
    }
  }

  updateTelemetry(simState, planetStates, recentCompletions, nowMs) {
    // 1. Live Simulation Clock
    this.els.clockDays.textContent = formatElapsedDays(simState.elapsedDays);
    this.els.clockYears.textContent = formatElapsedYears(simState.elapsedDays);

    // 2. Live 8-Planet Telemetry Rows
    let selectedPlanetState = null;

    for (const state of planetStates) {
      const { planet } = state;
      const entry = this.planetRows.get(planet.id);
      if (entry) {
        entry.orbitsEl.textContent = formatOrbits(state.orbitsCompleted);
        const progress = clamp(state.phaseProgress, 0, 1);
        entry.progressFillEl.style.transform = `scaleX(${progress.toFixed(4)})`;

        const completionTs = recentCompletions.get(planet.id);
        const isPulsing = typeof completionTs === 'number' && nowMs - completionTs < COMPLETION_PULSE_MS;
        if (isPulsing !== entry.wasCompleted) {
          entry.rowEl.classList.toggle('orbit-completed', isPulsing);
          entry.wasCompleted = isPulsing;
        }
      }

      if (simState.selectedPlanetId === planet.id) {
        selectedPlanetState = state;
      }
    }

    // 3. Selected Body Inspector Card
    this._updateInspector(simState, selectedPlanetState);
  }

  _updateInspector(simState, selectedPlanetState) {
    const selectedId = simState.selectedPlanetId;

    if (!selectedId) {
      if (this.renderedInspectorId !== null) {
        this.els.inspectorCard.classList.add('hidden');
        this.renderedInspectorId = null;
        this.inspectorRefs = null;
      }
      return;
    }

    this.els.inspectorCard.classList.remove('hidden');

    if (selectedId === 'sun') {
      if (this.renderedInspectorId !== 'sun') {
        this._renderSunInspectorStructure();
        this.renderedInspectorId = 'sun';
      }
      if (this.inspectorRefs?.elapsedVal) {
        this.inspectorRefs.elapsedVal.textContent = formatElapsedYears(simState.elapsedDays);
        this.inspectorRefs.elapsedSub.textContent = formatElapsedDays(simState.elapsedDays);
      }
      return;
    }

    if (!selectedPlanetState) {
      return;
    }

    if (this.renderedInspectorId !== selectedId) {
      this._renderPlanetInspectorStructure(selectedPlanetState);
      this.renderedInspectorId = selectedId;
    }

    // Live per-frame text updates (zero DOM allocations)
    const refs = this.inspectorRefs;
    if (refs) {
      refs.distanceVal.textContent = `${selectedPlanetState.distanceAU.toFixed(4)} AU`;
      refs.speedVal.textContent = `${selectedPlanetState.speedKmS.toFixed(2)} km/s`;
      refs.orbitsVal.textContent = formatOrbits(selectedPlanetState.orbitsCompleted);
      refs.orbitsSub.textContent = `${(clamp(selectedPlanetState.phaseProgress, 0, 1) * 100).toFixed(1)}% of cycle`;
    }
  }

  _createMetricCell(label, initialValue, initialSub = '') {
    const cell = document.createElement('div');
    cell.className = 'metric-cell';

    const lbl = document.createElement('span');
    lbl.className = 'metric-cell-label';
    lbl.textContent = label;

    const val = document.createElement('span');
    val.className = 'metric-cell-value mono';
    val.textContent = initialValue;

    cell.append(lbl, val);

    let sub = null;
    if (initialSub !== null) {
      sub = document.createElement('span');
      sub.className = 'metric-cell-sub mono';
      sub.textContent = initialSub;
      if (!initialSub) {
        sub.classList.add('hidden');
      }
      cell.appendChild(sub);
    }

    return { cell, val, sub };
  }

  _renderSunInspectorStructure() {
    this.els.inspectorOrderBadge.textContent = 'Central Star';
    this.els.inspectorCategoryBadge.textContent = 'G2V Yellow Dwarf';
    this.els.inspectorDot.style.backgroundColor = SUN_DATA.color;
    this.els.inspectorDot.style.color = SUN_DATA.glowColor || SUN_DATA.color;
    this.els.inspectorName.textContent = SUN_DATA.name;
    this.els.inspectorDescription.textContent =
      SUN_DATA.description || 'The gravitational center of the Solar System holding all 8 planets in Keplerian orbit.';

    const radiusCell = this._createMetricCell(
      'Mean Radius',
      `${SUN_DATA.radiusKm.toLocaleString('en-US')} km`,
      '109.2 \u00d7 Earth'
    );
    const planetsCell = this._createMetricCell('Major Planets', '8 Worlds', 'Mercury \u2192 Neptune');
    const unitCell = this._createMetricCell('Astronomical Unit', '1.000 AU', '149.6M km (Earth avg)');
    const elapsedCell = this._createMetricCell('System Clock', '0.000 yr', '0.00 d');
    elapsedCell.sub.classList.remove('hidden');

    this.els.inspectorMetrics.replaceChildren(
      radiusCell.cell,
      planetsCell.cell,
      unitCell.cell,
      elapsedCell.cell
    );

    this.els.inspectorKeplerStrip.textContent = 'Solar Mass Reference: T\u00b2 / a\u00b3 = 1.0000 yr\u00b2/AU\u00b3';
    this.els.btnFollowPlanet.classList.add('hidden');

    this.inspectorRefs = {
      elapsedVal: elapsedCell.val,
      elapsedSub: elapsedCell.sub,
    };
  }

  _renderPlanetInspectorStructure(state) {
    const { planet } = state;
    const ratio = getKeplerRatio(planet, state);

    this.els.inspectorOrderBadge.textContent = `#${planet.order} from Sun`;
    this.els.inspectorCategoryBadge.textContent = planet.category;
    this.els.inspectorDot.style.backgroundColor = planet.color;
    this.els.inspectorDot.style.color = planet.color;
    this.els.inspectorName.textContent = planet.name;
    this.els.inspectorDescription.textContent = planet.description || '';

    const distCell = this._createMetricCell('Distance r', `${state.distanceAU.toFixed(4)} AU`, null);
    const speedCell = this._createMetricCell('Speed v', `${state.speedKmS.toFixed(2)} km/s`, `mean ${planet.meanSpeedKmS.toFixed(2)}`);
    const periodCell = this._createMetricCell(
      'Period T',
      `${formatPeriodDays(planet.periodDays)} d`,
      `${planet.periodYears.toFixed(2)} Earth yr`
    );
    const ratioCell = this._createMetricCell(
      'Period Ratio',
      `${planet.periodYears.toFixed(3)} \u00d7 T\u2295`,
      `a = ${planet.semiMajorAxisAU.toFixed(3)} AU`
    );
    const eccCell = this._createMetricCell('Eccentricity e', planet.eccentricity.toFixed(4), null);
    const incCell = this._createMetricCell('Inclination i', `${planet.inclinationDeg.toFixed(2)}\u00b0`, null);
    const orbitsCell = this._createMetricCell('Revolutions', formatOrbits(state.orbitsCompleted), '0.0% of cycle');
    orbitsCell.sub.classList.remove('hidden');
    const radiusCell = this._createMetricCell(
      'Mean Radius',
      `${Math.round(planet.radiusKm).toLocaleString('en-US')} km`,
      `tilt ${planet.axialTiltDeg.toFixed(1)}\u00b0`
    );

    this.els.inspectorMetrics.replaceChildren(
      distCell.cell,
      speedCell.cell,
      periodCell.cell,
      ratioCell.cell,
      eccCell.cell,
      incCell.cell,
      orbitsCell.cell,
      radiusCell.cell
    );

    this.els.inspectorKeplerStrip.textContent = `Kepler\u2019s 3rd Law: T\u00b2 / a\u00b3 = ${ratio.toFixed(4)}`;

    this.inspectorRefs = {
      distanceVal: distCell.val,
      speedVal: speedCell.val,
      orbitsVal: orbitsCell.val,
      orbitsSub: orbitsCell.sub,
    };
  }
}
