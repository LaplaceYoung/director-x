# Generation providers

Director X keeps provider setup small and auditable. It does not guess undocumented API behavior and never stores API keys in project files.

## Clarify with native questions

Follow `native-questioning.md`. Ask one unresolved provider decision at a time and recommend the best-supported route.

Ask only when image or video generation is needed:

1. confirm the generation route;
2. recommend and confirm the exact model;
3. find the official documentation yourself when it is publicly discoverable;
4. ask whether a key is available only after the route is selected;
5. confirm the paid or external submission immediately before calling it.

Do not ask the user to paste a key into chat or place it on the canvas.

## Continue without a key

If generation is necessary but the user has no usable API key:

1. finish the prompt and continuity constraints;
2. create one canvas generation placeholder for each required image or video shot;
3. include recommended model routes and concrete output specifications;
4. keep official documentation links visible in the placeholder;
5. continue planning the remaining shots instead of stopping the task;
6. do not silently turn the requested generative route into a Remotion-only video.

```bash
node <plugin-root>/scripts/directorx.mjs placeholder \
  --project <project-path> \
  --modality image \
  --title "Character identity reference" \
  --aspect-ratio 16:9 \
  --needs identity,multi-reference \
  --prompt "<production-ready prompt>"
```

Recommendations are ranked from the shot's needs rather than a fixed provider list. The catalog considers mainstream Seed/Seedance, Seedream, Kling, Veo, Sora, GPT Image, and Imagen routes. Happy Horse is considered only as an experimental candidate: no authoritative first-party model or API documentation was verified on 2026-08-05, so it must not be called until the user supplies official documentation.

Recommendations are presets, not permission to call a provider. Recheck the linked official documentation and exact model ID before configuring or submitting a request.

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
  --auth-header "Authorization" \
  --auth-scheme bearer \
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

For a documented JSON-over-HTTPS endpoint, place the documented request body in a project-local JSON file. After the user explicitly approves the paid or external request, run:

```bash
node <plugin-root>/scripts/directorx.mjs provider request \
  --project <project-path> \
  --id <provider-id> \
  --approved \
  --body <project-local-request.json>
```

The request command injects authentication from the configured environment variable, refuses credential-like fields in the JSON body, blocks redirects and cross-origin endpoint overrides, and stores a redacted run record under `.directorx/provider-runs/`.

For asynchronous video jobs, inspect the saved JSON response, then use `--method GET --endpoint <same-origin-status-url>` for documented polling. Do not poll faster or longer than the official documentation permits.

Direct image or video responses are saved and added to the canvas automatically. JSON responses remain technical evidence; download or decode only the documented output field, then add the resulting media to the canvas.
