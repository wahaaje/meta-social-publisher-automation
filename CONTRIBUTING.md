# Contributing

Contributions are welcome when they preserve the project's fail-closed publishing model.

## Before opening a pull request

1. Create a branch from the latest default branch.
2. Keep fixtures generic and every sample row `DRAFT`.
3. Never use production tokens, IDs, media, captions, state JSON, or queue exports.
4. Link official Meta or Google documentation for API or scope changes.
5. Add or update tests for pure queue and safety behavior.
6. Run `npm test`.
7. Review the manifest scopes and endpoint allowlists.
8. Run a secret scan across the working tree and Git history.

## Design requirements

- Preserve separate Facebook and Instagram state.
- Record intent before each remote mutation.
- Do not automatically replay uncertain publication requests.
- Re-read a row before a mutation.
- Keep previews read-only.
- Keep new sample rows `DRAFT`.
- Block unresolved variable-event dates.
- Do not expand Google or Meta permissions without a documented need.

## Bug reports

Include the repository version, format, sanitized row values, platform status, sanitized error, API version, and timezone. Remove all credentials and production identifiers before posting.

## Pull-request checklist

- [ ] Tests pass.
- [ ] Fixtures contain no production data.
- [ ] No credential or identifier was added.
- [ ] State and duplicate-prevention behavior remains safe.
- [ ] Documentation reflects user-visible changes.
- [ ] Manifest scopes and network destinations were reviewed.
