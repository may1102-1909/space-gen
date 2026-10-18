'use client';

import React from 'react';
import dynamic from 'next/dynamic';

// Dynamic import with ssr: false to guarantee WebGL2 & Web Worker client execution
const AholoViewerWorkspace = dynamic(
  () => import('@/components/AholoViewer/AholoViewerWorkspace'),
  { ssr: false }
);

export default function AholoViewerPage() {
  return <AholoViewerWorkspace initialFileUrl={null} />;
}
