# Downstream Maintenance Guide

This repository is maintained as a downstream fork of [router-for-me/Cli-Proxy-API-Management-Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center) following the `downstream-fork-maintain` workflow.

## Upstream Investigation

Before this fork's patches were implemented, upstream `router-for-me/Cli-Proxy-API-Management-Center` issues and pull requests were searched for equivalent work (model allow/deny rule pickers on the client-key page, embeddings/rerank endpoint toggles, promotional-section removal, client-key page extraction from providers). No upstream issue or PR was found that already delivers these patches, so each was implemented downstream instead of consuming an open PR.

Re-run on 2026-10-14, before the api-keys table rework and `patch/button-icon-layout`, searching open and closed issues and pull requests:

- Client-key naming: [#378](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/pull/378) (display names) and [#476](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/pull/476) (share client key names through CPA metadata) are both CLOSED, and issue [#458](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/issues/458) (name API keys) is CLOSED. Upstream has no shared-name mechanism, so the local notes file stays downstream-owned and the page keeps reporting only locally noted keys.
- Client-key scope: [#424](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/pull/424) (allowed provider prefixes, CLOSED) scopes a key by provider rather than by model, so it does not overlap the model allow/deny picker this fork carries.
- Per-key usage: [#367](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/pull/367) (per-key usage accounting dashboard, CLOSED) means a column counting real per-key traffic has no upstream implementation to build on and would need the backend to attribute requests to `access.api-keys` first. It stays a proposed follow-up, not part of any patch here.
- Button icon/label layout: no issue and no pull request matches the shared `.btn` baseline defect or its `.empty-action` workaround.

Re-run on 2026-10-14 before `patch/systemone-endpoint`, searching open and closed issues and pull requests for `systemone`, `typesafe`, `jev`, `decision endpoint` and `connectivity test endpoint`: no results in this repository. The core repository has [router-for-me/CLIProxyAPI#6012](https://github.com/router-for-me/CLIProxyAPI/issues/6012) ("Support TypeSafe Jev (System One decisions API)"), closed as COMPLETED on 2026-09-22, yet upstream core `main` (`5fc580b1`, checked 2026-10-15) contains no `systemone` field or route. Upstream ships nothing to consume, so the System One model flag stays downstream.

Re-run on 2026-10-15 before `patch/client-key-provider-scope`, `patch/codex-app-keepalive`, `patch/openai-compat-model-discovery` and `patch/usage-exclude-embeddings`, searching open and closed issues and pull requests for `key-scopes`, `key scope provider`, `allowed providers`, `provider prefix api key`, `auto-discover`, `models discovery openai compatibility`, `excluded-models openai`, `codex keepalive`, `keepalive`, `exclude-embeddings`, `embeddings usage` and `embedding`:

- Provider scopes: only [#424](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/pull/424) (allowed provider prefixes, CLOSED, not merged) is related. Upstream core has no `client.key-scopes`, so there is no upstream setting to edit; the rules card targets the downstream core patch.
- Codex app keepalive, OpenAI-compatible discovery/exclusions and embedding usage exclusion: no matching issue or pull request ([#115](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/issues/115) is an unrelated, CLOSED report about the streaming block being dropped on save).

Re-run on 2026-10-16 before `patch/quota-api`, searching open and closed issues and pull requests for `quota-api`, `v1/usage`, `sub2api`, `CC Switch`, `quota endpoint` and `usage endpoint`: the hits are all about the panel's own quota cards or usage dashboard (for example [#494](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/issues/494), OPEN, about the Claude reset-grant read), none about a client-facing quota endpoint. Upstream core `main` (`5be2cdab`, checked 2026-10-16) has no `quota-api` setting, so the switch stays downstream.

Conclusion unchanged: no active upstream issue or PR covers the client-key page rework or the button layout fix, so both stay downstream. Re-run this search before changing any patch and update this section with the links and the conclusion.

Re-run on 2026-10-16 before `patch/commandcode-oauth`, searching open and closed issues and pull requests for `commandcode`, `command code` and `command-code`. The only hit in this repository is [#398](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/pull/398) (closed unmerged on 2026-09-02), which managed `commandcode-api-key` entries through the v0 API for core #5060; it has no OAuth login or quota card. Core context: [router-for-me/CLIProxyAPI#3969](https://github.com/router-for-me/CLIProxyAPI/pull/3969) (closed; the maintainer asked for a plugin) and [#5060](https://github.com/router-for-me/CLIProxyAPI/pull/5060) (open, conflicting, API keys only). Upstream ships no Command Code login or quota card, so both stay downstream.

## Patch Branches

1. **`patch/embeddings-and-rerank`**
   - **Goal**: Add model form checkboxes and connectivity test routing for `/v1/embeddings` and `/v1/rerank` endpoints.
   - **Scope**:
     - Export `buildOpenAIEmbeddingsEndpoint` and `buildRerankEndpoint` in `src/components/providers/utils.ts`.
     - Add `embedding?: boolean` and `rerank?: boolean` to `ModelAlias` and `ModelEntryInput`.
     - Expose `[x] 标记为向量模型` and `[x] 标记为重排模型` in `ModelEntriesEditor.tsx` with collapsed badges. The backend treats both flags as metadata (connectivity-test endpoint and listed output modality; routing does not read them), so the copy marks the model rather than claiming to allow an endpoint.
     - Route connectivity test in `useConnectivityTest.ts` to `/embeddings` (with `{model, input}`) and `/rerank` (with `{model, query, documents}`). `modelsSignature` includes the flags, so toggling one clears earlier test results.
     - Save both flags for OpenAI-compatible models in `serializeModelAliases` (`src/services/api/providers.ts`); before this they were dropped on save.
     - Add comprehensive unit tests in `tests/embeddingsRerankConnectivity.test.ts` and `tests/embeddingsRerankPersistence.test.ts`.
     - Complete localized translation keys across all 6 locales.

2. **`patch/systemone-endpoint`**
   - **Goal**: Mark TypeSafe System One decision models and test them against `/systemone` instead of `/chat/completions`.
   - **Scope**:
     - Add `systemone?: boolean` to `ModelAlias` and `ModelEntryInput`; read, save and clear it like `embedding` and `rerank`.
     - Expose `[x] 标记为决策模型` in `ModelEntriesEditor.tsx` with a collapsed badge, localized in all 6 locales. Like `embedding` and `rerank`, the core treats the flag as metadata and routing does not read it.
     - Route the OpenAI-compatible connectivity test for flagged models to `<base-url>/systemone` with a minimal Noul question. Decision-only upstreams such as Command Code reject `/chat/completions` with 400. The flag is part of `modelsSignature`, so toggling it clears earlier test results.
     - Tests in `tests/systemOneConnectivity.test.ts`.
   - **Stacked**: Branched from `patch/embeddings-and-rerank` and integrated right after it through a seam-diff (see below).
   - **Cross-repo**: Needs the core patch `patch/systemone-endpoint` (`systemone` model field and `POST /v1/systemone`). Against a core without it the flag is dropped on save.

3. **`patch/fix-xai-quota-test`**
   - **Goal**: Keep the xai quota USD assertions independent of the runtime locale.
   - **Scope**:
     - `XaiQuotaBody` formats USD with `Intl.NumberFormat(undefined, ...)`, so the symbol follows the runtime locale: `$0.00` on `en-US`, `US$0.00` on `zh-CN`.
     - Normalize the `US$` qualifier in the two USD assertions of `tests/xaiQuotaUnavailable.test.ts` before comparing the amount.
   - **Note**: No other patch touches this file, so its position in the integration order does not matter.

4. **`patch/remove-promotional-sections`**
   - **Goal**: Remove commercial affiliate links and sponsor quick-fill ad sections.
   - **Scope**:
     - Remove `quickStartNavItem` (APIKEY.FUN) from `MainLayout.tsx` sidebar.
     - Remove `quickFillGroups` ("快速接入") sponsor group from `ProviderCategoryList.tsx`.
     - Drop the `apikeyFun` route hint in `ProviderSheet.tsx`; that brand is reached through `/ai-providers/apikeyFun` like every other brand.
     - Leave `MainRoutes.tsx` untouched: `patch/extract-client-api-keys` owns the `/quick-start` and `/api-keys` route lines.

5. **`patch/extract-client-api-keys`**
   - **Goal**: Move Client API Keys (`access.api-keys`) out of the Config panel into a dedicated navigation page.
   - **Scope**:
     - Remove `ApiKeysField` from `SectionCommon.tsx` and `SectionConnectivity.tsx` in `src/features/config/`.
     - Create standalone `ApiKeysPage` component (`src/pages/ApiKeysPage.tsx`) using `ApiKeysCardEditor`.
     - Add `/api-keys` entry in `MainLayout.tsx` under the gateway group.
     - Own the route region in `MainRoutes.tsx`: mount `/api-keys` and render `ApiKeysPage` at the existing `/quick-start` path, so no other patch has to edit those adjacent lines.
     - Synchronize i18n keys for `nav.api_keys` and `nav_meta.api_keys` across all 6 locales.

6. **`patch/downstream-versioning`**
   - **Goal**: Adopt downstream fork version convention `v<upstream_tag>+<patch_count>-<sha>` for app display.
   - **Scope**:
     - Dynamically inspect upstream baseline tag, squash patch count, and commit hash in `vite.config.ts`.
   - **Note**: Release builds set `VERSION` from `release.yml`, which takes precedence; this patch only names local and CI builds that run without it.

7. **`patch/update-management-panel`**
   - **Goal**: Let the system page trigger an on-demand management panel asset update.
   - **Scope**:
     - Add `versionApi.updatePanel()` calling `POST /server/update-panel`.
     - Add an "Update panel" button on the system page version tile.
     - Reload after a successful asset update. Already-latest and failure states use notifications.
     - Localize the button and result messages in all 6 locales.
   - **Cross-repo**: Needs the core patch `patch/management-panel-update` (`POST /v8/management/server/update-panel`). Against upstream core the button reports a 404.

8. **`patch/client-api-key-models`**
   - **Goal**: Support viewing and editing per-client API key model permissions (`models` whitelist and `excluded-models` blacklist) in `ApiKeysPage` and visual configuration.
   - **Scope**:
     - Support object client API key entries (`api-key`, `models`, `excluded-models`) alongside bare strings in `apiKeysApi` (`src/services/api/apiKeys.ts`).
     - Expose "Available Models" column in `ApiKeysPage` table displaying model whitelist tags and exclusion count badges.
     - Add Allowed Models and Excluded Models fields to `ApiKeysPage` Add/Edit modal.
     - Preserve custom object structure and model restrictions when parsing and serializing `access.api-keys` in `useVisualConfig.ts`.
     - Complete localized translation keys across all 6 locales and unit tests in `tests/clientApiKeys.test.ts`.
     - Read and write each key's name as the `name` field of its `access.api-keys` entry instead of browser storage, so every panel shows the same names; a name-only key is saved as a mapping entry. Names kept only in browser storage (`api-key-names:v1:`) are not migrated and no longer shown. `src/features/config/apiKeyNames.ts` stays for the upstream config editor (`ApiKeysCardEditor`), which this chain no longer renders.
     - **Cross-repo**: Needs the core patch `patch/client-api-key-models` (object entries in `access.api-keys`, their `name` field, and `GET /v8/management/models`). Ship the core side first: an older core drops name-only entries on struct-based saves.
     - Edit per-key allow and deny rules with the excluded-models picker, using `GET /v8/management/models` so the list is not filtered by the key being edited.
     - Render the model scope so it cannot mislead or grow: always show the exclusion count (an exclusion-only key used to render as "全部模型"), cap the allow-list at three chips plus a `+N more` counter, and ellipsize long ids. The logic lives in `src/utils/apiKeyScope.ts` with `tests/apiKeyScope.test.ts`.
     - Drop the `#` and strength columns, replace the 安全达标率 metric with 受限密钥, make the row actions icon-only with aria-labels, give the search input and its clear button accessible names, truncate a revealed key instead of stretching the row, and stop the copy feedback from cancelling itself.

9. **`patch/button-icon-layout`**
   - **Goal**: Lay out a button's icon and label on one centered row, so the icon size no longer shifts the label position or the button height.
   - **Scope**:
     - `src/components/ui/Button.tsx` marks the wrapper span it already renders as `btn-label`.
     - `src/styles/components.scss` lays that class out as `inline-flex` with a gap and a stable line height, and makes `.btn svg` a block that cannot shrink. The rule targets the class rather than every span, so the round loading spinner is unaffected.
     - Remove the `.empty-action` duplicate of that rule.
     - `tests/buttonIconLayout.test.ts` guards the wrapper class, the row layout, the retired workaround and the converted files, and fails on the pre-fix tree.
     - Delete the remaining per-call-site copies of that layout, which the base rule made redundant and which disagreed with it: `.actions :global(.btn > span)` and `.actions :global(.btn svg)` in `AuthFileCard.module.scss`, and the `:global(.btn > span)` overrides in `PluginsPage.module.scss` (two) and `PluginStorePage.module.scss` (two). Only the auth-files card changes visibly — its labelled button moves from a 6px gap and a 14px line box to the standard 8px gap and 39px height — and its icon buttons are pinned to 30px by `.iconButton`.
   - **Note**: The defect is upstream's own, and upstream worked around it per call site (`.empty-action`, the auth-files card, the plugins pages); this patch centralises the layout and removes those copies. No other patch touches `Button.tsx`, `styles/components.scss` or the three converted feature stylesheets, so this patch's position in the integration order does not matter.

10. **`patch/secure-storage-stable-key`**
   - **Goal**: Keep saved connections and management keys readable across browser updates.
   - **Scope**:
     - `src/utils/encryption.ts` derives the localStorage obfuscation key from the User-Agent with browser version numbers replaced by `0`, and re-keys values stored under the versioned key once per profile (`cpa_obfuscation_ua_migrated` marker). `src/main.tsx` runs the migration before anything reads storage.
     - `tests/secureStorageStableKey.test.ts` covers the re-key, the already-migrated case, and an independent copy of the stored format.
   - **Cross-repo**: The core patch `patch/management-ua-shim` injects an equivalent shim into older `management.html` builds. The version pattern and marker are identical, so data that shim migrated stays readable, and the shim skips any bundle that contains the `cpa_obfuscation_ua_migrated` marker, which this patch ships.

11. **`patch/websocket-upstream-toggle`**
    - **Goal**: Control the Codex HTTP-to-WebSocket upstream bridge from the panel.
    - **Scope**: Advanced settings gain `oauth.providers.codex.enable-websocket-upstream`; the credential WebSockets hint explains that, for Codex credentials, it also bridges HTTP/SSE clients and overrides the global switch. Localized in all 6 locales.
    - **Cross-repo**: Needs the core patch `patch/responses-ws-sse-incremental`, which adds the setting and the downstream per-credential semantics.

12. **`patch/client-key-provider-scope`**
    - **Goal**: Edit `client.key-scopes` provider scopes for client API keys on the API keys page.
    - **Scope**:
      - `src/services/api/keyScopes.ts` reads and replaces the list through `/config/client/key-scopes`; an emptied list is deleted instead of saved as `[]`.
      - `src/utils/keyScope.ts` mirrors the core matcher: the longest key prefix wins, rules without a prefix or providers are skipped, and the core provider aliases (anthropic, openai, chatgpt, muse, grok) resolve the same way.
      - `ClientKeyScopesCard` edits rules with free-form provider chips plus suggestions (the provider keys core registers credentials under, such as `gemini-interactions` for the Interactions API, plus openai-compatibility entry names); only a picked suggestion commits while typing and blocks saving rules the core would ignore or shadow. Each key row shows the scope it matches, the edit dialog explains the scope of the typed key, and scoped keys count as restricted.
      - Localized in all 6 locales; tests in `tests/clientKeyScopes.test.ts`.
    - **Stacked**: Branched from `patch/client-api-key-models` and integrated right after it through a seam-diff (see below).
    - **Cross-repo**: Needs the core patch `patch/client-key-provider-scope`. Against a core without it the backend rejects or ignores the field.

13. **`patch/codex-app-keepalive`**
    - **Goal**: Edit the Codex application keepalive for official Codex clients on `/v1/responses` SSE.
    - **Scope**: The streaming section gains `requests.streaming.codex-app-keepalive-seconds` (empty, 0 or negative keeps the core default of 30 seconds, so any integer is accepted) and `requests.streaming.disable-codex-app-keepalive` through the visual-config additions; the interval is locked while the keepalive is disabled. Localized in all 6 locales; tests in `tests/codexAppKeepaliveConfig.test.ts`.
    - **Cross-repo**: Needs the core patch `patch/codex-app-keepalive`.

14. **`patch/openai-compat-model-discovery`**
    - **Goal**: Edit `auto-discover-models` and `excluded-models` on openai-compatibility entries.
    - **Scope**: Read and save both fields, add the discovery switch to the models section (descriptor `supportsAutoDiscoverModels`), enable the existing excluded-models picker for the brand, count exclusions and tag discovering providers in the list. The switch is only written when on, so untouched entries keep their YAML. These entries have their own `disabled` field, so `*` is kept as an ordinary hide-all exclusion rather than reserved for the Disabled switch. Localized in all 6 locales; tests in `tests/openaiCompatModelDiscovery.test.ts`.
    - **Cross-repo**: Needs the core patch `patch/openai-compat-model-discovery`.

15. **`patch/usage-exclude-embeddings`**
    - **Goal**: Keep `/v1/embeddings` requests out of usage statistics from the panel.
    - **Scope**: The logging section gains `observability.usage.exclude-embeddings` right after `usage-statistics-enabled`, through the visual-config additions. Rerank requests are still counted. Localized in all 6 locales; tests in `tests/usageExcludeEmbeddings.test.ts`.
    - **Note**: Kept apart from `patch/embeddings-and-rerank` so that branch, and `patch/systemone-endpoint` stacked on it, do not need a rebase.
    - **Cross-repo**: Needs the core patch `patch/embeddings-and-rerank` (setting added in core `2cca4366`).

16. **`patch/quota-api`**
    - **Goal**: Choose, per client API key, which OAuth credentials the key can read through the core's `GET /v1/usage`, and edit its cache TTL.
    - **Scope**: The API keys page add/edit dialog lists the Codex, Claude, Antigravity, xAI and Command Code OAuth credentials in a picker drawn with the model allow/exclude picker's styles (`ClientKeyQuotaCredentialsField`: summary trigger with meter, searchable disclosure with keyboard navigation, select all and clear, selection as removable chips; styles from `components/excludedModels/ExcludedModelsPicker.module.scss`, options from `utils/quotaCredentials.ts`; only entries whose `account_type` is `oauth`, because the core probes no API-key credential even under the same provider), stored by core auth ID in `observability.quota-api.keys` (`services/api/quotaApiKeys.ts`). Saving writes the key's selection, a renamed key carries it, deleting a key drops it, and an unchanged selection writes nothing. A save or delete writes `access.api-keys` and a changed `observability.quota-api.keys` in one `PATCH /config` (sequences are replaced whole), so a failed write leaves both lists unchanged and a retry targets the same key; after a successful write the page keeps the new lists and closes the dialog even if the config refresh fails, records the keys with `updateConfigValue('api-keys')` and only warns; saved IDs whose credential is gone stay listed as removed once the credential list has loaded. The key table shows how many credentials a key can read. The logging section keeps `observability.quota-api.cache-ttl-seconds` after the usage statistics switch (empty or 0 keeps the core default of 300 seconds, values below 30 are raised to 30); the former `enabled` switch is gone because the core ignores it. Localized in all 6 locales; tests in `tests/quotaApiKeys.test.ts` and `tests/quotaApiConfig.test.ts`. The dialog also lists provider API keys with a custom base URL (OpenAI-compatible entries of enabled providers, and Codex, Claude and Gemini keys with a base URL) as `relay` options, which the core relays to the upstream proxy's own `GET /v1/usage`; they are stored by the `auth_index` the config reports (`buildQuotaRelayOptions`), so editing such a key or its base URL changes the index and the old selection then shows as removed. The list shows OAuth credentials first, then relays, then removed IDs, alphabetical within each group. A relay whose API key is one of this proxy's own `access.api-keys` (plain strings or the `api-key` of object entries) is tagged as a likely loop back to this proxy (`ownKey`) but stays selectable, since another proxy may share the key; the core reports such a loop as `relay loop detected`. A failed config fetch drops only the relay options; the OAuth list still loads. Relay options need `patch/config-auth-index`.
    - **Stacked**: Branched from `patch/client-key-provider-scope` (it edits `ApiKeysPage`) and integrated as a seam-diff against it (see below), right after `patch/usage-exclude-embeddings`.
    - **Note**: The logging insertion point sits one unchanged line away from `patch/usage-exclude-embeddings` and `patch/codex-app-keepalive`, so those apply cleanly in any order.
    - **Cross-repo**: Needs the core patch `patch/quota-api` (core `2628cfe5`); Command Code quota requires core `e3ddab10` or later, and relay selections need the core's summary contract (version 2). Against an older core the selection has no effect.

17. **`patch/commandcode-oauth`**
    - **Goal**: Log in to Command Code (commandcode.ai) like the other OAuth providers and show its quota.
    - **Scope**:
      - OAuth gallery tile `commandcode` (browser flow, `is_webui`, manual callback). Studio POSTs `apiKey` and `state` to `http://127.0.0.1:54546/callback`, so the address bar shows only the bare `/callback` and a remote login has no URL to copy. The manual field (`features/oauth/callbackUrl.ts`) therefore also takes the request payload from DevTools (`apiKey=…&state=…` or JSON) or the bare API key, and builds `http://127.0.0.1:54546/callback?apiKey=…&state=…` with the login's state; the core reads the key from it. Because the field can hold a reusable API key, it is a password input for Command Code only and is cleared once the core accepts the callback. Tests in `tests/oauthPage.test.ts`.
      - Built-in quota card `commandcode` (`features/quota/providers/commandcode`): through api-call with `Bearer $TOKEN$` it reads `GET https://api.commandcode.ai/alpha/billing/credits` (5-hour and weekly windows, remaining monthly/purchased/free credits) and `/alpha/billing/subscriptions` (plan and period end), the endpoints of the official CLI's `/usage`. The monthly row needs an active, known plan, because the API reports only the remaining monthly credits; the plan table is the CLI's. Rows reuse the Kimi row shape and meter, so reset scheduling and the timeline handle them the same way.
      - Icons, type colors, dashboard label; localized in all 6 locales; tests in `tests/commandCodeQuota.test.ts`.
    - **Cross-repo**: Needs the core patch `patch/commandcode-oauth`; automatic web UI callbacks need core `031e1255` or later, which serves Studio's POST on 54546. Core `09027cd9` stopped forcing the `commandcode/` model prefix (models follow the credential `prefix` and `force-model-prefix`), so the login hint names no prefix. Against a core without the patch the tile answers `provider_not_found`.

18. **`patch/config-auth-index`**
    - **Goal**: Carry each provider key's auth index from the config.
    - **Scope**: The v8 core injects every provider key's live auth index into `GET /config` as `auth_index` (core `0fb50a18`), but `services/api/transformers.ts` read only `auth-index`, so provider keys never had an auth index and the provider detail view showed it as not set. The normalizer now accepts both spellings. Test in `tests/configAuthIndex.test.ts`.
    - **Related Upstream Work**: None found (searched `auth_index` issues and pull requests on 2026-10-18). Suitable as an upstream PR.

19. **`patch/upstream-quota`**
    - **Goal**: Show the quota another proxy shares with one of this proxy's provider keys, so an upstream that is only reachable by API key is no longer a black box.
    - **Scope**: The provider detail view (`sheets/ResourceDetailView.tsx`) offers "Check upstream quota" for each API key with a custom base URL. Through api-call with the key as Bearer token (the `TOKEN` placeholder) and the key's auth index it reads the upstream's `GET /v1/usage` (`features/providers/upstreamQuota.ts`; a base URL ending in `/v1` is normalized), accepts only the core's quota contract (numeric `version` >= 2 with a `credentials` list), and renders the shared accounts (`features/quota/components/UpstreamQuotaBody.tsx`, used by both the provider sheet and the quota page) with the quota rows of the OAuth bodies: label, remaining percent and reset with countdown on one line, the meter below, balances as a plan line. Accounts are listed flat under a provider icon and plan chip; a relay is a proxy, not an account, so it contributes only the accounts behind it, each marked with the relay it came through (`flattenUpstreamAccounts`). A 404 or a foreign body reads as "does not share quota". Key entries sharing one auth index get one panel. Nothing is requested until the user asks. The quota page lists the same keys after the OAuth credentials as cards in the quota card shell (`features/quota/components/UpstreamQuotaCard.tsx`: brand icon, provider name and masked key, click-to-load body, refresh pill); target selection is shared through `collectUpstreamQuotaTargets`. Results live in a page-level hook (`features/quota/hooks/useUpstreamQuotas.ts`, scoped to the connection so a new server never shows the previous one's result), so the quota-window timeline, now placed below the upstream cards, also draws every checked shared account that reports a reset as a lane coloured by its own provider (`features/quota/upstreamTimeline.ts`, through the timeline's `extraLanes`); relays are proxies, not accounts, and get no lane. Localized in all 6 locales; tests in `tests/upstreamQuota.test.ts`.
    - **Cross-repo**: The upstream proxy must run the core patch `patch/quota-api` with the summary contract and select its accounts for the key; a stock upstream shows "does not share quota". The button needs the key's auth index, so it relies on `patch/config-auth-index`.
    - **Related Upstream Work**: None found (searched `upstream quota`, `v1/usage`, `quota passthrough` and `relay quota` issues and pull requests here and in the core on 2026-10-18).

20. **`patch/plugin-iframe-no-flash`**
    - **Goal**: Stop the white flash when a plugin resource page opens.
    - **Scope**: `features/plugins/PluginResourcePage.tsx` mounted the iframe as soon as the plugin list resolved, so the browser's blank canvas showed until the plugin document loaded. The iframe now stays at `opacity: 0` behind a themed loading overlay until its `load` event, then fades in with the shared motion tokens (no transition under reduced motion); it is keyed by its URL so switching menus starts a hidden frame again. Header refreshes and `plugin-resources-refresh` events keep the loaded iframe mounted instead of swapping the page to its loading state. A plugin that paints white after `load` (asynchronous rendering) still needs its own dark styles. Tests in `tests/pluginResourceFrameLoading.test.ts`.
    - **Related Upstream Work**: Issue [#443](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/issues/443) (CLOSED) and PR [#444](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/pull/444) (CLOSED, not merged). Upstream `23564214` only replaced the hard-coded white backgrounds and the maintainer named the `onLoad` reveal as a possible follow-up; this patch is that follow-up and is suitable as an upstream PR.

## Temporary Compatibility Patches

None. `tmp/patch/commandcode-quota-api` was folded into `patch/quota-api` on 2026-10-18: the picker's provider list belongs to that patch. `tmp/patch/api-keys-route` was retired once `patch/extract-client-api-keys` took ownership of the `/quick-start` and `/api-keys` route lines and `patch/remove-promotional-sections` stopped editing `MainRoutes.tsx`, which removed the adjacent-line conflict the compatibility patch existed to resolve.

## Stacked Patch Pairs

These pairs are not compatibility patches: the second branch descends from the first and is integrated as a seam-diff against it.

`patch/client-api-key-models` is branched from `patch/extract-client-api-keys`, and the two form a hard ordered pair: `extract-client-api-keys` must be integrated first and `client-api-key-models` can never be moved, retired, or reviewed on its own. Its integration step uses `git diff origin/patch/extract-client-api-keys origin/patch/client-api-key-models | git apply --3way` rather than a squash merge, because squashing it re-adds `ApiKeysPage` and other files already contributed by the extract patch. This branch must always contain the extract tip: while it does not, the same diff also reverts the newer extract commits, so the sync workflow fails closed unless `extract-client-api-keys` is an ancestor of `client-api-key-models`.

`patch/client-key-provider-scope` extends that chain: it is branched from `patch/client-api-key-models`, integrated right after it with `git diff origin/patch/client-api-key-models origin/patch/client-key-provider-scope | git apply --3way`, and the sync fails closed unless `client-api-key-models` is an ancestor of it. Rebase it whenever `client-api-key-models` moves.

`patch/quota-api` is stacked on `patch/client-key-provider-scope`: its credential picker extends the same `ApiKeysPage`. It is integrated after `patch/usage-exclude-embeddings` with `git diff origin/patch/client-key-provider-scope origin/patch/quota-api | git apply --3way`; the sync fails closed unless `client-key-provider-scope` is an ancestor of it. Rebase it whenever `client-key-provider-scope` moves.

`patch/systemone-endpoint` is stacked on `patch/embeddings-and-rerank` the same way: it extends the same model flags and connectivity-test branch, so squashing it would re-add the embeddings changes and conflict. It is integrated right after `embeddings-and-rerank` with `git diff origin/patch/embeddings-and-rerank origin/patch/systemone-endpoint | git apply --3way`, and the sync fails closed unless `embeddings-and-rerank` is an ancestor of `systemone-endpoint`. Rebase it whenever `embeddings-and-rerank` moves.

## Rebuild & Validation Procedure

```bash
git fetch upstream main --tags
git fetch origin ci patch/embeddings-and-rerank patch/systemone-endpoint patch/fix-xai-quota-test patch/remove-promotional-sections patch/extract-client-api-keys patch/downstream-versioning patch/update-management-panel patch/client-api-key-models patch/button-icon-layout patch/secure-storage-stable-key patch/websocket-upstream-toggle patch/client-key-provider-scope patch/codex-app-keepalive patch/openai-compat-model-discovery patch/usage-exclude-embeddings patch/quota-api patch/commandcode-oauth patch/config-auth-index patch/upstream-quota patch/plugin-iframe-no-flash

git checkout -B main upstream/main

git merge --squash origin/ci
git commit -m "merge ci branch"

git merge --squash origin/patch/embeddings-and-rerank
git commit -m "merge patch/embeddings-and-rerank branch"

# systemone-endpoint descends from embeddings-and-rerank: apply only its delta.
git merge-base --is-ancestor origin/patch/embeddings-and-rerank origin/patch/systemone-endpoint || { echo 'systemone-endpoint is behind embeddings; aborting'; exit 1; }
git diff origin/patch/embeddings-and-rerank origin/patch/systemone-endpoint | git apply --3way || { echo 'seam-diff did not apply; aborting'; exit 1; }
git diff --quiet --diff-filter=U -- || { echo 'seam-diff left conflicts; aborting'; exit 1; }
git add -A
git commit -m "merge patch/systemone-endpoint branch"

git merge --squash origin/patch/fix-xai-quota-test
git commit -m "merge patch/fix-xai-quota-test branch"

git merge --squash origin/patch/remove-promotional-sections
git commit -m "merge patch/remove-promotional-sections branch"

# extract-client-api-keys owns the /quick-start and /api-keys route lines and
# remove-promotional-sections leaves MainRoutes.tsx alone, so this merges clean.
git merge --squash origin/patch/extract-client-api-keys
git commit -m "merge patch/extract-client-api-keys branch"

git merge --squash origin/patch/downstream-versioning
git commit -m "merge patch/downstream-versioning branch"

git merge --squash origin/patch/update-management-panel
git commit -m "merge patch/update-management-panel branch"

# client-api-key-models descends from extract-client-api-keys: apply only its delta.
git merge-base --is-ancestor origin/patch/extract-client-api-keys origin/patch/client-api-key-models || { echo 'client-api-key-models is behind extract; aborting'; exit 1; }
git diff origin/patch/extract-client-api-keys origin/patch/client-api-key-models | git apply --3way || { echo 'seam-diff did not apply; aborting'; exit 1; }
git diff --quiet --diff-filter=U -- || { echo 'seam-diff left conflicts; aborting'; exit 1; }
git add -A
git commit -m "merge patch/client-api-key-models branch"

# client-key-provider-scope descends from client-api-key-models: apply only its delta.
git merge-base --is-ancestor origin/patch/client-api-key-models origin/patch/client-key-provider-scope || { echo 'client-key-provider-scope is behind client-api-key-models; aborting'; exit 1; }
git diff origin/patch/client-api-key-models origin/patch/client-key-provider-scope | git apply --3way || { echo 'seam-diff did not apply; aborting'; exit 1; }
git diff --quiet --diff-filter=U -- || { echo 'seam-diff left conflicts; aborting'; exit 1; }
git add -A
git commit -m "merge patch/client-key-provider-scope branch"

# button-icon-layout touches files no other patch edits, so its position does not matter.
git merge --squash origin/patch/button-icon-layout
git commit -m "merge patch/button-icon-layout branch"

git merge --squash origin/patch/secure-storage-stable-key
git commit -m "merge patch/secure-storage-stable-key branch"

git merge --squash origin/patch/websocket-upstream-toggle
git commit -m "merge patch/websocket-upstream-toggle branch"

git merge --squash origin/patch/codex-app-keepalive
git commit -m "merge patch/codex-app-keepalive branch"

git merge --squash origin/patch/openai-compat-model-discovery
git commit -m "merge patch/openai-compat-model-discovery branch"

git merge --squash origin/patch/usage-exclude-embeddings
git commit -m "merge patch/usage-exclude-embeddings branch"

git merge-base --is-ancestor origin/patch/client-key-provider-scope origin/patch/quota-api || { echo 'quota-api is behind client-key-provider-scope; aborting'; exit 1; }
git diff origin/patch/client-key-provider-scope origin/patch/quota-api | git apply --3way || { echo 'seam-diff did not apply; aborting'; exit 1; }
git diff --quiet --diff-filter=U -- || { echo 'seam-diff left conflicts; aborting'; exit 1; }
git add -A
git commit -m "merge patch/quota-api branch"

git merge --squash origin/patch/commandcode-oauth
git commit -m "merge patch/commandcode-oauth branch"
git merge --squash origin/patch/config-auth-index
git commit -m "merge patch/config-auth-index branch"
git merge --squash origin/patch/upstream-quota
git commit -m "merge patch/upstream-quota branch"
git merge --squash origin/patch/plugin-iframe-no-flash
git commit -m "merge patch/plugin-iframe-no-flash branch"

bun install --frozen-lockfile
bun run type-check
bun test
bun run build
git push --force-with-lease origin HEAD:main
```

## CI/CD Workflows Owned by `ci`

- `.github/workflows/upstream-sync.yml`: Runs at `05:28` and `17:28 UTC` and via `workflow_dispatch`. Rebuilds `main`, validates it, and pushes with `--force-with-lease` only when the rebuilt tree differs from `main`.
- `.github/workflows/release.yml`: Builds `management.html` and publishes a release on `main` pushes, `v*` tags, `workflow_dispatch`, and successful `Upstream Sync` runs (the sync pushes with `GITHUB_TOKEN`, which does not trigger push events). A commit that already has a release is skipped.

## Downstream Policy

- **No upstream pull requests.** This fork never opens pull requests against the upstream repository. Patches are maintained downstream indefinitely and are retired only when upstream lands an equivalent implementation on its own, detected by re-running the rebuild and finding that a patch has become empty or conflicting.
- **`main` is intentionally unprotected.** The scheduled sync rebuilds and force-pushes `main`, so neither `main` branch carries branch protection. Safety comes from `--force-with-lease`, the `upstream-sync-main` concurrency group, fail-closed conflict handling, and validation before the push. Protect the `patch/*` and `ci` branches against deletion instead; `main` is a derived artifact that nothing else may be based on.
