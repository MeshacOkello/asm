"""Verdicts and totals for a challenge submission. Pure functions only.

A test passes on an exact match, and a submission is Accepted only when every
test passes. An accepted submission reports the instructions it executed and
the memory accesses it made over all tests, next to the reference solution's
totals for the same tests.
"""
ACCEPTED = 'accepted'
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


def better(candidate, current):
    """Fewer instructions wins; fewer memory accesses breaks a tie."""
    if current is None:
        return True
    return (candidate['instructions'], candidate['memory_accesses']) \
        < (current['instructions'], current['memory_accesses'])


def summarize(results, reference):
    """The verdict, pass count and, when accepted, the totals and the reference's."""
    outcome = verdict(results)
    summary = {
        'verdict': outcome,
        'passed': sum(1 for result in results if result['passed']),
        'total': len(results),
    }
    if outcome == ACCEPTED and reference is not None:
        summary['score'] = {**totals(results), 'reference': dict(reference)}
    return summary
