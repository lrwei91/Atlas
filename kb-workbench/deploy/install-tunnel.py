#!/usr/bin/env python3
"""Install an SSH reverse tunnel after the remote host and key have been configured."""
import argparse
import os
import pathlib
import plistlib
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('ssh_host', help='Previously configured and verified SSH host alias')
args = parser.parse_args()
if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]*', args.ssh_host):
    parser.error('Use a verified SSH host alias')
root = pathlib.Path(__file__).resolve().parents[1]
state = root / '.local'
state.mkdir(mode=0o700, exist_ok=True)
label = 'com.lrwei91.atlas-tunnel'
agent = pathlib.Path.home() / 'Library/LaunchAgents' / (label + '.plist')
config = {
    'Label': label,
    'ProgramArguments': ['/usr/bin/ssh', '-NT', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
        '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
        '-R', '127.0.0.1:14317:127.0.0.1:4317', args.ssh_host],
    'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 15,
    'StandardOutPath': str(state / 'tunnel.log'), 'StandardErrorPath': str(state / 'tunnel-error.log'),
}
if agent.exists():
    raise SystemExit('Tunnel agent already exists; inspect it before updating')
agent.parent.mkdir(parents=True, exist_ok=True)
agent.write_bytes(plistlib.dumps(config))
subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(agent)], check=True)
print('Tunnel installed; verify remote loopback port and domain before declaring deployment complete.')
