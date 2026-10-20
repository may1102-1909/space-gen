IMAGE_GENERATION_PROMPT = """
Generate a photorealistic interior design visualization.

Room context:
- Type: {room_type}
- Style: {target_style}

PRESERVE EXACTLY (do not modify):
- Room architecture: walls, floor, ceiling
- Camera perspective and position
- Window and door locations
- Room proportions and scale
- Lighting direction

CHANGE:
{edit_instructions}

Quality: Professional interior photography, natural lighting, realistic materials, correct shadows and reflections.
Style: {style}
"""
