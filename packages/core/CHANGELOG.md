# @meshtour/core

## 1.0.0

- Document the 1.x viewer API and keep existing v1 tour files compatible.
- Resolve the correct TypeScript declarations for CommonJS and ES module imports.

## 0.2.0

- Use Zod 4.6.7 or newer for tour validation to address
  [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
  Tour JSON and its defaults are unchanged. Use the Zod 4 APIs if your code
  composes MeshTour's exported schemas directly.
