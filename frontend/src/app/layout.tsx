import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Speer – Intelligence & Multi-Step Outreach',
  description: 'Research prospects, verify signals, and generate multi-step outreach sequences.',
  icons: {
    icon: '/logo.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Manrope:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

