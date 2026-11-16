"""CLI entry point for demo-repo."""

import argparse
import sys
from pathlib import Path

from .parser import parse_records


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Parse structured log files.")
    parser.add_argument("path", type=Path, help="Path to the log file")
    args = parser.parse_args(argv)

    content = args.path.read_text(encoding="utf-8")
    records = parse_records(content)
    for rec in records:
        print(f"[{rec.level}] {rec.message}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
