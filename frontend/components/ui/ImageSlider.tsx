import { BeforeAfter } from '../features/BeforeAfter'

export function ImageSlider(props: React.ComponentProps<typeof BeforeAfter>) {
  // Aliasing BeforeAfter as ImageSlider for UI folder
  return <BeforeAfter {...props} />
}
