/*
 * NZ dialog — one shared sticker dialog (the mock's confirm card): cream
 * card, ink border, hard offset shadow, orange primary + white secondary,
 * over a dim scrim. Lives as an overlay subtree you add to a page's XML
 * (nzDlgLayer/nzDlgScrim/nzDlgCard) with content built per-open, so every
 * confirm conversation in the app speaks one visual language.
 *
 * Close discipline: scrim tap and hardware back dismiss WITHOUT running
 * any action; buttons close-then-run so navigation can leave cleanly.
 */
import {
  AndroidActivityBackPressedEventData,
  Application,
  Enums,
  FormattedString,
  GridLayout,
  Label,
  Page,
  Span,
  StackLayout,
  View,
} from '@nativescript/core'

export type DialogSpec = {
  title: string
  body: string
  /* substring of body painted bold — the area/locality name */
  bodyEmph?: string
  primaryLabel: string
  onPrimary?: () => void
  secondaryLabel?: string
  onSecondary?: () => void
}

let hostPage: Page | null = null
let spec: DialogSpec | null = null
let open = false
let backHooked = false
let openedMs = 0

const SCRIM_MAX = 0.45

/* scrim tap = plain dismiss (cancel), never the actions */
export function onDlgScrimTap() {
  closeDialog()
}

export function openDialog(page: Page, s: DialogSpec): void {
  const layer = <View>page.getViewById('nzDlgLayer')
  const scrim = <View>page.getViewById('nzDlgScrim')
  const card = <View>page.getViewById('nzDlgCard')
  if (!layer || !scrim || !card) {
    console.log('[NZ][dialog] layer missing — cannot open on', page.id || '(page)')
    return
  }
  hostPage = page
  spec = s
  open = true
  openedMs = Date.now()
  buildCard(page, s)
  layer.visibility = 'visible'
  scrim.opacity = 0
  card.opacity = 0
  card.translateY = -12
  scrim.animate({ opacity: SCRIM_MAX, duration: 160 })
  card
    .animate({
      opacity: 1,
      translate: { x: 0, y: 0 },
      duration: 210,
      curve: Enums.AnimationCurve.easeOut,
    })
    .catch(() => undefined)
  hookBack()
}

export function closeDialog(): void {
  const page = hostPage
  const card = page && <View>page.getViewById('nzDlgCard')
  const scrim = page && <View>page.getViewById('nzDlgScrim')
  const layer = page && <View>page.getViewById('nzDlgLayer')
  if (!open || !page || !card || !scrim || !layer) {
    return
  }
  open = false
  unhookBack()
  scrim.animate({ opacity: 0, duration: 130 }).catch(() => undefined)
  card
    .animate({ opacity: 0, translate: { x: 0, y: -12 }, duration: 170 })
    .then(() => {
      if (!open) {
        layer.visibility = 'collapse'
      }
    })
    .catch(() => {
      layer.visibility = 'collapse'
    })
}

/* hardware back: plain dismiss while the dialog is up */
function hookBack() {
  if (backHooked || !Application.android) {
    return
  }
  backHooked = true
  Application.android.on('activityBackPressed', dlgBackHandler)
}

function unhookBack() {
  if (!backHooked || !Application.android) {
    return
  }
  backHooked = false
  Application.android.off('activityBackPressed', dlgBackHandler)
}

function dlgBackHandler(args: AndroidActivityBackPressedEventData) {
  if (open) {
    args.cancel = true
    closeDialog()
  }
}

/* --------------------------------- content -------------------------------- */

function buildCard(page: Page, s: DialogSpec): void {
  const card = <GridLayout>page.getViewById('nzDlgCard')
  if (!card) {
    return
  }
  // clear any previous conversation
  const kids: View[] = []
  card.eachChildView((v) => {
    kids.push(v)
    return true
  })
  kids.forEach((k) => card.removeChild(k))

  // this core drops unindexed GridLayout children into the same cell (the
  // chip bug all over again) — the conversation stacks in one vertical pane
  const pane = new StackLayout()
  pane.col = 0
  pane.row = 0
  // air below the last button — the card currently hugs the locality button
  pane.marginBottom = 16

  const title = new Label()
  title.className = 'dlg-title'
  title.text = s.title
  title.textWrap = true
  title.marginTop = 26
  title.marginLeft = 24
  title.marginRight = 24
  pane.addChild(title)

  const body = new Label()
  body.className = 'dlg-body'
  body.textWrap = true
  body.marginTop = 12
  body.marginLeft = 24
  body.marginRight = 24
  // the area name reads bold inside the sentence when the caller names it
  const emph = s.bodyEmph || ''
  const at = emph ? s.body.indexOf(emph) : -1
  if (at >= 0) {
    const fs = new FormattedString()
    if (at > 0) {
      const pre = new Span()
      pre.text = s.body.slice(0, at)
      fs.spans.push(pre)
    }
    const bold = new Span()
    bold.fontWeight = 'bold'
    bold.text = emph
    fs.spans.push(bold)
    const tail = s.body.slice(at + emph.length)
    if (tail.length) {
      const post = new Span()
      post.text = tail
      fs.spans.push(post)
    }
    body.formattedText = fs
  } else {
    body.text = s.body
  }
  pane.addChild(body)

  pane.addChild(
    buttonRow(s.primaryLabel, 'ls-btn-primary', 'ls-btn-text-primary', s.onPrimary)
  )
  if (s.secondaryLabel) {
    pane.addChild(
      buttonRow(s.secondaryLabel, 'ls-btn-sec', 'ls-btn-text-secondary', s.onSecondary)
    )
  }

  card.addChild(pane)
}

function buttonRow(
  label: string,
  cardCls: string,
  textCls: string,
  action?: () => void
): View {
  const box = new GridLayout()
  box.height = 51
  box.marginTop = 14
  box.marginLeft = 20
  box.marginRight = 20
  const shadow = new GridLayout()
  shadow.className = 'ls-btn-shadow'
  shadow.height = 47
  shadow.marginTop = 4
  shadow.marginRight = 4
  const btn = new GridLayout()
  btn.className = cardCls
  btn.height = 47
  btn.marginLeft = 4
  const lbl = new Label()
  lbl.className = textCls
  lbl.text = label
  lbl.horizontalAlignment = 'center'
  lbl.verticalAlignment = 'middle'
  btn.addChild(lbl)
  box.addChild(shadow)
  box.addChild(btn)
  box.on('tap', <any>(() => {
    // this ROM double-dispatches touch+tap for a single press; a ghost
    // second tap within the opening window must not fire the action
    if (Date.now() - openedMs < 300) {
      return
    }
    box
      .animate({ translate: { x: 2, y: 2 }, duration: 70 })
      .then(() => box.animate({ translate: { x: 0, y: 0 }, duration: 110 }))
      .catch(() => undefined)
    // close first so the action can navigate away cleanly
    closeDialog()
    if (action) {
      setTimeout(action, 90)
    }
  }))
  return box
}

/* keep the spec referenced between open passes for potential diagnostics */
export function currentDialogSpec(): DialogSpec | null {
  return spec
}
