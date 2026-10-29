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

## Updating the database rules (after the UPI / QR and receipt updates)

The public pay page (`pay.html`) reads the committee UPI ID and QR image from one public record, and each receipt link
(`receipt.html?r=…`) reads one receipt record that can be opened only with its long random link.
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

## Android app (APK)

The project in [../android-app](../android-app) is a small Android shell (Capacitor 8) that loads this same app from
GitHub Pages, so every change pushed to GitHub reaches phones without a new APK. The shell adds what a browser cannot:

- **SMS reminders from the member's own SIM**, sent one after another without tapping (Follow-up → Send SMS reminders),
  with a daily limit (Settings, default 90) and a 4-second gap between messages.
- **Automatic receipt SMS** with the receipt link as soon as a collection is saved (can be turned off in Settings).
- **Alarms** for "Call again on <date> <time>" and for checklist due dates (9 am), even when the app is closed.
  Items assigned to someone else ring only on their phone.
- **Home-screen widget**: today's collection, total collected and donors yet to pay (long-press the home screen →
  Widgets → Kartikeswar).
- No address bar.

The call follow-up ("How did the call go?") and the receipt links work in the browser too.

**Login in the APK:** Google sign-in does not work inside the APK yet, so members use a ready-made ID & password
(see above). Google sign-in can be added later: in Firebase console add an Android app with package `in.kartikeswar.app`
and SHA-1 `8F:57:DA:42:98:FE:99:F1:82:95:7E:7D:DC:FA:09:BA:39:2F:EC:88`, then download `google-services.json`.

**Build it** (uses the JDK / Android SDK / Gradle already in `openGymv1/.toolchain`, nothing is downloaded):

```
bash android-app/build-local.sh        →  android-app/Kartikeswar.apk
```

Share `Kartikeswar.apk` on WhatsApp; members tap it, allow "Install unknown apps" once, and allow SMS and
notifications when the app asks. A new APK is only needed when the Android part itself changes.

**Keep the signing key safe:** `android-app/kartikeswar-release.jks` and `android-app/keystore.properties` are not in
GitHub (they are in `.gitignore`). Back both up (e.g. Google Drive). Phones only accept an updated APK signed with
the same key.

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
- **Each member's own UPI (optional):** **More → My UPI & QR**. Once added, that member's reminders, pay links and QR
  screen use their own account instead of the main committee QR. Pay links carry only a random key, never the UPI ID,
  and fall back to the main QR if the member removes theirs.
- **UPI money:** a UPI collection asks which account it went into (main QR or a member's own UPI) and is counted there in
  cash in hand. Money paid to the main QR shows as "Main UPI account (name)": set whose account it is in Settings.
- **Part payments:** set the promised amount (Update → Promised), then add each payment as its own collection. The donor
  shows "₹2,000 of ₹3,000 · ₹1,000 due", stays in Follow-up under **Part paid** until the promise is met, and every receipt
  shows the running total. Update → "Accept as final" closes a promise that will not be paid in full.
- **Gentle nudges (Settings):** reminders can add "Already N families have contributed ₹X", the usual amount range
  (only for donors who gave less than that) and the next donor title; receipts and thank-you messages show the donor's title.
  Titles and amounts are editable; each can be turned off. Nobody who has not paid is ever named.
- **Photos:** collections can have a payment screenshot and expenses a bill photo (Take photo or Gallery). Each photo is
  shrunk to ~100–200 KB and kept in Firestore (Firebase file storage needs a paid plan); a few thousand photos fit in the free 1 GB.
- **Reminder queue:** Follow-up → **Start reminders** goes through donors one by one (biggest past donors first). Each
  reminder is sent by hand from your own WhatsApp, so there is no risk of the number being banned.
- **Who is on a donor:** every reminder, call, UPI QR or update shows on the donor card for all members
  (green dot = in the last hour, also listed under **Active now** on Home). It never stops another member from sending.
- **Language:** each phone chooses English or ଓଡ଼ିଆ (More, or the login screen). Have someone check the Odia wording;
  the WhatsApp messages can be edited in Settings.
- **Cash in hand:** each collection adds to the person who received it, each expense subtracts from who paid, and
  **+ → Cash handover** moves money between members (or hands out last year's balance).
- **Year end:** **More → Download / Export** gives Excel (CSV) files, and **Data for public website** gives the year's donations and
  expenses in the same format as `data.js`, if the committee decides to publish them.
- **Updating the app later:** after changing app files, bump `CACHE` in [sw.js](sw.js) (e.g. `v2`) so phones load the new version.
