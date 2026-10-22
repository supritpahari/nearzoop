import {
  Application,
  ApplicationSettings,
  EventData,
  GestureEventData,
  GridLayout,
  Label,
  PanGestureEventData,
  Page,
  Screen,
  TapGestureEventData,
  TouchGestureEventData,
  View,
  WebView,
  isAndroid,
} from '@nativescript/core'
import * as geolocation from '@nativescript/geolocation'
import { encodeSpec, MapBubble, MapSpec, mountMap, pushSpec } from './map-src'
import { onLinkTouch, onStickerTouch } from './press-feel'
import { errText, firebaseAuth, firebaseDb, saveUserArea } from './firebase'
import { gpsProviderOn, lastKnownFix } from './locate'

export { onLinkTouch, onStickerTouch }
export { onDlgScrimTap } from './nz-dialog'
import { openDialog } from './nz-dialog'

declare const android: any

// Search radius bounds mirror the mock's slider (0.5 km .. 10 km, 0.5 steps).
const SETTING_KEY = 'searchRadiusKm'
const AREA_KEY = 'nz.area.v1'
const MIN_KM = 0.5
const MAX_KM = 10
const STEP_KM = 0.5
const THUMB = 30

// Map band: the webview map handles ring/dot/bubble geometry from real
// geo coords; only the seeding reuses the old dp->km scale (77.5 dp = 1 km).
const RING_DP_PER_KM = 155
const DP_PER_KM = RING_DP_PER_KM / 2
// plugin's raw numeric accuracy scale (3 = high / PRIORITY_HIGH_ACCURACY)
const ACC_HIGH = 3

// Default projection origin before any real fix: Kolkata CBD.
const DEFAULT_CENTER = { lat: 22.5726, lng: 88.3639 }

type Area = {
  lat: number
  lng: number
  radiusKm: number
  accuracyM?: number
  locality?: string
  setTimeMs: number
}

type Shop = {
  id: string
  lat: number
  lng: number
  text: string
  fontSize: number
}

let pageRef: Page | null = null
let sliderW = 0
let km = 2
let areaRef: Area | null = null
let shops: Shop[] = []
let seedAttempted = false
let mapMounted = false
let mapKey = ''

export function navigatingTo() {
  try {
    const v = parseFloat(ApplicationSettings.getString(SETTING_KEY, '2'))
    km = clampKm(isNaN(v) ? 2 : v)
  } catch {
    km = 2
  }
  // reuse the previously confirmed fix so the page opens around it
  areaRef = null
  try {
    const j = ApplicationSettings.getString(AREA_KEY, '')
    if (j) {
      const a = <Area>JSON.parse(j)
      if (a && isFinite(a.lat) && isFinite(a.lng)) {
        a.radiusKm = km
        areaRef = a
      }
    }
  } catch {
    areaRef = null
  }
  loadOffers()
  // silent entry locate: no pill first — find, then show the fix on the map
  setTimeout(autoLocate, 450)
  // belt: the map band paints even when locating lands nowhere (mount is
  // idempotent — the spec dedupe keeps repeats harmless)
  setTimeout(() => primeMap(true), 1600)
}

/* ------------------------------- geolocation ------------------------------ */

async function serviceReady(): Promise<boolean> {
  try {
    if (!(await geolocation.isEnabled())) {
      await geolocation.enableLocationRequest()
    }
    return true
  } catch (err) {
    console.log('[NZ][geo] permission/service off:', errText(err))
    showBanner('Location is off. Turn it on, then Retry.')
    return false
  }
}

type Fix = { lat: number; lng: number; accuracyM: number }

/* one fix attempt: current location or null (callers own the messaging) */
async function acquireFix(timeoutMs: number): Promise<Fix | null> {
  try {
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
    return { lat: lat, lng: lng, accuracyM: isFinite(acc) ? acc : 0 }
  } catch (err) {
    console.log('[NZ][geo] fix failed:', errText(err))
    return null
  }
}

/* Layered: a live fused wait first (cold-GPS first fixes need patience, so
 * the budget is generous); when even that comes up empty, the engine's
 * cached estimate lands instantly — no dialogs, no satellite wait. A stale
 * cache still beats zero: nothing saves before the confirm dialog. */
