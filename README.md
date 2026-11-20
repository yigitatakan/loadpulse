# LoadPulse

Welcome to your [Draftship](https://draftship.dev) project. This app was built with Draftship, where you describe an app in a chat and AI writes the code.

## Project info

- **Edit in Draftship:** https://draftship.dev/projects/08ea2877-67a6-4571-9594-fcf84d098a87
- **Live app:** https://loadpulse-08ea2877.draftship.site

## How can I edit this code?

### Use Draftship

Open the [project](https://draftship.dev/projects/08ea2877-67a6-4571-9594-fcf84d098a87) and describe the change in the chat. Draftship updates the code, checks the build and publishes the app.

### Use your own editor

On Pro+, connect your GitHub account and choose **Push** in the project to send the code to GitHub. You'll need [Node.js](https://nodejs.org) installed.

```bash
git clone <YOUR_GIT_URL>
cd <YOUR_PROJECT_NAME>
npm install
cp .env.production .env.local
npm run dev
```

The `.env.local` file connects your local copy to the app's Draftship backend, so it uses the app's real data. Backend functions need their own keys, so run them in Draftship.

Pushing to GitHub only goes one way. Changes you make in GitHub or your editor don't come back to Draftship, and the next push from Draftship replaces them. To keep a change, make it in the Draftship chat, or keep working outside Draftship from then on.

## What is this built with?

- [Next.js](https://nextjs.org) App Router
- TypeScript
- [Tailwind CSS](https://tailwindcss.com)
- Draftship's backend for data, accounts, files, email and AI (`lib/draftship.ts`)

## How can I publish this app?

Draftship publishes the app after each successful build, at https://loadpulse-08ea2877.draftship.site. On Pro+, you can also deploy it to Vercel from the project, and every later build deploys automatically.

## Can I use a custom domain?

Yes, on Pro and Pro+. See [Connecting a custom domain](https://draftship.dev/docs/domains/connecting-a-custom-domain).

## Need help?

Read the [Draftship docs](https://draftship.dev/docs).
