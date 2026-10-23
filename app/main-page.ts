/*
 * Home — the map-first "Nearby" screen (design-mock parallel, real data).
 *
 * Everything on screen comes from the same Firestore `shops` corpus the
 * location page renders as bubbles: each document is one offer with map
 * fields (lat/lng/text) plus card fields (title/shop/color/endsAtMs).
 *
 * Real-data paths:
 *   - header sticker line  <- nz.area.v1 (device fix) + users/{uid}.area
 *   - headline count/meta  <- offers within radius, sorted by real distance
 *   - map bubbles          <- webview MapLibre pins at true lat/lng (map-src)
 *   - card feed            <- same offers, bookmark state on users/{uid}.saved
 *   - locate button        <- fresh @nativescript/geolocation fix, re-projects
 *
 * Offline-safe: no area -> Kolkata default at 2 km; guest -> local saved set.
 */

import {
  AnimationCurve,
  Application,
  ApplicationSettings,
  EventData,
  GridLayout,
  Image,
  Label,
  Page,
  StackLayout,
  TapGestureEventData,
  View,
  WebView,
  isAndroid,
} from '@nativescript/core'
import * as geolocation from '@nativescript/geolocation'
import { encodeSpec, MapSpec, mountMap, pushSpec } from './map-src'
import { onStickerTouch, onLinkTouch } from './press-feel'
import { errText, firebaseDb, saveUserArea } from './firebase'
import { Offer } from './features/offers/domain/offer'

export { onStickerTouch, onLinkTouch }

declare const android: any

const AREA_KEY = 'nz.area.v1'
const RADIUS_KEY = 'searchRadiusKm'
const SAVED_KEY = 'nz.saved.v1'

/* same ground-scale as the location page: 2 km ring = 310 dp diameter */
const RING_DP_PER_KM = 155
const DP_PER_KM = RING_DP_PER_KM / 2
const ACC_HIGH = 3
const DEFAULT_CENTER = { lat: 22.5726, lng: 88.3639 }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const T_COLOR: Record<string, string> = {
  red: '#FB4B32',
  pink: '#F4539B',
  amber: '#F2A81D',
}

type Area = {
  lat: number
  lng: number
  radiusKm: number
  accuracyM?: number
  locality?: string
  setTimeMs: number
}

let pageRef: Page | null = null
let bandW = 0
let bandH = 0
let center = { x: 179, y: 298 }
let areaRef: Area | null = null
let corpus: Offer[] = []   // every offer Firestore returned
let offers: Offer[] = []   // filtered to the radius, distance-sorted
let savedIds = new Set<string>()
let loadedAt = 0
let chromeReady = false
let chromeTries = 0
let fixingBusy = false
let mapMounted = false
let mapKey = ''

/* ------------------------------- lifecycle -------------------------------- */

export function navigatingTo(args: EventData) {
  pageRef = <Page>args.object // args.object IS the page here
  areaRef = readAreaLocal()
  savedIds = new Set(readSavedLocal())
}

/* first chance to build chrome and kick the Firestore read; on some cores the
 * band isn't measured yet at this point — onBandLoaded finishes the pass */
export function onLoaded(args: EventData) {
  pageRef = <Page>args.object
  ensureChrome()
  loadAligned()
}

export function onBandLoaded(args: EventData) {
  const band = <View>args.object
  if (band && !pageRef) {
    pageRef = band.page
  }
  ensureChrome()
}

/* ------------------------------ chrome/layout ----------------------------- */

/* one-time geometry pass: clip the bay, size the sheet to the mock fractions
 * (sheet top ~41% of the screen, the "you are here" point just above it),
 * bake sticker shadow offsets and float the round map-side buttons. */
