import { EventData, Label, NavigatedData, Page, StackLayout, TextField, View } from '@nativescript/core'
import { buildOfferCard } from '../../offers/components/offer-card'
import { Offer, OfferScreensContext } from '../../offers/domain/offer'

const RECENT_SEARCHES = ['Puja sarees', 'Rosogolla', 'Kathi roll', 'Smartphone', 'Hair spa']
let pageRef: Page | null = null
let screenContext: OfferScreensContext = { offers: [] }

export function onNavigatingTo(args: NavigatedData) {
  pageRef = <Page>args.object
  screenContext = (args.context as OfferScreensContext) || { offers: [] }
}

export function onLoaded() {
  renderSuggestions()
}

export function onBack(args: EventData) {
  const page = (<View>args.object).page
  if (page) {
    page.frame.goBack()
  }
}

export function onQueryChange(args: EventData) {
  const query = String((<TextField>args.object).text || '').trim().toLowerCase()
  renderResults(query)
}

function renderResults(query: string) {
  const suggestions = <StackLayout>pageRef?.getViewById('searchSuggestions')
  const results = <StackLayout>pageRef?.getViewById('searchResults')
  const section = <Label>pageRef?.getViewById('searchSection')
  if (!suggestions || !results || !section) {
    return
  }
  suggestions.removeChildren()
  results.removeChildren()
  if (!query) {
    section.text = 'POPULAR NEARBY'
    renderSuggestions()
    return
  }
  section.text = 'OFFERS'
  const matches = screenContext.offers.filter((offer) => matchesQuery(offer, query))
  matches.forEach((offer) => results.addChild(offerCard(offer)))
  if (!matches.length) {
    const empty = new Label()
    empty.className = 'mvp-empty-title'
    empty.text = 'No offers found. Try another search.'
    empty.textWrap = true
    results.addChild(empty)
  }
}

function renderSuggestions() {
  const suggestions = <StackLayout>pageRef?.getViewById('searchSuggestions')
  if (!suggestions) {
    return
  }
  RECENT_SEARCHES.forEach((query) => {
    const item = new Label()
    item.className = 'mvp-search-suggestion'
    item.text = `⌕   ${query}`
    item.on('tap', () => {
      const field = <TextField>pageRef?.getViewById('searchField')
      if (field) {
        field.text = query
        renderResults(query.toLowerCase())
      }
    })
    suggestions.addChild(item)
  })
}

function offerCard(offer: Offer): View {
  const page = pageRef
  return buildOfferCard(offer, false, () => {
    page?.frame.navigate({
      moduleName: 'features/offers/screens/offer-detail-page',
      context: { offer: offer, offers: [] } satisfies OfferScreensContext,
    })
  })
}

function matchesQuery(offer: Offer, query: string): boolean {
  return `${offer.title || ''} ${offer.shop || ''} ${offer.text} ${offer.sub || ''}`
    .toLowerCase()
    .includes(query)
}
