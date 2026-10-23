export type Offer = {
  id: string
  lat: number
  lng: number
  text: string
  fontSize: number
  sub?: string
  title?: string
  shop?: string
  color?: string
  endsAtMs?: number
  category?: string
  distanceLabel?: string
}

export type OfferScreensContext = {
  offers: Offer[]
  savedIds?: string[]
  offer?: Offer
  category?: string
}

export function categoryForOffer(offer: Offer): string {
  const text = `${offer.title || ''} ${offer.shop || ''} ${offer.text}`.toLowerCase()
  if (/saree|fashion|clothing|salon|spa|beauty/.test(text)) {
    return 'Fashion'
  }
  if (/sweet|mishti|rosogolla|dessert|cafe|phuchka|food|dinner|tea|thali/.test(text)) {
    return 'Food'
  }
  if (/grocery|atta|rice|vegetable|market/.test(text)) {
    return 'Groceries'
  }
  if (/phone|mobile|electronic|computer|repair/.test(text)) {
    return 'Electronics'
  }
  return 'Services'
}
