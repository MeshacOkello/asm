"""JSON responses shared by every endpoint: one shape for every failure."""
from flask import jsonify, request
from werkzeug.exceptions import HTTPException

import errors

MAX_SOURCE_BYTES = 1 << 20


def error_response(error, code):
    """One JSON shape for every failure, with the flat fields kept for clients
    that only read `error` and `error_parts`."""
    body = {
        'error': errors.legacy_text(error),
        'error_parts': errors.legacy_parts(error),
        'error_info': error,
        'status': {'state': 'error', 'kind': error['kind']},
    }
    if error.get('line') is not None:
        body['status']['line'] = error['line']
    return jsonify(body), code


def bad_request(message, *, suggestion=None):
    return error_response(
        errors.payload(errors.REQUEST, message, suggestion=suggestion), 400)


def parse_body():
    """Decode the request body, or say precisely how it was unreadable."""
    if not request.is_json:
        return None, 'The request must be sent as JSON with Content-Type: application/json.'
    try:
        data = request.get_json()
    except HTTPException:
        return None, 'The request body is not valid JSON.'
    if not isinstance(data, dict):
        return None, 'The request body must be a JSON object.'
    return data, None


def read_code(data, field='code'):
    """The source text in `field`, or a ready 400 response explaining why not."""
    source = data.get(field)
    if not isinstance(source, str):
        return None, bad_request(f'{field} must be a string', suggestion='Send the editor contents as code.')
    if len(source.encode('utf-8', errors='replace')) > MAX_SOURCE_BYTES:
        return None, bad_request(f'{field} must be at most {MAX_SOURCE_BYTES} bytes')
    return source, None
