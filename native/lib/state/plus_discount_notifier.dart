// PLUS折扣功能已移除
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Plus discount model — placeholder after PLUS removal.
class PlusDiscount {
  final bool discount;
  final String content;

  const PlusDiscount({required this.discount, required this.content});

  factory PlusDiscount.fromJson(Map<String, dynamic> json) {
    return PlusDiscount(
      discount: json['discount'] as bool? ?? false,
      content: json['content'] as String? ?? '',
    );
  }
}
