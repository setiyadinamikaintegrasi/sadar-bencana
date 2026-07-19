package http

import (
	"regexp"
	"strings"
)

const nonProductionEventMarkerAlternation = `seed|demo|synthetic|mock|fixture|test`

const nonProductionEventMarkerSQLRegex = `(^|-)(` + nonProductionEventMarkerAlternation + `)(-|$)`

var nonAlphaNumericEventMarker = regexp.MustCompile(`[^a-z0-9]+`)

var nonProductionEventMarkerRegex = regexp.MustCompile(nonProductionEventMarkerSQLRegex)

func containsNonProductionEventMarker(value string) bool {
	normalized := strings.Trim(
		nonAlphaNumericEventMarker.ReplaceAllString(strings.ToLower(strings.TrimSpace(value)), "-"),
		"-",
	)
	return nonProductionEventMarkerRegex.MatchString(normalized)
}

func isNonProductionEvent(source, eventID string) bool {
	return containsNonProductionEventMarker(source) || containsNonProductionEventMarker(eventID)
}

func normalizedEventMarkerSQL(column string) string {
	return "lower(regexp_replace(btrim(COALESCE(" + column + ", '')), '[^a-zA-Z0-9]+', '-', 'g'))" +
		" ~ '" + nonProductionEventMarkerSQLRegex + "'"
}

func productionEventSQLPredicate(sourceColumn, eventIDColumn string) string {
	return "NOT (\n    " + normalizedEventMarkerSQL(sourceColumn) +
		"\n    OR " + normalizedEventMarkerSQL(eventIDColumn) + "\n  )"
}
