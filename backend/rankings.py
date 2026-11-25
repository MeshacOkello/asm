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
        'instructions': beats(0, attempt['instructions']),
        'memory_accesses': beats(1, attempt['memory_accesses']),
    }
