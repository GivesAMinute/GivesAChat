# Durable Object usage — baseline at the live-gating change

Recorded 25 August 2026, immediately after deploying commit `1bd7d93`
("Make room residency follow the stream, not the socket").

Written down because the Cloudflare dashboard shows **cumulative
period totals**, not daily figures. Without a fixed reference point
taken at a known moment, "is it better?" is unanswerable — every
later reading includes everything that came before it.

## Reading at the moment of the change

Billing period **21 August – 21 September**, ~4 days elapsed.

| | |
|---|---|
| Duration | **187,000 GB-s** |
| Requests | 91,740 |
| Billable | $0.00 |
| SQL storage | 114.69 kB |

### Per namespace

| Namespace | Requests | Errors | Duration (GB-s) | h/day resident |
|---|---:|---:|---:|---:|
| ChatRoom | 19,490 | 1,790 | 19.4 | ~0 |
| BitChuteRoom | 12,180 | 82 | 43,300 | **24.0** |
| BeamRoom | 12,160 | 61 | 43,300 | **24.0** |
| OdyseeRoom | 12,140 | 85 | 43,300 | **24.0** |
| ArenaRoom | 12,100 | 59 | 43,100 | **23.8** |
| FacebookRoom | 11,880 | 93 | 14,300 | 7.9 |
| FacebookTokenStore | 10,360 | 0 | 6.84 | ~0 |
| PopupRoom | 902 | 638 | 17.2 | ~0 |
| VeloraTokenStore | 524 | 0 | 1.47 | ~0 |

43,200 GB-s at 128 MB is 345,600 seconds, which is exactly 4 × 86,400.
Three rooms were resident every second of the period. Not an estimate.

## The cause

One socket. A chat overlay tab left open in Brave on a laptop that
never sleeps. Rooms ran while any overlay was *connected*, so that
single tab held four upstream connections open around the clock.

Scale worth remembering: **one room resident 24/7 costs 334,800 GB-s
a month — 84% of the entire free allowance**, watching nothing.
Dropping platforms could never have fixed this.

## What to expect now

| moment | if fixed | if still broken |
|---|---|---|
| +30 min, offline | ~187,000 (unchanged) | ~187,900 |
| +24 h, one 3h stream | ~193,800 | ~230,200 |

The 30-minute check is the useful one — it needs no stream and the
answer is unambiguous. Idle cost is now the cron wakes alone, about
**4.5 GB-s per day**, which rounds to nothing.

Projection at 4.5 h/day with all five rooms: **313,875 GB-s**, 78% of
the allowance, 86k spare. Under, but not roomy.

## If the margin ever feels tight

Merge the five platform rooms into one Durable Object. Cuts
streaming-hours cost roughly 5×, taking 4.5 h/day from ~314k to
~63k. Deliberately not done yet — live-gating is the fix that
stopped the bleeding, and it is worth measuring before adding
structural change on top.

## Unrelated, but noticed while reading this table

- **PopupRoom: 638 errors in 902 requests.** A 71% failure rate that
  nobody has looked at because popups still work.
- **ChatRoom: 1,790 errors in 19,490.** Around 9%, likely socket
  churn, but unverified.

Neither costs money. Both are worth a look on a quiet day.
