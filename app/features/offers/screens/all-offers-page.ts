import { EventData, Label, NavigatedData, Page, StackLayout, View } from '@nativescript/core'
import { buildOfferCard } from '../components/offer-card'
import { OfferScreensContext } from '../domain/offer'

let pageRef: Page | null = null
let screenContext: OfferScreensContext = { offers: [] }

export function onNavigatingTo(args: NavigatedData) {
  pageRef = <Page>args.object
  screenContext = (args.context as OfferScreensContext) || { offers: [] }
}

export function onLoaded() {
  render()
}

export function onBack(args: EventData) {
  const page = (<View>args.object).page
  if (page) {
    page.frame.goBack()
  }
}

function render() {
  const page = pageRef
  if (!page) {
    return
  }
  const list = <StackLayout>page.getViewById('offersList')
  if (!list) {
    return
  }
  const title = <Label>page.getViewById('offersTitle')
  const meta = <Label>page.getViewById('offersMeta')
  if (title && screenContext.category) {
    title.text = screenContext.category
  }
  if (meta) {
    meta.text = `${screenContext.offers.length} active offers near you`
  }
  screenContext.offers.forEach((offer) => {
    list.addChild(
      buildOfferCard(
        offer,
        (screenContext.savedIds || []).includes(offer.id),
        () =>
          page.frame.navigate({
            moduleName: 'features/offers/screens/offer-detail-page',
            context: { offer: offer, offers: screenContext.offers } satisfies OfferScreensContext,
          })
      )
    )
  })
  if (!screenContext.offers.length) {
    const empty = new Label()
    empty.className = 'mvp-empty-title'
    empty.text = 'No offers nearby yet'
    empty.textWrap = true
    list.addChild(empty)
  }
}