function ensureChrome() {
  const band = pageRef ? <GridLayout>pageRef.getViewById('mapBand') : null
  if (!band || chromeReady) {
    return
  }
  const size = band.getActualSize()
  if (!size || !(size.width > 50) || !(size.height > 50)) {
    // first layout pass can measure the band at 0 — without a retry the sheet
    // keeps its XML size and stretched over the whole screen on entry
    if (chromeTries < 30) {
      chromeTries++
      setTimeout(ensureChrome, 120)
    }
    return
  }
  bandW = size.width
  bandH = size.height
  center = {
    x: 0.497 * bandW,
    y: 0.427 * bandH,
  }
  chromeReady = true

  clipChildren(band)

  const sheet = <View>pageRef.getViewById('sheet')
  if (sheet) {
    sheet.height = Math.round(0.592 * bandH)
    sheet.style.zIndex = 10 // bubble layer is added last; the sheet must stay above
  }

  // sticker language: hard ink offsets under the white faces
  bakeShadow('locStickerShadow')
  bakeShadow('btnSearchShadow')
  bakeShadow('btnBellShadow')
  bakeShadow('btnAllShadow')

  // round side buttons stack down the ring's right edge
  const locate = <View>pageRef.getViewById('btnLocate')
  const layers = <View>pageRef.getViewById('btnLayers')
  if (locate) {
    locate.marginTop = Math.max(60, Math.round(center.y - 66))
  }
  if (layers) {
    layers.marginTop = Math.max(110, Math.round(center.y - 12))
  }

  lift('btnLocateCard', 5)
  lift('btnLayersCard', 4)

  mountStreetMap()
  primeMap(true)
}
function bakeShadow(id: string) {
  const sh = pageRef ? <View>pageRef.getViewById(id) : null
  if (sh) {
    sh.translateX = 2.5
    sh.translateY = 3.5
  }
}

function lift(id: string, dp: number) {
  const card = pageRef ? <View>pageRef.getViewById(id) : null
  if (card && card.android) {
    try {
      (<any>card).elevation = dp
    } catch {
      // flat white circle still reads fine
    }
  }
}

