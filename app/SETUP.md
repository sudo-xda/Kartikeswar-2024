# Committee app setup

The app lives at **https://sudo-xda.github.io/Kartikeswar-2024/app/**.
GitHub Pages only serves the app's code; all collection data is stored in Firebase and only committee members can read it.

## 1. Create the Firebase project (one time, ~15 minutes)

1. Go to https://console.firebase.google.com → **Add project** → name it `kartikeswar` → you can turn Google Analytics off.
2. On the project home page click the **web icon `</>`** → app nickname `Kartikeswar app` → leave "Firebase Hosting" unticked → **Register app**.
3. Copy the `firebaseConfig` values it shows into [firebase-config.js](firebase-config.js), replacing the `PASTE_...` placeholders.

## 2. Turn on login

1. **Build → Authentication → Get started → Sign-in method**
   - Enable **Google** (pick your email as the support email).
   - Enable **Email/Password** (for ready-made IDs).
2. **Authentication → Settings → Authorized domains → Add domain** → `sudo-xda.github.io`

## 3. Create the database

1. **Build → Firestore Database → Create database** → location **asia-south1 (Mumbai)** → start in **production mode**.
2. Open the **Rules** tab, replace everything with the contents of [firestore.rules](firestore.rules) and click **Publish**.
3. Add yourself as the first member: **Data** tab → **Start collection** → Collection ID `members` →
   Document ID = your Gmail address in lowercase (e.g. `yourname@gmail.com`) → add a field `name` (string) = your name → **Save**.

Everyone else can be added from inside the app.

## 4. Publish and start using it

1. Commit and push the `app/` folder. GitHub Pages updates in a minute or two.
2. Open the app link, **Sign in with Google**.
3. **More → Import past donors** loads everyone from 2024 and 2025 with their amounts.
4. **More → Donors & phone numbers → Paste phone numbers** — paste one line per person: `Name, 9876543210`.
   It shows which names matched before saving.
5. **More → Members** — add the other committee members' Gmail addresses.
6. **More → Year, UPI & WhatsApp messages** — check the year (defaults to the current year), set the **puja date**
   (drives the countdown and checklist dates), the balance carried from last year (pre-filled from the website: ₹19,194 for 2025),
   the committee **UPI ID** and **QR image**, and the message language (Odia by default, English also editable).
7. **More → Puja checklist → Create checklist from last year** adds the 16 main jobs with due dates counted back from the puja date.
8. **More → Vendors & budget** — add bookings paid in parts (Murti, Tent, DJ) with the agreed total; tap
   **Use 2025 spending as budget** to start each category's budget from last year.

## Updating the database rules (needed once after the UPI / QR update)

The public pay page (`pay.html`) reads the committee UPI ID and QR image from one public record.
Copy the latest [firestore.rules](firestore.rules) into Firebase console → Firestore Database → **Rules** → **Publish** again.
Until then the app works, but the UPI ID / QR image are not saved for the pay page.

## Ready-made ID & password (for anyone without Gmail, or iPhone users)

1. Firebase console → **Authentication → Users → Add user** → email `kuna@kartikeswar.app`, choose a password.
2. In the app: **More → Members** → name `Kuna Rout`, ID `kuna`.
3. They sign in with **Use ID & password instead** → ID `kuna` + the password.

## Install on phones

- **Android (Chrome):** open the link → ⋮ menu → **Add to Home screen / Install app**.
- **iPhone (Safari):** open the link → Share → **Add to Home Screen**. If Google sign-in does not open inside the installed app, use an ID & password login.

It works without internet: entries are saved on the phone and sync when the network is back (an orange dot shows entries not yet synced).

## Make an Android APK (optional)

The APK is a thin shell that opens this app in Chrome (a "Trusted Web Activity"), so Google login keeps working and
every update you push to GitHub reaches phones automatically. No new APK is needed for app changes.

1. Go to https://www.pwabuilder.com and enter `https://sudo-xda.github.io/Kartikeswar-2024/app/`.
2. **Package for stores → Android → Generate package** (package ID e.g. `in.kartikeswar.app`, app name `Kartikeswar`).
3. Download the zip. It contains the `.apk` to install, a `.aab` (only for Play Store), the **signing key** (keep it safe;
   you need the same key for any future APK) and `assetlinks.json`.
4. Send the `.apk` on WhatsApp; members tap it and allow "Install unknown apps" once.

Without step 5 the app shows a thin address bar at the top; everything still works.

5. To remove the address bar: create a GitHub repo named `sudo-xda.github.io`, add `.well-known/assetlinks.json`
   (from the zip) and an empty file named `.nojekyll`, and turn on GitHub Pages for it.

## Good to know

- **Cost:** free. 10–12 people with a few hundred donors stays well inside Firebase's free daily limits.
- **Privacy:** the code in this repo is public, but the data is not: Firestore rules only let listed members read or write.
  `firebase-config.js` is safe to commit; it only identifies the project.
- **Deleting:** deleted collections/expenses are only hidden (marked deleted), so a mistake can be recovered from the Firebase console.
- **Receipt numbers:** every collection gets `KP-<year>-001`, `002`… from one shared counter, so two phones never get the same number.
  A collection saved without internet gets its number automatically once that phone is online again. A deleted collection
  stays in the list as **Cancelled** with its number, so there are never gaps.
- **UPI:** the pay page shows the committee QR image (or one made from the UPI ID) and a Copy UPI ID button. It reads both
  only from the database, never from the link, so nobody can make a lookalike link with their own UPI ID.
- **UPI money is counted in "Bank / UPI account"**, not in the collector's cash in hand. Expenses and cash handovers can
  also be paid from / moved to the bank account (e.g. depositing collected cash).
- **Photos:** collections can have a payment screenshot and expenses a bill photo (Take photo or Gallery). Each photo is
  shrunk to ~100–200 KB and kept in Firestore (Firebase file storage needs a paid plan); a few thousand photos fit in the free 1 GB.
- **Language:** each phone chooses English or ଓଡ଼ିଆ (More, or the login screen). Have someone check the Odia wording;
  the WhatsApp messages can be edited in Settings.
- **Cash in hand:** each collection adds to the person who received it, each expense subtracts from who paid, and
  **+ → Cash handover** moves money between members (or hands out last year's balance).
- **Year end:** **More → Download / Export** gives Excel (CSV) files, and **Data for public website** gives the year's donations and
  expenses in the same format as `data.js`, if the committee decides to publish them.
- **Updating the app later:** after changing app files, bump `CACHE` in [sw.js](sw.js) (e.g. `v2`) so phones load the new version.
