/*
 * Create profile — the unskippable post-sign-in gate (design-mock parallel).
 *
 * New accounts (users/{uid} missing nzProfileDoneMs) must finish their name
 * here before the location step. Existing accounts never see this page:
 * completeSignIn() routes them to location-page directly.
 *
 * Skippability, closed every way around:
 *   - no back sticker on the screen at all
 *   - Android hardware back is cancelled while this page is on screen
 *   - Save is the only exit; it stamps the profile (via saveUserProfile) and
 *     only then releases the flow to the location step
 *
 * Field discipline:
 *   phone auth  -> mobile locked to the number Firebase verified, the
 *                  Verified chip is permanent (the number IS the identity)
 *   google auth -> name/email prefilled from the Google profile, editable;
 *                  mobile stays locked empty (no claimable number), no chip
 */

import {
  Application,
  EventData,
  Label,
  NavigatedData,
  Page,
  TextField,
  View,
} from '@nativescript/core'
import {
  onLinkTouch,
  onStickerTouch,
  defuseAutofill,
  defuseWindowAutofill,
  stripNativeChrome,
  tintCaret,
} from './press-feel'
import {
  errText,
  firebaseAuth,
  saveUserProfile,
  ProfileCtx,
} from './firebase'

export { onLinkTouch, onStickerTouch }

const NON_DIGIT = /\D/g
const EMAIL_RE = /^\S+@\S+\.\S+$/

let pageRef: Page | null = null
let mode: 'phone' | 'google' = 'phone'
let verifiedDigits = '' // phone mode: the number Firebase verified
let navigatingAway = false
let backBlocked = false // harness hooked

function field(id: string): TextField | null {
  return pageRef ? <TextField>pageRef.getViewById(id) : null
}

function setError(text: string) {
  const box = pageRef ? <Label>pageRef.getViewById('epError') : null
  if (box) {
    box.text = text
    box.visibility = text ? 'visible' : 'collapse'
  }
}

function warn(text: string) {
  setError(text)
  const page = pageRef
  if (page) {
    setTimeout(() => {
      if (pageRef === page && !navigatingAway) {
        setError('')
      }
    }, 2600)
  }
}

/* --------------------------------- lifecycle ------------------------------- */

export function navigatingTo(args: NavigatedData) {
  pageRef = <Page>args.object
  navigatingAway = false

  const ctx = <ProfileCtx>(<unknown>args.context)
  mode = ctx && ctx.mode === 'google' ? 'google' : 'phone'
  const name = ctx && ctx.name ? String(ctx.name) : ''
  const email = ctx && ctx.email ? String(ctx.email) : ''
  const phone = ctx && ctx.phone ? String(ctx.phone).replace(NON_DIGIT, '').slice(-10) : ''
  if (mode === 'phone' && phone.length === 10) {
    verifiedDigits = phone
  } else {
    verifiedDigits = ''
  }

  const nf = field('epName')
  if (nf) {
    nf.text = name
  }
  const ef = field('epEmail')
  if (ef) {
    ef.text = email
  }
  const pf = field('epPhone')
  if (pf) {
    pf.text = phone
    // the number is the identity — locked on both auth paths, no keyboard,
    // no cursor; google accounts carry no mobile at all
    pf.editable = false
    pf.hint = mode === 'phone' ? '' : 'Not verified'
    try {
      const nv = <any>pf.android
      if (nv) {
        nv.setShowSoftInputOnFocus(false)
        nv.setFocusable(false)
        nv.setFocusableInTouchMode(false)
        nv.setCursorVisible(false)
      }
    } catch {
      // native hardening is best-effort; editable already blocks input
    }
  }
  const chip = pageRef ? <Label>pageRef.getViewById('epVerified') : null
  if (chip) {
    chip.visibility = mode === 'phone' && phone.length === 10 ? 'visible' : 'collapse'
  }
  setError('')
}

export function onLoaded(args: EventData) {
  pageRef = <Page>args.object
  defuseWindowAutofill(<Page>pageRef)
  for (const id of ['epName', 'epPhone', 'epEmail']) {
    const f = field(id)
    if (f) {
      defuseAutofill(f)
      stripNativeChrome(f)
      tintCaret(f, 0xFF1C1B19)
    }
  }
  if (isAndroidRuntime()) {
    try {
      Application.android.on('activityBackPressed', onBackPressed)
      backBlocked = true
    } catch (err) {
      console.log('[NZ][profile] back harness off:', errText(err))
    }
  }
}

export function onUnloaded() {
  if (backBlocked && Application.android) {
    try {
      Application.android.off('activityBackPressed', onBackPressed)
    } catch {
      // ignore
    }
    backBlocked = false
  }
  pageRef = null
}

function isAndroidRuntime(): boolean {
  return !!(Application.android && Application.android.context)
}

/* hardware back: cancelled — no back sticker to shake, the headline takes
 * the nudge; the gate is the only exit */
function onBackPressed(args: any) {
  if (!pageRef || !pageRef.isLoaded || navigatingAway) {
    return // other pages live and die with our own listener
  }
  args.cancel = true
  const title = <View>pageRef.getViewById('epTitle')
  if (title) {
    shakeView(title)
  }
  warn('Finish your profile to continue.')
}

/* --------------------------------- fields ---------------------------------- */

export function onFieldChange(args: any) {
  const f = <TextField>args.object
  if (!f || !pageRef || navigatingAway) {
    return
  }
  setError('') // typing clears feedback (same language as the sign-in page)
  // mobile is locked (see navigatingTo) so there is no chip-toggle path
  // anymore: a verified number can never be edited away
}

/* ---------------------------------- save ----------------------------------- */

export function onSave(args: EventData) {
  const page = pageRef || (<View>args.object).page
  if (navigatingAway) {
    return
  }
  const nf = field('epName')
  const pf = field('epPhone')
  const ef = field('epEmail')
  if (!nf) {
    return
  }
  const name = String(nf.text || '').trim()
  if (!name) {
    setError('Add your name to keep the account on this profile.')
    shakeView(nf)
    return
  }
  let email = String(ef ? ef.text || '' : '').trim()
  if (email && !EMAIL_RE.test(email)) {
    setError('That email does not look complete yet.')
    shakeView(<View>ef || (<View>nf))
    return
  }
  const phone = String(pf ? pf.text || '' : '').replace(NON_DIGIT, '').slice(-10)
  const verified = mode === 'phone' && phone.length === 10 && phone === verifiedDigits

  navigatingAway = true
  firebaseAuth()
    .then((auth) => {
      const user = auth && auth.currentUser
      if (!user || !user.uid) {
        console.log('[NZ][profile] session gone — back to sign-in')
        page.frame.navigate({ moduleName: 'signin-page', clearHistory: true })
        return null
      }
      return saveUserProfile(String(user.uid), name, email, phone, verified)
    })
    .then(() => {
      if (!page.frame) {
        return
      }
      page.frame.navigate({ moduleName: 'location-page', clearHistory: true })
    })
    .catch((err) => {
      console.log('[NZ][profile] save failed:', errText(err))
      navigatingAway = false
      setError('Could not save right now. Try again.')
      shakeView(<View>(page.getViewById('saveBtn') || page))
    })
}

/* the gate has no back affordance anywhere on screen (see header note) */

function shakeView(view: View) {
  view
    .animate({ translate: { x: 5, y: 0 }, duration: 55 })
    .then(() => view.animate({ translate: { x: -5, y: 0 }, duration: 110 }))
    .then(() => view.animate({ translate: { x: 0, y: 0 }, duration: 55 }))
}
