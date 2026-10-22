/*
 * Splash — brand frame, spinner, and the cold-start locate step.
 *
 * On load it asks for the device's location permission (first install opens
 * the OS dialog right over the splash; later starts skip straight to a fix),
 * then labels the restore strip with the real area: "RESTORING <AREA> · km".
 * The strip keeps the design-default text while nothing is known yet.
 *
 * Advance waits for the minimum splash window, a settled locate pipeline
 * (bounded budget so a slow grant can't strand users here), AND the session
 * route: no session -> onboarding; a session whose Firestore profile has no
 * name -> the Create-profile gate (same prefills the sign-in router feeds);
 * a session with a name -> home. Any tap skips ahead — for a signed-in user
 * it still honors the same route once the read settles. The located fix is
 * persisted into the shared area store (locate.ts) so the location page and
 * home pre-center on it.
 */
import { EventData, Enums, GridLayout, Image, Label, Page } from '@nativescript/core'
import {
  locateUser,
  persistFix,
  radiusKmFor,
  reverseAreaName,
} from './locate'
import { errText, firebaseAuth, firebaseDb, ProfileCtx } from './firebase'

// Matches the design spec: 1.15s linear infinite spin (zoop-spin).
const SPIN_DURATION = 1150
// Auto-advance once the minimum splash window AND the locate step are done.
const SPLASH_MS = 2600
// OS permission dialog time + one fix + naming, bounded.
const LOCATE_BUDGET_MS = 12000
// Device Geocoder can be slow on first use; name on a side budget.
const NAME_BUDGET_MS = 2500
// Session route decision (auth check + one Firestore read), bounded.
const ROUTE_BUDGET_MS = 6000
// Same accuracy bar the location page holds a fix to.
const ACCURACY_LIMIT_M = 800

type Route = 'onboarding' | 'create-profile' | 'home'

let advanced = false
let tapped = false
let timerDone = false
let locateDone = false
let routeReady = false
let route: Route = 'onboarding'
// prefill context for the create-profile route (built by routeForSession)
let gateCtx: ProfileCtx | null = null

const onlyDigits = (s: string) => String(s || '').replace(/\D/g, '').slice(-10)

/* Where does a cold start go?
 *   no session        -> onboarding (the locate pipeline still runs)
 *   session, no name  -> Create-profile gate with the same prefills the
 *                        sign-in router feeds it
 *   session + name    -> home (the cold-start land-on-onboarding bug, closed) */
async function routeForSession(): Promise<Route> {
  let user: any = null
  try {
    const auth = await firebaseAuth()
    user = auth && auth.currentUser
  } catch (err) {
    console.log('[NZ][splash] auth unavailable:', errText(err))
    return 'onboarding'
  }
  if (!user || !user.uid) {
    return 'onboarding'
  }
  console.log('[NZ][splash] session found:', String(user.uid))
  let docVal: Record<string, unknown> | null = null
  try {
    const db = await firebaseDb()
    const doc: any = await (<any>db.collection('users').doc(String(user.uid))).get()
    docVal = doc && doc.exists && doc.data ? <Record<string, unknown>>(doc.data() || {}) : null
  } catch (err) {
    console.log('[NZ][splash] profile read blocked:', errText(err))
  }
  if (!docVal) {
    // unreadable profile: fail-closed into the gate, same direction the
    // sign-in router takes — it refills from the session and saves fine
    buildGateCtx(<Record<string, unknown>>{}, user)
    return 'create-profile'
  }
  const prof = <{ name?: unknown; email?: unknown; phone?: unknown }>docVal.profile || {}
  const named = typeof prof.name === 'string' && !!prof.name.trim()
  if (named) {
    console.log('[NZ][splash] named account -> home')
    return 'home'
  }
  console.log('[NZ][splash] signed-in but nameless -> create profile')
  buildGateCtx(docVal, user)
  return 'create-profile'
}

/* gate context from the stored doc + the live session: phone mode whenever
 * a phone number exists anywhere (locked field shows the verified digits +
 * the chip), google mode otherwise; name/email prefer saved, fall to session */
function buildGateCtx(docVal: Record<string, unknown>, user: any): void {
  const prof = <{ name?: unknown; email?: unknown; phone?: unknown }>docVal.profile || {}
  const phoneSaved = typeof prof.phone === 'string' ? onlyDigits(prof.phone) : ''
  const phoneAuth = onlyDigits(<string>(<unknown>user.phoneNumber) || '')
  const mode: ProfileCtx['mode'] = phoneSaved || phoneAuth ? 'phone' : 'google'
  gateCtx = {
    mode: mode,
    name:
      typeof prof.name === 'string' && prof.name.trim()
        ? prof.name.trim()
        : String(user.displayName || ''),
    email:
      typeof prof.email === 'string' && prof.email
        ? prof.email
        : String(user.email || ''),
    phone: mode === 'phone' ? phoneSaved || phoneAuth : '',
  }
}

