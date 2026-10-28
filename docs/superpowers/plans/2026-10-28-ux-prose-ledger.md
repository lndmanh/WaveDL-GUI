# UX prose ledger

This ledger records the Phase 5B text-to-UI conversion. Long explanatory copy is
represented by a visible badge, chip, structured field, or an accessible disclosure.
Client error messages remain intact because they are diagnostic contracts.

| Source | Treatment | Meaning retained |
| --- | --- | --- |
| `runs.lifecycleNote` | `RunStateChip` dashed state tooltip | Lifecycle is not currently confirmed. The state above is the last daemon observation, not proof that the run is still running or has finished. |
| `runs.lastKnownNote` | `RunStateChip` uncertainty modifier and runtime heading | Elapsed time and epoch progress do not confirm that the runtime is still active. |
| `runs.healthNote` | Health panel explanatory label | Heuristic indicators are informational, not a guarantee of training quality. |
| `runs.pendingNote` | Pending chip tooltip | A newer native generation has no runtime yet; earlier diagnostics are retained but are not current progress. |
| `catalog.modelSafety` | Dashed certification InfoChip | Bundled architecture descriptions provide guidance only; daemon planning and execution validate the actual environment and data compatibility. |
| Catalog model descriptions | Card metadata + Popover | Full descriptions remain keyboard/touch reachable; the grid shows the short description and top pros. |
| Project review JSON | Diff card + Collapsible raw view | Only changed values are promoted; the complete plan remains copyable behind one disclosure. |
| Result artifact metadata | Artifact cards + companion `artifacts` tab | Generation, attempt, size, preview, and download actions remain visible without a table. |
| `datasets.headerHelp`, `datasets.previewBounds`, `datasets.sampleHelp`, `datasets.plotHelp`, `datasets.heatmapHelp` | Dataset chips and bounded-preview controls | Dataset limits and interaction guidance are encoded by the info chips and compact labels. |
| `project.hostPathsHelp`, `project.runtimeHelp`, `project.environmentHelp` | Host/runtime badges and field-level Info chips | Ownership and validation boundaries remain visible without paragraph copy. |
| `project.planManifestHelp` | Review scope InfoChip and raw-plan Collapsible | The daemon-owned immutable plan warning remains keyboard/touch reachable. |
| `project.submissionAckUnknown` | Dashed submission-outcome chip | The lost-ack hedge remains exact and prominent. |
| `results.sourceHelp`, `results.importModulesHelp`, `results.formatHelp` | Explicit-source, trusted-code, and verified-PNG InfoChips | Source authority, code execution, and preview limits remain visible. |
| `runs.lastKnownNote`, `runs.lifecycleNote`, `runs.omittedDiagnostics`, `runs.shortenedDiagnostics` | Dashed uncertainty/freshness chips and bounded-log chips | Epistemic hedges remain exact in accessible hidden text/tooltips. |

Uncertainty and freshness hedges are never deleted. They are rendered as dashed chips
and their exact sentence is available in an accessible tooltip or disclosure. Error
codes and protocol diagnostics are not prose and remain unchanged.

## Mechanical copy ledger

Shortened keys are paired in the catalogs with `*Details` keys when their hedge or
ownership meaning remains material. The visible control stays concise; the detail
is reachable through the InfoChip and its keyboard/touch disclosure.

| Namespace keys | Replacement |
| --- | --- |
| `datasets.inspectionUnavailable`, `datasets.previewBounds`, `datasets.sampleHelp` | Dataset status, bound chips, and preview facts |
| `project.hostPathsHelp`, `project.presetsHelp`, `project.presetImportHelp`, `project.exportHelp` | Host/runtime badges and preset/export disclosures |
| `project.yamlExportRequested`, `project.planManifestHelp`, `project.planRetryHelp` | Download evidence chip, plan-scope chip, and retry badge |
| `project.guideHelp`, `project.interpreterHelp`, `project.runtimeHelp`, `project.environmentHelp` | Guided-step labels and runtime/environment InfoChips |
| `project.customModelHelp`, `project.authoringHelp`, `project.modelSelectionSummary`, `project.resetHelp` | Compatibility chip, authoring status, model badge, and reset badge |
| Vietnamese parity keys matching the rows above | Same controls with Vietnamese detail catalogs |

### Per-key checklist

