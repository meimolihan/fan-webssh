import 'package:flutter/material.dart';

import 'app_color_theme.dart';

OverlayEntry? _activeTopNoticeEntry;

void showTopNotice(
  BuildContext context,
  String message, {
  Duration duration = const Duration(seconds: 2),
}) {
  final previous = _activeTopNoticeEntry;
  if (previous?.mounted ?? false) {
    previous!.remove();
  }

  final overlay = Overlay.of(context, rootOverlay: true);
  late final OverlayEntry entry;
  entry = OverlayEntry(
    builder: (context) {
      final top = MediaQuery.viewPaddingOf(context).top + 14;
      return Positioned(
        top: top,
        left: 18,
        right: 18,
        child: IgnorePointer(
          child: Material(
            color: Colors.transparent,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
              decoration: BoxDecoration(
                color: context.colors.card,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: context.colors.strongBorder),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.14),
                    blurRadius: 18,
                    offset: const Offset(0, 8),
                  ),
                ],
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.info_outline_rounded,
                    size: 18,
                    color: context.colors.primary,
                  ),
                  const SizedBox(width: 9),
                  Expanded(
                    child: Text(
                      message,
                      style: TextStyle(
                        color: context.colors.text,
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        height: 1.35,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    },
  );

  _activeTopNoticeEntry = entry;
  overlay.insert(entry);
  Future<void>.delayed(duration, () {
    if (_activeTopNoticeEntry == entry && entry.mounted) {
      entry.remove();
      _activeTopNoticeEntry = null;
    }
  });
}
