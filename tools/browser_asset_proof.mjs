export async function frozenAssetProof(command, python) {
  return JSON.parse(
    await command(python, [
      "-c",
      "import json,hashlib\nfrom pathlib import Path\nfrom tools.vendor_web_assets import inventory\np=Path('src/wavedl_daemon/web_assets'); raw=(p/'.wavedl-assets.json').read_bytes(); assets=inventory(p,managed=True)\nif assets!=json.loads(raw): raise ValueError('Frozen asset inventory mismatch')\nprint(json.dumps({'manifestSha256':hashlib.sha256(raw).hexdigest(),'assets':assets}))",
    ]),
  );
}
