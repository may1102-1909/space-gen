# Read images as evidence

Begin with `scene-agent image-check reference.png`. Header/decoder validation catches mismatched extensions and broken files; it does not identify objects, infer rights or verify a DCC texture loader. Record source dimensions, aspect ratio and known crop/resizing history.

## Observation ledger

Use rows with `id`, `reference`, `region_px`, `observation`, `decision`, `status`, `evidence`, `impact` and `verification`. Status is one of **measured**, **inferred**, **assumed**, **unresolved**. Example: a mullion appears 8 pixels wide in a 1500-pixel image; that is a pixel measurement. A 50 mm physical mullion is an inference until a scale or drawing supports it.

Find long straight lines for vanishing directions: slabs, ceiling joints, wall corners and frames. Reflections are not new rooms; shadow boundaries are not necessarily panel seams. Look for repeated construction rhythms, material scale cues and visible thickness. Furniture dimensions can support a rough scale assumption, but product variation makes them weak survey evidence.

## Multiple references

Keep the user-designated hero reference dominant for framing. Compare storeys, facade openings, furniture and landscape across the set. If images conflict, write a contradiction entry and choose a coherent building interpretation. Do not claim all views were simultaneously matched when they represent different designs.

## Unseen space

Single-view reconstruction is underdetermined. Build unseen backs, internal supports and room connections to make a usable scene, but mark them as inferred. A background projection may help a fixed camera; it must remain identified as projection and be excluded from geometry accuracy assessment.

No bundled OCR or monocular-depth inference is claimed. An agent with a vision tool can inspect and trace; a production platform should preserve the resulting coordinates and confidence ledger as data rather than leaving them in conversation text.
