import { EventData, StackLayout, NavigatedData, Page, View } from '@nativescript/core'
import { buildOfferCard } from '../../offers/components/offer-card'
import { OfferScreensContext } from '../../offers/domain/offer'

let pageRef: Page | null = null
let screenContext: OfferScreensContext = { offers: [] }

export function onNavigatingTo(args: NavigatedData) {
  pageRef = <Page>args.object
  screenContext = (args.context as OfferScreensContext) || { offers: [] }
}

export function onLoaded() {
  const page = pageRef
  if (!page) {
    return
  }
  const list = <StackLayout>page.getViewById('savedOffers')
  const empty = <StackLayout>page.getViewById('savedEmpty')
  if (!list || !empty) {
    return
  }
  const saved = new Set(screenContext.savedIds || [])
  const offers = screenContext.offers.filter((offer) => saved.has(offer.id))
  if (!offers.length) {
    empty.visibility = 'visible'
    return
  }
  offers.forEach((offer) => {
    list.addChild(
      buildOfferCard(offer, true, () =>
        page.frame.navigate({
          moduleName: 'features/offers/screens/offer-detail-page',
          context: { offer: offer, offers: screenContext.offers } satisfies OfferScreensContext,
        })
      )
    )
  })
}

export function onBrowse(args: EventData) {
  const page = (<View>args.object).page
  page?.frame.navigate({ moduleName: 'main-page', clearHistory: true })
}
