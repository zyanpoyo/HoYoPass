# Privacy Policy

**Effective Date**: October 12, 2026 (Last Revised: October 26, 2026)  
**Target Software**: HoYoPass - Auto Daily Check-In & Code Redeemer (Chrome Extension)

---

## 1. Fundamental Principle
HoYoPass (hereinafter referred to as "the Extension") places the highest priority on user privacy protection and is developed under a zero-trust architecture: **"Never collect or transmit personal information."** The Extension never stores or sends your account credentials to third-party servers, nor does it conduct any personally identifiable tracking.

---

## 2. Data Not Collected
The Extension does not collect, record, or transmit any of the following information:
- Personally identifiable information such as names, usernames, email addresses, or phone numbers
- Passwords or authentication tokens for HoYoverse / HoYoLAB accounts
- Raw cookie data stored in the browser (the Extension code never extracts or saves raw cookie strings)
- Credit card numbers, payment details, or purchase history
- In-game inventory, transaction logs, or friends list
- Browsing history or visited URLs outside the Extension

---

## 3. Data Stored Locally Within Your Browser
To ensure proper functionality, the Extension stores only the following operational data in your browser's local storage (`chrome.storage.local`). None of this data is ever transmitted to external servers or third parties.

1. **User Settings & Preferences**:
   - Daily check-in auto-claim toggle flag (`autoSignEnabled`)
   - Periodic code auto-redemption toggle flag (`autoRedeemEnabled`)
   - Enabled game selection state (Genshin Impact, Honkai: Star Rail, Zenless Zone Zero)
   - Currently active game tab
   - First-run terms agreement flag (`optInAccepted`)
   - Anonymous usage statistics toggle flag (`analyticsEnabled`)
   - Anonymous usage statistics review flag (`analyticsConsentReviewed`)
   - Agreed privacy policy version (`agreedPolicyVersion`)
2. **Daily Check-In Records**:
   - Last check-in date (UTC+8) and cumulative login days per game (used solely to prevent duplicate requests on the same day)
3. **Redeemed Code History**:
   - List of previously redeemed code strings and their completion status (used solely to prevent re-submitting identical codes)
4. **Execution Logs**:
   - Recent execution logs for check-ins and code redemptions displayed in the popup UI (up to 50 entries)
5. **Random Client Identifier**:
   - Pseudonymous, randomly generated UUIDv4 client identifier (contains no personal or device identifiers)

---

## 4. Handling of Credentials (Cookies)
When sending requests to private APIs on your behalf to claim check-in rewards and redeem codes, the Extension uses standard browser secure transport (`credentials: 'include'`).

- **No Cookie Reading**: The Extension's JavaScript code never reads, inspects, or loads your session cookies into memory.
- **No Cookie Storage**: Cookies are never stored in local storage, session storage, or file caches.
- **No Cookie Leakage**: Your browser automatically attaches existing official cookies only when communicating directly with official domains (`*.hoyolab.com` and `*.hoyoverse.com`).

---

## 5. External Communications & Purposes
External network communications performed by the Extension are strictly limited to the following endpoints and purposes:

