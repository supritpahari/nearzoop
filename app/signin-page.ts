import {
  EventData,
  Label,
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
  phoneVerifyStart,
} from './firebase'
import {
  googleCredentialFlow,
  finishGoogleSignIn,
} from './firebase'

let googleBusy = false

export { onLinkTouch, onStickerTouch, defuseAutofill, defuseWindowAutofill, stripNativeChrome, tintCaret }

const NON_DIGIT = /\D/g

// This ROM's autofill provider paints a pale-blue "filled here" pill over the
// phone field (it grabs the prefill number). Mark the field un-autofillable on
// entry so the sticker stays clean for everyone.
export function onNavigatingTo(args: EventData) {
  const page = <Page>args.object
  // fresh entry or revisit (e.g. back from the OTP page): button must not
  // stay frozen in its last flight state; error line starts clean
  resetSendBtn(page)
  hideSiErr(page)
  try {
    defuseWindowAutofill(page)
    const field = <TextField>page.getViewById('phoneField')
    if (field) {
      defuseAutofill(field)
      stripNativeChrome(field) // no theme drawable / tint can survive here
      tintCaret(field, 0xFF1C1B19) // ink caret, never the ROM blue bar
    }
  } catch (err) {
    // suppression is cosmetic — never block sign-in over it
  }
}

// focus = the moment a NEW autofill session is requested; re-assert the
// window exclusion and cancel whatever the provider just started building
export function onFocusDefuse(args: EventData) {
  try {
    const field = <TextField>args.object
    const page = field && field.page
    if (page) {
      defuseWindowAutofill(page)
    }
    if (field) {
      defuseAutofill(field)
      stripNativeChrome(field) // focus can re-assert the theme drawable — kill it again
    }
  } catch (err) {
    // cosmetic only
  }
}

const isDigit = (ch: string) => !!ch && ch >= '0' && ch <= '9'

/* selection helpers — native Android/iOS, never crash if unavailable */
function getSelStart(field: TextField, fallback: number): number {
  try {
    const nv = <any>field.nativeView
    if (nv && typeof nv.getSelectionStart === 'function') {
      const s = nv.getSelectionStart()
      if (s >= 0) return s
    }
    const iv = <any>field.ios
    if (iv && typeof iv.offsetFromPositionToPosition === 'function') {
      const range = iv.selectedTextRange
      if (range) return iv.offsetFromPositionToPosition(iv.beginningOfDocument, range.start)
    }
  } catch (err) {
    /* keep fallback */
  }
  return fallback
}

function setSelPos(field: TextField, pos: number) {
  try {
    const nv = <any>field.nativeView
    if (nv && typeof nv.setSelection === 'function') {
      const max = nv.getText ? String(nv.getText()).length : 0xff
      nv.setSelection(Math.max(0, Math.min(pos, max)))
      return
    }
    const iv = <any>field.ios
    if (iv && typeof iv.positionFromPositionOffset === 'function') {
      const target = iv.positionFromPositionOffset(iv.beginningOfDocument, Math.max(0, pos))
      if (target) iv.selectedTextRange = iv.textRangeFromPosition(target, target)
    }
  } catch (err) {
    /* cosmetic only */
  }
}

function countDigits(src: string, upto: number) {
  let n = 0
  const stop = Math.min(upto, src.length)
  for (let i = 0; i < stop; i++) {
    if (isDigit(src[i])) n++
  }
  return n
}

/* index in src right after the `want`-th digit (or end of string) */
function caretAfterDigits(src: string, want: number) {
  let n = 0
  for (let i = 0; i < src.length; i++) {
    if (isDigit(src[i])) {
      if (n >= want) return i
      n++
    }
  }
  return src.length
}

let prevPhoneLen = 0

// keep only 10 digits; display them grouped like the mock ("98300 45621")
export function onPhoneChange(args: any) {
  const field = <TextField>args.object
  // fresh typing clears the inline error line
  try {
    hideSiErr((<View>field).page)
  } catch { /* cosmetic */ }
  const raw = String(field.text || '')
  const digits = raw.replace(NON_DIGIT, '').slice(0, 10)
  const pretty = digits.length > 5 ? digits.slice(0, 5) + ' ' + digits.slice(5) : digits
  prevPhoneLen = pretty.length
  if (raw === pretty) {
    return // already formatted — never touch the text, never steal the caret
  }
  // map the caret by digit index so reformatting keeps it beside the digits
  const sel = getSelStart(field, raw.length)
  const deleting = raw.length < prevPhoneLen
  const typedDigit = !deleting && isDigit(raw[sel - 1] || '') ? 1 : 0
  const goal = Math.min(10, countDigits(raw, sel) + typedDigit)
  field.text = pretty
  setSelPos(field, caretAfterDigits(pretty, goal))
}

// post-layout pass: the native cursor drawable can materialise after layout,
// so re-assert autofill suppression + the ink caret here too (idempotent)
export function onSignLoaded(args: EventData) {
  const page = <Page>args.object
  try {
    defuseWindowAutofill(page)
    const field = <TextField>page.getViewById('phoneField')
    if (field) {
      defuseAutofill(field)
      stripNativeChrome(field)
      tintCaret(field, 0xFF1C1B19)
    }
    // freshness ladder: AppCompat re-installs its themed background shortly
    // after attach (the "underline on fresh entry" moment). Sweep again a
    // couple of times so any late painter is flattened before it can show.
    const sweep = () => {
      try {
        const f = <TextField>page.getViewById('phoneField')
        if (f) {
          stripNativeChrome(f)
        }
      } catch (err) {
        // cosmetic only
      }
    }
    setTimeout(sweep, 350)
    setTimeout(sweep, 900)
  } catch (err) {
    // cosmetic only
  }
}

