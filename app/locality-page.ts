/*
 * Locality search — Nominatim (OpenStreetMap) backed, keyless and free
 * forever (the same OSM family the app's tiles already ride on): one
 * request per 800 ms of settled typing, India-fenced, most recent answer
 * wins. Every choice opens the shared sticker dialog; an agreement is what
 * writes the area to the device store (and the signed-in profile) and
 * releases to home. Nothing saves on a cancel or a back-out.
 */
import {
  EventData,
  GridLayout,
  Label,
  NavigatedData,
  Page,
  ScrollView,
  StackLayout,
  TextField,
  View,
} from '@nativescript/core'
import { onLinkTouch, onStickerTouch, defuseWindowAutofill } from './press-feel'
import { errText } from './firebase'
import { LocatedArea, persistFix, radiusKmFor } from './locate'
import { onDlgScrimTap, openDialog } from './nz-dialog'

export { onLinkTouch, onStickerTouch, onDlgScrimTap }

type Row = {
  lat: number
  lng: number
  locality: string
  detail: string
}

let pageRef: Page | null = null
let debounce: ReturnType<typeof setTimeout> | null = null
let seq = 0
// single press on this ROM can dispatch twice: the second dispatch would
// instantly confirm whatever dialog the first one opened
let lastRowMs = 0

const MIN_CHARS = 3
const DEBOUNCE_MS = 800

export function navigatingTo(args: NavigatedData) {
  pageRef = <Page>args.object
  seq++ // any in-flight search from a previous visit is stale
  setNote('', '')
}

export function onLoaded() {
  if (!pageRef) {
    return
  }
  defuseWindowAutofill(<Page>pageRef)
}

export function onBack(args: EventData) {
  const page = (<View>args.object).page
  if (page) {
    page.frame.goBack()
  }
}

export function onQuery(args: any) {
  const f = <TextField>args.object
  if (!pageRef) {
    return
  }
  const q = String((f && f.text) || '').trim()
  if (debounce) {
    clearTimeout(debounce)
    debounce = null
  }
  if (q.length < MIN_CHARS) {
    seq++ // settle killed: the field is below the search floor
    if (hasRows()) {
      clearRows()
      setNote('', '')
    }
    return
  }
  const hit = q
  debounce = setTimeout(() => {
    debounce = null
    search(hit)
  }, DEBOUNCE_MS)
}

export function onQueryPress(args: any) {
  const f = <TextField>args.object
  const q = String((f && f.text) || '').trim()
  if (q.length >= MIN_CHARS) {
    if (debounce) {
      clearTimeout(debounce)
      debounce = null
    }
    search(q)
  }
}

/* ------------------------------- the search ------------------------------- */

async function search(q: string): Promise<void> {
  const page = pageRef
  if (!page) {
    return
  }
  const run = ++seq
  setNote('Searching…', '')
  clearRows()
  try {
    const url =
      'https://nominatim.openstreetmap.org/search?q=' +
      encodeURIComponent(q) +
      '&format=jsonv2&addressdetails=1&countrycodes=in&limit=8'
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Accept-Language': 'en',
        'User-Agent': 'NearZoop/1.0 (Android; locality search)',
      },
    })
    if (run !== seq) {
      return // a newer query took over while this one flew
    }
    if (!res || !res.ok) {
      throw new Error('HTTP ' + (res && res.status))
    }
    const arr = await res.json()
    if (run !== seq) {
      return
    }
    const rows = uniqueRows(<any[]>arr)
    clearRows()
    if (!rows.length) {
      setNote('Nothing found. Try a nearby landmark or a PIN code.', 'err')
      return
    }
    setNote('', '')
    const list = listRef(page)
    rows.forEach((r, i) => {
      list.addChild(rowView(r, i))
    })
  } catch (err) {
    if (run === seq) {
      console.log('[NZ][locality] search failed:', errText(err))
      setNote("Couldn't reach search. Check the internet, then try again.", 'err')
    }
  }
}

