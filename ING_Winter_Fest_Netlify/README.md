# ING Winter Fest 2026 — Netlify edition

Isabelle Gonzalez’s graduation concert: December 26, 2026, 3 PM. Venetian Gardens Clubhouse, 1555 Mosaic Way, Stockton, CA. RSVP by December 5, 2026. Red, black and turquoise; all ’80s costumes welcome, music looks encouraged. No generated imagery is included.

## Deployment status

Source conversion and local tests are complete. No production Netlify project, database or Backblaze bucket has been connected or verified. Guest actions stay disabled while required configuration is missing. A ZIP dropped into Netlify’s static upload area will NOT deploy this app’s server functions. Use a Git-connected build or Netlify CLI deploying both functions and static output.

## Setup

1. Create a private Git repository from the contents of this folder (package.json and netlify.toml at the repository root), and import it into Netlify. Build command `npm run build`; publish directory `dist`; functions directory `netlify/functions`. Keep the free plan and automatic paid upgrades disabled.
2. Enable Netlify Database for that project. Netlify supplies `NETLIFY_DB_URL`; apply the included SQL migration through Netlify’s database migration workflow. Do not paste database credentials into chat or commit them to Git.
3. In Backblaze B2, create a **private** bucket dedicated to this event. Create a bucket-scoped application key with read, write and delete file permissions. Copy the bucket’s exact S3 endpoint and region, bucket name, key ID and application key into Netlify’s environment variable settings. Keep the account within the free allowance; the app reserves at most 9,000,000,000 photo bytes, but other account files and versions also count. Disable file version retention/use a lifecycle rule to remove replaced/deleted versions so they do not accumulate.
4. Set these Netlify runtime variables (functions scope): `B2_ENDPOINT`, `B2_REGION`, `B2_BUCKET`, `B2_KEY_ID`, `B2_APPLICATION_KEY`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `PHOTO_CODE`. Use a unique strong host password and a random signing secret of at least 32 bytes. `.env.example` contains names only.
5. Deploy through Netlify’s Git build. Database migrations live in `netlify/database/migrations` and must finish before guest use.
6. Check `/api/config` returns `configured: true`, then open `/?view=admin` and sign in. Test a disposable household invitation, RSVP, photo upload, approval and deletion on the live site before sending invitations. Configuration presence is not a connectivity test.

## Host controls

Use HOST ACCESS in the footer. Upload your own logo, banner, Isabelle photograph and ticket invitation independently; JPEG or PNG, under 4 MB each. Empty slots remain placeholders. These public website assets should not contain private information.

Create one household invitation at a time with its maximum party size. Copy its personal link to send by text or use the email draft action. **There is no automatic email or SMS delivery service.** The link is a bearer credential, so send each household its own link. The dashboard displays responses and exports CSV.

Download the photo QR code only after the final website URL is chosen. Guests need their invitation link or the party photo code to upload. Photos are resized to JPEG and metadata is removed by the browser. Originals up to 30 MB are accepted by the picker; resulting uploads must be under 4 MB. Videos are not supported. Uploaded photos remain pending until host approval. Approved photos are publicly viewable by anyone with the event URL. Private storage uses five-minute signed image links; a link already issued can work until it expires.

The app caps photo storage at 9 GB, leaving room for website assets within an otherwise empty 10 GB account allowance. Deleted photos are removed from the application; B2 lifecycle/version settings determine retained older versions. Keep original photos elsewhere.

## Local verification

Node 22.18+ or newer. Run `npm ci`, `npm test`, `npm run build`. Tests use a local PostgreSQL engine and simulated private storage; they do not use production credentials. `npm run dev` previews the design only. Use Netlify Dev plus configured local services for a full integration preview.

Before launch, verify the provider dashboards show the free plan, no paid auto-recharge, and appropriate usage limits. Netlify Database consumes plan credits for compute and bandwidth. Keep its five-minute sleep setting and monitor the account’s credits; a free-plan quota can pause the service. Backblaze includes the first 10 GB of storage, but download traffic also has an allowance; configure its account-level caps to prevent charges. Nothing in this package authorizes paid upgrades.
