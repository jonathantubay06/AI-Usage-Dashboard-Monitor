# Cloud mirror (optional)

Your own read-only copy of the dashboard on a free Netlify site, so you can check usage from a phone anywhere. Your computer pushes a trimmed snapshot within about 10 seconds of any change; the site stores only the latest one (Netlify Blobs) and shows it after you enter a view token.

What is sent: totals per app, model and day, the last 30 days of sessions (titles and project folders replaced by "Session ab12cd" unless you tick "Include session titles"), live server status, plan limits and exchange rates. Your logs, source paths, API keys and webhooks never leave your computer.

## Set it up once

You need a free Netlify account and Node.js.

1. In this folder, install the one package the cloud function uses, build the site and log in to Netlify:

   ```bash
   npm install
   npm run cloud
   npx netlify-cli login
   ```

2. Create the site and deploy it:

   ```bash
   npx netlify-cli sites:create --name my-ai-monitor-<something-random>
   npx netlify-cli deploy --prod --dir dist-cloud --functions cloud/functions
   ```

3. Make two long random tokens (for example `node -e "console.log(crypto.randomBytes(24).toString('base64url'))"`, run it twice) and store them on the site:

   ```bash
   npx netlify-cli env:set ATM_PUSH_TOKEN <first-token> --secret
   npx netlify-cli env:set ATM_VIEW_TOKEN <second-token> --secret
   npx netlify-cli deploy --prod --dir dist-cloud --functions cloud/functions
   ```

   (Deploy again after setting them so the function sees them.)

4. On your computer, open the monitor, go to Settings, Cloud mirror: enter the site address and the push token, tick "Send updates" and press Save. "Last push" should say "Pushed".

5. On your phone, open the site address, enter the view token, and use "Add to Home Screen".

Keep both tokens private. To stop the mirror, untick "Send updates"; to remove everything, delete the site in Netlify.
