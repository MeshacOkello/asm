"""Verdicts, totals and medals for a challenge submission. Pure functions only.

A test passes on an exact match, and a submission is Accepted only when every
test passes. An accepted submission's instruction and memory-access totals
over all tests are compared with the reference solution's:

    gold    both totals at most the reference's
    silver  both totals at most 1.5 times the reference's
    bronze  any other accepted submission
"""
ACCEPTED = 'accepted'
GOLD, SILVER, BRONZE = 'gold', 'silver', 'bronze'
MEDALS = (GOLD, SILVER, BRONZE)
METRICS = ('instructions', 'memory_accesses')


def verdict(results):
    """'accepted', or the kind of the first failing test."""
    for result in results:
        if not result['passed']:
            return result['kind']
    return ACCEPTED


def totals(results):
    """Instructions and memory accesses summed over every result."""
    return {metric: sum(result[metric] for result in results) for metric in METRICS}


def medal(score, reference):
    """The medal for an accepted submission's totals against the reference's."""
    if all(score[metric] <= reference[metric] for metric in METRICS):
        return GOLD
    # 1.5x compared in integers, so no total is rounded across the line.
    if all(2 * score[metric] <= 3 * reference[metric] for metric in METRICS):
        return SILVER
    return BRONZE


def summarize(results, reference):
    """The verdict, pass count and, when accepted, the score and medal."""
    outcome = verdict(results)
    summary = {
        'verdict': outcome,
        'passed': sum(1 for result in results if result['passed']),
        'total': len(results),
    }
    if outcome == ACCEPTED and reference is not None:
        score = totals(results)
        summary['score'] = {**score, 'reference': dict(reference), 'medal': medal(score, reference)}
    return summary
