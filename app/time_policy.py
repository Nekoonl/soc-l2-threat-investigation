"""Source-based clocks for SOC calculations; no database writes or implicit zones.

An unzoned wall clock is not an instant. Relative comparisons require an explicit
scope of event IDs and a documented assumption; they never become UTC evidence.
"""
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfoNotFoundError

from .event_view import source_field
from .ingestion import parse_time


@dataclass(frozen=True)
class RelativeClockScope:
    name: str
    event_ids: frozenset[int]
    assumption: str

    def __post_init__(self):
        if not self.name.strip() or not self.assumption.strip() or not self.event_ids:
            raise ValueError('El reloj relativo requiere nombre, eventos y un supuesto documentado.')
        if any(type(value) is not int or value < 0 for value in self.event_ids):
            raise ValueError('El ámbito temporal debe contener identificadores internos de eventos.')
        object.__setattr__(self, 'event_ids', frozenset(self.event_ids))


@dataclass(frozen=True)
class SourceTime:
    original: str | None
    normalized: str | None
    utc: str | None
    status: str
    declared_timezone: str | None


@dataclass(frozen=True)
class TimePoint:
    domain: tuple[str, str]
    seconds: float


def read_source_time(event):
    """Use raw/original evidence, not a historical normalized UTC suffix.

    A bare offset-aware timestamp is accepted for internal, non-persisted engine
    inputs. Imported records need original evidence or documented provenance.
    """
    original = None
    raw = event.get('raw')
    if isinstance(raw, dict):
        _, original = source_field(raw, 'timestamp', event.get('source_columns'))
    if original is None and 'timestamp_original' in event:
        original = event['timestamp_original']
    if original is None and raw is None and not any(key in event for key in ('import_id', 'provenance', 'file_sha256')):
        original = event.get('timestamp')
    declared = (event.get('provenance') or {}).get('declared_timezone')
    try:
        normalized = parse_time(original, source_timezone=declared)
        known = datetime.fromisoformat(normalized).tzinfo is not None
        return SourceTime(original, normalized, normalized if known else None, 'known' if known else 'unknown', declared)
    except (ValueError, TypeError, OverflowError, ZoneInfoNotFoundError):
        return SourceTime(original, None, None, 'unverified', declared)


class TimePolicy:
    def __init__(self, relative_scope=None):
        self.relative_scope = relative_scope

    def point(self, event):
        source = read_source_time(event)
        if source.utc is not None:
            # timestamp() is safe only on this offset-aware, UTC-normalized value.
            return TimePoint(('absolute', 'UTC'), datetime.fromisoformat(source.utc).timestamp())
        scope = self.relative_scope
        if source.status == 'unknown' and scope is not None and event.get('id') in scope.event_ids:
            wall_clock = datetime.fromisoformat(source.normalized)
            # A coordinate for differences, not a Unix timestamp or UTC instant.
            seconds = (wall_clock - datetime(1970, 1, 1)).total_seconds()
            return TimePoint(('relative', scope.name), seconds)
        return None

    def seconds(self, event):
        point = self.point(event)
        if point is None:
            raise ValueError('Fecha sin base temporal comparable; no se puede tratar como UTC.')
        return point.seconds

    def partition(self, events):
        groups, unavailable = {}, []
        for event in events:
            point = self.point(event)
            if point is None:
                unavailable.append(event)
            else:
                groups.setdefault(point.domain, []).append(event)
        return list(groups.values()), unavailable

    def interval(self, events):
        points = [self.point(event) for event in events]
        if not points or any(point is None for point in points) or len({point.domain for point in points}) != 1:
            return None
        return points[0].domain, min(point.seconds for point in points), max(point.seconds for point in points)

    def timestamp(self, event):
        source = read_source_time(event)
        return source.normalized or source.original or ''

    def describe(self, events):
        interval = self.interval(events)
        kind = interval[0][0] if interval else 'unavailable'
        return {'kind': kind, 'utc_verified': kind == 'absolute',
                'clock': interval[0][1] if interval else None,
                'assumption': self.relative_scope.assumption if kind == 'relative' else None}
