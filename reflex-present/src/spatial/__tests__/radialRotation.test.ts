import { describe, expect, it } from 'vitest'
import { detectTwistAxis, estimateBias, GyroAngleIntegrator, type GyroCalibration, type GyroSample } from '../radial/RotationCalibration'
import { WristRotationMapper } from '../radial/WristRotationMapper'

const samples = (n: number, f: (i: number, tMs: number) => Partial<GyroSample>, dtMs = 10): GyroSample[] =>
  Array.from({ length: n }, (_, i) => ({ x: 0, y: 0, z: 0, deviceTMs: i * dtMs, ...f(i, i * dtMs) }))

const cal = (patch: Partial<GyroCalibration> = {}): GyroCalibration => ({
  version: 1,
  axis: 'z',
  sign: 1,
  bias: { x: 0, y: 0, z: 0 },
  noiseDps: 0.5,
  axisShare: 0.9,
  calibratedAt: 0,
  ...patch,
})

describe('gyro bias and axis calibration', () => {
  it('estimates a stationary bias and flags stillness', () => {
    const est = estimateBias(samples(200, (i) => ({ x: 1.5 + (i % 2 ? 0.2 : -0.2), y: -0.8, z: 0.3 })))!
    expect(est.bias.x).toBeCloseTo(1.5, 5)
    expect(est.bias.y).toBeCloseTo(-0.8, 5)
    expect(est.still).toBe(true)
  })

  it('rejects a "still" phase that moved', () => {
    expect(estimateBias(samples(200, (_i, t) => ({ y: 40 * Math.sin(t / 100) })))!.still).toBe(false)
  })

  it('finds the twist axis and its clockwise sign', () => {
    const bias = { x: 0.5, y: -1, z: 2 }
    // twist lands on -y in this wearing: clockwise reads negative on y
    const s = samples(300, (_i, t) => ({ x: 0.5 + 5 * Math.sin(t / 90), y: -1 - 120 * Math.sin((2 * Math.PI * t) / 1200), z: 2 }))
    const a = detectTwistAxis(s, bias)!
    expect(a.axis).toBe('y')
    expect(a.sign).toBe(-1)
    expect(a.axisShare).toBeGreaterThan(0.9)
  })

  it('returns null for a twist too small to tell', () => {
    expect(detectTwistAxis(samples(100, () => ({ z: 3 })), { x: 0, y: 0, z: 2.5 })).toBeNull()
  })
})

describe('gyro integration', () => {
  it('integrates using the samples’ own timestamps', () => {
    const integ = new GyroAngleIntegrator(cal())
    // 90 deg/s for 0.5 s at irregular spacing
    let t = 0
    for (let i = 0; i <= 50; i++) {
      integ.feed({ x: 0, y: 0, z: 90, deviceTMs: t })
      t += i % 2 ? 7 : 13
    }
    expect(integ.angle).toBeCloseTo(90 * ((t - (50 % 2 ? 7 : 13)) / 1000), 3)
  })

  it('removes the measured bias', () => {
    const integ = new GyroAngleIntegrator(cal({ bias: { x: 0, y: 0, z: 3 } }))
    for (const s of samples(101, () => ({ z: 3 }))) integ.feed(s)
    expect(integ.angle).toBeCloseTo(0, 9)
  })

  it('applies the calibrated sign', () => {
    const integ = new GyroAngleIntegrator(cal({ sign: -1 }))
    for (const s of samples(101, () => ({ z: 50 }))) integ.feed(s)
    expect(integ.angle).toBeCloseTo(-50, 6)
  })

  it('skips gaps instead of integrating across them, and clamps', () => {
    const integ = new GyroAngleIntegrator(cal(), { maxDtMs: 100, clampDeg: 60 })
    integ.feed({ x: 0, y: 0, z: 100, deviceTMs: 0 })
    integ.feed({ x: 0, y: 0, z: 100, deviceTMs: 5000 })
    expect(integ.angle).toBe(0)
    expect(integ.gaps).toBe(1)
    for (let t = 5010; t < 7000; t += 10) integ.feed({ x: 0, y: 0, z: 100, deviceTMs: t })
    expect(integ.angle).toBe(60)
  })
})

describe('rotation → sector mapping', () => {
  const noSmooth = { smoothingMs: 0 }
  const settle = (m: WristRotationMapper, deg: number, from = 0, ms = 200) => {
    for (let t = from; t <= from + ms; t += 10) m.update(deg, t)
    return m.action
  }

  it('neutral is Explain; clockwise past threshold is Remember; counter-clockwise is Voice', () => {
    expect(settle(new WristRotationMapper(noSmooth), 10)).toBe('explain')
    expect(settle(new WristRotationMapper(noSmooth), 30)).toBe('remember')
    expect(settle(new WristRotationMapper(noSmooth), -30)).toBe('voice')
  })

  it('reads small angles inside the dead zone as zero', () => {
    const m = new WristRotationMapper({ ...noSmooth, deadZoneDeg: 6 })
    m.update(4, 0)
    expect(m.angle).toBe(0)
    m.update(8, 10)
    expect(m.angle).toBe(8)
  })

  it('holds an outer sector inside the hysteresis band', () => {
    const m = new WristRotationMapper({ ...noSmooth, thresholdDeg: 25, hysteresisDeg: 6 })
    settle(m, 30)
    expect(settle(m, 21, 300)).toBe('remember') // 21 > 25 - 6
    expect(settle(m, 18, 600)).toBe('explain')
  })

  it('needs the new sector to be stable before moving the highlight', () => {
    const m = new WristRotationMapper({ ...noSmooth, stableMs: 120 })
    m.update(30, 0)
    m.update(30, 100)
    expect(m.action).toBe('explain')
    m.update(0, 110) // a flick back: candidate dropped
    m.update(30, 120)
    m.update(30, 200)
    expect(m.action).toBe('explain')
    m.update(30, 240)
    expect(m.action).toBe('remember')
  })

  it('inversion and sensitivity', () => {
    expect(settle(new WristRotationMapper({ ...noSmooth, invert: true }), 30)).toBe('voice')
    expect(settle(new WristRotationMapper({ ...noSmooth, sensitivity: 2 }), 15)).toBe('remember')
  })

  it('clamps to three fixed positions instead of accumulating', () => {
    const m = new WristRotationMapper({ ...noSmooth, maxDeg: 75 })
    settle(m, 400)
    expect(m.angle).toBe(75)
    expect(m.action).toBe('remember')
    expect(m.step(1)).toBe('remember')
  })
})
