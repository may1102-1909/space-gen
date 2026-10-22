import type { Metadata } from 'next';

// Share links are bearer capabilities: keep them out of indexes and out of Referer headers.
export const metadata: Metadata = {
  title: 'SpaceGen presentation',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function PresentationLayout({ children }: { children: React.ReactNode }) {
  return children;
}
