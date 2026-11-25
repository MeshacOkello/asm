"""How an accepted attempt compares with other students. Pure functions only.

Each other student is represented by their best accepted result on the
problem: fewest instructions, then fewest memory accesses. An attempt "beats"
a student on a metric when that student's best is strictly worse on it, so a
tie beats no one. Rankings are shown only once enough distinct students have
an accepted submission; below that the reference comparison is used instead.
"""
import os

DEFAULT_MIN_USERS = 10


def min_users():
    try:
        value = int(os.environ.get('RANKING_MIN_USERS', DEFAULT_MIN_USERS))
    except ValueError:
        return DEFAULT_MIN_USERS
    return max(value, 1)


def best_per_user(accepted):
    """Each user's best (instructions, memory_accesses) among their accepted rows.

    `accepted` is an iterable of (user_id, instructions, memory_accesses).
    """
    best = {}
    for user_id, instructions, memory in accepted:
        key = (instructions, memory)
        if user_id not in best or key < best[user_id]:
            best[user_id] = key
    return best


METRICS = ('instructions', 'memory_accesses')


def ranking(attempt, owner_id, accepted, threshold, reference=None):
    """The chart for an accepted attempt and, with enough students, 'beats X%'.

    `attempt` and `reference` are {'instructions', 'memory_accesses'};
    `accepted` covers every accepted submission on the problem, the owner's
    included. Below the threshold the chart holds only this attempt and the
    reference, so no other student's result is shown.
    """
    best = best_per_user(accepted)
    others = [result for user_id, result in best.items() if user_id != owner_id]
    ranked = len(best) >= threshold and bool(others)
    result = {'ranked': ranked, 'threshold': threshold, 'users': len(best),
              'compared': len(others) if ranked else 0}
    for index, metric in enumerate(METRICS):
        values = [other[index] for other in others] if ranked else []
        entry = {'distribution': histogram(values, attempt[metric],
                                           None if reference is None else reference[metric])}
        if ranked:
            worse = sum(1 for value in values if value > attempt[metric])
            entry.update(beats=worse * 100 // len(values), worse=worse)
        result[metric] = entry
    return result


MAX_BARS = 60
# The fewest values a chart spans, so a lone result still sits on a baseline.
MIN_SPAN = 30


def _quartile(ordered, fraction):
    position = (len(ordered) - 1) * fraction
    below = int(position)
    above = min(below + 1, len(ordered) - 1)
    return ordered[below] + (ordered[above] - ordered[below]) * (position - below)


def histogram(values, yours, reference=None, bars=MAX_BARS):
    """Other students' best results as bars, with where this attempt and the
    reference fall.

    Results bunch up with a long tail, so the bars cover the bulk finely, up
    to Tukey's fence (Q3 + 1.5 IQR, and never below this attempt or the
    reference), and any results past it share one last bar marked as
    overflow. Counts only: no bar says which student it holds.
    """
    marks = [yours] + ([reference] if reference is not None else [])
    ordered = sorted(values)
    if ordered:
        q1, q3 = _quartile(ordered, 0.25), _quartile(ordered, 0.75)
        low = min(ordered[0], *marks)
        top = max(*marks, min(ordered[-1], int(q3 + 1.5 * (q3 - q1))))
    else:
        low, top = min(marks), max(marks)
    if top - low + 1 < MIN_SPAN:
        low = max(0, low - (MIN_SPAN - (top - low + 1)) // 2)
        top = max(top, low + MIN_SPAN - 1)
    width = max(1, -(-(top - low + 1) // bars))
    count = (top - low) // width + 1
    buckets = [{'low': low + i * width, 'high': min(top, low + (i + 1) * width - 1), 'users': 0}
               for i in range(count)]
    tail = [value for value in values if value > top]
    for value in values:
        if value <= top:
            buckets[(value - low) // width]['users'] += 1
    if tail:
        buckets.append({'low': top + 1, 'high': max(tail), 'users': len(tail), 'overflow': True})
    chart = {'bars': buckets, 'yours': (yours - low) // width}
    if reference is not None:
        chart['reference'] = (reference - low) // width
    return chart
