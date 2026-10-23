import { EventData, GridLayout, Label, NavigatedData, Page, View } from '@nativescript/core'
import { OfferScreensContext } from '../domain/offer'

let pageRef: Page | null = null
let offerContext: OfferScreensContext = { offers: [] }

const TILE_COLORS: Record<string, string> = {
  red: '#FB4B32',
  pink: '#F4539B',
  amber: '#F2A81D',
}

export function onNavigatingTo(args: NavigatedData) {
  pageRef = <Page>args.object
  offerContext = (args.context as OfferScreensContext) || { offers: [] }
}

export function onLoaded() {
  const offer = offerContext.offer
  const page = pageRef
  if (!offer || !page) {
    return
  }
  const artwork = <Label>page.getViewById('offerArtwork')
  const artworkSub = <Label>page.getViewById('offerArtworkSub')
  const tile = <GridLayout>page.getViewById('detailTile')
  const title = <Label>page.getViewById('offerTitle')
  const shop = <Label>page.getViewById('shopName')
  const shopMeta = <Label>page.getViewById('shopMeta')
  if (artwork) {
    artwork.text = offer.text
  }
  if (artworkSub) {
    artworkSub.text = offer.sub || 'OFFER'
  }
  if (tile) {
    tile.backgroundColor = TILE_COLORS[offer.color || 'red'] || TILE_COLORS.red
  }
  if (title) {
    title.text = offer.title || `${offer.text} offer`
  }
  if (shop) {
    shop.text = offer.shop || 'Local shop'
  }
  if (shopMeta) {
    shopMeta.text = [offer.distanceLabel, 'Open now'].filter(Boolean).join(' · ')
  }
}

export function onBack(args: EventData) {
  const page = (<View>args.object).page
  if (page) {
    page.frame.goBack()
  }
}

export function onShop() {
  pageRef?.frame.navigate({
    moduleName: 'features/offers/screens/shop-page',
    context: { offer: offerContext.offer, offers: [] } satisfies OfferScreensContext,
  })
}

export function onClaim() {
  pageRef?.frame.navigate({ moduleName: 'signin-page' })
}
