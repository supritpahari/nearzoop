import { EventData, GridLayout, Label, NavigatedData, Page, StackLayout, View } from '@nativescript/core'
import { Offer, OfferScreensContext, categoryForOffer } from '../../offers/domain/offer'

const CATEGORIES = [
  { name: 'Food', color: '#FB4B32', sub: 'খাবার' },
  { name: 'Mishti', color: '#FFC533', sub: 'মিষ্টি' },
  { name: 'Fashion', color: '#F4539B', sub: 'পোশাক' },
  { name: 'Groceries', color: '#12A66A', sub: 'মুদি' },
  { name: 'Electronics', color: '#7957F5', sub: 'ইলেকট্রনিক্স' },
  { name: 'Services', color: '#FB4B32', sub: 'পরিষেবা' },
]

let pageRef: Page | null = null
let screenContext: OfferScreensContext = { offers: [] }

export function onNavigatingTo(args: NavigatedData) {
  pageRef = <Page>args.object
  screenContext = (args.context as OfferScreensContext) || { offers: [] }
}

export function onLoaded() {
  const grid = <GridLayout>pageRef?.getViewById('categoriesGrid')
  if (!grid) {
    return
  }
  CATEGORIES.forEach((category, index) => {
    const count = screenContext.offers.filter((offer) => categoryForOffer(offer) === category.name).length
    const tile = new GridLayout()
    tile.className = 'mvp-category-tile'
    tile.backgroundColor = category.color
    tile.rows = 'auto,*,auto'
    tile.col = index === 0 ? 0 : (index + 1) % 2
    tile.row = index === 0 ? 0 : Math.ceil(index / 2)
    tile.colSpan = index === 0 ? 2 : 1
    tile.height = index === 0 ? 190 : 150
    tile.marginRight = index % 2 === 1 ? 8 : 0
    tile.marginLeft = index > 0 && index % 2 === 0 ? 8 : 0
    tile.marginBottom = 14
    tile.padding = 18
    const locale = new Label()
    locale.className = 'mvp-category-locale'
    locale.text = `${category.sub}  ·  ${count}`
    tile.addChild(locale)
    const title = new Label()
    title.className = 'mvp-category-title'
    title.text = category.name
    title.fontSize = category.name.length > 9 ? 18 : category.name.length > 6 ? 21 : 30
    title.textWrap = true
    title.row = 1
    title.verticalAlignment = 'bottom'
    tile.addChild(title)
    const meta = new Label()
    meta.className = 'mvp-category-meta'
    meta.text = 'live offers'
    meta.row = 2
    tile.addChild(meta)
    tile.on('tap', () => openCategory(category.name))
    grid.addChild(tile)
  })
}

export function onBack(args: EventData) {
  const page = (<View>args.object).page
  if (page) {
    page.frame.goBack()
  }
}

function openCategory(category: string) {
  const page = pageRef
  if (!page) {
    return
  }
  const offers: Offer[] = screenContext.offers.filter((offer) => {
    const matched = categoryForOffer(offer)
    return category === 'Mishti'
      ? matched === 'Food' && /sweet|mishti|rosogolla/.test(`${offer.title} ${offer.shop}`.toLowerCase())
      : matched === category
  })
  page.frame.navigate({
    moduleName: 'features/offers/screens/all-offers-page',
    context: { offers: offers, savedIds: screenContext.savedIds, category: category } satisfies OfferScreensContext,
  })
}
