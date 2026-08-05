# Generation providers

Director X keeps provider setup small and auditable. It does not guess undocumented API behavior and never stores API keys in project files.

## Clarify with native questions

Ask only when image or video generation is needed:

1. provider name
2. image or video modality
3. exact model name
4. official documentation URL
5. whether the user already has an API key

Do not ask the user to paste a key into chat or place it on the canvas.

## Configure non-secret metadata

Choose a clear environment variable name, then run:

```bash
node <plugin-root>/scripts/directorx.mjs provider configure \
  --project <project-path> \
  --id <lower-case-id> \
  --provider "<provider name>" \
  --modality image \
  --model "<exact model>" \
  --docs "<official HTTPS documentation URL>" \
  --endpoint "<documented HTTPS endpoint>" \
  --auth-env "<UPPERCASE_ENV_NAME>"
```

The generated `.directorx/providers.json` contains metadata and the environment variable name only. It must never contain a credential.

The user sets the credential in their local shell or secret manager. Verify availability without revealing it:

```bash
node <plugin-root>/scripts/directorx.mjs provider doctor \
  --project <project-path> \
  --id <provider-id>
```

## Add an adapter only from official documentation

Before making a paid request, verify:

- endpoint and HTTP method
- authentication header
- request schema and required parameters
- image, video, audio, and reference input formats
- response schema
- asynchronous polling behavior
- documented limits, safety rules, and pricing
- output ownership and retention behavior

Keep each provider adapter thin. Redact credentials and authorization headers from errors and logs. Save request metadata, provider job IDs, costs, outputs, and failures under `.directorx/`, but never save the key.
