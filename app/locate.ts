/*
 * Device location — the cold-start locate path used by the splash: ask for
 * the OS permission once, read one fix, name the locality with the device
 * Geocoder, and persist it into the same store the location page and home
 * read (nz.area.v1) + stamp it on the signed-in profile (guest no-op).
 *
 * The location/home pages keep their own deeper flows (retry banners,
 * accuracy guidance, radius slider) — this module only exists so the splash
 * can settle "restoring <area>" before onboarding takes over. Same plugin
 * and geocoder path as those pages; failure here is silent-by-design and
 * the splash keeps its design-default strip.
 */
import { Application, ApplicationSettings, isAndroid } from '@nativescript/core'
import * as geolocation from '@nativescript/geolocation'
import { errText, saveUserArea } from './firebase'

export type LocatedArea = {
  lat: number
  lng: number
  radiusKm: number
  accuracyM?: number
  locality?: string
  setTimeMs: number
}

/* Same store key as the location/home pages — a persisted fix pre-centers
 * those pages' maps and labels their headers. */
const AREA_KEY = 'nz.area.v1'
const RADIUS_KEY = 'searchRadiusKm'
// plugin's raw numeric accuracy scale (3 = high / PRIORITY_HIGH_ACCURACY)
const ACC_HIGH = 3

declare const android: any
declare const com: any

/* one fix attempt result, plugin-shaped (timeMs = engine fix age, 0 for live) */
export type RawFix = { lat: number; lng: number; accuracyM: number; timeMs?: number }

/* is the GPS side of location services actually enabled (network-only mode
 * can look identical while every high-accuracy wait is doomed) */
export function gpsProviderOn(): boolean {
  if (!isAndroid) {
    return true
  }
  try {
    const ctx = Application.android && Application.android.context
    const lm = ctx && ctx.getSystemService(<any>android.content.Context.LOCATION_SERVICE)
    return !!lm && lm.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)
  } catch (err) {
    return true // assume on when the probe fails — callers message for the on case
  }
}

/* The fused engine's cached estimate — instant, no permission dance, no
 * "enable GPS" resolution dialog, no satellite wait. Age is whatever the
 * engine last produced; every saving path in the app runs through the
 * confirm dialog, so a stale cache beats a zero fix. */
export function lastKnownFix(): Promise<RawFix | null> {
  if (!isAndroid) {
    return Promise.resolve(null)
  }
  return new Promise<RawFix | null>((resolve) => {
    let settled = false
    const done = (v: RawFix | null) => {
      if (!settled) {
        settled = true
        resolve(v)
      }
    }
    try {
      const ctx = Application.android && Application.android.context
      const GMS = com.google.android.gms.location.LocationServices
      if (!ctx || !GMS) {
        console.log('[NZ][geo] lastKnown: no context/gms')
        done(null)
        return
      }
      const client = GMS.getFusedLocationProviderClient(<any>ctx)
      // interfaces implement via anonymous `new` (the geolocation plugin's own
      // pattern) — .extend() is only for classes and can throw on interfaces
      const succ = new com.google.android.gms.tasks.OnSuccessListener({
        onSuccess: (loc: any) => {
          try {
            const lat = loc && loc.getLatitude()
            const lng = loc && loc.getLongitude()
            if (!isFinite(lat) || !isFinite(lng)) {
              console.log('[NZ][geo] lastKnown: engine has no fix for us')
              done(null)
              return
            }
            const acc = loc.getAccuracy ? Number(loc.getAccuracy()) : 0
            const t = loc.getTime ? Number(loc.getTime()) : 0
            done({ lat: lat, lng: lng, accuracyM: isFinite(acc) ? acc : 0, timeMs: isFinite(t) ? t : 0 })
          } catch (e) {
            console.log('[NZ][geo] lastKnown parse:', errText(e))
            done(null)
          }
        },
      })
      const fail = new com.google.android.gms.tasks.OnFailureListener({
        onFailure: () => done(null),
      })
      client
        .getLastLocation()
        .addOnSuccessListener(<any>succ)
        .addOnFailureListener(<any>fail)
      // the engine answers in ms; anything slower is a dead task
      setTimeout(() => {
        if (!settled) {
          console.log('[NZ][geo] lastKnown: no answer in 3s')
        }
        done(null)
      }, 3000)
    } catch (err) {
      console.log('[NZ][geo] lastKnown threw:', errText(err))
      done(null)
    }
  })
}

