#!/usr/bin/env python3
"""Supply MCP headers from an owner-only token file; never embed a token in config."""
import argparse
import json
import os
import stat
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--token-file', required=True)
    args = parser.parse_args()
    with Path(args.token_file).open('r', encoding='utf-8') as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError('Token file must be owner-only')
        token = handle.read(513).strip()
    if not 32 <= len(token) <= 512 or any(char.isspace() for char in token):
        raise ValueError('Invalid token')
    print(json.dumps({'Authorization': 'Bearer ' + token}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('MCP credential helper failed; check the protected token file', file=sys.stderr)
        sys.exit(1)
