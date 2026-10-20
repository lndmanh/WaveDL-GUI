# Runtime and real-site qualification

This is an operator runbook, **not an execution or qualification report**. It
does not change the supported-platform matrix or waive any remaining gate.
Successful CPU, simulated-scheduler, MPS or foundation tests do not establish
CUDA/distributed GPU cancellation or real Slurm/filesystem-site acceptance.

The requirements remain [architecture §16](superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md#16-testing)
and [current T30c supported-site gate](superpowers/plans/2026-09-06-daemon-migration-structure.md#phase-1c--daemonbrowser-reliability-current-scope).
Existing cross-component failure tests and manual site execution can supply
evidence; a new dedicated automated runner is not a prerequisite merely because
none is provided here. This document supplies operator inputs and an evidence
checklist, not a replacement for those requirements or final release review.

## Authority, isolation and unresolved inputs

Before running anything, obtain authorization for the specific machine, GPUs,
scheduler partition/account, allocation duration and any fault/requeue exercise.
Use only fresh, private, operator-owned QA directories and test jobs. Never use
production run roots, an existing user's state database, broad process-name
kills, GPU-reset commands, `scancel --user`, or deletion of unrelated files.
Cancellation must target the recorded WaveDL run and its native job/process
identity. Browser closure is detach, not cancellation.

Record these deployment-specific inputs; an unresolved field is not a pass:

- Exact source commit, installed wheel/sdist SHA-256, Python executable and
  dependency versions; use the selected installed artifact, not an editable
  checkout hidden behind `PYTHONPATH`.
- OS/version, GPU UUIDs/device allocation, driver/CUDA/PyTorch versions, number
  of machines and processes per machine; chosen precision and any additional
  precision/compilation variants being qualified.
- Readable compatible dataset and approved model/configuration. Use a small
  completion case and a sufficiently long cancellation case, with separate
  fresh outputs and idempotency keys.
- Absolute local durable daemon-state root, absolute run root, private credential
  file, and who owns the evidence directory. Do not put SQLite/dispatch ownership
  on the shared run filesystem or an ephemeral login-node temporary directory.
- For Slurm: site/cluster/version, approved partition/account/resources, trusted
  setup hooks, allocation-visible Python/dataset paths, shared mount identity and
  options on login and compute nodes, address/rendezvous policy, accounting
  availability/retention, requeue permission and compute-to-daemon connectivity.

The shell examples below are **Linux/POSIX examples**, not PowerShell commands.
Run each native supported-OS cancellation case on that OS; do not count Linux
container results as native Windows or macOS results. Follow the existing device
and OS support policy: this document neither invents a CUDA path on an OS that
lacks it nor removes the full-tree cancellation requirement on supported OSes.
Use native platform tooling for owned PID/Job/descendant evidence on Windows;
POSIX signals and process-group observations are not Windows Job evidence.

## Create a private Linux QA workspace

Choose an approved persistent **local** parent (not the shared Slurm filesystem).
Replace all `REPLACE_...` values before execution. The only directories created
here are the new QA root and its children; retain them until review.

```sh
umask 077
QA_ROOT=$(mktemp -d /REPLACE_LOCAL_DURABLE_PARENT/wavedl-qa.XXXXXX) || exit 1
mkdir "$QA_ROOT/state" "$QA_ROOT/evidence" || exit 1
QA_PYTHON=/REPLACE_ABSOLUTE_INSTALLED_ENV/bin/python
"$QA_PYTHON" -I -c 'import pathlib,secrets,sys; p=pathlib.Path(sys.argv[1]); stream=p.open("x"); stream.write(secrets.token_urlsafe(32)); stream.close(); p.chmod(0o600)' "$QA_ROOT/token" || exit 1
"$QA_PYTHON" -m pip check
"$QA_PYTHON" -c 'import sys,torch,wavedl; print(sys.executable,torch.__version__,torch.version.cuda); print(wavedl.__file__); print(torch.cuda.is_available(),torch.cuda.device_count())'
nvidia-smi --query-gpu=index,uuid,name,driver_version --format=csv
```

Keep tokens/bootstrap URLs out of reports, terminal recordings and support
uploads. The credential file is an authentication input, not evidence to share.
The daemon prints a single-use bootstrap URL: use it privately if opening the
browser; do not save that line in a distributable log. Daemon binds loopback only;
use an explicitly approved SSH-forwarding/tunnel arrangement for remote access.

## Local GPU completion and cancellation

Start the installed daemon in a separate terminal using this fresh workspace.
Set `QA_ROOT` and `QA_PYTHON` there to the exact paths created/selected above;
shell variables are not automatically shared between terminals:

```sh
mkdir "$QA_ROOT/runs"
"$QA_PYTHON" -m wavedl_daemon.cli serve --host 127.0.0.1 --port 8420 \
  --state-root "$QA_ROOT/state" --run-root "$QA_ROOT/runs" \
  --credential-file "$QA_ROOT/token" \
  --browse-root "datasets=/REPLACE_ABSOLUTE_DATASET_DIRECTORY"
```

Check the installed commands belong to the selected environment. If port 8420
is occupied, choose an unused approved port and use that same port everywhere;
do not stop another listener. Use the private bootstrap URL for the browser.

Author a real training draft in the browser: select the actual dataset, model,
CUDA interpreter/device, machine count and processes per machine. For Local use
one machine; exercise two or more GPUs where distributed GPU support is in scope.
Use enough epochs to observe genuine rank activity before cancellation.

Generate a **preview**, not submission. Save only the JSON **request body** of
`POST /api/runs/plan` from browser developer tools as
`$QA_ROOT/request.json`; never copy request headers, cookies, bootstrap codes or
tokens. The UI's standalone YAML/POSIX command export is a training-config
export, **not** this daemon lifecycle JSON or Slurm policy. There is no assumed
"Export lifecycle JSON" button.

Review the payload against
[`RunService.plan`](../src/wavedl_daemon/runs/service.py): required fields are
`backend`, `operation`, `config`, `runtime`, `topology`. Runtime contains
`python`, `mode`, `device`, `environment`; topology contains
`num_machines`, `processes_per_machine`, `machine_rank`. Optional fields are
`storage_map`, `submission_cwd`, `checkpoint_source`. Do not inject `WAVEDL_*`
environment variables, credentials or fabricated runtime identities. Dataset,
output and checkpoint configuration must follow the actual validated draft and
published-checkpoint rules, not a guessed minimal JSON example.

The CLI uses the same lifecycle contract:

```sh
QA_KEY=$("$QA_PYTHON" -c 'import uuid; print(uuid.uuid4())')
"$QA_PYTHON" -m wavedl.client run --daemon http://127.0.0.1:8420 \
  --request "$QA_ROOT/request.json" --credential-file "$QA_ROOT/token" \
  --idempotency-key "$QA_KEY" --plan-only > "$QA_ROOT/evidence/preview.json"
```

Inspect the exact immutable preview, runtime, command, paths and resource policy.
Only after approval, repeat the identical command **without `--plan-only`** to
submit, saving its JSON response. Preserve the same key for retries of the same
payload; use a new key for a different test. A preview and a 202 response are not
proof of runtime startup or completion. Record the returned `run_id`.

The browser's authenticated Stop control requests durable cancellation. For a
CLI-only exercise, this example reads the credential from disk rather than
putting it in the shell history or process arguments. Replace the run UUID with
the exact returned owned run ID:

```sh
QA_RUN_ID=REPLACE_OWNED_RUN_UUID
"$QA_PYTHON" - "$QA_ROOT/token" "$QA_RUN_ID" <<'PY'
import sys
from uuid import UUID
from wavedl.client import DaemonClient
from wavedl.core.credentials import read_credential
run_id = str(UUID(sys.argv[2]))
client = DaemonClient("http://127.0.0.1:8420", read_credential(sys.argv[1]))
print(client.request("POST", f"/api/runs/{run_id}/cancel"))
print(client.request("GET", f"/api/runs/{run_id}"))
print(client.request("GET", f"/api/runs/{run_id}/attempts"))
PY
```

Poll authenticated GET until a truthful terminal result is available; do not
interpret the first receipt/requested/stopping state as completed cancellation.
If status remains unknown or native inspection is denied, retain that uncertainty
and fail the absence claim. Repeat cancellation to verify one durable intent and
no duplicate attempt/job, then establish native cleanup independently.

For each supported native OS/device case, retain:

1. Runtime `hello`, selected device, identity and observed ranks; genuine epoch
   progress before cancellation. Fake children and idle imported CUDA are not
   actual distributed-training evidence.
2. Full owned tree: daemon supervisor, launcher, accelerate/elastic agent and
   every rank/worker, with stable native identities and initial GPU process
   ownership. Observe before cancelling; a vanished launcher alone is insufficient.
3. Durable cancel intent/acknowledgement, delivery and terminal projection, raw
   native exit status, bounded pipe drain and no forced cleanup hidden as graceful
   success. Any emergency cleanup must target only the recorded owned tree and
   be reported separately, never used to convert a failed gate to a pass.
4. All owned ranks/descendants and their GPU process contexts absent after cancel.
   On CUDA Linux, capture before/after
   `nvidia-smi --query-compute-apps=pid,gpu_uuid,process_name,used_gpu_memory --format=csv`
   plus native process identity/tree checks. Do not kill unrelated PIDs or require
   global GPU memory to be zero. Unsupported/permission-denied GPU queries are
   unknown, not absence. PID reuse must not be mistaken for the original process.
5. A separate normal-completion run with complete checkpoint generations,
   `COMPLETE.json`, manifest and attempt journal. Check collective publication
   across all ranks. Retain cancelled-run outputs too; an in-flight legitimate
   publication is not automatically proof of corruption or zero post-intent work.

## Real Slurm/filesystem site

This is a distinct gate from Local GPU/OS cancellation. Run only with site
authorization. A successful single-node Local GPU case does not establish Slurm,
and a scheduler cancellation does not establish Local supervisor tree cleanup.

Use a fresh local durable state root and a separate fresh private shared run root
created under an approved project filesystem. Verify access/identity on both
login and compute nodes using the site's approved allocation process. Never put
the daemon registry on NFS/Lustre/GPFS merely because run files belong there.

```sh
scontrol --version
findmnt -T "$QA_ROOT/state"
findmnt -T /REPLACE_APPROVED_SHARED_RUN_ROOT
```

Create an owner-private trusted `site.json` reviewed by the operator/site owner.
Fields are defined by
[`SlurmSite`](../src/wavedl_daemon/backends/slurm_plan.py): required `partition`;
optional `account`, `time`, `cpus_per_task`, `memory`, `gpus_per_node`, `constraint`,
`cluster`, `rendezvous_port`, `setup_commands`, `stage_out_command`, `requeue`.
Resources must match the approved topology; memory is per node and CPUs are per
launcher task. Setup/stage-out fields are trusted shell programs, not untrusted
training arguments. Do not paste arbitrary hooks, credentials or guessed module
names. Enable requeue only when the site authorizes that exercise. JSON values
must follow the actual validator (for example, time `[days-]hours:minutes:seconds`
and memory a positive Slurm quantity), not shell expansions in directives.

```sh
"$QA_PYTHON" -m wavedl_daemon.cli serve --host 127.0.0.1 --port 8420 \
  --state-root "$QA_ROOT/state" --run-root /REPLACE_APPROVED_SHARED_RUN_ROOT \
  --credential-file "$QA_ROOT/token" --slurm-site /REPLACE_PRIVATE/site.json \
  --browse-root "datasets=/REPLACE_SHARED_DATASET_DIRECTORY"
```

Do not concurrently start the Local example against the same state. Author and
preview a fresh browser request for `backend=slurm` with the actual allocation
interpreter/dataset and topology. Review generated batch script/resources and
path mappings. Use the same CLI preview/approved-submission flow above. A healthy
login-node daemon cannot prove CUDA visibility or compatible runtime inside the
allocation; retain compute-side `hello` and all rank/device evidence.

Required site evidence, with operator-approved fault exercises:

- **Submission and identity:** exactly one native job for the request despite
  retry; durable recorded job/cluster/owner provenance agrees with native records.
  Retain plan hash, approved script, job ID and allocation/runtime identity.
- **Visibility/publication:** record filesystem type/mount options on both sides,
  run-root mapping and visibility tolerance. Observe actual compute-written
  journals and complete checkpoints from the login daemon, including replay
  after reconnect/restart. An empty/stale read must not become completion;
  distinguish live push from filesystem observation. Deliberate delay or failure
  exercises require site permission and isolated test data.
- **Accounting and retention:** retain the bounded capability probe result and
  sanitized `scontrol show config` fields for `MinJobAge`,
  `AccountingStorageType`, `AccountingStoreFlags`, and actual `sacct` access.
  [`SlurmObservation.capabilities`](../src/wavedl_daemon/backends/slurm_observation.py)
  performs these probes; report unavailable accounting/comments as such, not a
  fabricated successful history. Do not publish full site config indiscriminately.
- **Cancellation:** use the exact WaveDL run cancel route; observe durable intent,
  native cancellation and release of that allocation, all ranks/job steps and
  owned GPU contexts. `squeue` disappearance alone is not proof of terminal
  success when accounting/native observation is unavailable. Retain raw scheduler
  status and WaveDL uncertainty, not only a terminal-looking UI screenshot.
- **Requeue:** in a separate approved test with `requeue=true`, ask the authorized
  operator to requeue only the recorded test job (for sites that authorize it,
  `scontrol requeue REPLACE_EXACT_OWNED_JOB_ID`). Confirm a new runtime attempt
  and scheduler restart provenance; preserve attempt 1 bytes and independent
  attempt-2 sequence/hello/checkpoint identity. Do not merely edit environment
  variables or count a fake scheduler response as requeue evidence.
- **Failure boundaries:** apply the applicable architecture §16 cases using
  isolated data/site-approved methods: delayed visibility, interrupted submission,
  publication interruption, held/requeued allocations and unavailable controller
  or accounting observations. Existing simulated failure reports remain valuable
  but do not prove actual mount durability or scheduler retention behavior.

## Handoff and cleanup

Produce a sanitized evidence index: source/artifact/config hashes; OS/runtime/GPU
and site facts; command/scenario timestamps; exact owned run/job/native identities;
expected assertions and observed results; terminal status; uncertainty/failures;
logs, journals, checkpoint markers and post-cancel native absence evidence. Record
every skip and missing permission. Do not include tokens, full credential files,
private environment secrets or unnecessary unrelated job/process information.

Stop/drain only this QA daemon and its own jobs, verify dispatch-lock/database
release and no owned listeners/workers/processes/allocations remain, and preserve
evidence before cleanup. Directory deletion, broad scheduler cleanup, GPU resets,
publishing and tagging are not authorized by this runbook. Review the resulting
evidence against the original supported matrix and §16 before recording any
qualification or final-release conclusion.
