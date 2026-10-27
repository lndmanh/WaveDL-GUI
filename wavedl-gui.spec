# -*- mode: python ; coding: utf-8 -*-
"""
WaveDL GUI - PyInstaller Spec File
==================================

Build standalone application with:
    pyinstaller wavedl-gui.spec

This creates:
    - Windows: dist/WaveDL/WaveDL.exe
    - macOS: dist/WaveDL.app
    - Linux: dist/WaveDL/WaveDL

Author: Ductho Le (ductho.le@outlook.com)
"""

import sys
from pathlib import Path

# Determine platform
is_windows = sys.platform == 'win32'
is_macos = sys.platform == 'darwin'
is_linux = sys.platform.startswith('linux')

# Application metadata
APP_NAME = 'WaveDL'
APP_VERSION = '1.0.0'

# Paths
block_cipher = None
src_path = Path('src')

# Analysis
a = Analysis(
    [str(src_path / 'wavedl_gui' / 'main.py')],
    pathex=[str(src_path)],
    binaries=[],
    datas=[
        # Include configs directory
        ('configs', 'configs'),
    ],
    hiddenimports=[
        # PyQt6 components
        'PyQt6.QtCore',
        'PyQt6.QtGui',
        'PyQt6.QtWidgets',
        # PyQtGraph
        'pyqtgraph',
        # QFluentWidgets (optional, gracefully handled if missing)
        'qfluentwidgets',
        # Data handling
        'numpy',
        'scipy',
        'scipy.io',
        'h5py',
        'pandas',
        # Matplotlib backend
        'matplotlib',
        'matplotlib.backends.backend_qtagg',
        # YAML
        'yaml',
        # wavedl modules
        'wavedl',
        'wavedl.models',
        'wavedl.models.registry',
        'wavedl.utils',
        'wavedl.train',
        'wavedl.test',
        'wavedl.hpc',
        'wavedl.hpo',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude unnecessary modules to reduce size
        'tkinter',
        'test',
        'tests',
        'unittest',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

# Create the PYZ archive
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# Create the executable
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name=APP_NAME,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,  # No console window (GUI application)
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    # Icons: create logos/icon.ico for Windows, logos/icon.icns for macOS
    icon='logos/icon.ico' if is_windows else ('logos/icon.icns' if is_macos else None),
)

# Collect all files into distribution folder
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name=APP_NAME,
)

# macOS App Bundle
if is_macos:
    app = BUNDLE(
        coll,
        name=f'{APP_NAME}.app',
        icon='logos/icon.icns',
        bundle_identifier='io.wavedl.gui',
        info_plist={
            'CFBundleName': APP_NAME,
            'CFBundleDisplayName': APP_NAME,
            'CFBundleVersion': APP_VERSION,
            'CFBundleShortVersionString': APP_VERSION,
            'NSHighResolutionCapable': True,
            'NSRequiresAquaSystemAppearance': False,  # Support dark mode
            'CFBundleDocumentTypes': [
                {
                    'CFBundleTypeName': 'NPZ Data File',
                    'CFBundleTypeExtensions': ['npz'],
                    'CFBundleTypeRole': 'Viewer',
                },
                {
                    'CFBundleTypeName': 'MAT Data File',
                    'CFBundleTypeExtensions': ['mat'],
                    'CFBundleTypeRole': 'Viewer',
                },
                {
                    'CFBundleTypeName': 'HDF5 Data File',
                    'CFBundleTypeExtensions': ['h5', 'hdf5'],
                    'CFBundleTypeRole': 'Viewer',
                },
            ],
        },
    )
