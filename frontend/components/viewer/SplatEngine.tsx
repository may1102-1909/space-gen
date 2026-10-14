'use client'

/**
 * SplatEngine — SpaceGen Integrated 3D Gaussian Splatting Engine
 * Powered by @manycore/aholo-viewer
 * 
 * Re-exports AholoViewer for seamless integration with existing SpaceGen components.
 * @license MIT — see THIRD_PARTY_LICENSES.md
 */

import dynamic from 'next/dynamic'
import type { AholoViewerProps } from '../AholoViewer/AholoViewer'

const AholoViewer = dynamic(
  () => import('../AholoViewer/AholoViewer'),
  { ssr: false }
)

export { AholoViewer }
export type { AholoViewerProps }

export function SplatEngine(props: AholoViewerProps) {
  return <AholoViewer {...props} />
}

export default SplatEngine
