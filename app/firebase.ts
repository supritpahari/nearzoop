/*
 * Firebase bootstrap — Auth + Firestore only (project 'nearzoop').
 *
 * Native side: google-services.json (App_Resources/Android + .../src) feeds
 * the default FirebaseApp through FirebaseInitProvider, and the
 * @nativescript/firebase-core gradle mixin already applies the
 * google-services plugin + BOM — no manual app.gradle apply needed.
 *
 * JS side: the side-effect imports register .auth() / .firestore() on the
 * Firebase facade; initFirebase() resolves the default app once per process.
 */

import { Application, isAndroid, Page } from '@nativescript/core'
import { firebase, Firebase } from '@nativescript/firebase-core'
// App Check — DEBUG provider for sideloaded ns-run builds (Play Integrity only
// blesses Play-Store installs). This package both registers firebase().appCheck()
// and flags its factory as the debug one. For store builds swap to:
//   import { AppCheck } from '@nativescript/firebase-app-check'
//   AppCheck.setProviderFactory()   // default = Play Integrity on Android
// NOTE: import exactly ONE app-check package per app — each installs its own
// `appCheck` property on the shared Firebase prototype (non-configurable), so
// importing both throws "Cannot redefine property" at boot.
import { AppCheck } from '@nativescript/firebase-app-check-debug'

// Debug App Check factory — must be set before the app is initialized so every
// auth/firestore request carries tokens from the very first call.
AppCheck.setProviderFactory()
import '@nativescript/firebase-auth'
import '@nativescript/firebase-firestore'

import { Auth, AuthCredential, GoogleAuthProvider, PhoneAuthProvider } from '@nativescript/firebase-auth'
import type { UserCredential } from '@nativescript/firebase-auth'
import { Firestore } from '@nativescript/firebase-firestore'

type FirebaseAppRef = ReturnType<Firebase['app']>

let defaultApp: FirebaseAppRef | null = null
let appBoot: Promise<FirebaseAppRef> | null = null

/* Runs once per process, even across HMR re-entry. */
export function initFirebase(): Promise<FirebaseAppRef> {
  if (!appBoot) {
    appBoot = (async () => {
      let app: FirebaseAppRef
      try {
        app = await firebase().initializeApp()
      } catch (err) {
        // native default app may already exist (process start or HMR re-run)
        app = firebase().app()
      }
      defaultApp = app
      // activation carries the App Check token on all subsequent calls;
      // never let the hardening layer block the auth path
      try {
        ;(<any>firebase()).appCheck().activate(true)
      } catch (err) {
        console.log('[NZ][appcheck] activate failed:', (<any>err)?.message || err)
      }
      return app
    })()
  }
  return appBoot
}

export async function firebaseAuth(): Promise<Auth> {
  await initFirebase()
  return firebase().auth()
}

export async function firebaseDb(): Promise<Firestore> {
  await initFirebase()
  return firebase().firestore()
}

declare const com: any
declare const java: any

export type PhoneVerifyOutcome = {
  verifyId: string | null
  instantCredential: any | null
}

/*
 * Kick off phone verification. Android drives the native callback flow
 * directly: the plugin leaves onVerificationCompleted empty, which would
 * strand instant-verified devices with a hanging promise.
 */
export async function phoneVerifyStart(phoneIntl: string): Promise<PhoneVerifyOutcome> {
  if (!isAndroid) {
    const provider = PhoneAuthProvider.provider()
    const verifyId = await provider.verifyPhoneNumber(phoneIntl)
    return { verifyId: String(verifyId), instantCredential: null }
  }
  const auth = await firebaseAuth()
  return new Promise<PhoneVerifyOutcome>((resolve, reject) => {
    try {
      let settled = false
      const done = (o: PhoneVerifyOutcome) => {
        if (!settled) {
          settled = true
          resolve(o)
        }
      }
      const fail = (e: unknown) => {
        if (!settled) {
          settled = true
          reject(e)
        }
      }
      const Cb = com.google.firebase.auth.PhoneAuthProvider.OnVerificationStateChangedCallbacks.extend({
        onVerificationFailed(e: any) {
          fail(e)
        },
        onCodeSent(verifyId: string, token: any) {
          done({ verifyId: String(verifyId), instantCredential: null })
        },
        onCodeAutoRetrievalTimeOut(verifyId: string) {
          done({ verifyId: String(verifyId), instantCredential: null })
        },
        onVerificationCompleted(cred: any) {
          // Play instant auto-verification: no SMS, no code needed
          done({ verifyId: null, instantCredential: cred })
        },
      })
      const act = Application.android.foregroundActivity || Application.android.startActivity
      const opts = com.google.firebase.auth.PhoneAuthOptions.newBuilder((<any>auth).native)
        .setPhoneNumber(phoneIntl)
        .setTimeout(<any>java.lang.Long.valueOf(60), java.util.concurrent.TimeUnit.SECONDS)
        .setActivity(act)
        .setCallbacks(new Cb())
        .build()
      com.google.firebase.auth.PhoneAuthProvider.verifyPhoneNumber(opts)
    } catch (err) {
      reject(err)
    }
  })
}

