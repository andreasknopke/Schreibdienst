# Schreibdienst Agent Instructions

## Releases and versioning

- When you make a user-visible change that is intended to ship, decide whether the app version in `package.json` also needs to change.
- The in-app update panel reads the installed version from `package.json` and matches it against GitHub Releases. If code is pushed after a release without a version bump, users will still see the previous release notes.
- Before pushing release-ready changes to `main`, explicitly check whether a new GitHub Release should be created.
- If a new release is created, keep the GitHub tag aligned with the app version, for example `package.json` version `0.1.2` with GitHub tag `v0.1.2`.

## Release notes

- Write GitHub release notes in German unless the user asks otherwise.
- Keep release notes user-facing and easy to understand.
- Do not mention admin-only or root-only features in release notes unless the user explicitly wants them included.
- Avoid technical implementation details, internal debugging changes, protocol details, encoding details, or English engineering jargon if a simpler user-facing description exists.
- Prefer short headings such as `Das ist neu` and `Behobene Probleme`.

## Shipping checklist

- Check whether the visible behavior changed for end users.
- If yes, decide whether this should be a new version.
- If yes, bump `package.json` and `package-lock.json` to the new version.
- If yes, create or update the GitHub Release text so the in-app update panel has the correct notes.
- If not, tell the user that pushing without a new version will keep showing the previous release notes.