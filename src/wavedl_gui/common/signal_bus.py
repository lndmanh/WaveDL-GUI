from PySide6.QtCore import QObject, Signal


class SignalBus(QObject):
    """Signal bus for application-wide event communication"""

    # Application signals
    appMessageSig = Signal(str)
    appErrorSig = Signal(str)
    requestExitSig = Signal()

    # Window signals
    checkUpdateSig = Signal()
    micaEnableChanged = Signal(bool)

    # Training signals
    trainingProgressSig = Signal(object)  # TrainingProgress dataclass
    trainingOutputSig = Signal(str)  # Log output line
    trainingStateChangedSig = Signal(object)  # ProcessState enum
    trainingCompletedSig = Signal(bool, str)  # (success, message)
    historyUpdatedSig = Signal(list)  # List of TrainingMetrics

    # Testing signals
    testCompletedSig = Signal(bool, str, dict)  # (success, message, results)

    # Plot generation signals
    plotGeneratedSig = Signal(bool, str, list)  # (success, message, image_paths)
    plotStartedSig = Signal()  # A plot worker was actually started
    plotStateChangedSig = Signal(object, bool)  # (state, retry_available)

    # Navigation signals
    switchToProjectSig = Signal()
    switchToTrainingSig = Signal()
    switchToDashboardSig = Signal()
    switchToResultsSig = Signal()

    # Action signals
    requestStartTrainingSig = Signal()  # Request MainWindow to start training
    requestResumePlotsSig = Signal()  # Retry the retained plot monitor only

    # Wizard signals
    wizardCompletedSig = Signal(object)  # WizardState dataclass


signalBus = SignalBus()
