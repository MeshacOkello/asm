"""Daily streaks of accepted submissions. Pure functions only.

A day counts when it has at least one accepted submission, by the student's
own local calendar. The current streak still stands until today ends: a run
that reached yesterday is kept for the rest of today, and grows when today
gets an accepted submission.
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def zone(name):
    """The named IANA time zone, or UTC for a missing or unknown name."""
    if not isinstance(name, str) or not name or len(name) > 64:
        return timezone.utc
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return timezone.utc


def local_days(timestamps_ms, tz):
    """The distinct local dates of the given UTC millisecond timestamps."""
    return {datetime.fromtimestamp(ms / 1000, tz).date() for ms in timestamps_ms}


def streaks(accepted_ms, now_ms, tz):
    """{'current': days, 'longest': days} for accepted submission times."""
    days = local_days(accepted_ms, tz)
    longest = 0
    for day in days:
        if day - timedelta(days=1) in days:
            continue  # not the start of a run
        length = 1
        while day + timedelta(days=length) in days:
            length += 1
        longest = max(longest, length)

    today = datetime.fromtimestamp(now_ms / 1000, tz).date()
    cursor = today if today in days else today - timedelta(days=1)
    current = 0
    while cursor in days:
        current += 1
        cursor -= timedelta(days=1)
    return {'current': current, 'longest': longest, 'active_today': today in days}
