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
5. Build a Dictionary with:
   - `schemaVersion`: number `1`
   - `shortcutVersion`: text `1`
   - `name`: selected contact full name
   - `jobTitle`: selected contact job title, or an empty string
6. Add the optional contact details without allowing an empty list to stop the Shortcut:
   - Add an **If** action using the phone-number result and choose **has any value**.
   - Inside that **If**, use **Set Dictionary Value** to set `phones` to the selected contact phone-number list.
   - After **End If**, add another **If** using the email-address result and choose **has any value**.
   - Inside that **If**, use **Set Dictionary Value** to set `emails` to the selected contact email-address list.
   - Leave either key out when its list is empty. Neat treats a missing `phones` or `emails` key as an empty list.
7. Convert the final Dictionary to JSON text.
8. **URL Encode** the JSON text.
9. Build Text as: `[reviewUrl]#contact=[URL-encoded JSON]`.
10. **Open URLs** using that text.

The fragment after `#` is processed in the browser and removed from the address bar after Neat stores it in session storage. The Contact is not created until the user presses **Save contact** on the authenticated review page.

## Publishing

Test the Shortcut on an iPhone, choose **Share**, then **Copy iCloud Link**. Set that link as `IPHONE_SHORTCUT_INSTALL_URL`. Users install it once with **Get Shortcut**. Installed copies do not receive centralized updates, so keep the Shortcut thin; increase `IPHONE_SHORTCUT_VERSION` and publish a replacement link when an update is required.
