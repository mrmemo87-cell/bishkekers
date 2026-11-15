# Bishkekers — waitlist page

Static sign-up page for Bishkekers (points and 1+1 offers in Bishkek), served by GitHub Pages.

- Data: Supabase project `brains-heist-demo`, schema `bishkekers`, reached only through the RPCs `bk_signup` and `bk_stats`.
- The key in `index.html` is the Supabase **publishable** key (safe in the browser); the table itself has no public access.

## Telegram bot (@bishkekers_bot)

`bot/index.ts` is the Supabase Edge Function `bishkekers-bot` (copy kept here for history).
It needs one secret, `BISHKEKERS_BOT_TOKEN`, set in Supabase → Edge Functions → Secrets (never commit it).

- Customers: phone verification, points card, history, invites, partner list
- Cashiers: till (customer code + bill → spend/earn points), owner reports
- Admin: `/admin`, `/addpartner Name | food`, `/partners`, `/stats`, `/resetdemo`
