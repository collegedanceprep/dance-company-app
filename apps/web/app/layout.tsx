import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Sora } from 'next/font/google'
import { VersionBadge } from '@/components/version-badge'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})
const sora = Sora({
  variable: '--font-sora',
  subsets: ['latin'],
  weight: ['200', '300', '400', '500', '600', '700'],
})

export const metadata: Metadata = {
  title: 'College Dance Prep — Book Private Sessions',
  description:
    'Train with elite PrepMasters. Book private dance sessions, track your credits, and level up your craft with College Dance Prep.',
  generator: 'v0.app',
  verification: {
    google: '3-17bIudf47hr2Ks5P_MugY4Q8TMrai2kohoBB3hxOE',
  },
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${sora.variable} bg-background`}
    >
      <body className="font-sans antialiased">
        {children}
        <VersionBadge />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
