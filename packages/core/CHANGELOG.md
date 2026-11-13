# @meshtour/core

## 0.2.0

- Use Zod 4.6.7 or newer for tour validation to address
  [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
  Tour JSON and its defaults are unchanged. Use the Zod 4 APIs if your code
  composes MeshTour's exported schemas directly.
