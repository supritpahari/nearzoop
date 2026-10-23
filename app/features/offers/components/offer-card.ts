import { GridLayout, Image, Label, StackLayout, View } from '@nativescript/core'
import { Offer } from '../domain/offer'

const COLORS: Record<string, string> = {
  red: '#FB4B32',
  pink: '#F4539B',
  amber: '#F2A81D',
}

export function buildOfferCard(
  offer: Offer,
  saved: boolean,
  onOpen: () => void,
  onSave?: () => void
): View {
  const card = new GridLayout()
  card.className = 'mvp-offer-card'
  card.columns = '88,*'
  card.rows = 'auto,auto'
  card.marginBottom = 14

  const tile = new StackLayout()
  tile.className = 'mvp-offer-tile'
  tile.backgroundColor = COLORS[offer.color || 'red'] || COLORS.red
  tile.col = 0
  tile.rowSpan = 2
  tile.width = 78
  tile.height = 78
  tile.verticalAlignment = 'middle'
  const tileText = new Label()
  tileText.className = 'mvp-offer-tile-text'
  tileText.text = offer.text
  tileText.textAlignment = 'center'
  tile.addChild(tileText)
  if (offer.sub) {
    const subtitle = new Label()
    subtitle.className = 'mvp-offer-tile-sub'
    subtitle.text = offer.sub
    subtitle.textAlignment = 'center'
    tile.addChild(subtitle)
  }
  card.addChild(tile)

  const title = new Label()
  title.className = 'mvp-offer-title'
  title.text = offer.title || offer.text
  title.textWrap = true
  title.col = 1
  title.row = 0
  title.marginLeft = 10
  title.marginRight = 26
  card.addChild(title)

  if (onSave) {
    const bookmark = new Image()
    bookmark.className = 'mvp-offer-bookmark'
    bookmark.src = saved ? 'res://ic_bkm_save' : 'res://ic_bkm_ink'
    bookmark.col = 1
    bookmark.row = 0
    bookmark.width = 20
    bookmark.height = 20
    bookmark.stretch = 'aspectFit'
    bookmark.horizontalAlignment = 'right'
    bookmark.verticalAlignment = 'top'
    bookmark.on('tap', onSave)
    card.addChild(bookmark)
  }

  const meta = new StackLayout()
  meta.col = 1
  meta.row = 1
  meta.marginLeft = 10
  meta.marginTop = 8
  const shop = new Label()
  shop.className = 'mvp-offer-shop'
  shop.text = offer.shop || 'Local shop'
  meta.addChild(shop)

  const detail = new Label()
  detail.className = 'mvp-offer-meta'
  detail.text = [offer.distanceLabel, offer.endsAtMs ? endDate(offer.endsAtMs) : '']
    .filter(Boolean)
    .join('  ·  ')
  detail.marginTop = 4
  meta.addChild(detail)
  card.addChild(meta)

  card.on('tap', onOpen)
  return card
}

function endDate(timestamp: number): string {
  const date = new Date(timestamp)
  return `Ends ${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
}
