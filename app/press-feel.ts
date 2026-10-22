import { Application, Enums, GridLayout, Page, TouchGestureEventData, View } from '@nativescript/core'

// Shared "sticker press" feel: the printed card sinks into its hard ink
// shadow on touch-down and springs back on lift.
//
// Sticker button shells follow the id convention
//   <GridLayout id="X" ...> <StackLayout id="XShadow"/> <GridLayout id="XCard"/>
// so one generic touch handler animates every card the same way.
export function onStickerTouch(args: TouchGestureEventData) {
  const shell = <GridLayout>args.object
  const card = <View>(shell.id ? shell.getViewById(shell.id + 'Card') : null)
  if (!card) {
    return
  }
  if (args.action === 'down') {
    card.animate({
      translate: { x: 2, y: 2 },
      duration: 80,
      curve: Enums.AnimationCurve.easeOut,
    })
  } else if (args.action === 'up' || args.action === 'cancel') {
    card.animate({
      translate: { x: 0, y: 0 },
      duration: 140,
      curve: Enums.AnimationCurve.easeOut,
    })
  }
}

// Text links (Skip, Retry) get a lighter press: a 1dp sink. Tap fires as
// usual on lift, so the interaction reads like a physical key.
export function onLinkTouch(args: TouchGestureEventData) {
  const link = <View>args.object
  if (!link) {
    return
  }
  if (args.action === 'down') {
    link.animate({
      translate: { x: 0, y: 1 },
      duration: 70,
      curve: Enums.AnimationCurve.easeOut,
    })
  } else if (args.action === 'up' || args.action === 'cancel') {
    link.animate({
      translate: { x: 0, y: 0 },
      duration: 120,
      curve: Enums.AnimationCurve.easeOut,
    })
  }
}

// Kill the Google autofill provider's claim on a field: this ROM paints a
// pale-blue "filled here" pill over inputs and can inject saved numbers.
// Flag the view un-autofillable, drop hint matching, and cancel any live
// session that is already drawing its highlight. Cosmetic; never crashes.
export function defuseAutofill(view: View) {
  try {
    const nv = <any>view.android
    if (nv) {
      if (nv.setImportantForAutofill) {
        nv.setImportantForAutofill(2) // IMPORTANT_FOR_AUTOFILL_NO
      }
      if (nv.setAutofillHints) {
        nv.setAutofillHints(<any>[])
      }
    }
  } catch {
    // ignore
  }
  try {
    const act = Application.android && Application.android.foregroundActivity
    if (act) {
      const am = <any>act.getSystemService('autofill')
      if (am && am.cancel) {
        am.cancel() // ends the running session + its highlight
      }
    }
  } catch {
    // ignore
  }
}

/* The ROM draws the text caret (cursor) in system blue — on this ink-sticker
 * design it reads wrong. Re-tint the native cursor drawable (+ selection
 * handles when reachable) to the brand ink. */
export function tintCaret(view: View, color: number) {
  try {
    const nv = <any>view.android
    if (!nv) {
      return
    }
    if (nv.getTextCursorDrawable) {
      const cur = nv.getTextCursorDrawable()
      if (cur && cur.setTint) {
        cur.setTint(<any>color)
      }
    }
    ;['getTextSelectLeftHandle', 'getTextSelectRightHandle'].forEach((fn) => {
      try {
        if (nv[fn]) {
          const d = nv[fn]()
          if (d && d.setTint) {
            d.setTint(<any>color)
          }
        }
      } catch {
        // handle not reachable: caret alone still reads ink
      }
    })
  } catch {
    // ignore
  }
}

/* Flatten any native/theme chrome on the field itself. The ROM theme hands
 * EditText a tinted drawable (android:editTextBackground); its activated/
 * focused state paints the pale-blue underline (colorControlActivated). After
 * NS applies its own styles, re-assert a plain empty drawable and drop any
 * background tint, so the wrapper is the only chrome that can ever show. */
export function stripNativeChrome(view: View) {
  try {
    const nv = <any>view.android
    if (!nv) {
      return
    }
    try {
      if (nv.setBackgroundTintList) {
        nv.setBackgroundTintList(null)
      }
      if (nv.setSupportBackgroundTintList) {
        nv.setSupportBackgroundTintList(null)
      }
    } catch {
      // tint calls are optional on some cores
    }
    try {
      const bg = nv.getBackground && nv.getBackground()
      if (bg && bg.setTintList) {
        bg.setTintList(null)
      }
    } catch {
      // ignore
    }
    try {
      nv.setBackgroundDrawable(
        new (<any>android.graphics.drawable.ColorDrawable)(0x00000000)
      )
    } catch {
      // ignore
    }
    /* sticky invisibility: even if the ROM swaps in a focused-state
     * drawable later, alpha 0 keeps it from painting anything */
    try {
      const bg = nv.getBackground && nv.getBackground()
      if (bg && bg.setAlpha) {
        bg.setAlpha(0)
      }
    } catch {
      // ignore
    }
    /* Android's own focus highlight overlay (system paints a glow on the
     * focused view) — off, we own all chrome */
    try {
      if (nv.setDefaultFocusHighlightEnabled) {
        nv.setDefaultFocusHighlightEnabled(false)
      }
    } catch {
      // ignore
    }
  } catch {
    // cosmetic only
  }
}

/* The hard off-switch: mark the whole window (decor view + page root) as
 * no-autofill-exclude-descendants. Google's fill chip forms a NEW session on
 * every focus; a window-level exclusion stops the request before a chip can
 * even be built. Re-run it on every focus event to survive view re-creation. */
export function defuseWindowAutofill(page: Page) {
  try {
    const act = Application.android && Application.android.foregroundActivity
    if (act && act.getWindow) {
      const decor = act.getWindow().getDecorView()
      if (decor && decor.setImportantForAutofill) {
        decor.setImportantForAutofill(8) // NO_EXCLUDE_DESCENDANTS
      }
    }
  } catch {
    // ignore
  }
  try {
    const root = <any>(page && page.android)
    if (root && root.setImportantForAutofill) {
      root.setImportantForAutofill(8)
    }
  } catch {
    // ignore
  }
  try {
    const act = Application.android && Application.android.foregroundActivity
    if (act) {
      const am = <any>act.getSystemService('autofill')
      if (am && am.cancel) {
        am.cancel()
      }
    }
  } catch {
    // ignore
  }
}
