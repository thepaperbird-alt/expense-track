# Expense Flow

Expense Flow is a monthly node-based expense management prototype built with plain HTML, CSS, and JavaScript.

## Run

```bash
npm start
```

Then open `http://localhost:3000`.

## Current Features

- Monthly header with current month view
- One balance node plus recurring preset nodes such as salary, EMI, and bills
- Left toolbar to choose `Income` or `Expense` before placing a node
- No random click-to-create behavior
- Recurring toggle on nodes so they seed the next month automatically
- Month data persisted locally by default, with Firestore-ready cloud sync scaffolding included
- Pan, zoom, drag, connect-to-balance, and same-type stacking

## Firestore Setup

- Copy `db-config.example.js` to `db-config.js`
- Create a Firebase project and add a Web app
- Enable `Firestore Database` in the Firebase console
- Open `db-config.js` and paste your Firebase web config into `FIREBASE_CONFIG`
- Restart `npm start`

The app stores one Firestore document per month in the `expenseFlowMonths` collection.
If `FIREBASE_CONFIG` is left blank, the app safely falls back to local storage.
