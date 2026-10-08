# Models

## lifter.glb

The lifter in the landing-page gym scene (`src/components/three/gym-lifter.ts`).

- **Source:** "Michelle", a Mixamo character (Adobe), as published in the three.js examples
  (`examples/models/gltf/Michelle.glb`, https://github.com/mrdoob/three.js).
- **License:** Mixamo characters are royalty-free for use in personal, commercial and non-profit projects, including
  inside apps and websites. They may not be redistributed as standalone assets (for example re-sold or shared as a
  model download). Keep this file served only as part of the app. Terms: https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html
- **Changes:** produced by `scripts/prepare-lifter-model.py`. It removes the sunglasses, re-dyes the outfit into
  training kit, and drops the dance animations. The scene drives the bones itself from `gym-rig.ts`.

To swap the character, supply any Mixamo-rigged glTF (bone names `mixamorig:*`, with fingers), then re-measure its
proportions into `BODY` in `gym-rig.ts` and `SCALE` in `gym-lifter.ts`, so that the IK stays exact.
