#!/usr/bin/env python3
"""Install only the Atlas local service; optional --public-url enables Secure cookies."""
import argparse
import os
import pathlib
import plistlib
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--public-url', default='')
args = parser.parse_args()
if args.public_url and args.public_url not in ('https://note.lrwei91.com', 'https://note.lrwei91.online'):
    parser.error('public URL must be an authorized Atlas hostname')
root = pathlib.Path(__file__).resolve().parents[1]
state = root / '.local'
state.mkdir(mode=0o700, exist_ok=True)
node = shutil.which('node')
if not node:
    raise SystemExit('node not found')
label = 'com.lrwei91.atlas'
agent = pathlib.Path.home() / 'Library/LaunchAgents' / (label + '.plist')
agent.parent.mkdir(parents=True, exist_ok=True)
env = {'PORT': '4317', 'ATLAS_STATE_DIR': str(state)}
if args.public_url:
    env['ATLAS_PUBLIC_URL'] = args.public_url
config = {
    'Label': label, 'ProgramArguments': [str(pathlib.Path(node).resolve()), str(root / 'server.js')],
    'WorkingDirectory': str(root), 'EnvironmentVariables': env,
    'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 10,
    'StandardOutPath': str(state / 'server.log'), 'StandardErrorPath': str(state / 'server-error.log'),
}
if agent.exists():
    old = plistlib.loads(agent.read_bytes())
    if old.get('WorkingDirectory') != str(root):
        raise SystemExit('Existing agent belongs to another checkout; refusing overwrite')
    subprocess.run(['launchctl', 'bootout', f'gui/{os.getuid()}', str(agent)], check=False, capture_output=True)
agent.write_bytes(plistlib.dumps(config))
subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(agent)], check=True)
print('Atlas service installed: http://127.0.0.1:4317/login')
if not (state / 'admin.json').exists():
    print('Setup credential is stored locally in .local/setup-token; do not publish this file.')
