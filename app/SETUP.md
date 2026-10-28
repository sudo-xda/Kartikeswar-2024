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
6. **More → Year, balance & WhatsApp messages** — check the year (defaults to the current year), the balance carried from last year
   (pre-filled from the website: ₹19,194 for 2025), and edit the WhatsApp messages if you like.

## Ready-made ID & password (for anyone without Gmail, or iPhone users)

1. Firebase console → **Authentication → Users → Add user** → email `kuna@kartikeswar.app`, choose a password.
2. In the app: **More → Members** → name `Kuna Rout`, ID `kuna`.
3. They sign in with **Use ID & password instead** → ID `kuna` + the password.

## Install on phones

- **Android (Chrome):** open the link → ⋮ menu → **Add to Home screen / Install app**.
- **iPhone (Safari):** open the link → Share → **Add to Home Screen**. If Google sign-in does not open inside the installed app, use an ID & password login.

It works without internet: entries are saved on the phone and sync when the network is back (an orange dot shows entries not yet synced).

## Good to know

- **Cost:** free. 10–12 people with a few hundred donors stays well inside Firebase's free daily limits.
- **Privacy:** the code in this repo is public, but the data is not: Firestore rules only let listed members read or write.
  `firebase-config.js` is safe to commit; it only identifies the project.
- **Deleting:** deleted collections/expenses are only hidden (marked deleted), so a mistake can be recovered from the Firebase console.
- **Cash in hand:** each collection adds to the person who received it, each expense subtracts from who paid, and
  **+ → Cash handover** moves money between members (or hands out last year's balance).
- **Year end:** **More → Download / Export** gives Excel (CSV) files, and **Data for public website** gives the year's donations and
  expenses in the same format as `data.js`, if the committee decides to publish them.
- **Updating the app later:** after changing app files, bump `CACHE` in [sw.js](sw.js) (e.g. `v2`) so phones load the new version.