async function acquireFixLayered(timeoutMs: number): Promise<Fix | null> {
  const fresh = await acquireFix(timeoutMs)
  if (fresh) {
    return fresh
  }
  const cached = await lastKnownFix()
  if (cached) {
    console.log(
      '[NZ][geo] cached engine fix',
      cached.lat.toFixed(5),
      cached.lng.toFixed(5),
      '±' + Math.round(cached.accuracyM) + 'm'
    )
    return cached
  }
  console.log('[NZ][geo] cache layer empty — no fix available this attempt')
  return null
}

/* honest failure wording, split by the device's real provider state */
function fixFailText(): string {
  return gpsProviderOn()
    ? "Couldn't get a fix just now — a first GPS fix can take a minute. Retry, or Search your locality below."
    : 'GPS is off on this device. Turn it on, then Retry — or Search your locality below.'
}

/* show a fix on the map WITHOUT saving it: center + naming live-render only */
function centerArea(lat: number, lng: number, accuracyM: number) {
  areaRef = {
    lat: lat,
    lng: lng,
    radiusKm: km,
    accuracyM: accuracyM,
    locality: areaRef ? areaRef.locality : undefined,
    setTimeMs: Date.now(),
  }
  render()
  nameLocality(areaRef).then((name) => {
    if (name && areaRef) {
      areaRef.locality = name
      render()
    }
  })
}

/* the confirmed step: save to device + profile, then release to home */
function commitArea(page: Page, locality?: string) {
  if (!areaRef) {
    return
  }
  areaRef.locality = locality || areaRef.locality
  persistArea(areaRef)
  saveUserArea(<Record<string, unknown>>sanitizedArea(areaRef))
  toMain(page)
}

/* silent entry locate — the pill never leads, the fix does. Errors surface
 * only after a real attempt, through the honest retry banner. */
async function autoLocate() {
  const page = pageRef
  if (!page) {
    return
  }
  try {
    if (!(await geolocation.isEnabled())) {
      await geolocation.enableLocationRequest()
    }
  } catch (err) {
    console.log('[NZ][geo] entry service off:', errText(err))
    showBanner('Location is off. Turn it on, then tap Use my current location.')
    return
  }
  const fix = await acquireFixLayered(12000)
  if (!pageRef) {
    return
  }
  if (!fix) {
    showBanner(
      gpsProviderOn()
        ? "Couldn't find you just now — a first GPS fix can take a minute. Use the button below, or Search your locality."
        : 'GPS is off on this device. Turn it on, then tap Use my current location.'
    )
    return
  }
  console.log(
    '[NZ][geo] entry fix',
    fix.lat.toFixed(5),
    fix.lng.toFixed(5),
    '±' + Math.round(fix.accuracyM) + 'm'
  )
  centerArea(fix.lat, fix.lng, fix.accuracyM)
}

/* Real flow for the primary CTA: fix, center the map, then ASK with the
 * sticker dialog. Only an explicit agreement saves and releases to home;
 * the secondary hands the decision to the free locality search screen. */
let useBusy = false

export async function onUseLocation(args: EventData) {
  const page = (<View>args.object).page
  pageRef = page
  if (useBusy) {
    return
  }
  useBusy = true
  if (!(await serviceReady())) {
    useBusy = false
    return // serviceReady banners its own honest wording
  }
  const fix = await acquireFixLayered(15000)
  if (!pageRef) {
    useBusy = false
    return
  }
  if (!fix) {
    showBanner(fixFailText())
    useBusy = false
    return
  }
  centerArea(fix.lat, fix.lng, fix.accuracyM)
  const name = areaRef ? String((await nameLocality(areaRef)) || '') : ''
  useBusy = false // the dialog's scrim owns the screen from here
  const accM = Math.round(fix.accuracyM)
  openDialog(page, {
    title: 'Is this right?',
    body:
      'We found you near ' +
      (name || 'your current position') +
      (accM > 50 ? ' — about ' + accM + ' m accuracy.' : '.') +
      ' Offers come from this area.',
    primaryLabel: 'Yes — use this',
    onPrimary: () => {
      commitArea(page, name || undefined)
    },
    secondaryLabel: 'Search locality',
    onSecondary: () => {
      toLocality(page)
    },
  })
}

