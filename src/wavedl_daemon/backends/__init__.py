"""Headless execution contracts; no runtime/ML imports at package import."""

from .contracts import (
    Backend,
    BackendObservation,
    Handle,
    ObservationStatus,
    OperationKind,
    OperationOutcome,
    OperationResult,
    OutcomeStatus,
    Plan,
    Topology,
    UnsupportedPlan,
)
