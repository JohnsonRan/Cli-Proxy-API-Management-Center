# Downstream Maintenance Guide

This repository is maintained as a downstream fork of [router-for-me/Cli-Proxy-API-Management-Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center) following the `downstream-fork-maintain` workflow.

## Upstream Investigation

Before this fork's patches were implemented, upstream `router-for-me/Cli-Proxy-API-Management-Center` issues and pull requests were searched for equivalent work (model allow/deny rule pickers on the client-key page, embeddings/rerank endpoint toggles, promotional-section removal, client-key page extraction from providers). No upstream issue or PR was found that already delivers these patches, so each was implemented downstream instead of consuming an open PR. Re-run this search before changing any patch and update this section with the links and the conclusion.

## Patch Branches

1. **`patch/embeddings-and-rerank`**
   - **Goal**: Add model form checkboxes and connectivity test routing for `/v1/embeddings` and `/v1/rerank` endpoints.
   - **Scope**:
     - Export `buildOpenAIEmbeddingsEndpoint` and `buildRerankEndpoint` in `src/components/providers/utils.ts`.
     - Add `embedding?: boolean` and `rerank?: boolean` to `ModelAlias` and `ModelEntryInput`.
     - Expose `[x] 允许向量端点` and `[x] 允许重排端点` in `ModelEntriesEditor.tsx` with collapsed badges.
     - Route connectivity test in `useConnectivityTest.ts` to `/embeddings` (with `{model, input}`) and `/rerank` (with `{model, query, documents}`).
     - Add comprehensive unit tests in `tests/embeddingsRerankConnectivity.test.ts`.
     - Complete localized translation keys across all 6 locales.

2. **`patch/fix-xai-quota-test`**
   - **Goal**: Keep the xai quota USD assertions independent of the runtime locale.
   - **Scope**:
     - `XaiQuotaBody` formats USD with `Intl.NumberFormat(undefined, ...)`, so the symbol follows the runtime locale: `$0.00` on `en-US`, `US$0.00` on `zh-CN`.
     - Normalize the `US$` qualifier in the two USD assertions of `tests/xaiQuotaUnavailable.test.ts` before comparing the amount.
   - **Note**: No other patch touches this file, so its position in the integration order does not matter.

3. **`patch/remove-promotional-sections`**
   - **Goal**: Remove commercial affiliate links and sponsor quick-fill ad sections.
   - **Scope**:
     - Remove `quickStartNavItem` (APIKEY.FUN) from `MainLayout.tsx` sidebar.
     - Remove `quickFillGroups` ("快速接入") sponsor group from `ProviderCategoryList.tsx`.
     - Drop the `apikeyFun` route hint in `ProviderSheet.tsx`; that brand is reached through `/ai-providers/apikeyFun` like every other brand.
     - Leave `MainRoutes.tsx` untouched: `patch/extract-client-api-keys` owns the `/quick-start` and `/api-keys` route lines.

4. **`patch/extract-client-api-keys`**
   - **Goal**: Move Client API Keys (`access.api-keys`) out of the Config panel into a dedicated navigation page.
   - **Scope**:
     - Remove `ApiKeysField` from `SectionCommon.tsx` and `SectionConnectivity.tsx` in `src/features/config/`.
     - Create standalone `ApiKeysPage` component (`src/pages/ApiKeysPage.tsx`) using `ApiKeysCardEditor`.
     - Add `/api-keys` entry in `MainLayout.tsx` under the gateway group.
     - Own the route region in `MainRoutes.tsx`: mount `/api-keys` and render `ApiKeysPage` at the existing `/quick-start` path, so no other patch has to edit those adjacent lines.
     - Synchronize i18n keys for `nav.api_keys` and `nav_meta.api_keys` across all 6 locales.

5. **`patch/downstream-versioning`**
   - **Goal**: Adopt downstream fork version convention `v<upstream_tag>+<patch_count>-<sha>` for app display.
   - **Scope**:
     - Dynamically inspect upstream baseline tag, squash patch count, and commit hash in `vite.config.ts`.

6. **`patch/update-management-panel`**
   - **Goal**: Let the system page trigger an on-demand management panel asset update.
   - **Scope**:
     - Add `versionApi.updatePanel()` calling `POST /server/update-panel`.
     - Add an "Update panel" button on the system page version tile.
     - Reload after a successful asset update. Already-latest and failure states use notifications.
     - Localize the button and result messages in all 6 locales.

7. **`patch/client-api-key-models`**
   - **Goal**: Support viewing and editing per-client API key model permissions (`models` whitelist and `excluded-models` blacklist) in `ApiKeysPage` and visual configuration.
   - **Scope**:
     - Support object client API key entries (`api-key`, `models`, `excluded-models`) alongside bare strings in `apiKeysApi` (`src/services/api/apiKeys.ts`).
     - Expose "Available Models" column in `ApiKeysPage` table displaying model whitelist tags and exclusion count badges.
     - Add Allowed Models and Excluded Models fields to `ApiKeysPage` Add/Edit modal.
     - Preserve custom object structure and model restrictions when parsing and serializing `access.api-keys` in `useVisualConfig.ts`.
     - Complete localized translation keys across all 6 locales and unit tests in `tests/clientApiKeys.test.ts`.
     - Edit per-key allow and deny rules with the excluded-models picker, using `GET /v8/management/models` so the list is not filtered by the key being edited.

## Temporary Compatibility Patches

None. `tmp/patch/api-keys-route` was retired once `patch/extract-client-api-keys` took ownership of the `/quick-start` and `/api-keys` route lines and `patch/remove-promotional-sections` stopped editing `MainRoutes.tsx`, which removed the adjacent-line conflict the compatibility patch existed to resolve.

`patch/client-api-key-models` is branched from `patch/extract-client-api-keys`, and the two form a hard ordered pair: `extract-client-api-keys` must be integrated first and `client-api-key-models` can never be moved, retired, or reviewed on its own. Its integration step uses `git diff origin/patch/extract-client-api-keys origin/patch/client-api-key-models | git apply --3way` rather than a squash merge, because squashing it re-adds `ApiKeysPage` and other files already contributed by the extract patch. This branch must always contain the extract tip: while it does not, the same diff also reverts the newer extract commits, so the sync workflow fails closed unless `extract-client-api-keys` is an ancestor of `client-api-key-models`.

## Rebuild & Validation Procedure

```bash
git fetch upstream main --tags
git fetch origin ci patch/embeddings-and-rerank patch/fix-xai-quota-test patch/remove-promotional-sections patch/extract-client-api-keys patch/downstream-versioning patch/update-management-panel patch/client-api-key-models

git checkout -B main upstream/main

git merge --squash origin/ci
git commit -m "merge ci branch"

git merge --squash origin/patch/embeddings-and-rerank
git commit -m "merge patch/embeddings-and-rerank branch"

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

bun install --frozen-lockfile
bun run type-check
bun test
bun run build
git push --force-with-lease origin HEAD:main
```

## Downstream Policy

- **No upstream pull requests.** This fork never opens pull requests against the upstream repository. Patches are maintained downstream indefinitely and are retired only when upstream lands an equivalent implementation on its own, detected by re-running the rebuild and finding that a patch has become empty or conflicting.
- **`main` is intentionally unprotected.** The scheduled sync rebuilds and force-pushes `main`, so neither `main` branch carries branch protection. Safety comes from `--force-with-lease`, the `upstream-sync-main` concurrency group, fail-closed conflict handling, and validation before the push. Protect the `patch/*` and `ci` branches against deletion instead; `main` is a derived artifact that nothing else may be based on.