| Prior long key | Meaning now lives in |
| --- | --- |
| `en/datasets.json:inspectionUnavailable` | Exact prior text moved to `inspectionDetails` InfoChip. |
| `en/datasets.json:previewBounds` | Visible row-count/feature-cap chips; exact hedge in `datasets.previewNotFull` dashed InfoChip |
| `en/datasets.json:sampleHelp` | Structured original/preview shape label; flattening detail is encoded by the preview |
| `en/project.json:hostPathsHelp` | Exact prior text moved to `hostPathsDetails` InfoChip. |
| `en/project.json:presetsHelp` | Exact prior text moved to `presetsQualificationDetails` InfoChip. |
| `en/project.json:presetImportHelp` | Configuration-only label plus dataset/runtime/credential chips |
| `en/project.json:exportHelp` | Selected-host, no-Slurm, no-credential chips; raw command disclosure |
| `en/project.json:yamlExportRequested` | Exact prior text moved to `yamlExportRequestedDetails` InfoChip. |
| `en/project.json:planManifestHelp` | Exact prior text moved to `planManifestDetailsFull` InfoChip. |
| `en/project.json:planRetryHelp` | Same-plan retry badge plus leave-does-not-cancel badge |
| `en/project.json:guideHelp` | Shorter same-draft/no-start guide label |
| `en/project.json:interpreterHelp` | Execution-host field description and runtime details chip |
| `en/project.json:runtimeHelp` | Exact prior text moved to `runtimeDetails` InfoChip. |
| `en/project.json:environmentHelp` | Exact prior text moved to `environmentDetails` InfoChip. |
| `en/project.json:customModelHelp` | Exact prior text moved to `customModelDetailsFull` InfoChip. |
| `en/project.json:authoringHelp` | Shorter draft/review/explicit-approval label; visible no-automatic-start text |
| `en/project.json:modelSelectionSummary` | Model identity badge plus `project.modelCompatibilityDetails` dashed InfoChip |
| `en/project.json:resetHelp` | Selection-preserving reset label; existing-run safety chip |
| `vi/datasets.json:inspectionUnavailable` | Exact prior text moved to `inspectionDetails` InfoChip. |
| `vi/datasets.json:previewBounds` | Visible row-count/feature-cap chips; exact hedge in `datasets.previewNotFull` dashed InfoChip |
| `vi/datasets.json:sampleHelp` | Structured original/preview shape label; flattening detail is encoded by the preview |
| `vi/datasets.json:pngExportRequestFailed` | Conditional sanitized error; diagnostic meaning retained |
| `vi/project.json:hostPathsHelp` | Exact prior text moved to `hostPathsDetails` InfoChip. |
| `vi/project.json:presetsHelp` | Exact prior text moved to `presetsQualificationDetails` InfoChip. |
| `vi/project.json:presetImportHelp` | Configuration-only label plus dataset/runtime/credential chips |
| `vi/project.json:presetApplied` | Conditional applied-preset status; approval invalidation retained |
| `vi/project.json:exportHelp` | Selected-host, no-Slurm, no-credential chips; raw command disclosure |
| `vi/project.json:yamlExportRequested` | Exact prior text moved to `yamlExportRequestedDetails` InfoChip. |
| `vi/project.json:planManifestHelp` | Exact prior text moved to `planManifestDetailsFull` InfoChip. |
| `vi/project.json:planRetryHelp` | Same-plan retry badge plus leave-does-not-cancel badge |
| `vi/project.json:guideHelp` | Shorter same-draft/no-start guide label |
| `vi/project.json:interpreterHelp` | Execution-host field description and runtime details chip |
| `vi/project.json:runtimeHelp` | Exact prior text moved to `runtimeDetails` InfoChip. |
| `vi/project.json:environmentHelp` | Exact prior text moved to `environmentDetails` InfoChip. |
| `vi/project.json:customModelHelp` | Exact prior text moved to `customModelDetailsFull` InfoChip. |
| `vi/project.json:authoringHelp` | Shorter draft/review/explicit-approval label; visible no-automatic-start text |
| `vi/project.json:modelSelectionSummary` | Model identity badge plus `project.modelCompatibilityDetails` dashed InfoChip |
| `vi/project.json:resetHelp` | Selection-preserving reset label; existing-run safety chip |

### Complete key audit

| Changed key | Replacement / disposition |
| --- | --- |
| `en/catalog.json:noRoots` | Removed as redundant after the structured chip replacement. |
| `en/catalog.json:browseUnavailable` | Removed as redundant after the structured chip replacement. |
| `en/datasets.json:inspectionUnavailable` | Exact text moved to `inspectionDetails` detail disclosure. |
| `en/datasets.json:previewBounds` | Compact label plus structured facts/details. |
| `en/datasets.json:sampleHelp` | Compact label plus structured facts/details. |
| `en/project.json:hostPathsHelp` | Exact text moved to `hostPathsDetails` detail disclosure. |
| `en/project.json:presetsHelp` | Exact text moved to `presetsQualificationDetails` detail disclosure. |
| `en/project.json:presetImportHelp` | Compact label plus structured facts/details. |
| `en/project.json:exportHelp` | Compact label plus structured facts/details. |
| `en/project.json:yamlExportRequested` | Exact text moved to `yamlExportRequestedDetails` detail disclosure. |
| `en/project.json:planManifestHelp` | Exact text moved to `planManifestDetailsFull` detail disclosure. |
| `en/project.json:planRetryHelp` | Compact label plus structured facts/details. |
| `en/project.json:guideHelp` | Compact label plus structured facts/details. |
| `en/project.json:interpreterHelp` | Compact label plus structured facts/details. |
| `en/project.json:runtimeHelp` | Exact text moved to `runtimeDetails` detail disclosure. |
| `en/project.json:environmentHelp` | Exact text moved to `environmentDetails` detail disclosure. |
| `en/project.json:customModelHelp` | Exact text moved to `customModelDetailsFull` detail disclosure. |
| `en/project.json:authoringHelp` | Compact label plus structured facts/details. |
| `en/project.json:modelSelectionSummary` | Compact label plus structured facts/details. |
| `en/project.json:resetHelp` | Compact label plus structured facts/details. |
| `en/storage-mapping.json:guidance` | Exact text moved to `guidanceDetails` detail disclosure. |
| `en/storage-mapping.json:interpreter` | Exact text moved to `interpreterDetails` detail disclosure. |
| `en/storage-mapping.json:local` | Compact label plus structured facts/details. |
| `vi/catalog.json:browseSafety` | Removed as redundant after the structured chip replacement. |
| `vi/catalog.json:noRoots` | Removed as redundant after the structured chip replacement. |
| `vi/datasets.json:inspectionUnavailable` | Exact text moved to `inspectionDetails` detail disclosure. |
| `vi/datasets.json:previewBounds` | Compact label plus structured facts/details. |
| `vi/datasets.json:sampleHelp` | Compact label plus structured facts/details. |
| `vi/datasets.json:pngExportRequestFailed` | Compact label plus structured facts/details. |
| `vi/project.json:hostPathsHelp` | Exact text moved to `hostPathsDetails` detail disclosure. |
| `vi/project.json:presetsHelp` | Exact text moved to `presetsQualificationDetails` detail disclosure. |
| `vi/project.json:presetImportHelp` | Compact label plus structured facts/details. |
| `vi/project.json:presetApplied` | Compact label plus structured facts/details. |
| `vi/project.json:exportHelp` | Compact label plus structured facts/details. |
| `vi/project.json:yamlExportRequested` | Exact text moved to `yamlExportRequestedDetails` detail disclosure. |
| `vi/project.json:planManifestHelp` | Exact text moved to `planManifestDetailsFull` detail disclosure. |
| `vi/project.json:planRetryHelp` | Compact label plus structured facts/details. |
| `vi/project.json:guideHelp` | Compact label plus structured facts/details. |
| `vi/project.json:interpreterHelp` | Compact label plus structured facts/details. |
| `vi/project.json:runtimeHelp` | Exact text moved to `runtimeDetails` detail disclosure. |
| `vi/project.json:environmentHelp` | Exact text moved to `environmentDetails` detail disclosure. |
| `vi/project.json:customModelHelp` | Exact text moved to `customModelDetailsFull` detail disclosure. |
| `vi/project.json:authoringHelp` | Compact label plus structured facts/details. |
| `vi/project.json:modelSelectionSummary` | Compact label plus structured facts/details. |
| `vi/project.json:resetHelp` | Compact label plus structured facts/details. |
| `vi/storage-mapping.json:guidance` | Exact text moved to `guidanceDetails` detail disclosure. |
| `vi/storage-mapping.json:interpreter` | Exact text moved to `interpreterDetails` detail disclosure. |
| `vi/storage-mapping.json:local` | Compact label plus structured facts/details. |