/* shape + dedupe Nominatim rows: short leading name, neat district detail */
function uniqueRows(arr: any[]): Row[] {
  const out: Row[] = []
  const seen = new Set<string>()
  ;(arr || []).forEach((v) => {
    const lat = Number(v && v.lat)
    const lng = Number(v && v.lon)
    if (!isFinite(lat) || !isFinite(lng)) {
      return
    }
    const a = <Record<string, string>>(<unknown>(v.address || {}))
    const head = String(v.display_name || '').split(',')[0] || ''
    const locality = String(
      v.name || a.suburb || a.neighbourhood || a.city_district || a.city ||
        a.town || a.village || head
    ).trim()
    const line = String(v.display_name || locality)
    if (!locality || !line) {
      return
    }
    const parts: string[] = []
    ;[a.city || a.town || a.village || a.county, a.state].forEach((p: any) => {
      const s = p ? String(p).trim() : ''
      if (s && s.toLowerCase() !== 'india' && s !== locality && parts.indexOf(s) < 0) {
        parts.push(s)
      }
    })
    if (!parts.length) {
      line
        .split(',')
        .slice(1, 3)
        .map((p) => p.trim())
        .filter(Boolean)
        .forEach((p) => {
          if (p.toLowerCase() !== 'india' && parts.indexOf(p) < 0 && parts.length < 2) {
            parts.push(p)
          }
        })
    }
    const detail = parts.join(' · ') || 'Exact pin from the map search'
    // one visible row per place+context: Nominatim returns several feature
    // types per locality (node/way/transit), which read as duplicate cards
    const key = (locality + '|' + detail).toLowerCase()
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    out.push({
      lat: lat,
      lng: lng,
      locality: locality,
      detail: detail,
    })
  })
  return out.slice(0, 8)
}

/* -------------------------------- the rows -------------------------------- */

function listRef(page: Page): StackLayout {
  return <StackLayout>page.getViewById('resList')
}

function hasRows(): boolean {
  if (!pageRef) {
    return false
  }
  const list = listRef(pageRef)
  if (!list) {
    return false
  }
  let n = 0
  list.eachChildView(() => {
    n++
    return true
  })
  return n > 0
}

function clearRows() {
  if (!pageRef) {
    return
  }
  const list = listRef(pageRef)
  if (!list) {
    return
  }
  const kids: View[] = []
  list.eachChildView((v) => {
    kids.push(v)
    return true
  })
  kids.forEach((k) => list.removeChild(k))
}

function setNote(text: string, kind: string) {
  if (!pageRef) {
    return
  }
  const n = <Label>pageRef.getViewById('qNote')
  if (n) {
    n.text = text
    n.className = kind === 'err' ? 'si-err' : 'si-sub'
  }
}

function rowView(r: Row, i: number): View {
  const row = new GridLayout()
  row.className = 'lp-row'
  row.columns = 'auto, *'
  row.marginBottom = 10
  row.id = 'lr' + i

  // ink badge + initial letter — same sticker language as the account sheet
  const badge = new GridLayout()
  badge.col = 0
  badge.className = 'lp-pin'
  badge.width = 40
  badge.height = 40
  const letter = new Label()
  letter.className = 'gp-avatar-letter'
  letter.text = String(r.locality || 'A').charAt(0).toUpperCase()
  letter.horizontalAlignment = 'center'
  letter.verticalAlignment = 'middle'
  badge.addChild(letter)
  row.addChild(badge)

  const col = new StackLayout()
  col.col = 1
  col.marginLeft = 12
  col.verticalAlignment = 'middle'
  const name = new Label()
  name.className = 'gp-name'
  name.text = r.locality
  const det = new Label()
  det.className = 'gp-mail'
  det.text = r.detail
  det.marginTop = 2
  col.addChild(name)
  col.addChild(det)
  row.addChild(col)

  row.on('tap', () => selectRow(row, r))
  return row
}

/* the confirm conversation: nothing writes until the primary says so */
function selectRow(row: View, r: Row) {
  const page = pageRef
  if (!page) {
    return
  }
  const now = Date.now()
  if (now - lastRowMs < 700) {
    return // ghost second dispatch from the same physical press
  }
  lastRowMs = now
  row
    .animate({ translate: { x: 2, y: 2 }, duration: 70 })
    .then(() => row.animate({ translate: { x: 0, y: 0 }, duration: 110 }))
    .catch(() => undefined)
  const short = r.locality || 'this place'
  openDialog(page, {
    title: 'Is ' + short + ' right?',
    body:
      'Offers will come from ' +
      (r.detail ? r.detail : 'this exact pin') +
      '. Your radius slider carries over.',
    bodyEmph: r.detail ? r.detail : 'this exact pin',
    primaryLabel: 'Yes — use this',
    onPrimary: () => {
      const area: LocatedArea = {
        lat: r.lat,
        lng: r.lng,
        radiusKm: radiusKmFor(),
        accuracyM: 0,
        locality: r.locality,
        setTimeMs: Date.now(),
      }
      persistFix(area)
      toMain(page)
    },
    secondaryLabel: 'Back to search',
  })
}

function toMain(page: Page) {
  page.frame.navigate({
    moduleName: 'main-page',
    clearHistory: true,
  })
}
