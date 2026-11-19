/**
 * Keplerian 3D orbital mechanics engine for the Solar System simulation.
 * Pure browser-compatible ES Module with zero external dependencies.
 */

import { PLANETS } from '../data/planets.js';

export const AU_KM = 149597870.7;
export const MU_SUN_KM3_S2 = 1.32712440018e11;

const DEG_TO_RAD = Math.PI / 180;
const TWO_PI = Math.PI * 2;
const VIS_VIVA_SCALE = MU_SUN_KM3_S2 / AU_KM; // (km/s)^2 * AU

/**
 * Normalizes an angle in radians to [-Math.PI, Math.PI].
 * Preserves values already in [-Math.PI, Math.PI] and cleans -0 to 0.
 *
 * @param {number} rad
 * @returns {number}
 */
function normalizeSignedAngle(rad) {
  if (rad >= -Math.PI && rad <= Math.PI) {
    return rad === 0 ? 0 : rad;
  }
  let normalized = (((rad + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI - Math.PI;
  if (normalized === -Math.PI && rad > 0) {
    normalized = Math.PI;
  }
  return normalized === 0 ? 0 : normalized;
}

/**
 * Eliminates signed negative zero (-0) for clean numeric comparisons and display.
 *
 * @param {number} value
 * @returns {number}
 */
function cleanZero(value) {
  return value === 0 ? 0 : value;
}

/**
 * Solves Kepler's equation M = E - e * sin(E) for eccentric anomaly E (radians)
 * using Newton-Raphson iteration after normalizing M safely to [-pi, pi].
 *
 * @param {number} meanAnomalyRad - Mean anomaly M in radians (any real number)
 * @param {number} eccentricity - Orbital eccentricity e in [0, 1)
 * @param {number} [tolerance=1e-12] - Convergence tolerance on |E - e*sin(E) - M_norm|
 * @param {number} [maxIter=50] - Maximum Newton-Raphson iterations
 * @returns {number} Eccentric anomaly E in radians
 */
export function solveKepler(meanAnomalyRad, eccentricity, tolerance = 1e-12, maxIter = 50) {
  const M = normalizeSignedAngle(meanAnomalyRad);
  if (eccentricity === 0) {
    return M;
  }

  let E =
    eccentricity < 0.8
      ? M + eccentricity * Math.sin(M) + 0.5 * eccentricity * eccentricity * Math.sin(2 * M)
      : M < 0
        ? -Math.PI
        : Math.PI;

  for (let i = 0; i < maxIter; i++) {
    const f = E - eccentricity * Math.sin(E) - M;
    if (Math.abs(f) < tolerance) {
      return cleanZero(E);
    }
    const fPrime = 1 - eccentricity * Math.cos(E);
    const delta = f / fPrime;
    E -= delta;
    if (
      Math.abs(delta) < tolerance * 0.5 &&
      Math.abs(E - eccentricity * Math.sin(E) - M) < tolerance
    ) {
      return cleanZero(E);
    }
  }

  return cleanZero(E);
}

/**
 * Maps a heliocentric distance in AU into scene radius units.
 *
 * - 'true': 1:1 AU mapping (1 scene unit = 1 AU).
 * - 'compressed': strictly monotonic smooth transform (f(0) = 0, f'(au) > 0 for all au > 0)
 *   mapping Mercury (0.387 AU -> ~1.57) well clear of the Sun, giving unmistakable spacing
 *   for the Asteroid Belt between Mars (1.52 AU -> ~3.77) and Jupiter (5.20 AU -> ~6.65),
 *   and fitting Neptune (30.11 AU -> ~11.81) comfortably within ~12 scene units.
 *
 * @param {number} au - Heliocentric distance in Astronomical Units
 * @param {'compressed' | 'true'} [scaleMode='compressed']
 * @returns {number}
 */
export function mapDistanceToScene(au, scaleMode = 'compressed') {
  if (au <= 0) {
    return 0;
  }
  if (scaleMode === 'true') {
    return au;
  }
  return 2.5 * Math.log1p(1.9 * au) + 0.3 * Math.sqrt(au);
}

/**
 * Resolves orbital orientation angles and initial mean anomaly for the requested startMode.
 *
 * @param {object} planet
 * @param {'aligned' | 'j2000'} startMode
 * @returns {{ m0Rad: number, omegaRad: number, ascNodeRad: number, incRad: number }}
 */
function getOrbitalAngles(planet, startMode) {
  const incRad = planet.inclinationDeg * DEG_TO_RAD;
  if (startMode === 'j2000') {
    const m0Deg =
      planet.meanLongitudeJ2000Deg - (planet.ascendingNodeDeg + planet.argPerihelionDeg);
    return {
      m0Rad: m0Deg * DEG_TO_RAD,
      omegaRad: planet.argPerihelionDeg * DEG_TO_RAD,
      ascNodeRad: planet.ascendingNodeDeg * DEG_TO_RAD,
      incRad,
    };
  }
  return {
    m0Rad: 0,
    omegaRad: 0,
    ascNodeRad: 0,
    incRad,
  };
}

/**
 * Computes heliocentric 3D ecliptic coordinates (AU and scene units) from eccentric anomaly E.
 * Shared by both getPlanetState and getOrbitPathPoints so planets sit exactly on their drawn orbits.
 *
 * @param {object} planet
 * @param {number} eccentricAnomalyRad
 * @param {{ omegaRad: number, ascNodeRad: number, incRad: number }} angles
 * @param {'compressed' | 'true'} scaleMode
 * @returns {{ distanceAU: number, positionAU: {x:number,y:number,z:number}, scenePosition: {x:number,y:number,z:number} }}
 */
function computePositionFromEccentricAnomaly(planet, eccentricAnomalyRad, angles, scaleMode) {
  const a = planet.semiMajorAxisAU;
  const e = planet.eccentricity;
  const cosE = Math.cos(eccentricAnomalyRad);
  const sinE = Math.sin(eccentricAnomalyRad);

  // Perifocal (orbital plane) coordinates: perihelion on +X, counter-clockwise (+X -> +Y)
  const xOrb = a * (cosE - e);
  const yOrb = a * Math.sqrt(1 - e * e) * sinE;
  const distanceAU = a * (1 - e * cosE);

  // Apply 3D Euler rotation R_z(Omega) * R_x(i) * R_z(omega)
  const cosW = Math.cos(angles.omegaRad);
  const sinW = Math.sin(angles.omegaRad);
  const cosI = Math.cos(angles.incRad);
  const sinI = Math.sin(angles.incRad);
  const cosO = Math.cos(angles.ascNodeRad);
  const sinO = Math.sin(angles.ascNodeRad);

  const x1 = xOrb * cosW - yOrb * sinW;
  const y1 = xOrb * sinW + yOrb * cosW;

  const y2 = y1 * cosI;
  const z2 = y1 * sinI;

  const positionAU = {
    x: cleanZero(x1 * cosO - y2 * sinO),
    y: cleanZero(x1 * sinO + y2 * cosO),
    z: cleanZero(z2),
  };

  const sceneRadius = mapDistanceToScene(distanceAU, scaleMode);
  const radialScale = distanceAU > 0 ? sceneRadius / distanceAU : 0;

  const scenePosition = {
    x: cleanZero(positionAU.x * radialScale),
    y: cleanZero(positionAU.y * radialScale),
    z: cleanZero(positionAU.z * radialScale),
  };

  return { distanceAU, positionAU, scenePosition };
}

/**
 * Computes full orbital kinematics and 3D coordinates for a single planet at elapsedDays.
 *
 * @param {object} planet - Planet catalog entry from PLANETS
 * @param {number} elapsedDays - Elapsed simulation time in Earth days
 * @param {object} [options={}]
 * @param {'aligned' | 'j2000'} [options.startMode='aligned']
 * @param {'compressed' | 'true'} [options.scaleMode='compressed']
 * @returns {object} Complete orbital state snapshot
 */
export function getPlanetState(planet, elapsedDays, options = {}) {
  const { startMode = 'aligned', scaleMode = 'compressed' } = options;

  const orbitsCompleted = cleanZero(elapsedDays / planet.periodDays);
  const wholeOrbits = Math.floor(Math.abs(orbitsCompleted));
  let phaseProgress = ((orbitsCompleted % 1) + 1) % 1;
  if (phaseProgress >= 1 || phaseProgress === 0) {
    phaseProgress = 0;
  }

  const angles = getOrbitalAngles(planet, startMode);
  const meanAnomalyRad = normalizeSignedAngle(angles.m0Rad + TWO_PI * phaseProgress);
  const eccentricAnomalyRad = solveKepler(meanAnomalyRad, planet.eccentricity);

  const e = planet.eccentricity;
  const a = planet.semiMajorAxisAU;
  const trueAnomalyRad = cleanZero(
    Math.atan2(
      Math.sqrt(1 - e * e) * Math.sin(eccentricAnomalyRad),
      Math.cos(eccentricAnomalyRad) - e
    )
  );

  const { distanceAU, positionAU, scenePosition } = computePositionFromEccentricAnomaly(
    planet,
    eccentricAnomalyRad,
    angles,
    scaleMode
  );

  // Instantaneous orbital speed via the vis-viva equation: v = sqrt(GM_sun * (2/r - 1/a))
  const speedKmS = Math.sqrt(VIS_VIVA_SCALE * (2 / distanceAU - 1 / a));
  const keplerRatio = (planet.periodYears * planet.periodYears) / (a * a * a);

  return {
    planet,
    elapsedDays,
    orbitsCompleted,
    wholeOrbits,
    phaseProgress,
    meanAnomalyRad,
    eccentricAnomalyRad,
    trueAnomalyRad,
    distanceAU,
    speedKmS,
    keplerRatio,
    positionAU,
    scenePosition,
  };
}

/**
 * Samples a closed 3D orbital ellipse path for a planet using the exact same projection,
 * inclination rotation, and distance scaling as getPlanetState.
 *
 * @param {object} planet - Planet catalog entry from PLANETS
 * @param {object} [options={}]
 * @param {'aligned' | 'j2000'} [options.startMode='aligned']
 * @param {'compressed' | 'true'} [options.scaleMode='compressed']
 * @param {number} [options.segments=180]
 * @returns {Array<{ x: number, y: number, z: number, au: { x: number, y: number, z: number } }>}
 */
export function getOrbitPathPoints(planet, options = {}) {
  const { startMode = 'aligned', scaleMode = 'compressed', segments = 180 } = options;
  const stepCount = Math.max(3, Math.floor(segments));
  const angles = getOrbitalAngles(planet, startMode);
  const points = new Array(stepCount + 1);

  for (let i = 0; i <= stepCount; i++) {
    const E = i === stepCount ? 0 : (TWO_PI * i) / stepCount;
    const { positionAU, scenePosition } = computePositionFromEccentricAnomaly(
      planet,
      E,
      angles,
      scaleMode
    );
    points[i] = {
      x: scenePosition.x,
      y: scenePosition.y,
      z: scenePosition.z,
      au: positionAU,
    };
  }

  return points;
}

/**
 * Computes orbital states for all 8 planets in strict order (#1 Mercury through #8 Neptune).
 *
 * @param {number} elapsedDays
 * @param {object} [options={}]
 * @param {'aligned' | 'j2000'} [options.startMode='aligned']
 * @param {'compressed' | 'true'} [options.scaleMode='compressed']
 * @returns {Array<object>}
 */
export function getAllPlanetStates(elapsedDays, options = {}) {
  return PLANETS.map((planet) => getPlanetState(planet, elapsedDays, options));
}
