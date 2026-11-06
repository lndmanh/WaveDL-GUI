"""One best-checkpoint plot per confirmed, successful non-CV training attempt."""

from __future__ import annotations

import json
from copy import deepcopy
from typing import TYPE_CHECKING

from wavedl_daemon.runs import training_options
from wavedl_daemon.runs.lifecycle import Ended
from wavedl_daemon.runs.model import Operation, Outcome, RunId


if TYPE_CHECKING:
    from wavedl_daemon.runs.lifecycle import RunHead
    from wavedl_daemon.runs.service import RunService
    from wavedl_daemon.storage.automatic_plots import AutomaticPlotStore
    from wavedl_daemon.storage.plans import PlanRecord


def eligible(head: RunHead | None, record: PlanRecord) -> bool:
    return (
        record.plan.operation is Operation.TRAIN
        and record.plan.spec.resolved_config.get("cv") == 0
        and head is not None
        and isinstance(head.stage, Ended)
        and head.stage.exit.outcome is Outcome.COMPLETED
        and head.stage.exit.confirmed
        and not head.cancel_requested
    )


class AutomaticPlots:
    """Tick on the same owner lane as HTTP planning, after reconciliation."""

    def __init__(self, runs: RunService, store: AutomaticPlotStore):
        self.runs = runs
        self.store = store

    def tick(self) -> None:
        source = self.store.undiscovered()
        if source is not None:
            run_id, attempt = source
            record = self.runs.plans.by_run(run_id)
            if record is not None:
                head = self.runs.log.head(RunId(run_id))
                self.store.add(
                    run_id, attempt, "pending" if eligible(head, record) else "skipped"
                )
        pending = self.store.pending()
        if pending is None:
            return
        run_id, attempt = pending.source_run_id, pending.source_attempt
        try:
            record = self.runs.plans.by_run(run_id)
            head = self.runs.log.head(RunId(run_id))
            if (
                record is None
                or head is None
                or head.attempt != attempt
                or not eligible(head, record)
            ):
                raise ValueError("The source training attempt is no longer eligible")
            original = json.loads(record.request_json)
            config = training_options.resolve(Operation.TRAIN, original["config"])
            inference = {
                name: deepcopy(option.default)
                for name, option in training_options.TEST.items()
                if name != "checkpoint"
            }
            for name in ("data_path", "model", "import_modules", "batch_size"):
                inference[name] = config[name]
            inference["workers"] = max(0, config["workers"])
            inference["plot"] = True
            payload = {
                "backend": original["backend"],
                "operation": "plot",
                "runtime": original["runtime"],
                "topology": {
                    "num_machines": 1,
                    "processes_per_machine": 1,
                    "machine_rank": 0,
                },
                "checkpoint_source": {
                    "run_id": run_id,
                    "checkpoint": "best_checkpoint",
                },
                "config": inference,
            }
            for name in ("storage_map", "submission_cwd"):
                if name in original:
                    payload[name] = original[name]
            plan = self.runs.plan(payload, f"daemon-autoplot:{run_id}:{attempt}")
            plot = self.runs.submit(plan.plan_id)
        except Exception as error:
            self.store.update(
                run_id,
                attempt,
                "failed",
                failure=" ".join(str(error).split())[:300] or type(error).__name__,
            )
        else:
            self.store.update(run_id, attempt, "submitted", plot_run_id=plot.run_id)
