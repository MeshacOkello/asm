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


def ranking(attempt, owner_id, accepted, threshold):
    """'Beats X%' for each metric, or None while too few students qualify.

    `attempt` is {'instructions', 'memory_accesses'}; `accepted` covers every
    accepted submission on the problem, the owner's included.
    """
    best = best_per_user(accepted)
    if len(best) < threshold:
        return None
    others = [result for user_id, result in best.items() if user_id != owner_id]
    if not others:
        return None

    def beats(index, value):
        worse = sum(1 for result in others if result[index] > value)
        return {'beats': worse * 100 // len(others), 'worse': worse}

    return {
        'users': len(best),
        'compared': len(others),
        'instructions': {**beats(0, attempt['instructions']),
                         'distribution': histogram([r[0] for r in others], attempt['instructions'])},
        'memory_accesses': {**beats(1, attempt['memory_accesses']),
                            'distribution': histogram([r[1] for r in others], attempt['memory_accesses'])},
    }


MAX_BARS = 24


def histogram(values, yours, bars=MAX_BARS):
    """Other students' best results as bars, with the one this attempt falls in.

    Each bar covers a whole-number range [low, high]; a narrow spread gets one
    bar per value. Counts only: no bar says which student it holds.
    """
    low = min(values + [yours])
    high = max(values + [yours])
    width = max(1, -(-(high - low + 1) // bars))
    count = (high - low) // width + 1
    buckets = [{'low': low + i * width, 'high': low + (i + 1) * width - 1, 'users': 0}
               for i in range(count)]
    for value in values:
        buckets[(value - low) // width]['users'] += 1
    return {'bars': buckets, 'yours': (yours - low) // width}
