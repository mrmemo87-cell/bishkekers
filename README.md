# Bishkekers — waitlist page

Static sign-up page for Bishkekers (points and 1+1 offers in Bishkek), served by GitHub Pages.

- Data: Supabase project `brains-heist-demo`, schema `bishkekers`, reached only through the RPCs `bk_signup` and `bk_stats`.
- The key in `index.html` is the Supabase **publishable** key (safe in the browser); the table itself has no public access.