export function onLoaded(args: EventData) {
  advanced = false
  tapped = false
  timerDone = false
  locateDone = false
  routeReady = false
  route = 'onboarding'
  gateCtx = null
  const root = <GridLayout>args.object
  const spinner = <Image>root.getViewById('splash-spinner')

  if (spinner) {
    // Continuous rotation: keep bumping the target angle so the view
    // never snaps back to 0 between cycles (iterations: Infinity is
    // unreliable on both runtimes). Dies with the page.
    let angle = 0
    const spin = () => {
      if (advanced || !spinner.isLoaded) {
        return
      }
      angle += 360
      spinner
        .animate({
          rotate: angle,
          duration: SPIN_DURATION,
          curve: Enums.AnimationCurve.linear,
        })
        .then(spin)
    }
    spin()
  }

  const page = root.page
  const tryAdv = () => tryAdvance(page)
  setTimeout(() => {
    timerDone = true
    tryAdv()
  }, SPLASH_MS)
  withBudget(runLocate(page), LOCATE_BUDGET_MS, null).then(() => {
    locateDone = true
    tryAdv()
  })
  withBudget(routeForSession(), ROUTE_BUDGET_MS, 'onboarding').then((r) => {
    route = r
    routeReady = true
    tryAdv()
  })
}

export function onTap(args: EventData) {
  // A tap skips the remaining splashing — where it goes still obeys the
  // session route, so a signed-in user never bounces to onboarding.
  tapped = true
  tryAdvance((<GridLayout>args.object).page)
}

function tryAdvance(page: Page | null) {
  if (!page || advanced) {
    return
  }
  if (tapped) {
    // skip everything except an unsettled route decision (bounded)
    if (routeReady) {
      advance(page, route)
    }
    return
  }
  if (timerDone && locateDone && routeReady) {
    advance(page, route)
  }
}

/* Ask, fix, name, persist, relabel. Silent on every failure path — the
 * design-default strip remains and the flow advances as usual. */
async function runLocate(page: Page | null): Promise<void> {
  try {
    const fix = await locateUser()
    if (!fix || advanced) {
      return
    }
    persistFix(fix)
    const name = await withBudget(reverseAreaName(fix.lat, fix.lng), NAME_BUDGET_MS, '')
    if (advanced) {
      return
    }
    if (name) {
      setStatus(
        page,
        'RESTORING ' +
          name.toUpperCase() +
          ' · ' +
          fmtKm(radiusKmFor(fix.radiusKm))
      )
    } else {
      // a real fix without a name: honest wording instead of a fake label
      setStatus(page, 'RESTORING NEAR YOU · ' + fmtKm(radiusKmFor(fix.radiusKm)))
    }
    console.log(
      '[NZ][splash] located',
      fix.lat.toFixed(5),
      fix.lng.toFixed(5),
      '±' + Math.round(fix.accuracyM || 0) + 'm',
      'as "' + name + '"',
      (fix.accuracyM || 0) <= ACCURACY_LIMIT_M ? 'sharp' : 'coarse'
    )
  } catch (err) {
    console.log('[NZ][splash] locate pipeline failed:', (err && (<any>err).message) || err)
  }
}

function setStatus(page: Page | null, text: string) {
  if (advanced || !page) {
    return
  }
  const label = <Label>page.getViewById('statusLabel')
  if (label) {
    label.text = text
  }
}

function fmtKm(km: number) {
  return (km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)) + ' km'
}

/* Resolve with the promise's value, or the fallback when it exceeds ms or
 * rejects — a bounded pipeline rather than an open-ended await chain */
function withBudget<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false
    const settle = (v: T) => {
      if (!done) {
        done = true
        resolve(v)
      }
    }
    const t = setTimeout(() => settle(fallback), ms)
    p.then((v) => {
      clearTimeout(t)
      settle(v)
    }).catch(() => {
      clearTimeout(t)
      settle(fallback)
    })
  })
}

function advance(page: Page | null, r: Route) {
  if (advanced || !page) {
    return
  }
  advanced = true
  const target =
    r === 'home'
      ? 'main-page'
      : r === 'create-profile'
        ? 'profile-page'
        : 'onboarding-page'
  console.log('[NZ][splash] landing on', target)
  page.frame.navigate({
    moduleName: target,
    clearHistory: true,
    context: r === 'create-profile' && gateCtx ? gateCtx : undefined,
  })
}