/* inline form error: the red line under the number field (id siError in xml) */
function showSiErr(page: Page, msg: string) {
  if (!page) return
  const err = <Label>page.getViewById('siError')
  if (!err) return
  err.text = msg
  err.visibility = 'visible'
}

function hideSiErr(page: Page) {
  if (!page) return
  const err = <Label>page.getViewById('siError')
  if (err) err.visibility = 'collapse'
}

/* Send-OTP "in flight" state: cycling dots on the sticker, dimmed + untappable.
   Reset on failure, on success (navigating away), or whenever the page is
   revisited (e.g. backing out of the OTP page after a code error). */
let siSending = false
let siDotsTimer: any = null

function resetSendBtn(page: Page) {
  siSending = false
  if (siDotsTimer) {
    clearInterval(siDotsTimer)
    siDotsTimer = null
  }
  const lbl = <Label>page.getViewById('sendLbl')
  if (lbl) lbl.text = 'Send OTP'
  const btn = <View>page.getViewById('sendBtn')
  if (btn) btn.opacity = 1
}

function startSendBtnSpin(page: Page) {
  siSending = true
  const btn = <View>page.getViewById('sendBtn')
  if (btn) btn.opacity = 0.55
  const lbl = <Label>page.getViewById('sendLbl')
  let dots = 0
  const tick = () => {
    dots = (dots + 1) % 4
    if (lbl) lbl.text = 'Sending OTP' + '.'.repeat(dots)
  }
  tick()
  siDotsTimer = setInterval(tick, 350)
}

export function onSendOtp(args: EventData) {
  const page = (<View>args.object).page
  const field = <TextField>page.getViewById('phoneField')
  const digits = String(field.text || '').replace(NON_DIGIT, '')
  if (siSending) return // request already in flight — button is disabled
  if (digits.length !== 10) {
    shakeView(field)
    showSiErr(page, 'Enter your 10-digit mobile number')
    return
  }
  hideSiErr(page)
  startSendBtnSpin(page)
  startVerification(page, digits).catch((err) => {
    console.log('[NZ][signin] phone verify failed:', errText(err))
    resetSendBtn(page)
    showSiErr(page, "Couldn't start verification: " + errText(err).slice(0, 80))
    shakeView(field)
  })
}

async function startVerification(page: Page, digits: string) {
  console.log('[NZ][signin] requesting OTP for +91', digits)
  const outcome = await phoneVerifyStart('+91' + digits)
  if (outcome.instantCredential) {
    // native auto-verification finished — pass through the OTP route quickly
    resetSendBtn(page)
    page.frame.navigate({
      moduleName: 'otp-page',
      context: { phone: digits, instant: outcome.instantCredential },
    })
    return
  }
  if (outcome.verifyId) {
    resetSendBtn(page)
    page.frame.navigate({
      moduleName: 'otp-page',
      context: { phone: digits, verifyId: outcome.verifyId },
    })
    return
  }
  throw new Error('empty verification result')
}

export function errText(err: unknown): string {
  const e = <any>err
  return (e && (e.code || e.message)) || String(err)
}

export function onGoogle(args: EventData) {
  const page = (<View>args.object).page
  const btn = <View>(<any>page.getViewById('googleBtn')) || (<View>args.object)
  if (googleBusy) {
    return
  }
  googleBusy = true
  // Google's own default account chooser: the GMS bottom sheet lists the
  // device accounts and returns the ID token directly — nothing custom.
  googleCredentialFlow()
    .then((cred) => {
      if (!cred) {
        // sheet cancelled — stay unsigned, stay right here (no error, no navigation)
        return
      }
      return finishGoogleSignIn(page, cred).catch((err) => {
        console.log('[NZ][gauth] sign-in failed:', errText(err))
        shakeView(btn)
      })
    })
    .catch((err) => {
      console.log('[NZ][gauth] google sheet failed:', errText(err))
      shakeView(btn)
    })
    .then(() => {
      googleBusy = false
    })
}

export function onNotNow(args: EventData) {
  // browse without an account
  toLocation((<View>args.object).page)
}

/* business-partner entry point: separate onboarding flow (not built yet) */
export function onBusinessTap(args: EventData) {
  const lbl = <Label>args.object
  lbl
    .animate({ translate: { x: 0, y: 2 }, duration: 70 })
    .then(() => lbl.animate({ translate: { x: 0, y: 0 }, duration: 130 }))
  console.log('[NZ][signin] business join tapped (flow stub)')
}

export function onBack(args: EventData) {
  ;(<View>args.object).page.frame.goBack()
}

function toLocation(page: Page) {
  page.frame.navigate({ moduleName: 'location-page', clearHistory: true })
}

function shakeView(view: View) {
  view
    .animate({ translate: { x: 5, y: 0 }, duration: 55 })
    .then(() => view.animate({ translate: { x: -5, y: 0 }, duration: 110 }))
    .then(() => view.animate({ translate: { x: 0, y: 0 }, duration: 55 }))
}