## Reproducible prose metric

Run `node tools/measure_ux_prose.mjs --baseline` for HEAD and `node tools/measure_ux_prose.mjs` for the working tree.
The metric counts JSON string values and TypeScript string literals (including SFC script blocks),
using UTF-16 length. It excludes template attributes, CSS, and JSON keys. New source files are included.
Before: **276 >80 / 131 >160**. After: **250 >80 / 120 >160**.
The plan's 417 / 219 predates the merged i18n/source-tree work and is not this checkout's baseline.

### Remaining literals over 80 characters

Each remaining literal is listed below with its disposition; long model descriptions and
exact epistemic hedges are intentionally preserved, not shortened to game the metric.

| File / key (or script line) | Length | Reason |
| --- | ---: | --- |
| `components/ui/alert/index.ts:9` | 225 | Non-prose Tailwind variant classes; not display copy. |
| `components/ui/alert/index.ts:15` | 240 | Non-prose Tailwind variant classes; not display copy. |
| `components/ui/alert/index.ts:17` | 260 | Non-prose Tailwind variant classes; not display copy. |
| `components/ui/badge/index.ts:6` | 398 | Non-prose Tailwind variant classes; not display copy. |
| `components/ui/badge/index.ts:12` | 84 | Non-prose Tailwind variant classes; not display copy. |
| `components/ui/badge/index.ts:14` | 169 | Non-prose Tailwind variant classes; not display copy. |
| `components/ui/badge/index.ts:16` | 159 | Non-prose Tailwind variant classes; not display copy. |
| `components/ui/badge/index.ts:18` | 164 | Non-prose Tailwind variant classes; not display copy. |
| `components/ui/button/index.ts:7` | 458 | Non-prose Tailwind variant classes; not display copy. |
| `components/ui/button/index.ts:14` | 145 | Non-prose Tailwind variant classes; not display copy. |
| `components/ui/button/index.ts:16` | 133 | Non-prose Tailwind variant classes; not display copy. |
| `components/ui/empty/index.ts:12` | 91 | Non-prose Tailwind variant classes; not display copy. |
| `components/ui/empty/index.ts:17` | 122 | Non-prose Tailwind variant classes; not display copy. |
| `components/ui/field/index.ts:13` | 116 | Non-prose Tailwind variant classes; not display copy. |
| `components/ui/field/index.ts:16` | 124 | Non-prose Tailwind variant classes; not display copy. |
| `components/ui/field/index.ts:18` | 148 | Non-prose Tailwind variant classes; not display copy. |
| `components/ui/sidebar/index.ts:39` | 817 | Non-prose Tailwind variant classes; not display copy. |
| `components/ui/sidebar/index.ts:45` | 172 | Non-prose Tailwind variant classes; not display copy. |
| `i18n/locales/en/catalog.json:shape_described` | 221 | Exact advisory/compatibility qualifier in a dashed InfoChip or model Popover. |
| `i18n/locales/en/catalog.json:shape_mismatch` | 242 | Exact advisory/compatibility qualifier in a dashed InfoChip or model Popover. |
| `i18n/locales/en/catalog.json:shape_unknown` | 178 | Exact advisory/compatibility qualifier in a dashed InfoChip or model Popover. |
| `i18n/locales/en/catalog.json:shape_ambiguous` | 263 | Exact advisory/compatibility qualifier in a dashed InfoChip or model Popover. |
| `i18n/locales/en/catalog.json:modelSafety` | 150 | Exact advisory/compatibility qualifier in a dashed InfoChip or model Popover. |
| `i18n/locales/en/catalog.json:untranslated` | 93 | Exact advisory/compatibility qualifier in a dashed InfoChip or model Popover. |
| `i18n/locales/en/client-errors.json:daemonUnavailable` | 89 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/en/client-errors.json:autoPlotAuthorityMismatch` | 94 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/en/client-errors.json:adoptionAckUnknown` | 124 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/en/client-errors.json:artifactMemoryBudget` | 81 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/en/client-errors.json:autoPlotCheckpointNotice` | 81 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/en/client-errors.json:autoPlotManifestUnsupported` | 92 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/en/client-errors.json:autoPlotAckUnknown` | 118 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/en/client-errors.json:daemonScopeChanged` | 116 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/en/client-errors.json:cancellationAckUnknown` | 87 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/en/client-errors.json:exportWindowsHost` | 134 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/en/client-errors.json:exportMultiNode` | 95 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/en/client-errors.json:exportContainerStartup` | 83 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/en/client-errors.json:envValuesNotExported` | 155 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/en/client-errors.json:exportOptionPrefix` | 84 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/en/client-errors.json:slurmGpuPolicy` | 81 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/en/cv-summary.json:help` | 186 | Exact publication-not-completion hedge in dashed InfoChip. |
| `i18n/locales/en/cv-summary.json:failed` | 109 | Conditional verification error; preserved. |
| `i18n/locales/en/datasets.json:headerHelp` | 135 | Technical preview/export scope retained in InfoChip or structured sample facts. |
| `i18n/locales/en/datasets.json:inspectionDetails` | 119 | Technical preview/export scope retained in InfoChip or structured sample facts. |
| `i18n/locales/en/datasets.json:pngExportRequested` | 91 | Technical preview/export scope retained in InfoChip or structured sample facts. |
| `i18n/locales/en/datasets.json:pngExportRequestFailed` | 82 | Conditional inspection/export diagnostic; preserved. |
| `i18n/locales/en/datasets.json:plotHelp` | 96 | Technical preview/export scope retained in InfoChip or structured sample facts. |
| `i18n/locales/en/datasets.json:heatmapHelp` | 91 | Technical preview/export scope retained in InfoChip or structured sample facts. |
| `i18n/locales/en/project.json:customModelDetailsFull` | 221 | Exact authority/approval/host qualifier in InfoChip, disclosure, or conditional validation. |
| `i18n/locales/en/project.json:planManifestDetailsFull` | 195 | Exact authority/approval/host qualifier in InfoChip, disclosure, or conditional validation. |
| `i18n/locales/en/project.json:hostPathsDetails` | 283 | Exact authority/approval/host qualifier in InfoChip, disclosure, or conditional validation. |
| `i18n/locales/en/project.json:presetsQualificationDetails` | 173 | Exact authority/approval/host qualifier in InfoChip, disclosure, or conditional validation. |
| `i18n/locales/en/project.json:presetInvalid` | 121 | Conditional authoring/export diagnostic. |
| `i18n/locales/en/project.json:yamlExportRequestedDetails` | 127 | Exact authority/approval/host qualifier in InfoChip, disclosure, or conditional validation. |
| `i18n/locales/en/project.json:yamlExportFailed` | 83 | Conditional authoring/export diagnostic. |
| `i18n/locales/en/project.json:runtimeDetails` | 324 | Exact authority/approval/host qualifier in InfoChip, disclosure, or conditional validation. |
| `i18n/locales/en/project.json:environmentDetails` | 118 | Exact authority/approval/host qualifier in InfoChip, disclosure, or conditional validation. |
| `i18n/locales/en/project.json:submissionAckHelp` | 116 | Exact authority/approval/host qualifier in InfoChip, disclosure, or conditional validation. |
| `i18n/locales/en/project.json:submissionAckUnknown` | 221 | Exact authority/approval/host qualifier in InfoChip, disclosure, or conditional validation. |
| `i18n/locales/en/results.json:publications` | 86 | Artifact provenance accessible label; generation/attempt/size chips remain visible. |
| `i18n/locales/en/results.json:automaticHelp` | 149 | Source/ownership/export qualifier retained in accessible InfoChip or field description. |
| `i18n/locales/en/results.json:importModulesHelp` | 205 | Source/ownership/export qualifier retained in accessible InfoChip or field description. |
| `i18n/locales/en/results.json:formatHelp` | 106 | Source/ownership/export qualifier retained in accessible InfoChip or field description. |
| `i18n/locales/en/results.json:sourceHelp` | 159 | Source/ownership/export qualifier retained in accessible InfoChip or field description. |
| `i18n/locales/en/results.json:resultsHelp` | 85 | Source/ownership/export qualifier retained in accessible InfoChip or field description. |
| `i18n/locales/en/results.json:adoptHelp` | 140 | Source/ownership/export qualifier retained in accessible InfoChip or field description. |
| `i18n/locales/en/results.json:retainedRequest` | 147 | Source/ownership/export qualifier retained in accessible InfoChip or field description. |
| `i18n/locales/en/results.json:attemptHelp` | 81 | Source/ownership/export qualifier retained in accessible InfoChip or field description. |
| `i18n/locales/en/results.json:unacknowledged` | 104 | Conditional operation diagnostic; preserved. |
| `i18n/locales/en/results.json:adopted` | 154 | Source/ownership/export qualifier retained in accessible InfoChip or field description. |
| `i18n/locales/en/runs.json:listSnapshot` | 100 | Exact uncertainty, freshness, or bounded-history detail in accessible InfoChip/tooltip. |
| `i18n/locales/en/runs.json:omittedDiagnostics` | 93 | Exact uncertainty, freshness, or bounded-history detail in accessible InfoChip/tooltip. |
| `i18n/locales/en/runs.json:shortenedDiagnostics` | 107 | Exact uncertainty, freshness, or bounded-history detail in accessible InfoChip/tooltip. |
| `i18n/locales/en/runs.json:lastKnownNote` | 129 | Exact uncertainty, freshness, or bounded-history detail in accessible InfoChip/tooltip. |
| `i18n/locales/en/runs.json:chartNote` | 90 | Exact uncertainty, freshness, or bounded-history detail in accessible InfoChip/tooltip. |
| `i18n/locales/en/runs.json:pendingNote` | 111 | Exact uncertainty, freshness, or bounded-history detail in accessible InfoChip/tooltip. |
| `i18n/locales/en/runs.json:lifecycleNote` | 142 | Exact uncertainty, freshness, or bounded-history detail in accessible InfoChip/tooltip. |
| `i18n/locales/en/shell-settings.json:connectionHelp` | 212 | Sibling 5A-owned settings/shell copy; outside 5B ownership. |
| `i18n/locales/en/shell-settings.json:credentialHelp` | 103 | Sibling 5A-owned settings/shell copy; outside 5B ownership. |
| `i18n/locales/en/shell-settings.json:sessionStorageHelp` | 93 | Sibling 5A-owned settings/shell copy; outside 5B ownership. |
| `i18n/locales/en/shell-settings.json:disconnectHelp` | 191 | Sibling 5A-owned settings/shell copy; outside 5B ownership. |
| `i18n/locales/en/shell-settings.json:appearanceHelp` | 89 | Sibling 5A-owned settings/shell copy; outside 5B ownership. |
| `i18n/locales/en/shell-settings.json:downloadsHelp` | 218 | Sibling 5A-owned settings/shell copy; outside 5B ownership. |
| `i18n/locales/en/shell-settings.json:feedbackPrivacyHelp` | 115 | Sibling 5A-owned settings/shell copy; outside 5B ownership. |
| `i18n/locales/en/shell-settings.json:trainingDefaultsHelp` | 229 | Sibling 5A-owned settings/shell copy; outside 5B ownership. |
| `i18n/locales/en/shell-settings.json:loggingHelp` | 146 | Sibling 5A-owned settings/shell copy; outside 5B ownership. |
| `i18n/locales/en/storage-mapping.json:guidanceDetails` | 274 | Ownership/access qualifier in mapping details InfoChip or conditional backend warning. |
| `i18n/locales/en/storage-mapping.json:interpreterDetails` | 185 | Ownership/access qualifier in mapping details InfoChip or conditional backend warning. |
| `i18n/locales/en/storage-mapping.json:rootError` | 117 | Conditional field-validation diagnostic. |
| `i18n/locales/en/training-fields.json:pretrained.description` | 100 | Field help moved to keyboard/touch InfoChip; typed control remains visible. |
| `i18n/locales/en/training-fields.json:grad_accum_steps.description` | 87 | Field help moved to keyboard/touch InfoChip; typed control remains visible. |
| `i18n/locales/en/training-fields.json:deterministic.description` | 85 | Field help moved to keyboard/touch InfoChip; typed control remains visible. |
| `i18n/locales/en/training-fields.json:single_channel.description` | 89 | Field help moved to keyboard/touch InfoChip; typed control remains visible. |
| `i18n/locales/vi/catalog.json:shape_described` | 229 | Exact advisory/compatibility qualifier in a dashed InfoChip or model Popover. |
| `i18n/locales/vi/catalog.json:shape_mismatch` | 246 | Exact advisory/compatibility qualifier in a dashed InfoChip or model Popover. |
| `i18n/locales/vi/catalog.json:shape_unknown` | 168 | Exact advisory/compatibility qualifier in a dashed InfoChip or model Popover. |
| `i18n/locales/vi/catalog.json:shape_ambiguous` | 278 | Exact advisory/compatibility qualifier in a dashed InfoChip or model Popover. |
| `i18n/locales/vi/catalog.json:modelSafety` | 153 | Exact advisory/compatibility qualifier in a dashed InfoChip or model Popover. |
| `i18n/locales/vi/catalog.json:modelsUnavailable` | 84 | Exact advisory/compatibility qualifier in a dashed InfoChip or model Popover. |
| `i18n/locales/vi/catalog.json:untranslated` | 95 | Exact advisory/compatibility qualifier in a dashed InfoChip or model Popover. |
| `i18n/locales/vi/client-errors.json:unsafeStoragePath` | 90 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/vi/client-errors.json:registrationPathMismatch` | 82 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/vi/client-errors.json:autoPlotAuthorityMismatch` | 103 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/vi/client-errors.json:adoptionAckUnknown` | 111 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/vi/client-errors.json:artifactNamesTooLong` | 85 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/vi/client-errors.json:autoPlotCheckpointNotice` | 92 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/vi/client-errors.json:autoPlotManifestUnsupported` | 91 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/vi/client-errors.json:autoPlotAckUnknown` | 109 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/vi/client-errors.json:modelIdInvalid` | 83 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/vi/client-errors.json:daemonScopeChanged` | 129 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/vi/client-errors.json:exportWindowsHost` | 131 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/vi/client-errors.json:exportMultiNode` | 96 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/vi/client-errors.json:exportContainerStartup` | 104 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/vi/client-errors.json:envValuesNotExported` | 129 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/vi/client-errors.json:exportOptionPrefix` | 82 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/vi/client-errors.json:slurmGpuPolicy` | 85 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/vi/client-errors.json:cvPlateauFactor` | 81 | Conditional client diagnostic; preserved error contract. |
| `i18n/locales/vi/cv-summary.json:help` | 196 | Exact publication-not-completion hedge in dashed InfoChip. |
| `i18n/locales/vi/cv-summary.json:failed` | 101 | Conditional verification error; preserved. |
| `i18n/locales/vi/datasets.json:headerHelp` | 144 | Technical preview/export scope retained in InfoChip or structured sample facts. |
| `i18n/locales/vi/datasets.json:inspectionDetails` | 126 | Technical preview/export scope retained in InfoChip or structured sample facts. |
| `i18n/locales/vi/datasets.json:pngExportRequested` | 90 | Technical preview/export scope retained in InfoChip or structured sample facts. |
| `i18n/locales/vi/datasets.json:pngExportRequestFailed` | 87 | Conditional inspection/export diagnostic; preserved. |
| `i18n/locales/vi/datasets.json:plotHelp` | 129 | Technical preview/export scope retained in InfoChip or structured sample facts. |
| `i18n/locales/vi/datasets.json:heatmapHelp` | 124 | Technical preview/export scope retained in InfoChip or structured sample facts. |
| `i18n/locales/vi/models.json:cnn.description` | 395 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:resnet18.description` | 430 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:resnet34.description` | 389 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:resnet50.description` | 425 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:resnet18_pretrained.description` | 400 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:resnet50_pretrained.description` | 460 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:densenet121.description` | 400 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:densenet169.description` | 406 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:densenet121_pretrained.description` | 440 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:mobilenet_v3_small.description` | 397 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:mobilenet_v3_large.description` | 388 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:efficientnet_b0.description` | 462 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:efficientnet_b2.description` | 374 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:efficientnet_b4.description` | 376 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:efficientnet_b7.description` | 408 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:efficientnet_v2_s.description` | 478 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:efficientnet_v2_m.description` | 420 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:efficientnet_v2_l.description` | 374 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:regnet_y_400mf.description` | 459 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:regnet_y_800mf.description` | 396 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:regnet_y_1_6gf.description` | 382 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:regnet_y_3_2gf.description` | 424 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:regnet_y_8gf.description` | 388 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:convnext_tiny.description` | 488 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:convnext_small.description` | 323 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:convnext_base.description` | 367 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:convnext_tiny_pretrained.description` | 425 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:convnext_v2_tiny.description` | 477 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:convnext_v2_small.description` | 362 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:convnext_v2_base.description` | 383 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:convnext_v2_tiny_pretrained.description` | 338 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:unireplknet_tiny.description` | 438 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:unireplknet_small.description` | 346 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:unireplknet_base.description` | 356 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:vit_tiny.description` | 450 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:vit_small.description` | 351 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:vit_base.description` | 406 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:swin_t.description` | 444 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:swin_s.description` | 335 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:swin_b.description` | 441 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:maxvit_tiny.description` | 424 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:maxvit_small.description` | 373 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:maxvit_base.description` | 424 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:fastvit_t8.description` | 413 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:fastvit_t12.description` | 324 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:fastvit_s12.description` | 398 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:fastvit_sa12.description` | 394 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:caformer_s18.description` | 467 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:caformer_s36.description` | 330 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:caformer_m36.description` | 351 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:poolformer_s12.description` | 419 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:efficientvit_m1.description` | 390 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:efficientvit_b1.description` | 357 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:efficientvit_b2.description` | 433 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:efficientvit_l2.description` | 405 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:mamba_1d.description` | 466 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:s4d_small.description` | 428 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:s4d.description` | 439 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:s4d_large.description` | 367 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:vim_tiny.description` | 432 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:vim_small.description` | 411 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:vim_base.description` | 411 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:tcn_small.description` | 418 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:tcn.description` | 353 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:tcn_large.description` | 347 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:wavenet_small.description` | 405 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:wavenet.description` | 481 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:wavenet_large.description` | 388 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:resnet3d_18.description` | 422 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:mc3_18.description` | 455 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/models.json:unet_regression.description` | 486 | Guarded bundled model prose, retained in the model details Popover. |
| `i18n/locales/vi/project.json:customModelDetailsFull` | 237 | Exact authority/approval/host qualifier in InfoChip, disclosure, or conditional validation. |
| `i18n/locales/vi/project.json:planManifestDetailsFull` | 201 | Exact authority/approval/host qualifier in InfoChip, disclosure, or conditional validation. |
| `i18n/locales/vi/project.json:hostPathsDetails` | 300 | Exact authority/approval/host qualifier in InfoChip, disclosure, or conditional validation. |
| `i18n/locales/vi/project.json:presetsQualificationDetails` | 200 | Exact authority/approval/host qualifier in InfoChip, disclosure, or conditional validation. |
| `i18n/locales/vi/project.json:presetInvalid` | 162 | Conditional authoring/export diagnostic. |
| `i18n/locales/vi/project.json:yamlExportRequestedDetails` | 128 | Exact authority/approval/host qualifier in InfoChip, disclosure, or conditional validation. |
| `i18n/locales/vi/project.json:yamlExportFailed` | 88 | Conditional authoring/export diagnostic. |
| `i18n/locales/vi/project.json:runtimeDetails` | 382 | Exact authority/approval/host qualifier in InfoChip, disclosure, or conditional validation. |
| `i18n/locales/vi/project.json:environmentDetails` | 132 | Exact authority/approval/host qualifier in InfoChip, disclosure, or conditional validation. |
| `i18n/locales/vi/project.json:environmentNameInvalid` | 94 | Conditional authoring/export diagnostic. |
| `i18n/locales/vi/project.json:submissionAckHelp` | 132 | Exact authority/approval/host qualifier in InfoChip, disclosure, or conditional validation. |
| `i18n/locales/vi/project.json:submissionAckUnknown` | 233 | Exact authority/approval/host qualifier in InfoChip, disclosure, or conditional validation. |
| `i18n/locales/vi/results.json:publications` | 100 | Artifact provenance accessible label; generation/attempt/size chips remain visible. |
| `i18n/locales/vi/results.json:automaticHelp` | 177 | Source/ownership/export qualifier retained in accessible InfoChip or field description. |
| `i18n/locales/vi/results.json:importModulesHelp` | 226 | Source/ownership/export qualifier retained in accessible InfoChip or field description. |
| `i18n/locales/vi/results.json:formatHelp` | 119 | Source/ownership/export qualifier retained in accessible InfoChip or field description. |
| `i18n/locales/vi/results.json:sourceHelp` | 180 | Source/ownership/export qualifier retained in accessible InfoChip or field description. |
| `i18n/locales/vi/results.json:resultsHelp` | 103 | Source/ownership/export qualifier retained in accessible InfoChip or field description. |
| `i18n/locales/vi/results.json:adoptHelp` | 145 | Source/ownership/export qualifier retained in accessible InfoChip or field description. |
| `i18n/locales/vi/results.json:retainedRequest` | 148 | Source/ownership/export qualifier retained in accessible InfoChip or field description. |
| `i18n/locales/vi/results.json:attemptHelp` | 82 | Source/ownership/export qualifier retained in accessible InfoChip or field description. |
| `i18n/locales/vi/results.json:unacknowledged` | 113 | Conditional operation diagnostic; preserved. |
| `i18n/locales/vi/results.json:downloadRequested` | 89 | Source/ownership/export qualifier retained in accessible InfoChip or field description. |
| `i18n/locales/vi/results.json:verificationFailed` | 81 | Conditional operation diagnostic; preserved. |
| `i18n/locales/vi/results.json:adopted` | 162 | Source/ownership/export qualifier retained in accessible InfoChip or field description. |
| `i18n/locales/vi/runs.json:listSnapshot` | 111 | Exact uncertainty, freshness, or bounded-history detail in accessible InfoChip/tooltip. |
| `i18n/locales/vi/runs.json:omittedDiagnostics` | 100 | Exact uncertainty, freshness, or bounded-history detail in accessible InfoChip/tooltip. |
| `i18n/locales/vi/runs.json:shortenedDiagnostics` | 120 | Exact uncertainty, freshness, or bounded-history detail in accessible InfoChip/tooltip. |
| `i18n/locales/vi/runs.json:healthNote` | 85 | Exact uncertainty, freshness, or bounded-history detail in accessible InfoChip/tooltip. |
| `i18n/locales/vi/runs.json:noHealth` | 86 | Conditional missing-metric diagnostic; never substitutes zero for unavailable data. |
| `i18n/locales/vi/runs.json:latestNote` | 86 | Exact uncertainty, freshness, or bounded-history detail in accessible InfoChip/tooltip. |
| `i18n/locales/vi/runs.json:lastKnownNote` | 129 | Exact uncertainty, freshness, or bounded-history detail in accessible InfoChip/tooltip. |
| `i18n/locales/vi/runs.json:notLive` | 98 | Exact uncertainty, freshness, or bounded-history detail in accessible InfoChip/tooltip. |
| `i18n/locales/vi/runs.json:chartNote` | 110 | Exact uncertainty, freshness, or bounded-history detail in accessible InfoChip/tooltip. |
| `i18n/locales/vi/runs.json:pendingNote` | 112 | Exact uncertainty, freshness, or bounded-history detail in accessible InfoChip/tooltip. |
| `i18n/locales/vi/runs.json:lifecycleNote` | 141 | Exact uncertainty, freshness, or bounded-history detail in accessible InfoChip/tooltip. |
| `i18n/locales/vi/shell-settings.json:connectionHelp` | 215 | Sibling 5A-owned settings/shell copy; outside 5B ownership. |
| `i18n/locales/vi/shell-settings.json:credentialHelp` | 117 | Sibling 5A-owned settings/shell copy; outside 5B ownership. |
| `i18n/locales/vi/shell-settings.json:sessionStorageHelp` | 99 | Sibling 5A-owned settings/shell copy; outside 5B ownership. |
| `i18n/locales/vi/shell-settings.json:disconnectHelp` | 220 | Sibling 5A-owned settings/shell copy; outside 5B ownership. |
| `i18n/locales/vi/shell-settings.json:appearanceHelp` | 101 | Sibling 5A-owned settings/shell copy; outside 5B ownership. |
| `i18n/locales/vi/shell-settings.json:downloadsHelp` | 214 | Sibling 5A-owned settings/shell copy; outside 5B ownership. |
| `i18n/locales/vi/shell-settings.json:feedbackPrivacyHelp` | 134 | Sibling 5A-owned settings/shell copy; outside 5B ownership. |
| `i18n/locales/vi/shell-settings.json:trainingDefaultsHelp` | 255 | Sibling 5A-owned settings/shell copy; outside 5B ownership. |
| `i18n/locales/vi/shell-settings.json:loggingHelp` | 152 | Sibling 5A-owned settings/shell copy; outside 5B ownership. |
| `i18n/locales/vi/storage-mapping.json:guidanceDetails` | 287 | Ownership/access qualifier in mapping details InfoChip or conditional backend warning. |
| `i18n/locales/vi/storage-mapping.json:interpreterDetails` | 226 | Ownership/access qualifier in mapping details InfoChip or conditional backend warning. |
| `i18n/locales/vi/storage-mapping.json:rootError` | 126 | Conditional field-validation diagnostic. |
| `i18n/locales/vi/training-fields.json:model.description` | 86 | Field help moved to keyboard/touch InfoChip; typed control remains visible. |
| `i18n/locales/vi/training-fields.json:pretrained.description` | 104 | Field help moved to keyboard/touch InfoChip; typed control remains visible. |
| `i18n/locales/vi/training-fields.json:grad_accum_steps.description` | 83 | Field help moved to keyboard/touch InfoChip; typed control remains visible. |
| `i18n/locales/vi/training-fields.json:single_channel.description` | 85 | Field help moved to keyboard/touch InfoChip; typed control remains visible. |
| `i18n/locales/vi/training-fields.json:constraint_weight.description` | 82 | Field help moved to keyboard/touch InfoChip; typed control remains visible. |
| `lib/adoption.ts:187` | 124 | Lost-acknowledgement diagnostic; exact uncertainty contract retained. |
| `lib/training-export.ts:9` | 82 | Exported YAML provenance comment; not default workspace prose. |

## Retained raw views and shell contract

- `runs/LogPanel.vue`: escaped, keyboard-focusable runtime journal text; not a structured-state dump.
- `project/PlanApproval.vue`: copyable raw persisted plan behind the single raw-plan disclosure.
- Settings raw controls are owned by 5A and were not edited.
- `#shell-panel-tab-logs` and `#shell-panel-tab-artifacts` receive no element when empty.
- The targets are expected to exist by section mount; standalone mounts retain an inline fallback.
- No vendored web assets or frozen acceptance reports were regenerated.

