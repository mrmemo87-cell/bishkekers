# Bishkekers — waitlist page

Static sign-up page for Bishkekers (points and 1+1 offers in Bishkek), served by GitHub Pages.

- Data: Supabase project `brains-heist-demo`, schema `bishkekers`, reached only through the RPCs `bk_signup` and `bk_stats`.
- The key in `index.html` is the Supabase **publishable** key (safe in the browser); the table itself has no public access.

## Telegram bot (@bishkekers_bot)

`bot/index.ts` is the Supabase Edge Function `bishkekers-bot` (copy kept here for history).
It needs one secret, `BISHKEKERS_BOT_TOKEN`, set in Supabase → Edge Functions → Secrets (never commit it).

- Customers: phone verification, points card, history, invites, partner list
- Cashiers: till (customer code + bill → spend/earn points), owner reports
- Admin: `/admin`, `/addpartner Name | food`, `/partners`, `/stats`, `/flags`, `/resetdemo`

### Security model
- Till code (`card_code`) is separate from the invite code (`ref_code`) and can be rotated by the customer.
- Spending points always needs the customer's approval in Telegram (expires after 3 minutes); earning is one step.
- Referral bonus only after the friend's first bill of 500+ som; max 10 bonuses per referrer per month.
- Owner link works once; owners can list/remove cashiers and rotate the cashier link (`/staff`).
- Max 30 code checks per cashier per hour; warnings (declined spends, code guessing, repeat pairs, night or very large bills) go to the admin daily report and `/flags`.
