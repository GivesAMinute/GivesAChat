# Moving bjwok.com DNS to Cloudflare

Goal: serve the chat overlay from your own domain instead of
`givesachat-cloudflare.benonkoebsch.workers.dev`.

The overlay is the easy part. The risk is your **email** — MX, SPF and
DKIM records. Get those wrong and mail stops arriving, often silently.
Work through this in order and don't skip the verification step.

---

## Before you start

**Back up.** Screenshot the DreamHost DNS page, or keep the record list
you already pasted. If anything goes wrong the fix is to put the
DreamHost nameservers back and restore these records.

**Find your registrar.** Cloudflare needs you to change nameservers
where the *domain* is registered, which may or may not be DreamHost.
Check DreamHost → Domains → Registrations. If bjwok.com isn't listed
there, it's registered elsewhere and that's where step 5 happens.

**Timing.** Do this on a day you're not streaming, and not while
expecting anything important by email. Propagation is usually minutes
but can take up to 24 hours.

---

## 1. Add the site to Cloudflare

Cloudflare dashboard → **Add a site** → `bjwok.com` → **Free** plan.

Cloudflare scans your existing DNS and imports what it finds.

## 2. Verify every record — do not trust the scan

The scanner is good but not perfect, and TXT and SRV records are the
ones it most often mangles. Check each of these exists in Cloudflare
and matches exactly:

| Name | Type | Value |
|---|---|---|
| @ | A | 173.236.137.190 |
| ftp | A | 173.236.137.190 |
| mail | A | 64.90.62.162 |
| mailboxes | A | 69.163.136.97 |
| mysql | A | 208.113.245.206 |
| ssh | A | 173.236.137.190 |
| webmail | A | 69.163.136.138 |
| www | A | 173.236.137.190 |
| www.mailboxes | A | 69.163.136.97 |
| www.webmail | A | 69.163.136.138 |
| @ | MX | 0 mx1.mailchannels.net. |
| @ | MX | 0 mx2.mailchannels.net. |
| mail | MX | 0 mx1.mailchannels.net. |
| mail | MX | 0 mx2.mailchannels.net. |
| autoconfig | CNAME | autoconfig.dreamhost.com |
| @ | TXT | v=spf1 mx include:netblocks.dreamhost.com include:relay.mailchannels.net -all |
| dreamhost._domainkey | TXT | v=DKIM1; k=rsa; ... (the long one) |
| _autodiscover._tcp | SRV | 5 0 443 autoconfig.dreamhost.com |

**The DKIM record is long and must be exact.** One truncated character
and your outgoing mail starts failing DKIM checks. Copy it from
DreamHost rather than retyping.

Do **not** copy the `NS` records — Cloudflare replaces those.

## 3. Turn the orange clouds OFF

This is the step that breaks things if you miss it.

Cloudflare defaults some records to **Proxied** (orange cloud). Proxying
only works for HTTP/HTTPS. Anything proxied that isn't a website stops
working:

- `ssh` → can't connect
- `ftp` → can't connect
- `mail`, `mailboxes`, `webmail` → mail breaks
- `mysql` → database connections fail

**Set every record to "DNS only" (grey cloud), including @ and www.**

That makes Cloudflare purely a DNS host, so your photography site
behaves exactly as it does today — no proxying, no caching, no SSL mode
to get wrong. The worker custom domain works regardless; it doesn't
need the rest of the zone proxied.

You can always turn proxying on for `@` and `www` later, deliberately,
once you've read up on SSL modes. Don't bundle it with this change.

## 4. Note Cloudflare's nameservers

Cloudflare gives you two, something like:

```
xxxx.ns.cloudflare.com
yyyy.ns.cloudflare.com
```

## 5. Change nameservers at your registrar

Replace all three DreamHost nameservers:

```
ns1.dreamhost.com    ->  xxxx.ns.cloudflare.com
ns2.dreamhost.com    ->  yyyy.ns.cloudflare.com
ns3.dreamhost.com    ->  (remove)
```

## 6. Wait, then verify

Cloudflare will email you when the zone goes **Active**.

Then check, in this order:

1. `https://www.bjwok.com` still loads
2. **Send yourself an email from an outside address** and confirm it
   arrives — this is the one people forget until it's too late
3. Send an email *from* your address and check it isn't flagged as spam
   (that's SPF/DKIM working)

If mail breaks, compare the MX, SPF and DKIM records against the table
above. It is almost always a typo or a missing record, not Cloudflare.

## 7. Point the worker at the domain

Cloudflare dashboard → **Workers & Pages** → `givesachat-cloudflare` →
**Settings** → **Domains & Routes** → **Add** → **Custom domain**:

```
chat.bjwok.com
```

Cloudflare creates the DNS record and issues the certificate itself.
Takes a minute or two.

Your viewer URL becomes:

```
https://chat.bjwok.com/overlay/chat/?key=YOUR_VIEWER_KEY&mode=persistent
```

The workers.dev URL keeps working, so your OBS sources don't need
changing.

---

## Afterwards

**DreamHost no longer manages your DNS.** If they ever migrate your
hosting to a new IP, they'll update their own DNS and yours won't
follow. Your site would go down until you updated the A records in
Cloudflare manually. Worth knowing; not a reason to avoid this.

**Rolling back** is just putting the DreamHost nameservers back at the
registrar. Same propagation delay.