// the banner is honest data: Retry really tries again
export function onRetry(args: EventData) {
  pageRef = (<View>args.object).page
  hideBanner()
  serviceReady().then((ready) => {
    if (!ready) {
      return // serviceReady re-flagged the banner itself
    }
    acquireFixLayered(15000).then((fix) => {
      if (fix) {
        hideBanner()
        centerArea(fix.lat, fix.lng, fix.accuracyM)
      } else {
        showBanner(fixFailText())
      }
    })
  })
}

/* Android-native reverse geocode; empty string when the service is missing */
async function nameLocality(a: Area): Promise<string> {
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
      setTimeout(() => resolve(geo.getFromLocation(a.lat, a.lng, 1)), 0)
    )
    if (list && list.size() > 0) {
      const ad = list.get(0)
      return ad.getSubLocality() || ad.getLocality() || ad.getAdminArea() || ''
    }
  } catch (err) {
    console.log('[NZ][geo] geocode unavailable:', errText(err))
  }
  return ''
}

/* ------------------------------ persistence ------------------------------- */

function sanitizedArea(a: Area) {
  return {
    lat: a.lat,
    lng: a.lng,
    radiusKm: a.radiusKm,
    accuracyM: a.accuracyM || 0,
    locality: a.locality || '',
    setTimeMs: a.setTimeMs,
  }
}

function persistArea(a: Area) {
  try {
    ApplicationSettings.setString(AREA_KEY, JSON.stringify(sanitizedArea(a)))
  } catch {
    // settings unavailable: keep in-memory value only
  }
}

/* --------------------------------- offers --------------------------------- */

// Real bubbles come from the shops collection; when it's still empty and the
// user is signed in we seed the mock's six stickers into Firestore once, keyed
// around the real fix (or the Kolkata default), so everything on screen is
// data you can edit from the console.
async function loadOffers() {
  try {
    const db = await firebaseDb()
    const snap = await db.collection('shops').limit(50).get()
    const out: Shop[] = []
    ;(<any>snap).forEach((d: any) => {
      const v = <any>d.data() || {}
      const text = String(v.text || '').trim()
      if (text && isFinite(v.lat) && isFinite(v.lng)) {
        out.push({
          id: String(d.id || ''),
          lat: Number(v.lat),
          lng: Number(v.lng),
          text: text,
          fontSize: isFinite(v.fontSize) ? Number(v.fontSize) : 0,
        })
      }
    })
    if (!out.length) {
      console.log('[NZ][offers] shops collection empty — seeding demo stickers')
      seedShopsOnce()
      return
    }
    shops = out
    render()
    primeMap(true)
  } catch (err) {
    console.log('[NZ][offers] read blocked:', errText(err))
  }
}

// one-shot guarded: never loops back into itself
function seedShopsOnce() {
  if (seedAttempted) {
    return
  }
  seedAttempted = true
  firebaseAuth()
    .then((auth) => {
      if (!auth.currentUser) {
        console.log('[NZ][offers] guest session — demo stickers stay, seeds skipped')
        return
      }
      return firebaseDb().then((db) =>
        db
          .collection('shops')
          .limit(1)
          .get()
          .then((snap) => {
            let count = 0
            ;(<any>snap).forEach(() => {
              count++
            })
            if (count > 0) {
              // raced by another device: data arrived anyway
              return loadOffers()
            }
            const c = areaRef || { lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng }
            const slat = (c.lat * Math.PI) / 180
            const writes = DEMO_OFFSETS.map((off) =>
              db.collection('shops').add({
                lat: c.lat - off[1] / DP_PER_KM / 111.32,
                lng: c.lng + off[0] / DP_PER_KM / (111.32 * Math.cos(slat)),
                text: off[2],
                fontSize: off[3],
              })
            )
            return Promise.all(writes).then(() => {
              console.log('[NZ][offers] seeded 6 demo shops into Firestore')
              loadOffers()
            })
          })
      )
    })
    .catch((err) => console.log('[NZ][offers] seed blocked:', errText(err)))
}

