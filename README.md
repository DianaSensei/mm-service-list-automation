# mm-service-list-automation — DevTool plugins (`main`)

Plugin catalog for [DevTool](https://github.com/DianaSensei/developer-desktop-utils),
laid out like `developer-desktop-miniapp`: **`main` is the skeleton and holds no
plugin code**; each plugin lives on its own branch `app/<id>/main`.

- `shared/` — vendored UI kit and `src/lib/*` utilities (a plugin bundle cannot
  import the host's own components; only React is shared via `window.__DEVTOOL_VENDOR__`).
- `scripts/` — `makePluginConfig.mjs` (shared Vite config), `create-plugin.mjs`
  (scaffolder), `build-release.mjs`, `check-host-classes.mjs`.
- `catalog.json` — aggregated install list; each plugin's release updates only its own entry.

## Plugins

| id | branch | what it does |
|---|---|---|
| `service-list-automation` | `app/service-list-automation/main` | Fills the service-list form from a CSV via a Chrome session you log in to yourself |

The original Java/Selenium CLI is preserved on branch `backup/java-selenium`.

## Adding a plugin

```bash
node scripts/create-plugin.mjs <id> --label "Label" --description "..." [--sidecar]
```

## Installing a plugin

DevTool → **Settings → Extensions**: paste the plugin's `pluginManifestUrl` from
`catalog.json`, then its `serviceManifestUrl`, and restart the app.

See the host's `docs/plugin-sdk/` for the manifest, SDK and sidecar contracts.

## Host requirement for `service-list-automation`

Its sidecar `devtool-svc-service-list-automation` must be listed in the host's
`ALLOWED_SERVICES` (`src-tauri/src/service_host.rs` in the DevTool repo). Installing
a sidecar from a URL does **not** grant permission to run a new binary name, so until
that one-line change ships in a DevTool build, the plugin installs but its service
calls are refused.
