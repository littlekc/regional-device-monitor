# regional-device-monitor

This is a [Next.js](https://nextjs.org) project bootstrapped with [v0](https://v0.app).

## Built with v0

This repository is linked to a [v0](https://v0.app) project. You can continue developing by visiting the link below -- start new chats to make changes, and v0 will push commits directly to this repo. Every merge to `main` will automatically deploy.

[Continue working on v0 →](https://v0.app/chat/projects/prj_Souk2NeesOCspsPmWQvaRd9EdKCp)

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Learn More

To learn more, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [v0 Documentation](https://v0.app/docs) - learn about v0 and how to use it.

## Regression checks

```bash
npm test
npm run typecheck
npm run build
```

The test suite loads the actual TypeScript modules and renders the actual React
components, with in-memory localStorage for isolated persistence checks. It does
not touch browser data or connect to Zabbix. There is no configured lint script.

`hasFault` describes a current explicit fault in the fixed demo. A future adapter
must set `faultAvailable: false` for stale/unavailable fault samples; these samples
must not be reused as live alarms. An unavailable overall status remains unknown.
This flag is an input contract, not an automatic expiry timer.
