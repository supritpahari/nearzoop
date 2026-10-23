# Run the App

## To run the app, you need to follow these steps.

1. Turn On Developer Options in Your Android Device
2. Turn On USB Debugging in Your Developer Settings.
3. Connect your phone with PC with a USB 3.0 USB Cable.
4. Open terminal for the project.
5. Type ```ns run android``` to start the project.


First build might take a lot of time. 

> If any problem appears with compiling, run ```ns clean``` and then ```ns run android```

## App structure

- `app/features/discovery/` contains local offer search and category screens.
- `app/features/offers/` contains the offer domain type, shared offer-card
  component, and all-offers, offer-detail, and shop screens.
- `app/features/saved/` contains the saved-offers screen.
- Existing startup, authentication, location, and nearby-map routes remain in
  `app/` while the feature screens are migrated incrementally.
- `app/firebase.ts`, `app/locate.ts`, and `app/map-src.ts` hold the existing
  Firebase, device-location, and map integrations.

The new discovery screens consume the current page's offer context, and the
home screen falls back to local sample offers when Firestore is empty or
unavailable. This keeps the customer flow previewable without creating or
deleting Firestore documents. Search and category filtering operate on the
loaded offer list on-device.

The supplied screen references are in `Designing/app design/`. The current
implementation pass covers the customer MVP path; alternate states and
business/admin flows are intentionally left for later design passes.

Make a branch and make a pull request for the project!
