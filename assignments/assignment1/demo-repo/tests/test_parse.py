import unittest

from src.parser import LogRecord, parse_records


class TestParse(unittest.TestCase):
    def test_parse_single_record(self):
        records = parse_records("info: server started")
        self.assertEqual(records, [LogRecord(level="INFO", message="server started")])

    def test_parse_trailing_newline(self):
        records = parse_records("info: boot\nwarn: cache cold\n")
        self.assertEqual(
            records,
            [
                LogRecord(level="INFO", message="boot"),
                LogRecord(level="WARN", message="cache cold"),
            ],
        )


if __name__ == "__main__":
    unittest.main()
