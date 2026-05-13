This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.


1. There are errors in the TxStatusPage, and I'm not sure it was redesigned in the big redesign. Fix this.
2. Abstract away the Sidebar into its own component.
3. Make the transfers table more responsive.
4. Abstract away the header component of the dashboard components.
5. I need to be able to add a memo for single transfers. Also, I don't see the note/ memo that I add during batch sends or Paycrest orders when I open up transaction details. Also, I don't like the way the history transactions are displayed exactly like recent transactions on the home page. The home page should only have 5 transactions, and not load everything. The history shouldn't have the activity card and recent transactions text.
6. There are errors in the TxStatusPage, and I'm not sure it was redesigned in the big redesign.
