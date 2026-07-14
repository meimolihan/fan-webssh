// PLUS功能已移除

/// Plus info model — placeholder after PLUS removal.
class PlusInfo {
  final bool isActive;
  final String expireDate;

  const PlusInfo({required this.isActive, required this.expireDate});

  factory PlusInfo.empty() => const PlusInfo(isActive: false, expireDate: '');

  factory PlusInfo.fromJson(Map<String, dynamic> json) {
    return PlusInfo(
      isActive: json['isActive'] as bool? ?? false,
      expireDate: json['expireDate'] as String? ?? '',
    );
  }
}

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
