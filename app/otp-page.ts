import {
  EventData,
  Label,
  NavigatedData,
  Page,
  PropertyChangeData,
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
  completeSignIn,
  errText,
  phoneCredential,
  phoneSignIn,
  phoneVerifyStart,
} from './firebase'

export { onLinkTouch, onStickerTouch }

const COUNT_START = 24
const NON_DIGIT = /\D/g

let phoneDigits = '9830045621'
let verifyIdRef: string | null = null
let instantRef: any | null = null
let count = COUNT_START
let timer: ReturnType<typeof setInterval> | null = null
let pageRef: Page | null = null
let navigatingAway = false

export function navigatingTo(args: NavigatedData) {
  const ctx = <{ phone?: string; verifyId?: string; instant?: any }>args.context || {}
  if (ctx.phone) {
    const digits = String(ctx.phone).replace(NON_DIGIT, '')
    if (digits.length === 10) {
      phoneDigits = digits
    }
  }
  verifyIdRef = typeof ctx.verifyId === 'string' && ctx.verifyId ? ctx.verifyId : null
  instantRef = ctx.instant || null
  count = COUNT_START
  navigatingAway = false
}

export function onLoaded(args: EventData) {
  pageRef = <Page>args.object
  // no autofill pill, ink caret: unified native-side treatment on all six boxes
  defuseWindowAutofill(<Page>pageRef)
  for (let i = 0; i < 6; i++) {
    const f = <TextField>pageRef.getViewById('ot' + i)
    if (f) {
      defuseAutofill(f)
      stripNativeChrome(f)
      tintCaret(f, 0xFF1C1B19)
    }
  }
  const line = <Label>pageRef.getViewById('smsLine')
  if (line) {
    line.text = maskPhone(phoneDigits)
  }
  const empty = firstEmpty()
  markActive(empty)
  startTimer()
  if (instantRef) {
    // native auto-verified without a code: land after a paint beat
    const cred = instantRef
    instantRef = null
    setTimeout(() => completeInstant(cred), 350)
    return
  }
  if (!verifyIdRef) {
    // reached without a verification in flight — send one for the shown number
    setTimeout(() => {
      resendNow()
    }, 100)
  }
  // caret lands on the first empty box, like the mock's orange-ringed slot
  setTimeout(() => focusBox(empty), 120)
}

export function onUnloaded() {
  stopTimer()
  pageRef = null
}

function maskPhone(digits: string) {
  return 'Sent by SMS to +91 ' + digits.slice(0, 5) + ' ••• ' + digits.slice(-2)
}

function box(i: number): TextField | null {
  if (!pageRef) {
    return null
  }
  return <TextField>pageRef.getViewById('ot' + i)
}

function boxIndex(f: TextField) {
  const n = Number(String(f.id || '').replace('ot', ''))
  return isFinite(n) && n >= 0 && n <= 5 ? n : -1
}

function firstEmpty() {
  for (let i = 0; i < 6; i++) {
    const f = box(i)
    if (!f || !String(f.text || '').length) {
      return i
    }
  }
  return 5
}

function codeComplete() {
  for (let i = 0; i < 6; i++) {
    const f = box(i)
    if (!f || !/\d/.test(String(f.text || ''))) {
      return false
    }
  }
  return true
}

function markActive(active: number) {
  for (let i = 0; i < 6; i++) {
    // chrome lives on the wrapper Grids (the native EditText can't paint it);
    // radius lives in .wb CSS — class swap only, never raw style writes
    const w = <View>pageRef.getViewById('wb' + i)
    if (w) {
      w.className = i === active ? 'wb wb-active' : 'wb'
    }
  }
}

function focusBox(i: number) {
  markActive(i)
  const f = box(i)
  if (f) {
    f.focus()
  }
}

export function onFocus(args: EventData) {
  const f = <TextField>args.object
  const idx = boxIndex(f)
  if (idx >= 0) {
    markActive(idx)
  }
}

export function onDigit(args: PropertyChangeData) {
  const f = <TextField>args.object
  if (!f || navigatingAway) {
    return
  }
  const idx = boxIndex(f)
  if (idx < 0) {
    return
  }
  // settle AFTER the Android commit lands (event value/mid-IME races), then
  // normalize and advance in one pass — never wait for a re-set superfluous event
  setTimeout(() => settleBox(idx), 0)
}

