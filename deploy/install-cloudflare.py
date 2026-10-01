#!/usr/bin/env python3
"""Run Atlas's dedicated Cloudflare tunnel as a user LaunchAgent."""
import os
import pathlib
import plistlib
import shutil
import subprocess

root = pathlib.Path(__file__).resolve().parents[1]
state = root / '.local'
config = state / 'cloudflared.yml'
credentials = state / 'cloudflared-credentials.json'
cloudflared = shutil.which('cloudflared')
if not cloudflared or not config.is_file() or not credentials.is_file():
    raise SystemExit('Missing cloudflared, config, or credentials')
os.chmod(credentials, 0o600)
subprocess.run([cloudflared, 'tunnel', '--config', str(config), 'ingress', 'validate'], check=True)
label = 'com.lrwei91.atlas-cloudflare'
agent = pathlib.Path.home() / 'Library/LaunchAgents' / (label + '.plist')
if agent.exists():
    old = plistlib.loads(agent.read_bytes())
    if old.get('WorkingDirectory') != str(root):
        raise SystemExit('Existing agent belongs to another checkout; refusing overwrite')
    subprocess.run(['launchctl', 'bootout', f'gui/{os.getuid()}', str(agent)], check=False, capture_output=True)
config = {
    'Label': label, 'ProgramArguments': [cloudflared, 'tunnel', '--config', str(config), '--no-autoupdate', 'run'],
    'WorkingDirectory': str(root), 'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 15,
    'StandardOutPath': str(state / 'cloudflared.log'), 'StandardErrorPath': str(state / 'cloudflared-error.log'),
}
agent.parent.mkdir(parents=True, exist_ok=True)
agent.write_bytes(plistlib.dumps(config))
subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(agent)], check=True)
print('Atlas Cloudflare LaunchAgent installed')
