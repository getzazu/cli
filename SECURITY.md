# Security

## API keys

The CLI authenticates with Zazu API keys and stores local login state in the user's config directory.

- Prefer `zazu login` for interactive use. It uses a hidden prompt.
- Prefer `zazu login --api-key-stdin` for scripts and secret managers.
- Avoid passing API keys through shell arguments because they can appear in shell history and process listings.
- Do not commit `.env` files, generated config files, or command logs that contain secrets.

API permissions are enforced by the Zazu API. The CLI forwards the key and surfaces `401` and `403` responses without trying to bypass scope checks.

## Reporting vulnerabilities

Report suspected vulnerabilities privately to the Zazu maintainers. Do not open a public issue for secret leaks, authentication bypasses, or permission bugs.
