# Send to Neat iPhone Shortcut

Neat owns the authenticated import session, account association, payload validation, review, and Contact creation. The Apple Shortcut only selects one contact and returns a small JSON payload to the authenticated Neat review page.

## Configuration

- `IPHONE_SHORTCUT_VERSION=1`
- `IPHONE_SHORTCUT_INSTALL_URL=https://www.icloud.com/shortcuts/<published-shortcut-id>`

The installation URL is optional until the Shortcut is published. The import action can launch an already-installed Shortcut without it, while Profile and the contact tile explain that the installation link is not yet configured.

## Manual Shortcut creation

Create a Shortcut named exactly **Send to Neat** with these actions:

1. Accept **Text** as Shortcut Input. Neat supplies JSON containing `schema`, `state`, `reviewUrl`, and `requiredShortcutVersion`.
2. **Get Dictionary from Input** and retain the `reviewUrl` value.
3. **Select Contact** with multiple selection disabled. Leave cancellation as **Stop This Shortcut**.
4. From the selected Contact, use **Get Details of Contacts** for:
   - full name
   - phone numbers
   - email addresses
   - job title
5. Build a Dictionary with exactly:
   - `schemaVersion`: number `1`
   - `shortcutVersion`: text `1`
   - `name`: selected contact full name
   - `phones`: selected contact phone-number list
   - `emails`: selected contact email-address list
   - `jobTitle`: selected contact job title, or an empty string
6. Convert that Dictionary to JSON text.
7. **URL Encode** the JSON text.
8. Build Text as: `[reviewUrl]#contact=[URL-encoded JSON]`.
9. **Open URLs** using that text.

The fragment after `#` is processed in the browser and removed from the address bar after Neat stores it in session storage. The Contact is not created until the user presses **Save contact** on the authenticated review page.

## Publishing

Test the Shortcut on an iPhone, choose **Share**, then **Copy iCloud Link**. Set that link as `IPHONE_SHORTCUT_INSTALL_URL`. Users install it once with **Get Shortcut**. Installed copies do not receive centralized updates, so keep the Shortcut thin; increase `IPHONE_SHORTCUT_VERSION` and publish a replacement link when an update is required.
