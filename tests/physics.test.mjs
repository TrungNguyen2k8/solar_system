import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EARTH_YEAR_DAYS, SUN_DATA, PLANETS } from '../src/data/planets.js';
import {
  AU_KM,
  MU_SUN_KM3_S2,
  solveKepler,
  mapDistanceToScene,
  getPlanetState,
  getOrbitPathPoints,
  getAllPlanetStates,
} from '../src/physics/kepler.js';

const TWO_PI = Math.PI * 2;

function vecNorm(v) {
  return Math.hypot(v.x, v.y, v.z);
}

function vecDist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function normalizeSignedAngleRef(rad) {
  if (rad >= -Math.PI && rad <= Math.PI) {
    return rad === 0 ? 0 : rad;
  }
  let m = (((rad + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI - Math.PI;
  if (m === -Math.PI && rad > 0) {
    m = Math.PI;
  }
  return m === 0 ? 0 : m;
}

describe('Planetary Data Catalog (src/data/planets.js)', () => {
  it('exports EARTH_YEAR_DAYS and SUN_DATA matching contract', () => {
    assert.equal(EARTH_YEAR_DAYS, 365.256);
    assert.equal(SUN_DATA.id, 'sun');
    assert.equal(SUN_DATA.name, 'Sun');
    assert.equal(SUN_DATA.radiusKm, 696340);
    assert.equal(SUN_DATA.color, '#FDB813');
    assert.equal(SUN_DATA.glowColor, '#FF8C00');
    assert.equal(typeof SUN_DATA.description, 'string');
    assert.ok(SUN_DATA.description.length > 20);
  });

  it('contains all 8 planets in exact order #1 Mercury through #8 Neptune', () => {
    assert.equal(PLANETS.length, 8);
    const expected = [
      { order: 1, id: 'mercury', name: 'Mercury', category: 'Terrestrial' },
      { order: 2, id: 'venus', name: 'Venus', category: 'Terrestrial' },
      { order: 3, id: 'earth', name: 'Earth', category: 'Terrestrial' },
      { order: 4, id: 'mars', name: 'Mars', category: 'Terrestrial' },
      { order: 5, id: 'jupiter', name: 'Jupiter', category: 'Gas Giant' },
      { order: 6, id: 'saturn', name: 'Saturn', category: 'Gas Giant' },
      { order: 7, id: 'uranus', name: 'Uranus', category: 'Ice Giant' },
      { order: 8, id: 'neptune', name: 'Neptune', category: 'Ice Giant' },
    ];

    for (let i = 0; i < expected.length; i++) {
      const p = PLANETS[i];
      const exp = expected[i];
      assert.equal(p.order, exp.order);
      assert.equal(p.id, exp.id);
      assert.equal(p.name, exp.name);
      assert.equal(p.category, exp.category);
      assert.equal(typeof p.description, 'string');
      assert.ok(p.description.length > 20);
      assert.equal(typeof p.semiMajorAxisAU, 'number');
      assert.equal(typeof p.eccentricity, 'number');
      assert.equal(typeof p.periodDays, 'number');
      assert.equal(typeof p.periodYears, 'number');
      assert.equal(typeof p.inclinationDeg, 'number');
      assert.equal(typeof p.ascendingNodeDeg, 'number');
      assert.equal(typeof p.argPerihelionDeg, 'number');
      assert.equal(typeof p.meanLongitudeJ2000Deg, 'number');
      assert.equal(typeof p.meanSpeedKmS, 'number');
      assert.equal(typeof p.radiusKm, 'number');
      assert.equal(typeof p.axialTiltDeg, 'number');
      assert.equal(typeof p.visualRadiusPx, 'number');
      assert.equal(typeof p.color, 'string');
      assert.equal(typeof p.accentColor, 'string');
      assert.equal(typeof p.orbitColor, 'string');
      assert.equal(typeof p.hasRings, 'boolean');
    }

    assert.equal(PLANETS[5].hasRings, true);
    assert.deepEqual(PLANETS[5].ringSpec, {
      innerFactor: 1.38,
      outerFactor: 2.35,
      color: '#D8C39A',
      opacity: 0.72,
    });
    assert.equal(PLANETS[6].hasRings, true);
    assert.deepEqual(PLANETS[6].ringSpec, {
      innerFactor: 1.45,
      outerFactor: 1.85,
      color: '#A6DCE6',
      opacity: 0.32,
    });
    for (const idx of [0, 1, 2, 3, 4, 7]) {
      assert.equal(PLANETS[idx].hasRings, false);
      assert.equal(PLANETS[idx].ringSpec, null);
    }
  });

  it('has strictly increasing semi-major axis a, orbital period T, and non-overlapping radial bands', () => {
    for (let i = 1; i < PLANETS.length; i++) {
      const prev = PLANETS[i - 1];
      const curr = PLANETS[i];

      assert.ok(
        curr.semiMajorAxisAU > prev.semiMajorAxisAU,
        `${curr.name} a should exceed ${prev.name} a`
      );
      assert.ok(
        curr.periodDays > prev.periodDays,
        `${curr.name} periodDays should exceed ${prev.name} periodDays`
      );
      assert.ok(
        curr.periodYears > prev.periodYears,
        `${curr.name} periodYears should exceed ${prev.name} periodYears`
      );
      assert.ok(
        curr.meanSpeedKmS < prev.meanSpeedKmS,
        `${curr.name} meanSpeedKmS should be slower than ${prev.name}`
      );

      const prevAphelion = prev.semiMajorAxisAU * (1 + prev.eccentricity);
      const currPerihelion = curr.semiMajorAxisAU * (1 - curr.eccentricity);
      assert.ok(
        currPerihelion > prevAphelion,
        `${curr.name} perihelion (${currPerihelion}) should exceed ${prev.name} aphelion (${prevAphelion})`
      );
    }
  });
});

describe('Kepler Equation Solver (solveKepler)', () => {
  it('converges to < 1e-11 residual across all planetary eccentricities and extreme angles', () => {
    const eccentricities = [0, ...PLANETS.map((p) => p.eccentricity), 0.5, 0.85, 0.98];
    const testAngles = [
      -100 * Math.PI,
      -17.345,
      -Math.PI,
      -Math.PI / 2,
      -1e-6,
      0,
      1e-6,
      0.5,
      Math.PI / 3,
      Math.PI / 2,
      2.5,
      Math.PI - 1e-7,
      Math.PI,
      TWO_PI,
      123.456,
      1000 * Math.PI + 0.789,
    ];

    for (const e of eccentricities) {
      for (const M of testAngles) {
        const E = solveKepler(M, e);
        const mNorm = normalizeSignedAngleRef(M);
        const residual = Math.abs(E - e * Math.sin(E) - mNorm);
        assert.ok(
          residual < 1e-11,
          `solveKepler failed for e=${e}, M=${M}: residual=${residual}`
        );
      }
    }
  });

  it('returns exact boundary roots at M = 0 and M = ±pi', () => {
    for (const p of PLANETS) {
      assert.equal(solveKepler(0, p.eccentricity), 0);
      assert.ok(Math.abs(solveKepler(Math.PI, p.eccentricity) - Math.PI) < 1e-12);
      assert.ok(Math.abs(solveKepler(-Math.PI, p.eccentricity) + Math.PI) < 1e-12);
      assert.equal(solveKepler(TWO_PI, p.eccentricity), 0);
    }
  });
});

describe('Orbital Period Closure & Revolution Counts', () => {
  it('closes every planet orbit within 1e-9 AU after 1T, 5T, -1T, and arbitrary phase shifts', () => {
    for (const startMode of ['aligned', 'j2000']) {
      for (const planet of PLANETS) {
        const s0 = getPlanetState(planet, 0, { startMode, scaleMode: 'true' });
        const s1 = getPlanetState(planet, planet.periodDays, { startMode, scaleMode: 'true' });
        const s5 = getPlanetState(planet, 5 * planet.periodDays, { startMode, scaleMode: 'true' });
        const sNeg = getPlanetState(planet, -planet.periodDays, { startMode, scaleMode: 'true' });

        assert.ok(
          vecDist(s0.positionAU, s1.positionAU) < 1e-9,
          `${planet.name} (${startMode}) did not close at 1T`
        );
        assert.ok(
          vecDist(s0.positionAU, s5.positionAU) < 1e-9,
          `${planet.name} (${startMode}) did not close at 5T`
        );
        assert.ok(
          vecDist(s0.positionAU, sNeg.positionAU) < 1e-9,
          `${planet.name} (${startMode}) did not close at -1T`
        );

        const sPhaseA = getPlanetState(planet, 0.37 * planet.periodDays, { startMode });
        const sPhaseB = getPlanetState(planet, 1.37 * planet.periodDays, { startMode });
        assert.ok(
          vecDist(sPhaseA.positionAU, sPhaseB.positionAU) < 1e-9,
          `${planet.name} (${startMode}) phase closure failed`
        );
      }
    }
  });

  it('computes exact revolution counts at t = 365.256 days (1 Earth Year) and outer planet periods', () => {
    const states1Yr = getAllPlanetStates(EARTH_YEAR_DAYS);
    const byId = Object.fromEntries(states1Yr.map((s) => [s.planet.id, s]));

    assert.equal(byId.earth.orbitsCompleted, 1);
    assert.equal(byId.earth.wholeOrbits, 1);
    assert.equal(byId.earth.phaseProgress, 0);

    assert.ok(Math.abs(byId.mercury.orbitsCompleted - 365.256 / 87.9691) < 1e-12);
    assert.ok(Math.abs(byId.mercury.orbitsCompleted - 4.152094) < 1e-5);
    assert.equal(byId.mercury.wholeOrbits, 4);

    assert.ok(Math.abs(byId.venus.orbitsCompleted - 365.256 / 224.701) < 1e-12);
    assert.ok(Math.abs(byId.venus.orbitsCompleted - 1.62552) < 1e-5);
    assert.equal(byId.venus.wholeOrbits, 1);

    assert.ok(Math.abs(byId.mars.orbitsCompleted - 365.256 / 686.98) < 1e-12);
    assert.ok(Math.abs(byId.mars.orbitsCompleted - 0.531684) < 1e-5);
    assert.equal(byId.mars.wholeOrbits, 0);

    assert.ok(Math.abs(byId.jupiter.orbitsCompleted - 365.256 / 4332.589) < 1e-12);
    assert.ok(Math.abs(byId.saturn.orbitsCompleted - 365.256 / 10759.22) < 1e-12);
    assert.ok(Math.abs(byId.uranus.orbitsCompleted - 365.256 / 30688.5) < 1e-12);
    assert.ok(Math.abs(byId.neptune.orbitsCompleted - 365.256 / 60182.0) < 1e-12);

    // Exact outer planet single-orbit checks
    const jupiter1 = getPlanetState(PLANETS[4], 4332.589);
    assert.equal(jupiter1.orbitsCompleted, 1);
    assert.equal(jupiter1.wholeOrbits, 1);
    assert.equal(jupiter1.phaseProgress, 0);

    const neptune1 = getPlanetState(PLANETS[7], 60182.0);
    assert.equal(neptune1.orbitsCompleted, 1);
    assert.equal(neptune1.wholeOrbits, 1);
    assert.equal(neptune1.phaseProgress, 0);

    // Negative time handling
    const earthNeg = getPlanetState(PLANETS[2], -0.25 * EARTH_YEAR_DAYS);
    assert.equal(earthNeg.orbitsCompleted, -0.25);
    assert.equal(earthNeg.wholeOrbits, 0);
    assert.ok(Math.abs(earthNeg.phaseProgress - 0.75) < 1e-12);
  });
});

describe("Kepler's 2nd and 3rd Laws", () => {
  it("satisfies Kepler's 2nd Law: perihelion speed > aphelion speed and conserved specific angular momentum", () => {
    assert.equal(AU_KM, 149597870.7);
    assert.equal(MU_SUN_KM3_S2, 1.32712440018e11);

    for (const planet of PLANETS) {
      const peri = getPlanetState(planet, 0, { startMode: 'aligned' });
      const aph = getPlanetState(planet, planet.periodDays / 2, { startMode: 'aligned' });

      const expectedPeriR = planet.semiMajorAxisAU * (1 - planet.eccentricity);
      const expectedAphR = planet.semiMajorAxisAU * (1 + planet.eccentricity);

      assert.ok(Math.abs(peri.distanceAU - expectedPeriR) < 1e-12);
      assert.ok(Math.abs(aph.distanceAU - expectedAphR) < 1e-12);

      // Faster at perihelion than aphelion
      assert.ok(
        peri.speedKmS > aph.speedKmS,
        `${planet.name}: expected v_peri (${peri.speedKmS}) > v_aph (${aph.speedKmS})`
      );

      // Specific angular momentum h = r * v is identical at apsides (Kepler's 2nd Law)
      const hPeri = peri.distanceAU * peri.speedKmS;
      const hAph = aph.distanceAU * aph.speedKmS;
      assert.ok(
        Math.abs(hPeri - hAph) < 1e-9,
        `${planet.name}: angular momentum mismatch hPeri=${hPeri}, hAph=${hAph}`
      );
    }

    // Spot-check Mercury's notable eccentricity speed swing (NASA: ~58.98 km/s vs ~38.86 km/s)
    const mercuryPeri = getPlanetState(PLANETS[0], 0, { startMode: 'aligned' });
    const mercuryAph = getPlanetState(PLANETS[0], PLANETS[0].periodDays / 2, {
      startMode: 'aligned',
    });
    assert.ok(Math.abs(mercuryPeri.speedKmS - 58.98) < 0.05);
    assert.ok(Math.abs(mercuryAph.speedKmS - 38.86) < 0.05);
    assert.ok(mercuryPeri.speedKmS / mercuryAph.speedKmS > 1.5);

    // Spot-check Mars eccentricity speed swing (NASA: ~26.50 km/s vs ~21.97 km/s)
    const marsPeri = getPlanetState(PLANETS[3], 0, { startMode: 'aligned' });
    const marsAph = getPlanetState(PLANETS[3], PLANETS[3].periodDays / 2, {
      startMode: 'aligned',
    });
    assert.ok(Math.abs(marsPeri.speedKmS - 26.5) < 0.05);
    assert.ok(Math.abs(marsAph.speedKmS - 21.97) < 0.05);
  });

  it("satisfies Kepler's 3rd Law: T_yr^2 / a^3 ≈ 1.0 across all 8 planets", () => {
    for (const planet of PLANETS) {
      const state = getPlanetState(planet, 0);
      const expectedRatio = planet.periodYears ** 2 / planet.semiMajorAxisAU ** 3;
      assert.ok(Math.abs(state.keplerRatio - expectedRatio) < 1e-12);

      // Note: Saturn's NASA Fact Sheet J2000 osculating a = 9.5826 AU vs mean sidereal T = 10759.22 d
      // gives T^2 / a^3 = 0.9861 (1.39% deviation due to Jupiter's secular/short-period perturbation).
      // All other 7 planets are well within 1% of 1.0.
      const maxRelErr = planet.id === 'saturn' ? 0.015 : 0.01;
      assert.ok(
        Math.abs(state.keplerRatio - 1.0) < maxRelErr,
        `${planet.name} Kepler 3rd law ratio ${state.keplerRatio.toFixed(6)} exceeded ${maxRelErr}`
      );
    }
  });
});

describe('Scale Modes, Start Alignment Modes & Orbit Path Consistency', () => {
  it('maps distances monotonically in both true and compressed scale modes with clear asteroid belt spacing', () => {
    assert.equal(mapDistanceToScene(0, 'true'), 0);
    assert.equal(mapDistanceToScene(0, 'compressed'), 0);

    const sampleAUs = [0, 0.1, 0.307, 0.387098, 0.723332, 1.0, 1.523679, 2.2, 3.2, 5.2044, 9.5826, 19.2184, 30.1104, 40];
    for (const mode of ['true', 'compressed']) {
      for (let i = 1; i < sampleAUs.length; i++) {
        const prev = mapDistanceToScene(sampleAUs[i - 1], mode);
        const curr = mapDistanceToScene(sampleAUs[i], mode);
        assert.ok(
          curr > prev,
          `mapDistanceToScene not strictly increasing in ${mode} mode at ${sampleAUs[i]}`
        );
      }
    }

    // True scale is 1:1
    assert.equal(mapDistanceToScene(1.0, 'true'), 1.0);
    assert.equal(mapDistanceToScene(30.1104, 'true'), 30.1104);

    // Compressed scale framing & asteroid belt corridor
    const mercuryScene = mapDistanceToScene(PLANETS[0].semiMajorAxisAU, 'compressed');
    const neptuneScene = mapDistanceToScene(PLANETS[7].semiMajorAxisAU, 'compressed');
    assert.ok(mercuryScene > 1.2 && mercuryScene < 2.0, `Mercury scene radius=${mercuryScene}`);
    assert.ok(neptuneScene > 10.5 && neptuneScene < 12.5, `Neptune scene radius=${neptuneScene}`);

    const marsAphScene = mapDistanceToScene(
      PLANETS[3].semiMajorAxisAU * (1 + PLANETS[3].eccentricity),
      'compressed'
    );
    const beltInnerScene = mapDistanceToScene(2.2, 'compressed');
    const beltOuterScene = mapDistanceToScene(3.2, 'compressed');
    const jupiterPeriScene = mapDistanceToScene(
      PLANETS[4].semiMajorAxisAU * (1 - PLANETS[4].eccentricity),
      'compressed'
    );

    assert.ok(marsAphScene < beltInnerScene);
    assert.ok(beltInnerScene < beltOuterScene);
    assert.ok(beltOuterScene < jupiterPeriScene);
    assert.ok(jupiterPeriScene - marsAphScene > 2.0, 'Expected unmistakable Mars-Jupiter gap');
  });

  it('places all 8 planets on +X axis at t = 0 in aligned mode with strictly increasing X and CCW motion', () => {
    for (const scaleMode of ['compressed', 'true']) {
      const states0 = getAllPlanetStates(0, { startMode: 'aligned', scaleMode });
      assert.equal(states0.length, 8);

      let prevAuX = 0;
      let prevSceneX = 0;
      for (const s of states0) {
        assert.equal(s.positionAU.y, 0, `${s.planet.name} y should be 0 at t=0`);
        assert.equal(s.positionAU.z, 0, `${s.planet.name} z should be 0 at t=0`);
        assert.equal(s.scenePosition.y, 0, `${s.planet.name} scene y should be 0 at t=0`);
        assert.equal(s.scenePosition.z, 0, `${s.planet.name} scene z should be 0 at t=0`);
        assert.ok(s.positionAU.x > prevAuX, `${s.planet.name} AU x not strictly increasing`);
        assert.ok(s.scenePosition.x > prevSceneX, `${s.planet.name} scene x not strictly increasing`);
        prevAuX = s.positionAU.x;
        prevSceneX = s.scenePosition.x;
      }

      // Check counter-clockwise (+X -> +Y) motion and inclination lift
      const statesEarly = getAllPlanetStates(1, { startMode: 'aligned', scaleMode });
      for (const s of statesEarly) {
        assert.ok(s.positionAU.y > 0, `${s.planet.name} should orbit CCW (+Y)`);
        if (s.planet.inclinationDeg > 0) {
          assert.ok(s.positionAU.z > 0, `${s.planet.name} inclined orbit should lift in +Z`);
        } else {
          assert.equal(s.positionAU.z, 0, 'Earth lies in the ecliptic plane (z = 0)');
        }
      }
    }
  });

  it('preserves radial norm, 3D inclination, and strict planetary ordering in j2000 mode', () => {
    for (const scaleMode of ['compressed', 'true']) {
      for (const t of [0, 180, 1500, 12345]) {
        const states = getAllPlanetStates(t, { startMode: 'j2000', scaleMode });
        let prevAU = 0;
        let prevScene = 0;

        for (const s of states) {
          const rAU = vecNorm(s.positionAU);
          const rScene = vecNorm(s.scenePosition);
          assert.ok(Math.abs(rAU - s.distanceAU) < 1e-11);
          assert.ok(Math.abs(rScene - mapDistanceToScene(s.distanceAU, scaleMode)) < 1e-11);

          assert.ok(rAU > prevAU, `AU ordering broken at t=${t} for ${s.planet.name}`);
          assert.ok(rScene > prevScene, `Scene ordering broken at t=${t} for ${s.planet.name}`);
          prevAU = rAU;
          prevScene = rScene;
        }
      }
    }

    // Verify Earth stays in the ecliptic plane (z=0) and near J2000 longitude ~100.46 deg
    const earthJ2000 = getPlanetState(PLANETS[2], 0, { startMode: 'j2000', scaleMode: 'true' });
    assert.equal(earthJ2000.positionAU.z, 0);
    const lonDeg = (Math.atan2(earthJ2000.positionAU.y, earthJ2000.positionAU.x) * 180) / Math.PI;
    assert.ok(Math.abs(lonDeg - 100.464) < 0.2, `Earth J2000 longitude=${lonDeg}`);
  });

  it('generates closed orbit paths matching getPlanetState positions identically', () => {
    for (const startMode of ['aligned', 'j2000']) {
      for (const scaleMode of ['compressed', 'true']) {
        for (const planet of PLANETS) {
          const segments = 180;
          const pts = getOrbitPathPoints(planet, { startMode, scaleMode, segments });
          assert.equal(pts.length, segments + 1);

          // Exact loop closure
          assert.deepEqual(pts[0], pts[segments]);

          // In aligned mode, perihelion (E = 0, pts[0]) matches t = 0 state identically
          if (startMode === 'aligned') {
            const s0 = getPlanetState(planet, 0, { startMode, scaleMode });
            assert.ok(vecDist(pts[0], s0.scenePosition) < 1e-12);
            assert.ok(vecDist(pts[0].au, s0.positionAU) < 1e-12);
          }

          // Every sampled point respects scale mapping
          for (const pt of pts) {
            const rAU = vecNorm(pt.au);
            const rScene = vecNorm(pt);
            assert.ok(Math.abs(rScene - mapDistanceToScene(rAU, scaleMode)) < 1e-11);
          }
        }
      }
    }
  });
});