function settleBox(idx: number) {
  const f = box(idx)
  if (!f || navigatingAway) {
    return
  }
  const raw = String(f.text || '')
  const digit = raw.replace(NON_DIGIT, '').slice(-1)
  if (raw !== digit) {
    f.text = digit // paste/junk guard; the visual settles in this same tick
  }
  if (!digit) {
    // commit emptied the box: backspace walks the caret left
    if (raw === '' && idx > 0) {
      focusBox(idx - 1)
    }
    return
  }
  const next = idx >= 5 ? 5 : idx + 1
  if (next !== idx) {
    focusBox(next)
    return
  }
  if (codeComplete()) {
    // sixth digit in: verify shortly so the digit paints first
    setTimeout(realVerify, 160)
  }
}

function allDigits() {
  let out = ''
  for (let i = 0; i < 6; i++) {
    const f = box(i)
    if (f) {
      out += String(f.text || '').replace(NON_DIGIT, '')
    }
  }
  return out
}

async function realVerify() {
  const page = pageRef
  if (!page || navigatingAway || !verifyIdRef) {
    return
  }
  try {
    const cred = await phoneCredential(verifyIdRef, allDigits())
    await signedIn(cred)
  } catch (err) {
    console.log('[NZ][otp] code check failed:', errText(err))
    const row = page.getViewById('codeRow')
    if (row) {
      shakeView(<View>row)
    }
  }
}

async function signedIn(cred: any) {
  const page = pageRef
  if (!page || navigatingAway) {
    return
  }
  try {
    const uc = await phoneSignIn(cred)
    console.log('[NZ][auth] signed in:', uc.user.uid)
    // gate: new accounts must land on Edit profile (phone prefilled+verified)
    await completeSignIn(page, String(uc.user.uid), {
      mode: 'phone',
      name: '',
      email: '',
      phone: phoneDigits,
    })
  } catch (err) {
    console.log('[NZ][auth] sign-in failed:', errText(err))
    shakeView(<View>(page.getViewById('codeRow') || page))
  }
}

function completeInstant(cred: any) {
  signedIn(cred)
}

export function onVerify(args: EventData) {
  const page = (<View>args.object).page
  if (codeComplete()) {
    realVerify()
  } else {
    const row = page.getViewById('codeRow')
    if (row) {
      shakeView(<View>row)
    }
  }
}

export function onResend(args: EventData) {
  if (pageRef) {
    showResend(false)
  }
  count = COUNT_START
  startTimer()
  resendNow()
}

async function resendNow() {
  try {
    const outcome = await phoneVerifyStart('+91' + phoneDigits)
    if (outcome.instantCredential) {
      completeInstant(outcome.instantCredential)
      return
    }
    if (outcome.verifyId) {
      verifyIdRef = outcome.verifyId
    }
    console.log('[NZ][otp] verification code re-sent')
  } catch (err) {
    console.log('[NZ][otp] resend failed:', errText(err))
  }
}

export function onBack(args: EventData) {
  navigatingAway = true
  stopTimer()
  ;(<View>args.object).page.frame.goBack()
}

export function onNotNow(args: EventData) {
  navigatingAway = true
  succeed((<View>args.object).page)
}

function succeed(page: Page) {
  navigatingAway = true
  stopTimer()
  page.frame.navigate({ moduleName: 'location-page', clearHistory: true })
}

function startTimer() {
  stopTimer()
  timer = setInterval(() => {
    count -= 1
    if (count <= 0) {
      count = 0
      stopTimer()
      if (pageRef) {
        showResend(true)
      }
      return
    }
    const t = pageRef ? <Label>pageRef.getViewById('resendTimer') : null
    if (t) {
      t.text = '0:' + String(count).padStart(2, '0')
    }
  }, 1000)
}

function stopTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function showResend(show: boolean) {
  if (!pageRef) {
    return
  }
  const row = <View>pageRef.getViewById('resendRow')
  const btn = <View>pageRef.getViewById('resendBtn')
  if (row) {
    row.visibility = show ? 'collapse' : 'visible'
  }
  if (btn) {
    btn.visibility = show ? 'visible' : 'collapse'
  }
}

function shakeView(view: View) {
  view
    .animate({ translate: { x: 5, y: 0 }, duration: 55 })
    .then(() => view.animate({ translate: { x: -5, y: 0 }, duration: 110 }))
    .then(() => view.animate({ translate: { x: 0, y: 0 }, duration: 55 }))
}