function sanitized(a: LocatedArea) {
  return {
    lat: a.lat,
    lng: a.lng,
    radiusKm: a.radiusKm,
    accuracyM: a.accuracyM || 0,
    locality: a.locality || '',
    setTimeMs: a.setTimeMs,
  }
}

export function readSavedArea(): LocatedArea | null {
  try {
    const j = ApplicationSettings.getString(AREA_KEY, '')
    if (!j) {
      return null
    }
    const a = <LocatedArea>JSON.parse(j)
    if (a && isFinite(a.lat) && isFinite(a.lng)) {
      return a
    }
  } catch {
    // unreadable store: no prior fix
  }
  return null
}

/* radius, preferring a stored one, then the pages' slider setting, then 2 km */
export function radiusKmFor(v?: number): number {
  if (isFinite(<number>(v || NaN)) && <number>v > 0) {
    return <number>v
  }
  try {
    const s = parseFloat(ApplicationSettings.getString(RADIUS_KEY, '2'))
    return isFinite(s) && s > 0 ? s : 2
  } catch {
    return 2
  }
}

/* Ask for permission/service once, then read ONE fix; on a live failure the
 * fused engine's cached estimate keeps the strip honest. Null only when both
 * layers come up empty — callers keep their default presentation. After the
 * first grant the OS dialog never re-appears on cold starts. */
export async function locateUser(timeoutMs = 7000): Promise<LocatedArea | null> {
  if (!isAndroid) {
    return null
  }
  const prior = readSavedArea()
  try {
    if (!(await geolocation.isEnabled())) {
      // this core resolves void — the fix read below carries the verdict
      // (denied/unavailable → getCurrentLocation throws → null, as on the
      // location page's proven flow)
      await geolocation.enableLocationRequest()
    }
    const loc = await geolocation.getCurrentLocation({
      desiredAccuracy: ACC_HIGH,
      updateTime: 4000,
      timeout: timeoutMs,
    })
    const lat = loc && loc.latitude
    const lng = loc && loc.longitude
    if (!isFinite(lat) || !isFinite(lng)) {
      return null
    }
    const acc = Number(loc.horizontalAccuracy)
    return {
      lat: lat,
      lng: lng,
      radiusKm: radiusKmFor(prior ? prior.radiusKm : undefined),
      accuracyM: isFinite(acc) ? acc : 0,
      setTimeMs: Date.now(),
    }
  } catch (err) {
    console.log('[NZ][geo] cold locate failed:', errText(err))
  }
  // live wait came up empty — the engine's cache can still label the strip
  const cached = await lastKnownFix()
  if (!cached) {
    return null
  }
  return {
    lat: cached.lat,
    lng: cached.lng,
    radiusKm: radiusKmFor(prior ? prior.radiusKm : undefined),
    accuracyM: cached.accuracyM,
    setTimeMs: Date.now(),
  }
}

/* Device Geocoder label (sub-locality preferred), '' when unavailable —
 * the same lookup the location page and home run on their fresh fixes */
export async function reverseAreaName(lat: number, lng: number): Promise<string> {
  if (!isAndroid) {
    return ''
  }
  try {
    const ctx = Application.android && Application.android.context
    if (!ctx || !android || !android.location || !android.location.Geocoder) {
      return ''
    }
    const geo = new android.location.Geocoder(ctx)
    const list = await new Promise<any>((resolve) =>
      setTimeout(() => resolve(geo.getFromLocation(lat, lng, 1)), 0)
    )
    if (list && list.size() > 0) {
      const ad = list.get(0)
      return ad.getSubLocality() || ad.getLocality() || ad.getAdminArea() || ''
    }
  } catch (err) {
    console.log('[NZ][geo] cold geocode unavailable:', errText(err))
  }
  return ''
}

/* Persist a located fix: device store first (the pages read it offline),
 * then the signed-in profile (guest no-op inside saveUserArea). */
export function persistFix(a: LocatedArea): void {
  try {
    ApplicationSettings.setString(AREA_KEY, JSON.stringify(sanitized(a)))
  } catch {
    // store unavailable: profile write still carries it when signed in
  }
  saveUserArea(<Record<string, unknown>>sanitized(a))
}