## 2026-10-28 orchestrator review corrections

All review fixes are uncommitted follow-ups to the integrated 52c7ff0 baseline.

- Restored complete hedge assertions and exact ordered dataset facts. Details remain in each chip's accessible text and its own tooltip.
- Added explicit live status regions for adoption confirmation, export-requested state, empty catalog/root/directory states, and retained the complete lifecycle announcement.
- `project.datasetSelectionSummary` now supplies the full path and daemon identity to the Dataset InfoChip; the selected badge shows only the filename (or the explicit not-selected state).
- Training labels are human-readable and sentence-cased. Machine config keys, raw metric values, states, request IDs, and transport bodies are unchanged.
- Only empty `Available: ()` suffixes were removed from training descriptions. No epistemic hedge was deleted.
- The premature unconditional export-requested disclosure was removed; its exact text is announced only after a request.
- New Stepper registry files use existing reka-ui and the existing utils alias. No dependency or lockfile change remains.
- Browser helpers retain exact visible labels and scoped visibility checks; legacy CLI field names resolve to the current English label.
- Fault-report readers accept the two exact historical/current capitalization forms; frozen reports are not rewritten.
- Review prose metric (integrated HEAD -> working tree): **244 -> 244 over 80**, **118 -> 118 over 160**. The length-neutral label changes preserve long hedges.

