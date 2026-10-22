/*
In NativeScript, the app.ts file is the entry point to your application.
You can use this file to perform app-level initialization, but the primary
purpose of the file is to pass control to the app’s first module.
*/

import { Application } from '@nativescript/core'
import { initFirebase } from './firebase'

/* Auth + Firestore must be ready before the first route that needs them. */
initFirebase().catch((err) => console.log('[NZ][firebase]', err))

Application.run({ moduleName: 'app-root' })

/*
Do not place any code after the application has been started as it will not
be executed on iOS.
*/
