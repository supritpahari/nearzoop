import { EventData, Label, NavigatedData, Page, StackLayout, View } from '@nativescript/core'
import { buildOfferCard } from '../components/offer-card'
import { OfferScreensContext } from '../domain/offer'

let pageRef: Page | null = null
let shopContext: OfferScreensContext = { offers: [] }

export function onNavigatingTo(args: NavigatedData) {
  pageRef = <Page>args.object
  shopContext = (args.context as OfferScreensContext) || { offers: [] }
}

export function onLoaded() {
  const page = pageRef
  const offer = shopContext.offer
  if (!page || !offer) {
    return
  }
  const title = <Label>page.getViewById('shopTitle')
  const initial = <Label>page.getViewById('shopInitial')
  const list = <StackLayout>page.getViewById('shopOffers')
  if (title) {
    title.text = offer.shop || 'Local shop'
  }
  if (initial) {
    initial.text = String(offer.shop || 'N').charAt(0).toUpperCase()
  }
  if (list) {
    list.addChild(
      buildOfferCard(offer, false, () =>
        page.frame.navigate({
          moduleName: 'features/offers/screens/offer-detail-page',
          context: { offer: offer, offers: [offer] } satisfies OfferScreensContext,
        })
      )
    )
  }
}

export function onBack(args: EventData) {
  const page = (<View>args.object).page
  if (page) {
    page.frame.goBack()
  }
}