### Review key-by-key copy ledger

| Catalog/key | Before | After |
| --- | --- | --- |
| `en/project.json:exportDownloadDetails` | Download details | (removed) |
| `en/results.json:openArtifacts` | (added) | Open artifacts |
| `en/runs.json:operationTrain` | train | Train |
| `en/runs.json:operationTest` | test | Test |
| `en/runs.json:operationPlot` | plot | Plot |
| `en/runs.json:planned` | planned | Planned |
| `en/runs.json:pending` | pending | Pending |
| `en/runs.json:submissionUnknown` | submission unknown | Submission unknown |
| `en/runs.json:submitted` | submitted | Submitted |
| `en/runs.json:queued` | queued | Queued |
| `en/runs.json:held` | held | Held |
| `en/runs.json:running` | running | Running |
| `en/runs.json:stopping` | stopping | Stopping |
| `en/runs.json:completed` | completed | Completed |
| `en/runs.json:failed` | failed | Failed |
| `en/runs.json:cancelled` | cancelled | Cancelled |
| `en/runs.json:terminalUnknown` | terminal unknown | Terminal unknown |
| `en/runs.json:observationUnavailable` | observation unavailable | Observation unavailable |
| `en/runs.json:supervisionLost` | supervision lost | Supervision lost |
| `en/runs.json:updatedTime` | (added) | Updated {time} |
| `en/runs.json:logs` | (added) | Logs |
| `en/training-fields.json:model.label` | model | Model architecture |
| `en/training-fields.json:model.description` | Model architecture to train. Available: () | Model architecture to train |
| `en/training-fields.json:import_modules.label` | import modules | Registration modules |
| `en/training-fields.json:pretrained.label` | pretrained | Pretrained weights |
| `en/training-fields.json:batch_size.label` | batch size | Batch size |
| `en/training-fields.json:lr.label` | lr | Learning rate |
| `en/training-fields.json:epochs.label` | epochs | Epochs |
| `en/training-fields.json:patience.label` | patience | Early stopping patience |
| `en/training-fields.json:weight_decay.label` | weight decay | Weight decay |
| `en/training-fields.json:grad_clip.label` | grad clip | Gradient clipping |
| `en/training-fields.json:grad_accum_steps.label` | grad accum steps | Gradient accumulation steps |
| `en/training-fields.json:loss.label` | loss | Loss function |
| `en/training-fields.json:loss.description` | Loss function for training. Available: () | Loss function for training |
| `en/training-fields.json:huber_delta.label` | huber delta | Huber delta |
| `en/training-fields.json:loss_weights.label` | loss weights | Loss weights |
| `en/training-fields.json:optimizer.label` | optimizer | Optimizer |
| `en/training-fields.json:optimizer.description` | Optimizer for training. Available: () | Optimizer for training |
| `en/training-fields.json:momentum.label` | momentum | Momentum |
| `en/training-fields.json:nesterov.label` | nesterov | Nesterov momentum |
| `en/training-fields.json:betas.label` | betas | Beta coefficients |
| `en/training-fields.json:scheduler.label` | scheduler | Learning rate schedule |
| `en/training-fields.json:scheduler.description` | LR scheduler. Available: () | LR scheduler |
| `en/training-fields.json:scheduler_patience.label` | scheduler patience | Learning rate patience |
| `en/training-fields.json:min_lr.label` | min lr | Minimum learning rate |
| `en/training-fields.json:scheduler_factor.label` | scheduler factor | Learning rate reduction factor |
| `en/training-fields.json:warmup_epochs.label` | warmup epochs | Warmup epochs |
| `en/training-fields.json:step_size.label` | step size | Scheduler step interval |
| `en/training-fields.json:milestones.label` | milestones | Scheduler milestones |
| `en/training-fields.json:data_path.label` | data path | Training dataset |
| `en/training-fields.json:workers.label` | workers | Data loader workers |
| `en/training-fields.json:seed.label` | seed | Random seed |
| `en/training-fields.json:deterministic.label` | deterministic | Deterministic training |
| `en/training-fields.json:cache_validate.label` | cache validate | Cache validation |
| `en/training-fields.json:single_channel.label` | single channel | Single-channel data |
| `en/training-fields.json:cv.label` | cv | Cross-validation folds |
| `en/training-fields.json:cv_stratify.label` | cv stratify | Stratified cross-validation |
| `en/training-fields.json:cv_bins.label` | cv bins | Stratification bins |
| `en/training-fields.json:resume.label` | resume | Resume checkpoint |
| `en/training-fields.json:save_every.label` | save every | Checkpoint interval |
| `en/training-fields.json:fresh.label` | fresh | Fresh training |
| `en/training-fields.json:compile.label` | compile | Compile model |
| `en/training-fields.json:precision.label` | precision | Mixed precision |
| `en/training-fields.json:constraint.label` | constraint | Constraint expressions |
| `en/training-fields.json:constraint_file.label` | constraint file | Constraint file |
| `en/training-fields.json:constraint_weight.label` | constraint weight | Constraint weights |
| `en/training-fields.json:constraint_reduction.label` | constraint reduction | Constraint reduction |
| `en/training-fields.json:wandb.label` | wandb | W&B logging |
| `en/training-fields.json:wandb_watch.label` | wandb watch | W&B gradient tracking |
| `en/training-fields.json:project_name.label` | project name | W&B project name |
| `en/training-fields.json:run_name.label` | run name | W&B run name |
| `vi/project.json:exportDownloadDetails` | Chi tiết tải xuống | (removed) |
| `vi/results.json:openArtifacts` | (added) | Mở tệp |
| `vi/runs.json:planned` | đã lập kế hoạch | Đã lập kế hoạch |
| `vi/runs.json:pending` | đang chờ | Đang chờ |
| `vi/runs.json:submissionUnknown` | chưa rõ việc gửi | Chưa rõ việc gửi |
| `vi/runs.json:submitted` | đã gửi | Đã gửi |
| `vi/runs.json:queued` | trong hàng đợi | Trong hàng đợi |
| `vi/runs.json:held` | tạm giữ | Tạm giữ |
| `vi/runs.json:running` | đang chạy | Đang chạy |
| `vi/runs.json:stopping` | đang dừng | Đang dừng |
| `vi/runs.json:completed` | hoàn tất | Hoàn tất |
| `vi/runs.json:failed` | thất bại | Thất bại |
| `vi/runs.json:cancelled` | đã hủy | Đã hủy |
| `vi/runs.json:terminalUnknown` | chưa rõ trạng thái kết thúc | Chưa rõ trạng thái kết thúc |
| `vi/runs.json:observationUnavailable` | không có quan sát | Không có quan sát |
| `vi/runs.json:supervisionLost` | mất giám sát | Mất giám sát |
| `vi/runs.json:updatedTime` | (added) | Cập nhật {time} |
| `vi/runs.json:logs` | (added) | Nhật ký |

### Verification boundaries

Happy-dom regression tests cover live regions, ordered facts, accessible full hedges, real Select interactions, scoped tool exposure, horizontal booleans, stepper states, localized labels, non-default badges, numeric precision/exact-value titles, pagination, sibling state chips, filename-only selection badges, and shell-tab opening.
Actual 375px overflow and panel-height measurements require a real browser; happy-dom has no layout engine. No real-browser acceptance run or regenerated frozen/vendor artifacts is claimed.