const DEMO_OFFSETS: [number, number, string, number][] = [
  [-72, -78, '20%', 16],
  [96, -115, '\u20B9699', 15],
  [32, -40, 'BOGO', 14.5],
  [-70, 3, '10', 16],
  [65, 40, '\u20B9500', 16],
  [-120, 60, 'FREE', 14],
]

/* --------------------------------- layout --------------------------------- */

export function onSliderLayout(args: EventData) {
  const slider = <GridLayout>args.object
  pageRef = slider.page
  sliderW = slider.getActualSize().width
  clipMapBand()
  primeMap(true)
  if (!isFinite(sliderW) || sliderW <= 0) {
    return
  }
  render()
}

export function onSliderTap(args: TapGestureEventData) {
  const slider = <GridLayout>args.object
  ensureMetrics(slider)
  const x = pointerX(args)
  if (isFinite(x)) {
    updateFromPointer(x - THUMB / 2)
  }
}

export function onPan(args: PanGestureEventData) {
  const slider = <GridLayout>args.object
  ensureMetrics(slider)
  const x = pointerX(args)
  if (isFinite(x)) {
    updateFromPointer(x - THUMB / 2)
  }
}

// pan events carry no coordinates on this core — the touch listener is the
// reliable drag feed: every motion frame re-positions the thumb, and taps
// still land through onSliderTap for jump-to-point
export function onSliderTouch(args: TouchGestureEventData) {
  if (args.action === 'cancel') {
    return
  }
  const slider = <GridLayout>args.object
  ensureMetrics(slider)
  const x = pointerX(args)
  if (isFinite(x)) {
    updateFromPointer(x - THUMB / 2)
  }
}

// TapGestureEventData / PanGestureEventData carry no .x/.offsetX on this core
// version — the position only exists on the native event (MotionEvent is
// view-relative physical px; iOS locationInView is dp-equivalent points).
export function pointerX(args: GestureEventData) {
  let x = NaN
  try {
    if (args.android) {
      const me = <{ getX(): number }><unknown>args.android
      x = me.getX() / Screen.mainScreen.scale
    } else if (args.ios) {
      const gr = <{ view?: { }; locationInView(v: unknown): { x: number } }><unknown>args.ios
      const loc = gr.locationInView(gr.view)
      if (loc) {
        x = loc.x
      }
    }
  } catch {
    // native event unavailable (synthetic re-layout gesture)
  }
  return x
}

// Manual locality search — its own screen (locality-page) with the same
// confirm dialog before anything saves
export function onPickLocality(args: EventData) {
  console.log('[NZ][locate-pg] pick tapped -> navigating locality-page')
  toLocality((<View>args.object).page)
}

function toLocality(page: Page) {
  try {
    page.frame.navigate({
      moduleName: 'locality-page',
    })
  } catch (err) {
    // a failed target build must never leave a sunken button: land it back
    console.log('[NZ][locate-pg] navigate failed:', errText(err))
  }
}

function ensureMetrics(slider: GridLayout) {
  pageRef = slider.page
  if (!isFinite(sliderW) || sliderW <= 0) {
    sliderW = slider.getActualSize().width
  }
}

function updateFromPointer(x: number) {
  const travel = sliderW - THUMB
  if (travel <= 0) {
    return
  }
  const p = Math.min(1, Math.max(0, x / travel))
  km = clampKm(Math.round((MIN_KM + p * (MAX_KM - MIN_KM)) / STEP_KM) * STEP_KM)
  persist()
  render()
}

function clampKm(v: number) {
  return Math.min(MAX_KM, Math.max(MIN_KM, v))
}

function persist() {
  if (!isFinite(km)) {
    return
  }
  try {
    ApplicationSettings.setString(SETTING_KEY, String(km))
  } catch {
    // settings unavailable: keep in-memory value only
  }
}

