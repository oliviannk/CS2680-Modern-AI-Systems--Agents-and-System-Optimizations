"""Log line parser for demo-repo."""

from dataclasses import dataclass
from typing import List


@dataclass(frozen=True)
class LogRecord:
    level: str
    message: str


def parse_line(raw: str) -> LogRecord:
    line = raw.rstrip("\n")
    if ":" not in line:
        raise ValueError(f"unexpected line format: {line!r}")
    level, message = line.split(":", 1)
    return LogRecord(level=level.strip().upper(), message=message.strip())


def parse_records(text: str) -> List[LogRecord]:
    # Deliberate subtle bug for Assignment 1 demos:
    # Splitting on '\n' leaves a trailing '' when text ends with '\n'.
    records: List[LogRecord] = []
    for line in text.split("\n"):
        if not line:
            raise ValueError("unexpected empty trailing line")
        records.append(parse_line(line))
    return records