/* ------------------------------------------------------------------ *
 * Google sign-in — Google's OWN default account dialog. The button hands
 * off to the official GMS sign-in bottom sheet (play-services-auth, RC
 * 1042): it lists the device's Google accounts, returns the ID token for
 * our web client in one result, and Firebase exchanges it via
 * GoogleAuthProvider.credential. Resolves null where the user cancels the
 * sheet; never throws UI-fatal errors — callers keep a guest fallback.
 * ------------------------------------------------------------------ */
const GOOGLE_WEB_CLIENT_ID =
  '287400314808-lovt4is1tmbjt1nmg6o59557na8agnrq.apps.googleusercontent.com'

/* one shared finish: credential -> Firebase user -> gate/location routing */
export async function finishGoogleSignIn(page: Page, cred: AuthCredential): Promise<void> {
  const uc = await phoneSignIn(cred)
  console.log('[NZ][auth] google signed in:', uc.user.uid)
  await completeSignIn(page, String(uc.user.uid), {
    mode: 'google',
    name: String((<any>uc.user).displayName || ''),
    email: String((<any>uc.user).email || ''),
    phone: '',
  })
}

export function googleCredentialFlow(): Promise<AuthCredential | null> {
  return new Promise<AuthCredential | null>((resolve, reject) => {
    let settled = false
    const finish = (arg: AuthCredential | null) => {
      if (!settled) {
        settled = true
        resolve(arg)
      }
    }
    const bail = (e: unknown) => {
      if (!settled) {
        settled = true
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
    try {
      const act =
        Application.android &&
        (Application.android.foregroundActivity || Application.android.startActivity)
      if (!act) {
        bail(new Error('no foreground activity'))
        return
      }
      const GS = com.google.android.gms.auth.api.signin
      let client: any = null
      try {
        const gso = new GS.GoogleSignInOptions.Builder(
          GS.GoogleSignInOptions.DEFAULT_SIGN_IN
        )
          .requestIdToken(GOOGLE_WEB_CLIENT_ID)
          .build()
        client = GS.GoogleSignIn.getClient(act, gso)
      } catch (err) {
        console.log('[NZ][gauth] client setup failed:', errText(err))
        bail(err)
        return
      }
      const handleResult = (args: any) => {
        try {
          if (args.requestCode !== 1042) {
            return // not ours
          }
          try {
            Application.android.off('activityResult', handleResult)
          } catch {
            // ignore
          }
          const task = GS.GoogleSignIn.getSignedInAccountFromIntent(args.intent)
          if (!task.isSuccessful()) {
            // 12501 = sheet cancelled; anything else = GMS/network trouble
            const ex = task.getException()
            console.log('[NZ][gauth] sheet closed:', (ex && ex.getMessage && ex.getMessage()) || ex)
            finish(null)
            return
          }
          const acc = task.getResult()
          const token = acc ? String(acc.getIdToken() || '') : ''
          if (!token) {
            bail(new Error('empty id token from Google sheet'))
            return
          }
          // forget the remembered choice: the next tap shows the sheet again
          try {
            client.signOut()
          } catch {
            // sign-out is cosmetic here; the token is already minted
          }
          finish(GoogleAuthProvider.credential(token, ''))
        } catch (e) {
          try {
            Application.android.off('activityResult', handleResult)
          } catch {
            // ignore
          }
          bail(e)
        }
      }
      Application.android.on('activityResult', handleResult)
      // the official Google bottom-sheet account chooser
      act.startActivityForResult(client.getSignInIntent(), 1042)
    } catch (e) {
      bail(e)
    }
  })
}

export async function phoneCredential(verifyId: string, code: string): Promise<AuthCredential> {
  if (isAndroid) {
    const nativeCred = com.google.firebase.auth.PhoneAuthProvider.getCredential(verifyId, code)
    // runtime exposes fromNative; typings omit the static
    return <AuthCredential>(<any>AuthCredential).fromNative(nativeCred)
  }
  return PhoneAuthProvider.provider().credential(verifyId, code)
}

export function phoneSignIn(credential: AuthCredential): Promise<UserCredential> {
  return firebaseAuth().then((a) => a.signInWithCredential(credential))
}

/* small proof that Firestore is live; never blocks login on its own */
export async function ensureUserDoc(uid: string): Promise<boolean> {
  try {
    const db = await firebaseDb()
    await db.collection('users').doc(uid).set({ nzInit: true })
    return true
  } catch (err) {
    console.log('[NZ][firestore] user doc blocked:', (<any>err)?.code || (<any>err)?.message)
    return false
  }
}

/* ------------------------------ sign-in routing --------------------------- */

export type ProfileCtx = {
  mode: 'phone' | 'google'
  name: string
  email: string
  phone: string
}

/* Where does a freshly-authenticated user land? Accounts that never finished
 * the Edit-profile step are routed through it (unskippable); everyone who
 * already stamped nzProfileDoneMs goes straight to the location step.
 * Fail-closed: if the gate read errors the gate shows — no route can dodge it. */
export async function completeSignIn(page: Page, uid: string, ctx: ProfileCtx): Promise<void> {
  let gate = true
  try {
    const db = await firebaseDb()
    const doc: any = await (<any>db.collection('users').doc(uid)).get()
    const v = doc && doc.exists && doc.data ? <Record<string, unknown>>doc.data() : null
    gate = !(v && Number(v.nzProfileDoneMs) > 0)
    if (!v) {
      await db.collection('users').doc(uid).set({ nzInit: true })
      console.log('[NZ][firestore] new user doc for', uid)
    }
  } catch (err) {
    console.log('[NZ][profile] gate read blocked:', errText(err))
  }
  page.frame.navigate({
    moduleName: gate ? 'profile-page' : 'location-page',
    clearHistory: true,
    context: ctx,
  })
}

/* Profile save — read-modify-write: the doc may already carry `area` and
 * `saved` ids (home screen writes both), so the profile stamp never blows
 * them away with a full overwrite of unknown fields. */
export async function saveUserProfile(
  uid: string,
  name: string,
  email: string,
  phone: string,
  phoneVerified: boolean
): Promise<void> {
  const db = await firebaseDb()
  const ref = db.collection('users').doc(uid)
  let prev: Record<string, unknown> = {}
  try {
    const doc: any = await ref.get()
    if (doc && doc.exists && doc.data) {
      prev = <Record<string, unknown>>doc.data() || {}
    }
  } catch (err) {
    console.log('[NZ][profile] read-back blocked:', errText(err))
    prev = {}
  }
  prev.nzInit = true
  prev.nzProfileDoneMs = Date.now()
  prev.phoneVerified = phoneVerified
  prev.profile = { name: name, email: email, phone: phone, stampMs: Date.now() }
  await ref.set(prev)
  console.log('[NZ][profile] saved to users/' + uid, 'name="' + name + '"')
}

export function errText(err: unknown): string {
  const e = <any>err
  return (e && (e.code || e.message)) || String(err)
}

/* save the chosen area on the signed-in profile (no-op for guests).
 * Read-modify-write like saveUserProfile: `set` replaces the whole document,
 * so the gate's profile/nzProfileDoneMs stamps (and the `saved` offer ids a
 * caller doesn't pass) must survive every area write. */
export async function saveUserArea(
  area: Record<string, unknown>,
  saved?: string[]
): Promise<void> {
  try {
    const auth = await firebaseAuth()
    const user = auth.currentUser
    if (!user || !user.uid) {
      return // browse-without-account: nothing to persist
    }
    const db = await firebaseDb()
    const docRef = db.collection('users').doc(user.uid)
    let prev: Record<string, unknown> = {}
    try {
      const snap: any = await docRef.get()
      const raw = snap && snap.exists && snap.data ? snap.data() : null
      prev = <Record<string, unknown>>(raw || {})
    } catch (err) {
      console.log('[NZ][firestore] area read-back blocked:', errText(err))
    }
    prev.area = area
    prev.nzInit = true
    if (saved !== undefined) {
      prev.saved = Array.from(saved)
    }
    await docRef.set(prev)
  } catch (err) {
    console.log('[NZ][firestore] area save blocked:', errText(err))
  }
}
