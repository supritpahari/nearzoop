/*
 * Choose login — the door between onboarding and sign-in. One drawn scene
 * (the offer ring around a tiny shop), one caption, two big buttons:
 * "Sign In as User" walks the usual ladder (sign-in -> profile onboarding ->
 * location -> home); "Sign In as Business" answers with the shared sticker
 * dialog. Everything visual reuses the app's sticker classes (ls-btn-*,
 * bub, dlg-*), no new visual language.
 */
import { EventData, Page, View } from '@nativescript/core'
import { onLinkTouch, onStickerTouch } from './press-feel'
import { openDialog, onDlgScrimTap } from './nz-dialog'

export { onLinkTouch, onStickerTouch, onDlgScrimTap }

let lastBtnMs = 0
/* this ROM double-dispatches a single physical press on some views */
function locked(): boolean {
  const now = Date.now()
  if (now - lastBtnMs < 700) {
    return true
  }
  lastBtnMs = now
  return false
}

export function onUser(args: EventData) {
  if (locked()) {
    return
  }
  const v = <View>args.object
  const page = v.page || (<Page>(<unknown>args.object))
  console.log('[NZ][choose] user picked -> sign-in')
  page.frame.navigate({ moduleName: 'signin-page' })
}

export function onBusiness(args: EventData) {
  if (locked()) {
    return
  }
  const v = <View>args.object
  const page = v.page || (<Page>(<unknown>args.object))
  console.log('[NZ][choose] business picked -> coming soon')
  openDialog(page, {
    title: 'Sign in as Business',
    body: 'Coming soon in this app only!',
    primaryLabel: 'Okay',
  })
}
