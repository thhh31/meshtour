# Changesets

Every pull request that changes the public behavior of `@meshtour/core` or
`@meshtour/react` should include a changeset:

```bash
pnpm changeset
```

Choose the affected package(s), select the semantic version bump, and describe
the user-visible change. Documentation, tests, demos, and internal refactors do
not need a changeset unless they change the published API or runtime behavior.
