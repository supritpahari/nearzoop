import {
  EventData,
  Enums,
  GridLayout,
  Label,
  Page,
  SwipeDirection,
  SwipeGestureEventData,
  TouchGestureEventData,
  View,
} from '@nativescript/core'
import { onLinkTouch } from './press-feel'

export { onLinkTouch }

// Pager over the three scenes; per-scene CTA size comes from the mocks
// ("Next" is compact, "Find offers" is wider). Wrap = button + 4dp shadow edge.
const CTAS = [
  { text: 'Next', button: 100, wrap: 104 },
  { text: 'Next', button: 100, wrap: 104 },
  { text: 'Find offers', button: 160, wrap: 164 },
]

const SLIDE_MS = 280

let index = 0
let carouselWidth = 0
let carousel: GridLayout | null = null

// Session state comes from the XML defaults (index 0): nothing to reset
// because each visit loads a fresh page instance.
export function navigatingTo() {
  index = 0
}

export function onCarouselLayout(args: EventData) {
  const view = <GridLayout>args.object
  carousel = view
  // getMeasuredWidth() is physical px on Android while translateX and style
  // widths are DIPs — getActualSize() is the platform-normalized DIP width.
  const width = view.getActualSize().width
  if (width > 0 && width !== carouselWidth) {
    carouselWidth = width
    slideTo(index, false)
  }
}

export function onSwipe(args: SwipeGestureEventData) {
  const page = (<View>args.object).page
  if (args.direction === SwipeDirection.left) {
    goTo(page, Math.min(index + 1, CTAS.length - 1))
  } else if (args.direction === SwipeDirection.right) {
    goTo(page, Math.max(index - 1, 0))
  }
}

export function onCta(args: EventData) {
  const page = (<View>args.object).page
  console.log('[NZ][ob] cta tap, scene index=' + index)
  try {
    if (index < CTAS.length - 1) {
      goTo(page, index + 1)
    } else {
      toSignin(page)
    }
  } catch (e) {
    console.log('[NZ][ob] cta failed:', (e && (e.message || String(e))) || e)
  }
}

export function onSkip(args: EventData) {
  toSignin((<View>args.object).page)
}

function goTo(page: Page, to: number) {
  if (!page || to === index) {
    return
  }
  index = to
  slideTo(index, true)
  applyChrome(page)
}

// -- fluid chrome ------------------------------------------------------------
// {N} animate() can't tween layout width, so widths get a tiny manual
// ease-out-cubic tween (~60fps). A per-view token in `ticker` cancels the
// previous run when a new tween starts on the same view.
const ticker = new WeakMap<object, number>()

export function tweenWidth(view: View, to: number, ms: number) {
  const from = Number(view.width) || 0
  const id = (ticker.get(view) || 0) + 1
  ticker.set(view, id)
  const t0 = Date.now()
  const step = () => {
    if (ticker.get(view) !== id) {
      return
    }
    const t = Math.min(1, (Date.now() - t0) / ms)
    view.width = from + (to - from) * (1 - Math.pow(1 - t, 3))
    if (t < 1) {
      setTimeout(step, 16)
    }
  }
  step()
}

// sticker press: the card sinks into its hard shadow, springs back on lift
export function onCtaTouch(args: TouchGestureEventData) {
  const wrap = <GridLayout>args.object
  const card = <View>wrap.getViewById('ctaBtn')
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

function slideTo(to: number, animated: boolean) {
  if (!carousel || carouselWidth <= 0) {
    return
  }
  // Scenes share one cell; each one steps sideways by (i - to) page widths.
  for (let i = 0; i < 3; i++) {
    const scene = <View>carousel.getViewById('scene' + i)
    if (!scene) {
      continue
    }
    const x = (i - to) * carouselWidth
    if (animated) {
      scene.animate({
        translate: { x, y: 0 },
        duration: SLIDE_MS,
        curve: Enums.AnimationCurve.easeOut,
      })
    } else {
      scene.translateX = x
    }
  }
}

function applyChrome(page: Page) {
  for (let i = 0; i < CTAS.length; i++) {
    const dot = <View>page.getViewById('dot' + i)
    if (dot) {
      dot.className = i === index ? 'ob-dot-active' : 'ob-dot'
      tweenWidth(dot, i === index ? 26 : 9, 220)
    }
  }
  const cta = CTAS[index]
  const wrap = <View>page.getViewById('ctaWrap')
  const button = <View>page.getViewById('ctaBtn')
  const shadow = <View>page.getViewById('ctaShadow')
  const label = <Label>page.getViewById('ctaLabel')
  if (wrap) {
    tweenWidth(wrap, cta.wrap, 240)
  }
  if (button) {
    tweenWidth(button, cta.button, 240)
  }
  if (shadow) {
    tweenWidth(shadow, cta.button, 240)
  }
  if (label) {
    label.text = cta.text
  }
}

// history stays live so the sign-in back sticker returns here
function toSignin(page: Page) {
  try {
    page.frame.navigate({ moduleName: 'signin-page' })
  } catch (e) {
    console.log(
      '[NZ][ob] nav to signin failed:',
      (e && (e.message || String(e))) || e
    )
  }
}