| Destination Domain | Primary Purpose | Data Transmitted |
| :--- | :--- | :--- |
| `*.hoyoverse.com` / `*.hoyolab.com` (Private Takumi API) | Confirm character profiles (nickname, UID, server region) | Session cookies managed by browser (automatically attached) |
| `*.hoyolab.com` / `*.hoyoverse.com` (Private Check-In APIs) | Check daily check-in status and claim rewards | Event ID (`act_id`), `x-rpc-signgame` header, session cookies (automatically attached) |
| `*.hoyoverse.com` (Private Redemption APIs) | Redeem promotional gift codes | Game identifier, UID, code string, session cookies (automatically attached) |
| `https://hoyo-codes.seria.moe`<br>([GitHub: seriaati/hoyo-codes](https://github.com/seriaati/hoyo-codes)) | Fetch verified active promotional codes list | None (standard anonymous HTTP GET request for public data) |
| `https://www.google-analytics.com`<br>(Google Analytics 4 Measurement Protocol) | Monitor feature usage, success/error rates, and troubleshoot issues to improve quality | Anonymous metrics (game type, success/failure status, error category code, UI action type, extension version, UI language, random session ID and client ID).<br>**\* No UIDs, account names, passwords, cookies, or personal identifiers are ever collected.** |

\* The Extension never communicates with any third-party ad networks, trackers, or unauthorized servers.

---

## 6. Browser Permissions Justification
The Extension requests only the minimal permissions required for its operation:

- **`storage`**: To store user preferences, daily check-in records, and redeemed code history locally.
- **`alarms`**: To trigger background alarms for daily check-in (01:05 UTC+8) and periodic code checks (every 3 hours).
- **`notifications`**: To notify you upon reward claiming, CAPTCHA verification requirements, or session expiration.
- **`idle`**: To detect system wake or unlock, catching up on missed daily rewards safely after network reconnection.
- **`host_permissions`**: To perform secure HTTPS requests to the private APIs and open code repository listed in Section 5.

\* The `cookies` permission—which would grant arbitrary access to read user cookie values—is intentionally omitted for enhanced security.

---

## 7. Anonymous Usage Metrics (Google Analytics 4)
To monitor redemption reliability and detect service interruptions, the Extension collects anonymous operational metrics via **Google Analytics 4 (Measurement Protocol)** provided by Google LLC.

Transmitted data is strictly sanitized against a pre-defined whitelist (game key, status, sanitized error code, UI interaction type, app version, UI language, random session/client ID). In accordance with our security principles, user UIDs, usernames, passwords, cookies, and IP addresses are never collected or sent.

**Opt-Out Right:**  
Users may opt out at any time during onboarding or by unchecking "Anonymous Analytics" in settings (⚙). Once opted out, all analytics transmissions are completely silenced. Collected anonymous data is never sold or transferred to any third party.

---

## 8. Disclaimer & Relationship with Official Terms

- **Unofficial Tool & Intellectual Property**: The Extension is an unofficial, fan-made tool developed by an individual and is NOT affiliated with, endorsed by, or associated with COGNOSPHERE PTE. LTD. or miHoYo Co., Ltd. (HoYoverse). "Genshin Impact", "Honkai: Star Rail", "Zenless Zone Zero", "HoYoverse", "HoYoLAB", and all related names, trademarks, and intellectual property rights belong to their respective owners.
- **Risks Under Official Terms of Service & User Responsibility**: Automating daily check-in rewards and gift code redemption through the Extension may be deemed by the operator to violate the Terms of Service of HoYoverse titles (including prohibitions on third-party tools, bots, etc.). Automatic execution features are enabled only by the user's voluntary configuration, and users use the Extension at their own discretion and risk.
- **Limitation of Liability**: The developer assumes no responsibility for any damages arising from the use of (or inability to use) the Extension, including but not limited to account warnings, restrictions, or suspensions; revocation or reclamation of in-game rewards; and malfunctions caused by changes to or discontinuation of private APIs.
- **Suspension or Discontinuation**: Upon request from rights holders or platform operators (such as Google), or whenever the developer deems it necessary, the developer may suspend distribution of, discontinue, or remove some features of the Extension without prior notice.

---

## 9. Compliance with the Chrome Web Store User Data Policy

The Extension's handling of information and transmission to external services comply with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use), including the Limited Use requirements.

> The use and transfer of information received from Google APIs or browser storage to any other app will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

---

## 10. Changes to This Privacy Policy & Revision History
This policy may be updated due to feature additions, legal requirements, or browser platform changes. When material changes occur (such as changes to user rights, collected data types, or new transmission destinations), users will be notified via this website or extension updates, and explicit re-consent will be requested where required.

Minor modifications—such as wording clarifications, typographical corrections, or internal storage item additions—will be published directly without re-prompting user consent.

### Revision History
- **October 26, 2026 (Revised)**: Added provisions and opt-out instructions for anonymous usage metrics (Google Analytics 4 Measurement Protocol) for quality improvement
- **October 17, 2026 (Revised)**: Expanded local storage disclosures (check-in records), required permissions, and private API endpoints upon introducing daily check-in automation
- **October 12, 2026 (Enacted)**: Initial enactment (automatic code redemption for Genshin Impact, Honkai: Star Rail, and Zenless Zone Zero)

---

## 11. Contact & Support
If you have questions, feedback, or bug reports regarding this policy or data practices, please reach out via:
- Support tab on the Extension's Chrome Web Store page
- Web Privacy Policy: https://hoyopass.pages.dev/privacy (English: https://hoyopass.pages.dev/privacy_en )
