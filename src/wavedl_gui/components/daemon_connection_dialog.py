"""Quiet, explicit daemon connection preferences; never an access-token editor."""

from PySide6.QtWidgets import QFileDialog, QHBoxLayout, QVBoxLayout, QWidget
from qfluentwidgets import (
    BodyLabel,
    ComboBox,
    LineEdit,
    MessageBoxBase,
    PushButton,
    SubtitleLabel,
)

from ..common.config import cfg


class DaemonConnectionDialog(MessageBoxBase):
    """Edit locations and execution selection without reading a credential."""

    def __init__(self, parent=None):
        super().__init__(parent)
        title = SubtitleLabel(self.tr("Connect to a daemon"), self)
        self.viewLayout.addWidget(title)
        hint = BodyLabel(
            self.tr(
                "Start wavedl-daemon serve first. The credential file must belong to you and match that daemon."
            ),
            self,
        )
        hint.setWordWrap(True)
        self.viewLayout.addWidget(hint)
        self.urlEdit = self._field("Daemon URL", cfg.get(cfg.daemonUrl))
        self.pythonEdit = self._field(
            "Python path on the execution host", cfg.get(cfg.daemonPython)
        )
        self.viewLayout.addWidget(
            BodyLabel(self.tr("Private credential file on this computer"), self)
        )
        credential_row = QHBoxLayout()
        self.credentialEdit = LineEdit(self)
        self.credentialEdit.setText(cfg.get(cfg.daemonCredentialFile))
        self.credentialEdit.setAccessibleName(self.tr("Private credential file"))
        choose = PushButton(self.tr("Choose file"), self)
        choose.clicked.connect(self._chooseCredential)
        credential_row.addWidget(self.credentialEdit, 1)
        credential_row.addWidget(choose)
        self.viewLayout.addLayout(credential_row)
        choices = QWidget(self)
        choices.setObjectName("daemonChoices")
        choices.setStyleSheet("#daemonChoices { background: transparent; }")
        self._choicesLayout = QHBoxLayout(choices)
        self._choicesLayout.setContentsMargins(0, 0, 0, 0)
        self.viewLayout.addWidget(choices)
        self.backendBox = self._choice(
            "Backend", ["local", "slurm"], cfg.get(cfg.daemonBackend)
        )
        self.deviceBox = self._choice(
            "Device", ["cpu", "cuda", "mps", "auto"], cfg.get(cfg.daemonDevice)
        )
        self.realmBox = self._choice(
            "Dataset and checkpoint paths",
            ["same_host", "remote"],
            cfg.get(cfg.daemonPathRealm),
            [
                self.tr("Daemon on this computer"),
                self.tr("Paths on a remote daemon host"),
            ],
        )
        note = BodyLabel(
            self.tr(
                "SSH-forwarded localhost is still a remote host. Output folders stay local; the daemon owns its run directories."
            ),
            self,
        )
        note.setWordWrap(True)
        self.viewLayout.addWidget(note)
        self.errorLabel = BodyLabel("", self)
        self.errorLabel.setWordWrap(True)
        self.viewLayout.addWidget(self.errorLabel)
        self.viewLayout.setSpacing(8)
        self.yesButton.setText(self.tr("Save connection"))
        self.cancelButton.setText(self.tr("Cancel"))
        self.widget.setMinimumWidth(560)

    def _field(self, label, value):
        self.viewLayout.addWidget(BodyLabel(self.tr(label), self))
        field = LineEdit(self)
        field.setText(value)
        field.setAccessibleName(self.tr(label))
        self.viewLayout.addWidget(field)
        return field

    def _choice(self, label, values, selected, texts=None):
        column = QVBoxLayout()
        column.addWidget(BodyLabel(self.tr(label), self))
        field = ComboBox(self)
        for value, text in zip(values, texts or values, strict=True):
            field.addItem(text, userData=value)
        field.setCurrentIndex(values.index(selected))
        field.setAccessibleName(self.tr(label))
        column.addWidget(field)
        self._choicesLayout.addLayout(column)
        return field

    def _chooseCredential(self):
        path, _ = QFileDialog.getOpenFileName(
            self, self.tr("Choose private credential file"), self.credentialEdit.text()
        )
        if path:
            self.credentialEdit.setText(path)

    def validate(self):
        from ..service.daemon_contracts import DaemonConnection

        try:
            DaemonConnection(
                url=self.urlEdit.text().strip(),
                credential_file=self.credentialEdit.text().strip(),
                python=self.pythonEdit.text().strip(),
                backend=self.backendBox.currentData(),
                device=self.deviceBox.currentData(),
                path_realm=self.realmBox.currentData(),
                environment={},
            )
        except (ValueError, TypeError):
            self.errorLabel.setText(
                self.tr(
                    "Check the URL, absolute Python path, and credential-file location."
                )
            )
            return False
        return True

    def savePreferences(self):
        for item, value in (
            (cfg.daemonUrl, self.urlEdit.text().strip()),
            (cfg.daemonPython, self.pythonEdit.text().strip()),
            (cfg.daemonCredentialFile, self.credentialEdit.text().strip()),
            (cfg.daemonBackend, self.backendBox.currentData()),
            (cfg.daemonDevice, self.deviceBox.currentData()),
            (cfg.daemonPathRealm, self.realmBox.currentData()),
        ):
            cfg.set(item, value)