function clipChildren(band: View) {
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

/* --------------------------------- offers --------------------------------- */

async function loadAligned() {
  try {
    const db = await firebaseDb()
    const snap = await db.collection('shops').limit(50).get()
    const docs: Offer[] = []
    ;(<any>snap).forEach((d: any) => {
      const v = <any>(d.data && typeof d.data === 'function' ? d.data() : d.data) || {}
      const text = String(v.text || '').trim()
      if (text && isFinite(v.lat) && isFinite(v.lng)) {
        docs.push({
          id: String(d.id || ''),
          lat: Number(v.lat),
          lng: Number(v.lng),
          text: text,
          fontSize: isFinite(v.fontSize) ? Number(v.fontSize) : 0,
          sub: v.sub ? String(v.sub) : undefined,
          title: v.title ? String(v.title) : undefined,
          shop: v.shop ? String(v.shop) : undefined,
          color: v.color ? String(v.color) : undefined,
          endsAtMs: isFinite(v.endsAtMs) ? Number(v.endsAtMs) : undefined,
        })
      }
    })
    corpus = docs.length ? docs : makeDemoOffers()
    loadedAt = Date.now()
    presentOffers()
  } catch (err) {
    console.log('[NZ][home] offers read blocked:', errText(err))
    corpus = makeDemoOffers()
    loadedAt = Date.now()
    presentOffers()
  }
}

type MockOffer = {
  off: [number, number] // dp offset: east / south of the area centre
  text: string
  fontSize: number
  sub?: string
  title: string
  shop: string
  color: string
  ends: [number, number, number] // dayOffset, hour24, minute (local time)
}

const MOCK_OFFERS: MockOffer[] = [
  {
    off: [10, 24], text: 'BOGO', fontSize: 14.5, sub: 'PLATES',
    title: 'Buy 1 plate, get 1 free', shop: 'Phuchka Phactory', color: 'red',
    ends: [0, 21, 0],
  },
  {
    off: [-15, 20], text: '10', fontSize: 16, sub: 'FOR 8',
    title: '10 rosgogolla for the price of 8', shop: 'Nolen Gur Sweets',
    color: 'pink', ends: [3, 21, 30],
  },
  {
    off: [27, 13], text: '20%', fontSize: 16, sub: 'OFF',
    title: 'Puja collection — flat 20% off', shop: 'Gariahat Saree Ghar',
    color: 'amber', ends: [4, 22, 0],
  },
  {
    off: [39, -142], text: '₹699', fontSize: 15,
    title: 'Mishti hamper pick of the week', shop: 'Shri Mistanna Bhandar',
    color: 'red', ends: [0, 22, 30],
  },
  {
    off: [117, -2], text: '15%', fontSize: 14.5, sub: 'OFF',
    title: 'Mishti boxes at 15% off', shop: 'Dakshin Cafe',
    color: 'amber', ends: [2, 20, 0],
  },
  {
    off: [-60, 90], text: '₹500', fontSize: 16, sub: 'COMBO',
    title: 'Combo dinner under ₹500', shop: 'Deshi Kitchen',
    color: 'red', ends: [0, 23, 0],
  },
  {
    off: [-150, 60], text: 'FREE', fontSize: 14, sub: 'TEA',
    title: 'Free lemon tea with any thali', shop: 'Rimbick Kitchen',
    color: 'amber', ends: [1, 12, 30],
  },
  {
    off: [-90, -120], text: '25%', fontSize: 15, sub: 'OFF',
    title: 'Dessert bar, flat 25% off', shop: 'Ballygunge Bistro',
    color: 'pink', ends: [5, 21, 45],
  },
]

function endsAtFor(spec: [number, number, number], nowMs: number): number {
  const base = new Date(nowMs)
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  d.setDate(d.getDate() + spec[0])
  d.setHours(spec[1], spec[2], 0, 0)
  if (d.getTime() <= nowMs) {
    d.setDate(d.getDate() + 1) // this slot already passed: same slot tomorrow
  }
  return d.getTime()
}

function makeDemoOffers(): Offer[] {
  const area = areaRef || DEFAULT_CENTER
  const latRad = (area.lat * Math.PI) / 180
  const now = Date.now()
  return MOCK_OFFERS.map((mock, index) => ({
    id: `preview-${index + 1}`,
    lat: area.lat - mock.off[1] / DP_PER_KM / 111.32,
    lng: area.lng + mock.off[0] / DP_PER_KM / (111.32 * Math.cos(latRad)),
    text: mock.text,
    fontSize: mock.fontSize,
    sub: mock.sub,
    title: mock.title,
    shop: mock.shop,
    color: mock.color,
    endsAtMs: endsAtFor(mock.ends, now),
  }))
}

/* ---------------------------- present on screen ---------------------------- */

function presentOffers() {
  if (!pageRef) {
    return
  }
  const c = areaRef || { lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng }
  const km = areaRef ? areaRef.radiusKm : defaultRadius()
  offers = corpus
    .map((o) => ({ o: o, d: distanceKm(c.lat, c.lng, o.lat, o.lng) }))
    .filter((x) => x.d <= km + 0.001)
    .sort((a, b) => a.d - b.d)
    .map((x) => ({ ...x.o, distanceLabel: fmtDist(x.d) }))

  const count = <Label>pageRef.getViewById('offerCount')
  const meta = <Label>pageRef.getViewById('offerMeta')
  if (count) {
    count.text = offers.length + (offers.length === 1 ? ' offer' : ' offers') + ' nearby'
  }
  if (meta) {
    meta.text = 'Within ' + fmtKm(km) + ' km · ' + relTime(loadedAt)
  }

  // the header sticker mirrors the saved area
  const line = <Label>pageRef.getViewById('locLine')
  if (line) {
    line.text =
      (areaRef && areaRef.locality ? areaRef.locality : 'Gariahat') +
      ' · ' + fmtKm(km) + ' km'
  }

  primeMap(false)
  renderCards()
}

/* --------------------------------- map ------------------------------------ */

function mapWeb(): WebView | null {
  return pageRef ? <WebView>pageRef.getViewById('mapWeb') : null
}

/* mount the street page once; repeats cover the load window before the html
 * declares window.NZMap (the html dedupes a repeat payload by key) */
function mountStreetMap() {
  const web = mapWeb()
  if (!web || mapMounted) {
    return
  }
  if (mountMap(web)) {
    mapMounted = true
  }
}

function buildMapSpec(): MapSpec {
  const c = areaRef || { lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng }
  const km = areaRef ? areaRef.radiusKm : defaultRadius()
  return {
    lat: c.lat,
    lng: c.lng,
    radiusKm: km,
    padB: 0.66, // the offers sheet eats the lower band on this page
    bubbles: offers.map((o) => ({
      lat: o.lat,
      lng: o.lng,
      text: o.text,
      fontSize: o.fontSize || (o.text.length > 5 ? 13.5 : 16),
    })),
  }
}

function primeMap(force: boolean) {
  mountStreetMap()
  const web = mapWeb()
  if (!web || !mapMounted) {
    return
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

/* ------------------------------- card feed -------------------------------- */

function renderCards() {
  if (!pageRef) {
    return
  }
  const stack = <StackLayout>pageRef.getViewById('cardStack')
  if (!stack) {
    return
  }
  const kids: View[] = []
  stack.eachChildView((v) => {
    kids.push(v)
    return true
  })
  for (const k of kids) {
    stack.removeChild(k)
  }
  stack.paddingBottom = 20 // last card clears the sheet's lower edge
  if (!offers.length) {
    stack.addChild(emptyState())
    return
  }
  offers.forEach((o, i) => stack.addChild(buildCard(o, i)))
}

function buildCard(o: Offer, i: number): View {
  const c = areaRef || { lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng }
  const dKm = distanceKm(c.lat, c.lng, o.lat, o.lng)

  const card = new GridLayout()
  card.id = 'card' + i + 'Card'
  card.className = 'ho-card'
  card.rows = 'auto, auto'
  card.columns = '92, *'
  card.padding = '12 14 13 14'
  card.marginBottom = 12
  card.on('tap', <any>onCardTap)
  if (card.android) {
    try {
      (<any>card).elevation = 6
    } catch {
      // flat card still reads fine
    }
  }

  // offer tile (left square, colour by data)
  const tile = new StackLayout()
  tile.col = 0
  tile.rowSpan = 2
  tile.width = 88
  tile.height = 88
  tile.className = 'ho-tile'
  tile.backgroundColor = T_COLOR[o.color || 'red'] || T_COLOR.red
  const tileBox = new StackLayout()
  tileBox.orientation = 'vertical'
  tileBox.horizontalAlignment = 'center'
  tileBox.verticalAlignment = 'middle'
  const tileText = new Label()
  tileText.className = 'ho-tile-text'
  tileText.text = o.text
  tileText.textAlignment = 'center'
  tileText.fontSize = o.text.length <= 3 ? 18 : o.text.length === 4 ? 16.5 : 14.5
  tileBox.addChild(tileText)
  if (o.sub) {
    const tileSub = new Label()
    tileSub.className = 'ho-tile-sub'
    tileSub.text = o.sub
    tileSub.textAlignment = 'center'
    tileSub.marginTop = 1
    tileBox.addChild(tileSub)
  }
  tile.addChild(tileBox)
  card.addChild(tile)

  // title + bookmark share the top-right cell
  const title = new Label()
  title.col = 1
  title.className = 'ho-card-title'
  title.text = offerTitle(o)
  title.textWrap = true
  title.marginRight = 30
  title.marginTop = 1
  card.addChild(title)

  const bkm = new Image()
  bkm.col = 1
  bkm.id = 'bkm_' + i
  bkm.src = savedIds.has(o.id) ? 'res://ic_bkm_save' : 'res://ic_bkm_ink'
  bkm.width = 20
  bkm.height = 20
  bkm.stretch = 'aspectFit'
  bkm.horizontalAlignment = 'right'
  bkm.verticalAlignment = 'top'
  bkm.on('tap', <any>onSaveTap)
  card.addChild(bkm)

  // shop line + distance/ends chips under the title
  const under = new StackLayout()
  under.col = 1
  under.row = 1
  under.marginTop = 9
  const shopRow = new StackLayout()
  shopRow.orientation = 'horizontal'
  const shopIco = new Image()
  shopIco.src = 'res://ic_shop_gy'
  shopIco.width = 15
  shopIco.height = 15
  shopIco.stretch = 'aspectFit'
  shopIco.verticalAlignment = 'middle'
  shopRow.addChild(shopIco)
  const shopLbl = new Label()
  shopLbl.className = 'ho-card-shop'
  shopLbl.text = o.shop || 'Offer partner'
  shopLbl.verticalAlignment = 'middle'
  shopLbl.marginLeft = 6
  shopRow.addChild(shopLbl)
  under.addChild(shopRow)

  const chips = new StackLayout()
  chips.orientation = 'horizontal'
  chips.marginTop = 8
  chips.addChild(chip('res://ic_pin_ink', fmtDist(dKm), 'ho-chip-text'))
  if (o.endsAtMs && o.endsAtMs > Date.now()) {
    chips.addChild(chip('res://ic_clock_end', fmtEnds(o.endsAtMs), 'ho-chip-end'))
  }
  under.addChild(chips)
  card.addChild(under)
  return card
}

function chip(ico: string, text: string, textClass: string): GridLayout {
  const shell = new GridLayout()
  shell.className = 'ho-chip'
  shell.columns = 'auto, auto'
  const im = new Image()
  im.src = ico
  im.width = 12
  im.height = 12
  im.stretch = 'aspectFit'
  im.verticalAlignment = 'middle'
  shell.addChild(im)
  const lb = new Label()
  lb.className = textClass
  lb.text = text
  lb.verticalAlignment = 'middle'
  lb.marginLeft = 4
  shell.addChild(lb)
  return shell
}

function emptyState(): StackLayout {
  const wrap = new StackLayout()
  wrap.marginTop = 26
  const big = new Label()
  big.className = 'ho-empty-big'
  big.text = 'Nothing around yet'
  big.textAlignment = 'center'
  wrap.addChild(big)
  const sub = new Label()
  sub.className = 'ho-sub'
  sub.text = 'Offer stickers show up here and on the map the moment partners post them.'
  sub.textWrap = true
  sub.textAlignment = 'center'
  sub.marginTop = 6
  wrap.addChild(sub)
  return wrap
}

function offerTitle(o: Offer): string {
  if (o.title) {
    return o.title
  }
  // legacy sparse doc: readable fallback instead of a blank row
  const base = o.text + ' offer'
  return o.shop ? base + ' at ' + o.shop : base
}

/* ------------------------------ saved bookmark ----------------------------- */

export function onSaveTap(args: TapGestureEventData) {
  const view = <Image>args.object
  const idx = Number(String(view.id || '').replace('bkm_', ''))
  if (!isFinite(idx) || idx < 0 || idx >= offers.length) {
    return
  }
  const o = offers[idx]
  const on = !savedIds.has(o.id)
  if (on) {
    savedIds.add(o.id)
  } else {
    savedIds.delete(o.id)
  }
  persistSavedLocal()
  view.src = on ? 'res://ic_bkm_save' : 'res://ic_bkm_ink'
  writeStateToUser(areaRef || readAreaLocal())
  console.log('[NZ][home]', on ? 'saved' : 'unsaved', o.id)
}

function persistSavedLocal() {
  try {
    ApplicationSettings.setString(SAVED_KEY, JSON.stringify(Array.from(savedIds)))
  } catch {
    // settings unavailable: in-memory only
  }
}

function readSavedLocal(): string[] {
  try {
    const j = ApplicationSettings.getString(SAVED_KEY, '')
    const arr = j ? JSON.parse(j) : []
    return Array.isArray(arr) ? arr.map(String) : []
  } catch {
    return []
  }
}

/* full-state write: area + saved together (set replaces the document) */
function writeStateToUser(area: Area | null) {
  if (!area) {
    return
  }
  saveUserArea(<Record<string, unknown>>sanitizedArea(area), Array.from(savedIds))
}

/* ------------------------------- geolocation ------------------------------- */

export function onLocateTap(args: EventData) {
  if (fixingBusy) {
    return
  }
  fixingBusy = true
  const page = (<View>args.object).page
  if (page) {
    pageRef = page
  }
  serviceReady()
    .then((ok) => (ok ? readFix() : null))
    .then(() => {
      fixingBusy = false
    })
    .catch(() => {
      fixingBusy = false
    })
}

async function serviceReady(): Promise<boolean> {
  try {
    if (!(await geolocation.isEnabled())) {
      await geolocation.enableLocationRequest()
    }
    return true
  } catch (err) {
    console.log('[NZ][home] locate off:', errText(err))
    return false
  }
}

async function readFix(): Promise<boolean> {
  try {
    const loc = await geolocation.getCurrentLocation({
      desiredAccuracy: ACC_HIGH,
      updateTime: 4000,
      timeout: 12000,
    })
    const acc = Number(loc.horizontalAccuracy)
    areaRef = {
      lat: loc.latitude,
      lng: loc.longitude,
      radiusKm: areaRef ? areaRef.radiusKm : defaultRadius(),
      accuracyM: isFinite(acc) ? acc : 0,
      locality: areaRef ? areaRef.locality : undefined,
      setTimeMs: Date.now(),
    }
    persistAreaLocal(areaRef)
    writeStateToUser(areaRef)
    presentOffers()
    // label the fresh fix with a locality when the device Geocoder can
    nameLocality(areaRef).then((name) => {
      if (name && areaRef && name !== areaRef.locality) {
        areaRef.locality = name
        persistAreaLocal(areaRef)
        writeStateToUser(areaRef)
        presentOffers()
      }
    })
    console.log('[NZ][home] fresh fix', loc.latitude.toFixed(5), loc.longitude.toFixed(5))
    return true
  } catch (err) {
    console.log('[NZ][home] locate failed:', errText(err))
    return false
  }
}

/* Android-native reverse geocode (same as the location page) */
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
    console.log('[NZ][home] geocode unavailable:', errText(err))
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

function readAreaLocal(): Area | null {
  try {
    const j = ApplicationSettings.getString(AREA_KEY, '')
    if (!j) {
      return null
    }
    const a = <Area>JSON.parse(j)
    if (a && isFinite(a.lat) && isFinite(a.lng)) {
      a.radiusKm = isFinite(a.radiusKm) && a.radiusKm > 0 ? a.radiusKm : defaultRadius()
      return a
    }
  } catch {
    // fall through to default
  }
  return null
}

function persistAreaLocal(a: Area) {
  try {
    ApplicationSettings.setString(AREA_KEY, JSON.stringify(sanitizedArea(a)))
  } catch {
    // settings unavailable: in-memory only
  }
}

function defaultRadius(): number {
  try {
    const v = parseFloat(ApplicationSettings.getString(RADIUS_KEY, '2'))
    return isFinite(v) && v >= 0.5 && v <= 10 ? v : 2
  } catch {
    return 2
  }
}

/* --------------------------------- helpers -------------------------------- */

const EARTH_KM = 6371.0088

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r1 = (lat1 * Math.PI) / 180
  const r2 = (lat2 * Math.PI) / 180
  const dLat = r2 - r1
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(r1) * Math.cos(r2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function fmtKm(v: number) {
  return v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)
}

function fmtDist(km: number): string {
  const m = km * 1000
  if (m < 995) {
    return Math.round(m / 10) * 10 + ' m'
  }
  return (m % 1000 === 0 ? (m / 1000).toFixed(0) : (m / 1000).toFixed(1)) + ' km'
}

function relTime(ms: number): string {
  if (!ms) {
    return 'updated just now'
  }
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) {
    return 'updated just now'
  }
  const m = Math.round(s / 60)
  if (m < 60) {
    return 'updated ' + m + ' m ago'
  }
  const h = Math.round(m / 60)
  if (h < 48) {
    return 'updated ' + h + ' h ago'
  }
  return 'updated ' + Math.round(h / 24) + ' d ago'
}

function fmtEnds(ms: number): string {
  const now = new Date()
  const then = new Date(ms)
  if (now.toDateString() === then.toDateString()) {
    let h = then.getHours() % 12
    if (h === 0) {
      h = 12
    }
    const mm = then.getMinutes() < 10 ? '0' + then.getMinutes() : String(then.getMinutes())
    const ap = then.getHours() < 12 ? 'AM' : 'PM'
    return 'Ends today · ' + h + ':' + mm + ' ' + ap
  }
  return 'Ends ' + then.getDate() + ' ' + MONTHS[then.getMonth()]
}

/* ------------------------------- interactions ------------------------------ */

/* header sticker -> the location-setup screen (the radius slider lives there) */
export function onStickerTap(args: EventData) {
  const page = (<View>args.object).page
  if (page) {
    page.frame.navigate({ moduleName: 'location-page', clearHistory: true })
  }
}

export function onSearchTap(args: EventData) {
  sink('btnSearchCard')
  const page = (<View>args.object).page
  if (page) {
    page.frame.navigate({
      moduleName: 'features/discovery/screens/search-page',
      context: { offers: offers, savedIds: Array.from(savedIds) },
    })
  }
}

export function onBellTap(args: EventData) {
  // badge is design-static until a notifications source exists
  sink('btnBellCard')
  console.log('[NZ][home] notifications (stub, badge static)')
}

export function onAllTap(args: EventData) {
  sink('btnAllCard')
  const page = (<View>args.object).page
  if (page) {
    page.frame.navigate({
      moduleName: 'features/offers/screens/all-offers-page',
      context: { offers: offers, savedIds: Array.from(savedIds) },
    })
  }
}

export function onLayersTap(args: EventData) {
  console.log('[NZ][home] map layers (stub)')
}

export function onCardTap(args: TapGestureEventData) {
  const view = <View>args.object
  if (String(view.id || '').indexOf('bkm_') === 0) {
    return // the save handler owns bookmark taps
  }
  const m = /^card(\d+)Card$/.exec(String(view.id || ''))
  const idx = m ? Number(m[1]) : -1
  if (idx >= 0 && idx < offers.length) {
    view.page.frame.navigate({
      moduleName: 'features/offers/screens/offer-detail-page',
      context: { offer: offers[idx], offers: offers, savedIds: Array.from(savedIds) },
    })
  }
}

export function onTabTap(args: EventData) {
  const view = <View>args.object
  const tab = String(view.id || '')
  if (tab === 'tab0' || !view.page) {
    return // already home
  }
  if (tab === 'tab1') {
    view.page.frame.navigate({
      moduleName: 'features/discovery/screens/categories-page',
      context: { offers: offers, savedIds: Array.from(savedIds) },
    })
  } else if (tab === 'tab2') {
    view.page.frame.navigate({
      moduleName: 'features/saved/screens/saved-page',
      context: { offers: offers, savedIds: Array.from(savedIds) },
    })
  } else if (tab === 'tab3') {
    view.page.frame.navigate({ moduleName: 'signin-page' })
  }
}

function sink(id: string) {
  const card = pageRef ? <View>pageRef.getViewById(id) : null
  if (!card) {
    return
  }
  card
    .animate({
      translate: { x: 2, y: 2 },
      duration: 80,
      curve: AnimationCurve.easeOut,
    })
    .then(() =>
      card.animate({
        translate: { x: 0, y: 0 },
        duration: 130,
        curve: AnimationCurve.easeOut,
      })
    )
}
