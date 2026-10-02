# Changelog
## 2026-10-02
- Second audit: OI penalty, not window king, flipped 10/16 over 10/30. Invalidation uses the wall below spot. Missing king_gex warns and is not treated as zero. Theta includes the rate term. Weekend and missing quote time warn. DTE outside 15-32 is noted.
- Audit fix: coerce chain fields, ET date default, limit always below ask, hard gates, drop directional +4, window king, spot required, gap warning.
- Initial skill. Read-only ATM pick for Zhao spot fills on slow names (GLD, GOOGL).
- Limit never lifts the ask. Negative gamma is not a short signal. No order path.
