/// Thrown by `ApiClient` on a non-success HTTP response or a network failure.
/// The message is always the user-presentable string and `statusCode` is the
/// HTTP status from the server if any.
class ApiFailure implements Exception {
  ApiFailure(this.message, {this.statusCode, this.data});

  final String message;
  final int? statusCode;

  /// Raw `data` object from the server response body, if any.
  final Object? data;

  bool get isUnauthorized => statusCode == 401 || statusCode == 403;

  @override
  String toString() => message;
}

class UnauthorizedFailure extends ApiFailure {
  UnauthorizedFailure(super.message, {super.statusCode, super.data});
}