function render() {
  if (!pageRef || sliderW <= THUMB + 1) {
    return
  }
  const travel = sliderW - THUMB
  const p = (km - MIN_KM) / (MAX_KM - MIN_KM)
  const cx = Math.max(0, Math.min(travel, p * travel))

  const thumb = <View>pageRef.getViewById('thumb')
  const thumbShadow = <View>pageRef.getViewById('thumbShadow')
  const fill = <View>pageRef.getViewById('fill')
  const label = <Label>pageRef.getViewById('kmLabel')

  if (thumb) {
    thumb.translateX = cx
  }
  if (thumbShadow) {
    // sticker offset: 4 down / 2 right, sliding with the thumb
    thumbShadow.translateX = cx + 2
    thumbShadow.translateY = 4
  }
  if (fill) {
    fill.width = cx + THUMB / 2
  }
  if (label) {
    label.text = formatKm(km)
  }
  primeMap(false)
}

/* --------------------------------- map ------------------------------------ */

function centerForProjection() {
  return areaRef || { lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng }
}

/* The map webview owns all geometry. Around a real fix (or the Kolkata
 * default) it draws the dashed radius ring, the blue dot and one sticker
 * bubble per shop: shops when Firestore has them, the demo stickers as a
 * geo-anchored fallback for guests on a still-empty collection. */

function buildMapSpec(): MapSpec {
  const c = centerForProjection()
  const src: MapBubble[] = shops.length
    ? shops.map((s) => ({ lat: s.lat, lng: s.lng, text: s.text, fontSize: s.fontSize }))
    : demoBubbleList()
  return {
    lat: c.lat,
    lng: c.lng,
    radiusKm: km,
    padB: 0.09,
    bubbles: src.map((b) => ({
      lat: b.lat,
      lng: b.lng,
      text: b.text,
      fontSize: b.fontSize || (b.text.length > 5 ? 13.5 : 16),
    })),
  }
}

function demoBubbleList(): MapBubble[] {
  const c = centerForProjection()
  const cos = Math.cos((c.lat * Math.PI) / 180)
  return DEMO_OFFSETS.map((off) => ({
    lat: c.lat - off[1] / DP_PER_KM / 111.32,
    lng: c.lng + off[0] / DP_PER_KM / (111.32 * cos),
    text: off[2],
    fontSize: off[3],
  }))
}

function mapWeb(): WebView | null {
  return pageRef ? <WebView>pageRef.getViewById('mapWeb') : null
}

/* mount on first call, then hand the spec over; two delayed repeats cover the
 * page-load window before the html declares window.NZMap (payload is
 * idempotent — the page dedupes a repeat by key) */
function primeMap(force: boolean) {
  const web = mapWeb()
  if (!web) {
    return
  }
  if (!mapMounted) {
    if (!mountMap(web)) {
      return
    }
    mapMounted = true
  }
  const json = encodeSpec(buildMapSpec())
  if (!force && json === mapKey) {
    return
  }
  mapKey = json
  pushSpec(web, json)
  setTimeout(() => pushSpec(web, mapKey), 700)
  setTimeout(() => pushSpec(web, mapKey), 2400)
}

/* ------------------------------ fix banner -------------------------------- */

function showBanner(text: string) {
  if (!pageRef) {
    return
  }
  const banner = <View>pageRef.getViewById('fixBanner')
  const t = <Label>pageRef.getViewById('fixText')
  if (t && text) {
    t.text = text
  }
  if (banner) {
    banner.visibility = 'visible'
  }
}

function hideBanner() {
  if (!pageRef) {
    return
  }
  const banner = <View>pageRef.getViewById('fixBanner')
  if (banner) {
    banner.visibility = 'collapse'
  }
}

// Rings beyond ~2 km leave the 352 dp band, so the band clips on both sides.
function clipMapBand() {
  const band = <View>pageRef.getViewById('mapBand')
  if (!band) {
    return
  }
  try {
    if (band.android) {
      ;(<any>band.android).setClipChildren(true)
    }
  } catch {
    // ignore
  }
  try {
    if (band.ios) {
      ;(<any>band.ios).clipsToBounds = true
    }
  } catch {
    // ignore
  }
}

function formatKm(v: number) {
  return (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)) + ' km'
}

function toMain(page: Page) {
  page.frame.navigate({
    moduleName: 'main-page',
    clearHistory: true,
  })
}
