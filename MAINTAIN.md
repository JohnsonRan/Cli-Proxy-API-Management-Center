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

2. **`patch/remove-promotional-sections`**
   - **Goal**: Remove commercial affiliate links and sponsor quick-fill ad sections.
   - **Scope**:
     - Remove `quickStartNavItem` (APIKEY.FUN) from `MainLayout.tsx` sidebar.
     - Remove `quickFillGroups` ("快速接入") sponsor group from `ProviderCategoryList.tsx`.
     - Redirect `/quick-start` route in `MainRoutes.tsx` to `/ai-providers`.

3. **`patch/extract-client-api-keys`**
   - **Goal**: Move Client API Keys (`access.api-keys`) out of the Config panel into a dedicated navigation page.
   - **Scope**:
     - Remove `ApiKeysField` from `SectionCommon.tsx` and `SectionConnectivity.tsx` in `src/features/config/`.
     - Create standalone `ApiKeysPage` component (`src/pages/ApiKeysPage.tsx`) using `ApiKeysCardEditor`.
     - Add `/api-keys` entry in `MainLayout.tsx` under the gateway group.
     - Mount `/api-keys` route in `MainRoutes.tsx`.
     - Synchronize i18n keys for `nav.api_keys` and `nav_meta.api_keys` across all 6 locales.

4. **`patch/downstream-versioning`**
   - **Goal**: Adopt downstream fork version convention `v<upstream_tag>+<patch_count>-<sha>` for app display.
   - **Scope**:
     - Dynamically inspect upstream baseline tag, squash patch count, and commit hash in `vite.config.ts`.

5. **`patch/update-management-panel`**
   - **Goal**: Let the system page trigger an on-demand management panel asset update.
   - **Scope**:
     - Add `versionApi.updatePanel()` calling `POST /server/update-panel`.
     - Add an "Update panel" button on the system page version tile.
     - Reload after a successful asset update. Already-latest and failure states use notifications.
     - Localize the button and result messages in all 6 locales.

6. **`patch/client-api-key-models`**
   - **Goal**: Support viewing and editing per-client API key model permissions (`models` whitelist and `excluded-models` blacklist) in `ApiKeysPage` and visual configuration.
   - **Scope**:
     - Support object client API key entries (`api-key`, `models`, `excluded-models`) alongside bare strings in `apiKeysApi` (`src/services/api/apiKeys.ts`).
     - Expose "Available Models" column in `ApiKeysPage` table displaying model whitelist tags and exclusion count badges.
     - Add Allowed Models and Excluded Models fields to `ApiKeysPage` Add/Edit modal.
     - Preserve custom object structure and model restrictions when parsing and serializing `access.api-keys` in `useVisualConfig.ts`.
     - Complete localized translation keys across all 6 locales and unit tests in `tests/clientApiKeys.test.ts`.
     - Edit per-key allow and deny rules with the excluded-models picker, using `GET /v8/management/models` so the list is not filtered by the key being edited.

## Temporary Compatibility Patches

- **`tmp/patch/api-keys-route`**
  - **Depends on**: `patch/remove-promotional-sections`, then `patch/extract-client-api-keys`.
  - **Order**: applied during the `patch/extract-client-api-keys` integration step, immediately after its squash merge.
  - **Combined behavior**: `/api-keys` renders `ApiKeysPage` (extract) while `/quick-start` keeps redirecting to `/ai-providers` (remove-promotional).
  - **Retire when**: `patch/extract-client-api-keys` and `patch/remove-promotional-sections` no longer edit the same `MainRoutes.tsx` lines, or upstream merges an equivalent result.
  - Base and tip are recorded as `origin/patch/extract-client-api-keys` and `origin/tmp/patch/api-keys-route`; the CI sync orchestrator applies `git diff <base> <tip> -- src/router/MainRoutes.tsx` and fails closed on any other conflict shape.

`patch/client-api-key-models` is branched from `patch/extract-client-api-keys`. Its integration step uses `git diff origin/patch/extract-client-api-keys origin/patch/client-api-key-models | git apply --3way` rather than a squash merge, because squashing it re-adds `ApiKeysPage` and other files already contributed by the extract patch.

## Rebuild & Validation Procedure

```bash
git fetch upstream main --tags
git fetch origin ci patch/embeddings-and-rerank patch/remove-promotional-sections patch/extract-client-api-keys patch/downstream-versioning patch/update-management-panel patch/client-api-key-models tmp/patch/api-keys-route

git checkout -B main upstream/main

git merge --squash origin/ci
git commit -m "merge ci branch"

git merge --squash origin/patch/embeddings-and-rerank
git commit -m "merge patch/embeddings-and-rerank branch"

git merge --squash origin/patch/remove-promotional-sections
git commit -m "merge patch/remove-promotional-sections branch"

# On conflict, keep only ApiKeysPage and restore the quick-start redirects
# from tmp/patch/api-keys-route; abort on any other conflict shape.
git merge --squash origin/patch/extract-client-api-keys || {
  git checkout --theirs -- src/router/MainRoutes.tsx
  # `git apply --index` cannot be used here: `checkout --theirs` leaves the path
  # unmerged (stages 1/2/3), so apply to the worktree and stage it afterwards.
  git diff origin/patch/extract-client-api-keys origin/tmp/patch/api-keys-route -- src/router/MainRoutes.tsx | git apply
  git add src/router/MainRoutes.tsx
}
git commit -m "merge patch/extract-client-api-keys branch"

git merge --squash origin/patch/downstream-versioning
git commit -m "merge patch/downstream-versioning branch"

git merge --squash origin/patch/update-management-panel
git commit -m "merge patch/update-management-panel branch"

# client-api-key-models descends from extract-client-api-keys: apply only its delta.
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
