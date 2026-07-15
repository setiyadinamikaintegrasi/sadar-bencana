package http

import (
	"context"
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"reflect"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

var adapterContracts = map[string]map[string][]string{
	"bmkg":             {"v1": {}},
	"bmkg_cap":         {"v1": {}},
	"bmkg_air_quality": {"v1": {"__warnings", "__observations"}},
	"inatews":          {"v1": {"event_group_id", "sent_at"}},
	"pvmbg":            {"v1": {"volcano_id", "level", "published_at"}},
	"bnpb":             {"v1": {"report_id", "observed_at"}},
	"inarisk":          {"v1": {"layer_id", "context_type", "data_vintage", "attribution"}},
}

const (
	maxCAPPreviewLinks             = 50
	maxOfficialSourceResponseBytes = 1 << 20
)

var errOfficialSourceResponseTooLarge = errors.New("official source response exceeds 1 MiB limit")

var (
	lookupOfficialSourceIPs   = net.DefaultResolver.LookupIPAddr
	dialOfficialSourceContext = (&net.Dialer{Timeout: 10 * time.Second}).DialContext
	officialSourceTLSConfig   = func(host string) *tls.Config {
		return &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}
	}
)

var nonPublicAddressRanges = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.88.99.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("64:ff9b:1::/48"),
	netip.MustParsePrefix("100::/64"),
	netip.MustParsePrefix("2001::/32"),
	netip.MustParsePrefix("2001:2::/48"),
	netip.MustParsePrefix("2001:10::/28"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"),
	netip.MustParsePrefix("3fff::/20"),
}

func isPublicSourceIP(ip net.IP) bool {
	address, ok := netip.AddrFromSlice(ip)
	if !ok {
		return false
	}
	address = address.Unmap()
	if !address.IsGlobalUnicast() || address.IsPrivate() || address.IsLoopback() ||
		address.IsLinkLocalUnicast() || address.IsLinkLocalMulticast() || address.IsMulticast() ||
		address.IsUnspecified() {
		return false
	}
	for _, blocked := range nonPublicAddressRanges {
		if blocked.Contains(address) {
			return false
		}
	}
	return true
}

func fetchOfficialSource(
	ctx context.Context,
	source, endpoint, userAgent, token string,
) (*http.Response, error) {
	if !approvedSourceEndpoint(source, endpoint) {
		return nil, errors.New("official API URL is missing or not approved")
	}
	parsed, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil {
		return nil, errors.New("official API URL is invalid")
	}
	hostname := parsed.Hostname()
	addresses, err := lookupOfficialSourceIPs(ctx, hostname)
	if err != nil {
		return nil, fmt.Errorf("DNS resolution failed for %s: %w", hostname, err)
	}
	if len(addresses) == 0 {
		return nil, fmt.Errorf("DNS resolution returned no addresses for %s", hostname)
	}
	for _, address := range addresses {
		if !isPublicSourceIP(address.IP) {
			return nil, fmt.Errorf("hostname %s resolves to blocked IP %s", hostname, address.IP.String())
		}
	}
	pinnedIP := addresses[0].IP.String()
	port := parsed.Port()
	if port == "" {
		port = "443"
	}
	pinnedAddress := net.JoinHostPort(pinnedIP, port)
	transport := &http.Transport{
		Proxy:             nil,
		DisableKeepAlives: true,
		TLSClientConfig:   officialSourceTLSConfig(hostname),
		DialContext: func(dialCtx context.Context, network, _ string) (net.Conn, error) {
			return dialOfficialSourceContext(dialCtx, network, pinnedAddress)
		},
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   10 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, err
	}
	request.Host = parsed.Host
	request.Header.Set("User-Agent", userAgent)
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	return client.Do(request)
}

func validateAdapterConfiguration(source, version string, mapping map[string]string) error {
	versions, ok := adapterContracts[source]
	if !ok {
		return fmt.Errorf("unsupported source %q", source)
	}
	if _, ok := versions[version]; !ok {
		return fmt.Errorf("adapter %s/%s is not registered", source, version)
	}
	for field, path := range mapping {
		if strings.TrimSpace(field) == "" || strings.TrimSpace(path) == "" {
			return errors.New("mapping keys and paths cannot be empty")
		}
		if field == "__records" {
			continue
		}
		for _, segment := range strings.Split(path, ".") {
			if strings.TrimSpace(segment) == "" {
				return fmt.Errorf("invalid mapping path %q", path)
			}
		}
	}
	return nil
}

func mappedValue(record map[string]any, path string) any {
	var current any = record
	for _, segment := range strings.Split(path, ".") {
		object, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current, ok = object[segment]
		if !ok {
			return nil
		}
	}
	return current
}

func mapOfficialRecord(record map[string]any, mapping map[string]string) map[string]any {
	result := make(map[string]any, len(record)+len(mapping))
	for key, value := range record {
		result[key] = value
	}
	for canonical, path := range mapping {
		if canonical != "__records" {
			result[canonical] = mappedValue(record, path)
		}
	}
	return result
}

func payloadRecords(payload any, mapping map[string]string) []map[string]any {
	value := payload
	if path := strings.TrimSpace(mapping["__records"]); path != "" {
		root, ok := payload.(map[string]any)
		if !ok {
			return nil
		}
		value = mappedValue(root, path)
	} else if root, ok := payload.(map[string]any); ok {
		for _, key := range []string{"data", "items", "results"} {
			if candidate, exists := root[key]; exists {
				value = candidate
				break
			}
		}
	}
	items, ok := value.([]any)
	if !ok {
		if item, single := value.(map[string]any); single {
			return []map[string]any{item}
		}
		return nil
	}
	records := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if record, ok := item.(map[string]any); ok {
			records = append(records, record)
		}
	}
	return records
}

func sensitivePreviewKey(key string) bool {
	normalized := strings.Map(func(character rune) rune {
		if unicode.IsLetter(character) || unicode.IsDigit(character) {
			return unicode.ToLower(character)
		}
		return -1
	}, key)
	for _, pattern := range []string{
		"secretkey",
		"accesskey",
		"privatekey",
		"basicauth",
		"authorizationheader",
		"clientsecret",
		"apikey",
		"apitoken",
		"accesstoken",
		"refreshtoken",
		"credentials",
		"cookies",
		"tokens",
		"passwords",
		"passwd",
	} {
		if strings.Contains(normalized, pattern) {
			return true
		}
	}
	if normalized == "auth" || normalized == "cookie" || normalized == "cookies" || normalized == "setcookie" {
		return true
	}
	for _, suffix := range []string{
		"apikey", "credential", "credentials", "authorization", "secret",
		"token", "password", "passwd", "cookie",
	} {
		if strings.HasSuffix(normalized, suffix) {
			return true
		}
	}
	return false
}

func sanitizePreviewString(value string) string {
	parsed, err := url.Parse(value)
	if err != nil {
		if strings.Contains(value, "@") && (strings.Contains(value, "://") || strings.HasPrefix(value, "//")) {
			return "[REDACTED]"
		}
		return value
	}
	if parsed.User == nil {
		return value
	}
	if parsed.Hostname() == "" {
		return "[REDACTED]"
	}
	parsed.User = nil
	return parsed.String()
}

func sanitizePreview(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, item := range typed {
			if sensitivePreviewKey(key) {
				result[key] = "[REDACTED]"
			} else {
				result[key] = sanitizePreview(item)
			}
		}
		return result
	case []any:
		limit := len(typed)
		if limit > 3 {
			limit = 3
		}
		result := make([]any, 0, limit)
		for _, item := range typed[:limit] {
			result = append(result, sanitizePreview(item))
		}
		return result
	case string:
		return sanitizePreviewString(typed)
	default:
		return value
	}
}

func readOfficialSourceResponse(body io.Reader) ([]byte, error) {
	payload, err := io.ReadAll(io.LimitReader(body, maxOfficialSourceResponseBytes+1))
	if err != nil {
		return nil, err
	}
	if len(payload) > maxOfficialSourceResponseBytes {
		return nil, errOfficialSourceResponseTooLarge
	}
	return payload, nil
}

func likelyXMLResponse(contentType string, body []byte) bool {
	lowerContentType := strings.ToLower(contentType)
	if strings.Contains(lowerContentType, "xml") || strings.Contains(lowerContentType, "rss") {
		return true
	}
	prefixLimit := min(len(body), 256)
	prefix := strings.ToLower(strings.TrimSpace(string(body[:prefixLimit])))
	return strings.HasPrefix(prefix, "<?xml") || strings.HasPrefix(prefix, "<rss")
}

func allowedCAPLink(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return false
	}
	return parsed.Scheme == "https" && approvedSourceHost("bmkg_cap", parsed.Hostname())
}

func previewCapIndex(body []byte, base sourcePreviewResult) (sourcePreviewResult, bool) {
	var rss struct {
		XMLName xml.Name `xml:"rss"`
		Items   []struct {
			Link string `xml:"link"`
		} `xml:"channel>item"`
	}
	if err := xml.Unmarshal(body, &rss); err != nil || rss.XMLName.Local != "rss" {
		return base, false
	}

	links := make([]string, 0, len(rss.Items))
	seen := map[string]struct{}{}
	for _, item := range rss.Items {
		link := strings.TrimSpace(item.Link)
		if link == "" || !allowedCAPLink(link) {
			continue
		}
		if _, exists := seen[link]; exists {
			continue
		}
		links = append(links, link)
		seen[link] = struct{}{}
		if len(links) >= maxCAPPreviewLinks {
			break
		}
	}

	base.Errors = []string{}
	base.MappedSample = []map[string]any{}
	base.RawSample = links
	base.RecordCount = len(links)
	base.ValidCount = len(links)
	base.InvalidCount = 0
	base.ContractValid = base.Reachable && len(links) > 0
	if len(links) == 0 {
		base.Errors = append(base.Errors, "RSS CAP index does not contain approved BMKG CAP links")
	}
	return base, true
}

type sourcePreviewDraft struct {
	Mode           string            `json:"mode"`
	CustomAPIURL   *string           `json:"custom_api_url"`
	APIToken       *string           `json:"api_token"`
	AdapterVersion string            `json:"adapter_version"`
	FieldMapping   map[string]string `json:"field_mapping"`
}

type sourceRuntimeConfig struct {
	Source         string
	Mode           string
	RunMode        string
	Endpoint       string
	Token          string
	AdapterVersion string
	FieldMapping   map[string]string
	ConfigVersion  int
}

type sourcePreviewResult struct {
	Reachable        bool             `json:"reachable"`
	ContractValid    bool             `json:"contract_valid"`
	StatusCode       int              `json:"status_code"`
	ContentType      string           `json:"content_type"`
	AdapterVersion   string           `json:"adapter_version"`
	RecordCount      int              `json:"record_count"`
	ValidCount       int              `json:"valid_count"`
	InvalidCount     int              `json:"invalid_count"`
	WarningCount     int              `json:"warning_count"`
	ObservationCount int              `json:"observation_count"`
	Errors           []string         `json:"errors"`
	RawSample        any              `json:"raw_sample"`
	MappedSample     []map[string]any `json:"mapped_sample"`
	PayloadStored    bool             `json:"payload_stored"`
	LatencyMS        int64            `json:"latency_ms"`
}

func airQualityCollection(payload map[string]any, mapping map[string]string, key string) ([]any, bool) {
	path := strings.TrimSpace(mapping[key])
	if path == "" {
		path = strings.TrimPrefix(key, "__")
	}
	value := mappedValue(payload, path)
	items, ok := value.([]any)
	return items, ok
}

func mapAirQualityRecord(record map[string]any, prefix string, mapping map[string]string) map[string]any {
	result := make(map[string]any, len(record))
	for key, value := range record {
		result[key] = value
	}
	fieldPrefix := prefix + "."
	for canonical, path := range mapping {
		if strings.HasPrefix(canonical, fieldPrefix) {
			result[strings.TrimPrefix(canonical, fieldPrefix)] = mappedValue(record, path)
		}
	}
	return result
}

var airQualitySeverity = map[string]string{
	"Tidak Sehat":        "Moderate",
	"Sangat Tidak Sehat": "High",
	"Berbahaya":          "Critical",
}

var airQualityObservationCategories = map[string]struct{}{
	"Baik": {}, "Sedang": {}, "Tidak Sehat": {}, "Sangat Tidak Sehat": {}, "Berbahaya": {},
}

func requiredAirQualityString(record map[string]any, field string) (string, error) {
	value, ok := record[field]
	if !ok {
		return "", fmt.Errorf("%s is required", field)
	}
	text, ok := value.(string)
	if !ok || strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("%s must be a non-empty string", field)
	}
	return strings.TrimSpace(text), nil
}

func requiredAirQualityIdentifier(record map[string]any, field string) (string, error) {
	value, err := requiredAirQualityString(record, field)
	if err != nil {
		return "", err
	}
	if utf8.RuneCountInString(value) > 255 {
		return "", fmt.Errorf("%s must be at most 255 characters", field)
	}
	return value, nil
}

func validateOptionalAirQualityStrings(record map[string]any, fields ...string) error {
	for _, field := range fields {
		if value, exists := record[field]; exists && value != nil {
			if _, ok := value.(string); !ok {
				return fmt.Errorf("%s must be a string or null", field)
			}
		}
	}
	return nil
}

func airQualityNumber(value any) (float64, bool) {
	var number float64
	switch typed := value.(type) {
	case float64:
		number = typed
	case float32:
		number = float64(typed)
	case int:
		number = float64(typed)
	case int8:
		number = float64(typed)
	case int16:
		number = float64(typed)
	case int32:
		number = float64(typed)
	case int64:
		number = float64(typed)
	case uint:
		number = float64(typed)
	case uint8:
		number = float64(typed)
	case uint16:
		number = float64(typed)
	case uint32:
		number = float64(typed)
	case uint64:
		number = float64(typed)
	case string:
		var err error
		number, err = strconv.ParseFloat(strings.TrimSpace(typed), 64)
		if err != nil {
			return 0, false
		}
	default:
		return 0, false
	}
	return number, !math.IsNaN(number) && !math.IsInf(number, 0)
}

func validateAirQualityCoordinates(record map[string]any) error {
	latitude, hasLatitude := record["latitude"]
	longitude, hasLongitude := record["longitude"]
	latitudeSet := hasLatitude && latitude != nil
	longitudeSet := hasLongitude && longitude != nil
	if latitudeSet != longitudeSet {
		return errors.New("latitude and longitude must both be set or both be null")
	}
	if !latitudeSet {
		return nil
	}
	latitudeNumber, latitudeOK := airQualityNumber(latitude)
	longitudeNumber, longitudeOK := airQualityNumber(longitude)
	if !latitudeOK || latitudeNumber < -90 || latitudeNumber > 90 {
		return errors.New("latitude must be a number between -90 and 90")
	}
	if !longitudeOK || longitudeNumber < -180 || longitudeNumber > 180 {
		return errors.New("longitude must be a number between -180 and 180")
	}
	return nil
}

func decimalComponent(value string, maximum int) (int, bool) {
	if len(value) != 2 {
		return 0, false
	}
	number, err := strconv.Atoi(value)
	return number, err == nil && number >= 0 && number <= maximum
}

func validISOWeekDate(value string) bool {
	var yearText, weekText, dayText string
	switch len(value) {
	case len("2006-W01-1"):
		if value[4:6] != "-W" || value[8] != '-' {
			return false
		}
		yearText, weekText, dayText = value[:4], value[6:8], value[9:]
	case len("2006W011"):
		if value[4] != 'W' {
			return false
		}
		yearText, weekText, dayText = value[:4], value[5:7], value[7:]
	default:
		return false
	}
	year, yearErr := strconv.Atoi(yearText)
	week, weekErr := strconv.Atoi(weekText)
	day, dayErr := strconv.Atoi(dayText)
	if yearErr != nil || weekErr != nil || dayErr != nil || year < 1 || week < 1 || week > 53 || day < 1 || day > 7 {
		return false
	}
	jan4 := time.Date(year, time.January, 4, 0, 0, 0, 0, time.UTC)
	daysSinceMonday := (int(jan4.Weekday()) + 6) % 7
	date := jan4.AddDate(0, 0, -daysSinceMonday+(week-1)*7+(day-1))
	isoYear, isoWeek := date.ISOWeek()
	return isoYear == year && isoWeek == week
}

func isoDatePrefixLength(value string) (int, bool) {
	if len(value) >= len("2006-W01-1") && value[4:6] == "-W" {
		date := value[:len("2006-W01-1")]
		return len(date), validISOWeekDate(date)
	}
	if len(value) >= len("2006W011") && value[4] == 'W' {
		date := value[:len("2006W011")]
		return len(date), validISOWeekDate(date)
	}
	if len(value) >= len("2006-01-02") && value[4] == '-' {
		date := value[:len("2006-01-02")]
		year, yearErr := strconv.Atoi(date[:4])
		_, err := time.Parse("2006-01-02", date)
		return len(date), yearErr == nil && year >= 1 && err == nil
	}
	if len(value) >= len("20060102") {
		date := value[:len("20060102")]
		year, yearErr := strconv.Atoi(date[:4])
		_, err := time.Parse("20060102", date)
		return len(date), yearErr == nil && year >= 1 && err == nil
	}
	return 0, false
}

func splitISOFraction(value string) (string, string, bool) {
	index := strings.IndexAny(value, ".,")
	if index < 0 {
		return value, "", true
	}
	if index == len(value)-1 || strings.IndexAny(value[index+1:], ".,") >= 0 {
		return "", "", false
	}
	for _, character := range value[index+1:] {
		if character < '0' || character > '9' {
			return "", "", false
		}
	}
	return value[:index], value[index+1:], true
}

func validISOClock(value string) bool {
	clock, fraction, ok := splitISOFraction(value)
	if !ok {
		return false
	}
	var parts []string
	if strings.Contains(clock, ":") {
		parts = strings.Split(clock, ":")
		if len(parts) < 1 || len(parts) > 3 {
			return false
		}
	} else {
		if len(clock) != 2 && len(clock) != 4 && len(clock) != 6 {
			return false
		}
		for index := 0; index < len(clock); index += 2 {
			parts = append(parts, clock[index:index+2])
		}
	}
	if fraction != "" && len(parts) != 3 {
		return false
	}
	hour, hourOK := decimalComponent(parts[0], 24)
	if !hourOK {
		return false
	}
	minute, second := 0, 0
	if len(parts) > 1 {
		var minuteOK bool
		minute, minuteOK = decimalComponent(parts[1], 59)
		if !minuteOK {
			return false
		}
	}
	if len(parts) > 2 {
		var secondOK bool
		second, secondOK = decimalComponent(parts[2], 59)
		if !secondOK {
			return false
		}
	}
	if hour == 24 {
		return minute == 0 && second == 0 && (fraction == "" || strings.Trim(fraction, "0") == "")
	}
	return true
}

func validISOOffset(value string) bool {
	if value == "Z" {
		return true
	}
	if len(value) < 3 || (value[0] != '+' && value[0] != '-') {
		return false
	}
	offset, fraction, ok := splitISOFraction(value[1:])
	if !ok {
		return false
	}
	var parts []string
	if strings.Contains(offset, ":") {
		parts = strings.Split(offset, ":")
		if len(parts) < 1 || len(parts) > 3 {
			return false
		}
	} else {
		if len(offset) != 2 && len(offset) != 4 && len(offset) != 6 {
			return false
		}
		for index := 0; index < len(offset); index += 2 {
			parts = append(parts, offset[index:index+2])
		}
	}
	if fraction != "" && len(parts) != 3 {
		return false
	}
	if _, ok := decimalComponent(parts[0], 23); !ok {
		return false
	}
	if len(parts) > 1 {
		if _, ok := decimalComponent(parts[1], 59); !ok {
			return false
		}
	}
	if len(parts) > 2 {
		if _, ok := decimalComponent(parts[2], 59); !ok {
			return false
		}
	}
	return true
}

func pythonISOAwareTimestamp(value string) bool {
	dateLength, ok := isoDatePrefixLength(value)
	if !ok || len(value) <= dateLength {
		return false
	}
	_, separatorLength := utf8.DecodeRuneInString(value[dateLength:])
	if separatorLength == 0 || len(value) <= dateLength+separatorLength {
		return false
	}
	timeAndZone := value[dateLength+separatorLength:]
	zoneIndex := strings.IndexAny(timeAndZone, "+-")
	if zoneIndex < 0 && strings.HasSuffix(timeAndZone, "Z") {
		zoneIndex = len(timeAndZone) - 1
	}
	if zoneIndex <= 0 {
		return false
	}
	return validISOClock(timeAndZone[:zoneIndex]) && validISOOffset(timeAndZone[zoneIndex:])
}

func validateAirQualityTime(record map[string]any, field string) error {
	value, exists := record[field]
	text, ok := value.(string)
	if !exists {
		return fmt.Errorf("%s is required", field)
	}
	if !ok || text == "" || !pythonISOAwareTimestamp(text) {
		return fmt.Errorf("%s must be a timezone-aware ISO timestamp", field)
	}
	return nil
}

func validateAirQualityBMKGURL(record map[string]any, field string) error {
	value, err := requiredAirQualityString(record, field)
	if err != nil {
		return err
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || parsed.Hostname() == "" ||
		(parsed.Port() != "" && parsed.Port() != "443") ||
		!approvedSourceHost("bmkg_air_quality", strings.TrimSuffix(parsed.Hostname(), ".")) {
		return fmt.Errorf("%s must use an official BMKG HTTPS URL", field)
	}
	return nil
}

func validateAirQualityGeometry(value any) error {
	geometry, ok := value.(map[string]any)
	if !ok {
		return errors.New("area_geojson must be an object or null")
	}
	geometryType, ok := geometry["type"].(string)
	if !ok || (geometryType != "Polygon" && geometryType != "MultiPolygon") {
		return errors.New("area_geojson must be a Polygon or MultiPolygon")
	}
	coordinates, ok := geometry["coordinates"].([]any)
	if !ok {
		return errors.New("area_geojson coordinates must be an array")
	}
	polygons := coordinates
	if geometryType == "Polygon" {
		polygons = []any{coordinates}
	}
	for _, rawPolygon := range polygons {
		polygon, ok := rawPolygon.([]any)
		if !ok || len(polygon) == 0 {
			return errors.New("area_geojson polygon must contain rings")
		}
		for _, rawRing := range polygon {
			ring, ok := rawRing.([]any)
			if !ok || len(ring) < 4 || !reflect.DeepEqual(ring[0], ring[len(ring)-1]) {
				return errors.New("area_geojson rings must be closed")
			}
			for _, rawPoint := range ring {
				point, ok := rawPoint.([]any)
				if !ok || len(point) < 2 {
					return errors.New("area_geojson positions must contain longitude and latitude")
				}
				longitude, longitudeOK := airQualityJSONNumber(point[0])
				latitude, latitudeOK := airQualityJSONNumber(point[1])
				if !longitudeOK || !latitudeOK {
					return errors.New("area_geojson positions must be numeric")
				}
				if longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90 {
					return errors.New("area_geojson position is outside valid bounds")
				}
			}
		}
	}
	return nil
}

func airQualityJSONNumber(value any) (float64, bool) {
	if _, isString := value.(string); isString {
		return 0, false
	}
	return airQualityNumber(value)
}

func validateAirQualityRecord(record map[string]any, kind string) error {
	if err := validateAirQualityCoordinates(record); err != nil {
		return err
	}
	if err := validateAirQualityBMKGURL(record, "source_url"); err != nil {
		return err
	}
	if kind == "warning" {
		if _, err := requiredAirQualityIdentifier(record, "source_alert_id"); err != nil {
			return err
		}
		for field, allowed := range map[string]map[string]struct{}{
			"message_type": {"alert": {}, "update": {}, "cancel": {}},
			"status":       {"active": {}, "expired": {}, "cancelled": {}},
		} {
			value := map[string]string{"message_type": "alert", "status": "active"}[field]
			if raw, exists := record[field]; exists {
				var ok bool
				value, ok = raw.(string)
				if !ok {
					return fmt.Errorf("%s must be a string", field)
				}
			}
			if _, ok := allowed[value]; !ok {
				return fmt.Errorf("%s has an unsupported value", field)
			}
		}
		for _, field := range []string{"sent_at", "effective_at", "expires_at"} {
			if err := validateAirQualityTime(record, field); err != nil {
				return err
			}
		}
		category, err := requiredAirQualityString(record, "category")
		if err != nil {
			return err
		}
		severity, ok := airQualitySeverity[category]
		if !ok {
			return errors.New("category is not extreme")
		}
		record["severity"] = severity
		if err := validateOptionalAirQualityStrings(record, "area_name", "headline", "description"); err != nil {
			return err
		}
		if geometry, exists := record["area_geojson"]; exists && geometry != nil {
			if err := validateAirQualityGeometry(geometry); err != nil {
				return err
			}
		}
		return nil
	}

	if _, err := requiredAirQualityIdentifier(record, "station_id"); err != nil {
		return err
	}
	if _, err := requiredAirQualityString(record, "station_name"); err != nil {
		return err
	}
	value, exists := record["value"]
	number, numeric := airQualityNumber(value)
	if !exists || !numeric || number < 0 {
		return errors.New("value must be a non-negative number")
	}
	unit, err := requiredAirQualityString(record, "unit")
	if err != nil {
		return err
	}
	switch strings.ToLower(unit) {
	case "ug/m3", "µg/m³", "μg/m³":
	default:
		return errors.New("unit must be micrograms per cubic meter")
	}
	category, err := requiredAirQualityString(record, "category")
	if err != nil {
		return err
	}
	if _, ok := airQualityObservationCategories[category]; !ok {
		return errors.New("category has an unsupported value")
	}
	return validateAirQualityTime(record, "observed_at")
}

func previewAirQualityPayload(payload any, mapping map[string]string, base sourcePreviewResult) sourcePreviewResult {
	base.Errors = []string{}
	base.MappedSample = []map[string]any{}
	base.PayloadStored = false
	base.RawSample = sanitizePreview(payload)
	root, ok := payload.(map[string]any)
	if !ok {
		base.InvalidCount = 1
		base.Errors = append(base.Errors, "air-quality payload must be an object")
		return base
	}

	warnings, warningsOK := airQualityCollection(root, mapping, "__warnings")
	observations, observationsOK := airQualityCollection(root, mapping, "__observations")
	if !warningsOK {
		base.InvalidCount++
		base.Errors = append(base.Errors, "warnings must be an array")
	}
	if !observationsOK {
		base.InvalidCount++
		base.Errors = append(base.Errors, "observations must be an array")
	}
	base.WarningCount = len(warnings)
	base.ObservationCount = len(observations)
	base.RecordCount = base.WarningCount + base.ObservationCount

	collections := []struct {
		name  string
		items []any
	}{
		{name: "warning", items: warnings},
		{name: "observation", items: observations},
	}
	for _, collection := range collections {
		for index, item := range collection.items {
			record, valid := item.(map[string]any)
			if !valid {
				base.InvalidCount++
				if len(base.Errors) < 10 {
					base.Errors = append(base.Errors, fmt.Sprintf("%s %d must be an object", collection.name, index))
				}
				continue
			}
			mapped := mapAirQualityRecord(record, collection.name, mapping)
			if err := validateAirQualityRecord(mapped, collection.name); err != nil {
				base.InvalidCount++
				if len(base.Errors) < 10 {
					base.Errors = append(base.Errors, fmt.Sprintf("%s %d: %v", collection.name, index, err))
				}
			} else {
				base.ValidCount++
			}
			if len(base.MappedSample) < 3 {
				base.MappedSample = append(base.MappedSample, sanitizePreview(mapped).(map[string]any))
			}
		}
	}
	base.ContractValid = warningsOK && observationsOK && base.Reachable &&
		base.StatusCode >= 200 && base.StatusCode < 300 && base.RecordCount > 0 &&
		base.InvalidCount == 0
	return base
}

func loadSourceRuntimeConfig(
	db *sql.DB,
	source, encryptionKey string,
	draft *sourcePreviewDraft,
) (sourceRuntimeConfig, error) {
	var config sourceRuntimeConfig
	var defaultURL, customURL, token sql.NullString
	var mapping []byte
	err := db.QueryRow(`
		SELECT source_name, mode, run_mode, default_api_url, custom_api_url,
		       adapter_version, field_mapping, config_version,
		       CASE WHEN api_token_encrypted IS NOT NULL AND $2 <> ''
		         THEN pgp_sym_decrypt(api_token_encrypted,$2) END
		FROM official_source_settings WHERE source_name=$1`,
		source, encryptionKey,
	).Scan(&config.Source, &config.Mode, &config.RunMode, &defaultURL, &customURL,
		&config.AdapterVersion, &mapping, &config.ConfigVersion, &token)
	if err != nil {
		return config, err
	}
	config.FieldMapping = map[string]string{}
	_ = json.Unmarshal(mapping, &config.FieldMapping)
	config.Token = token.String
	if config.Mode == "custom_api" || (config.Mode == "auto" && customURL.Valid) {
		config.Endpoint = customURL.String
	} else {
		config.Endpoint = defaultURL.String
	}
	if draft != nil {
		if draft.Mode != "" {
			config.Mode = draft.Mode
		}
		if draft.CustomAPIURL != nil {
			config.Endpoint = strings.TrimSpace(*draft.CustomAPIURL)
		}
		if draft.APIToken != nil && *draft.APIToken != "" {
			config.Token = *draft.APIToken
		}
		if draft.AdapterVersion != "" {
			config.AdapterVersion = strings.TrimSpace(draft.AdapterVersion)
		}
		if draft.FieldMapping != nil {
			config.FieldMapping = draft.FieldMapping
		}
	}
	return config, nil
}

func executeSourcePreview(ctx *gin.Context, config sourceRuntimeConfig) (sourcePreviewResult, error) {
	result := sourcePreviewResult{
		AdapterVersion: config.AdapterVersion,
		Errors:         []string{},
		MappedSample:   []map[string]any{},
		PayloadStored:  false,
	}
	if err := validateAdapterConfiguration(config.Source, config.AdapterVersion, config.FieldMapping); err != nil {
		return result, err
	}
	if !approvedSourceEndpoint(config.Source, config.Endpoint) {
		return result, errors.New("official API URL is missing or not approved")
	}
	started := time.Now()
	response, err := fetchOfficialSource(
		ctx.Request.Context(), config.Source, config.Endpoint,
		"SadarBencana/0.4 source-preview", config.Token,
	)
	if err != nil {
		return result, err
	}
	defer response.Body.Close()
	result.StatusCode = response.StatusCode
	result.ContentType = response.Header.Get("Content-Type")
	result.Reachable = response.StatusCode >= 200 && response.StatusCode < 500
	result.LatencyMS = time.Since(started).Milliseconds()
	body, err := readOfficialSourceResponse(response.Body)
	if err != nil {
		return result, err
	}
	var payload any
	if err := json.Unmarshal(body, &payload); err != nil {
		if config.Source == "bmkg_cap" && likelyXMLResponse(result.ContentType, body) {
			if capResult, ok := previewCapIndex(body, result); ok {
				return capResult, nil
			}
		}
		result.Errors = append(result.Errors, "response is not valid JSON")
		result.RawSample = nil
		return result, nil
	}
	if config.Source == "bmkg_air_quality" {
		return previewAirQualityPayload(payload, config.FieldMapping, result), nil
	}
	result.RawSample = sanitizePreview(payload)
	records := payloadRecords(payload, config.FieldMapping)
	result.RecordCount = len(records)
	required := adapterContracts[config.Source][config.AdapterVersion]
	for index, raw := range records {
		mapped := mapOfficialRecord(raw, config.FieldMapping)
		missing := make([]string, 0)
		for _, field := range required {
			if value, exists := mapped[field]; !exists || value == nil || strings.TrimSpace(fmt.Sprint(value)) == "" {
				missing = append(missing, field)
			}
		}
		if len(missing) > 0 {
			result.InvalidCount++
			if len(result.Errors) < 10 {
				result.Errors = append(result.Errors, fmt.Sprintf("record %d missing: %s", index, strings.Join(missing, ", ")))
			}
		} else {
			result.ValidCount++
		}
		if len(result.MappedSample) < 3 {
			result.MappedSample = append(result.MappedSample, sanitizePreview(mapped).(map[string]any))
		}
	}
	result.ContractValid = response.StatusCode >= 200 && response.StatusCode < 300 &&
		result.RecordCount > 0 && result.InvalidCount == 0
	return result, nil
}

func writeSourceAudit(db *sql.DB, source, action, actor string, version int, success bool, metadata any) {
	payload, _ := json.Marshal(metadata)
	_, _ = db.Exec(`
		INSERT INTO official_source_setting_audit
		  (source_name, action, actor_email, config_version, success, metadata)
		VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
		source, action, actor, version, success, string(payload))
}

func OfficialSourcePreview(db *sql.DB, encryptionKey string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil || !requireSettingsAdmin(c, db) {
			if db == nil {
				dbUnavailable(c)
			}
			return
		}
		source := strings.TrimSpace(c.Param("source"))
		var draft sourcePreviewDraft
		if err := c.ShouldBindJSON(&draft); err != nil && err != io.EOF {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
			return
		}
		config, err := loadSourceRuntimeConfig(db, source, encryptionKey, &draft)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "source_not_found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_query_failed"})
			return
		}
		result, previewErr := executeSourcePreview(c, config)
		writeSourceAudit(db, source, "preview", AuthEmail(c), config.ConfigVersion, previewErr == nil && result.ContractValid,
			gin.H{"record_count": result.RecordCount, "warning_count": result.WarningCount,
				"observation_count": result.ObservationCount, "valid_count": result.ValidCount,
				"payload_stored": false})
		if previewErr != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "preview_failed", "message": previewErr.Error(), "data": result})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": result})
	}
}

func OfficialSourceDryRun(db *sql.DB, encryptionKey string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil || !requireSettingsAdmin(c, db) {
			if db == nil {
				dbUnavailable(c)
			}
			return
		}
		source := strings.TrimSpace(c.Param("source"))
		config, err := loadSourceRuntimeConfig(db, source, encryptionKey, nil)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "source_not_found"})
			return
		}
		if config.RunMode != "dry_run" {
			c.JSON(http.StatusConflict, gin.H{"error": "dry_run_mode_required"})
			return
		}
		result, previewErr := executeSourcePreview(c, config)
		valid := previewErr == nil && result.ContractValid
		updateResult, updateErr := db.ExecContext(c.Request.Context(), `
			UPDATE official_source_settings SET last_dry_run_at=now(),
			  last_dry_run_valid=$2, last_dry_run_config_version=config_version
			WHERE source_name=$1 AND config_version=$3 AND run_mode='dry_run'`,
			source, valid, config.ConfigVersion)
		evidenceRecorded := false
		if updateErr == nil {
			rowsAffected, rowsErr := updateResult.RowsAffected()
			if rowsErr != nil {
				updateErr = rowsErr
			} else {
				evidenceRecorded = rowsAffected == 1
			}
		}
		writeSourceAudit(db, source, "dry_run", AuthEmail(c), config.ConfigVersion, valid && evidenceRecorded,
			gin.H{"record_count": result.RecordCount, "warning_count": result.WarningCount,
				"observation_count": result.ObservationCount, "valid_count": result.ValidCount,
				"invalid_count": result.InvalidCount, "evidence_recorded": evidenceRecorded})
		if updateErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "dry_run_state_failed"})
			return
		}
		if !evidenceRecorded {
			c.JSON(http.StatusConflict, gin.H{"error": "stale_config_version"})
			return
		}
		if previewErr != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "dry_run_failed", "message": previewErr.Error(), "data": result})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": result})
	}
}

func OfficialSourceActivate(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil || !requireSettingsAdmin(c, db) {
			if db == nil {
				dbUnavailable(c)
			}
			return
		}
		source := strings.TrimSpace(c.Param("source"))
		tx, err := db.BeginTx(c.Request.Context(), nil)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_transaction_failed"})
			return
		}
		defer tx.Rollback()
		var version int
		err = tx.QueryRowContext(c.Request.Context(), `
			WITH updated AS (
			  UPDATE official_source_settings SET enabled=TRUE, run_mode='active',
			    config_version=config_version+1, updated_by=$2, updated_at=now()
			  WHERE source_name=$1 AND run_mode='dry_run'
			    AND last_dry_run_valid=TRUE
			    AND last_dry_run_config_version=config_version
			  RETURNING *
			)
			INSERT INTO official_source_setting_versions
			  (source_name, version, configuration, api_token_encrypted, changed_by, change_reason)
			SELECT source_name, config_version,
			  jsonb_build_object(
			    'enabled',enabled,'run_mode',run_mode,'mode',mode,
			    'adapter_version',adapter_version,'field_mapping',field_mapping,
			    'custom_api_url',custom_api_url,'poll_interval_seconds',poll_interval_seconds,
			    'expected_interval_seconds',expected_interval_seconds
			  ),
			  api_token_encrypted,$2,'Activated after successful dry run'
			FROM updated RETURNING version`,
			source, AuthEmail(c)).Scan(&version)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusConflict, gin.H{"error": "successful_current_dry_run_required"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "activation_failed"})
			return
		}
		_, err = tx.ExecContext(c.Request.Context(), `
			INSERT INTO official_source_setting_audit
			  (source_name,action,actor_email,config_version,success,metadata)
			VALUES ($1,'activate',$2,$3,TRUE,'{}'::jsonb)`,
			source, AuthEmail(c), version)
		if err != nil || tx.Commit() != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "activation_audit_failed"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"source_name": source, "run_mode": "active", "config_version": version}})
	}
}

type sourceRollbackBody struct {
	Version int    `json:"version"`
	Reason  string `json:"reason"`
}

func OfficialSourceRollback(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil || !requireSettingsAdmin(c, db) {
			if db == nil {
				dbUnavailable(c)
			}
			return
		}
		source := strings.TrimSpace(c.Param("source"))
		var body sourceRollbackBody
		if c.ShouldBindJSON(&body) != nil || body.Version < 1 || strings.TrimSpace(body.Reason) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "version_and_reason_required"})
			return
		}
		tx, err := db.BeginTx(c.Request.Context(), nil)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_transaction_failed"})
			return
		}
		defer tx.Rollback()
		var version int
		err = tx.QueryRowContext(c.Request.Context(), `
			WITH target AS (
			  SELECT configuration, api_token_encrypted,
			    COALESCE((configuration->>'enabled')::boolean,FALSE) AS target_enabled,
			    COALESCE(
			      configuration->>'run_mode',
			      CASE WHEN COALESCE((configuration->>'enabled')::boolean,FALSE)
			        THEN 'active' ELSE 'disabled' END
			    ) AS target_run_mode
			  FROM official_source_setting_versions
			  WHERE source_name=$1 AND version=$2
			), updated AS (
			  UPDATE official_source_settings s SET
			    enabled=t.target_enabled AND t.target_run_mode <> 'disabled',
			    run_mode=CASE
			      WHEN t.target_enabled AND t.target_run_mode <> 'disabled' THEN 'dry_run'
			      ELSE 'disabled'
			    END,
			    mode=COALESCE(t.configuration->>'mode','auto'),
			    adapter_version=COALESCE(t.configuration->>'adapter_version','v1'),
			    field_mapping=COALESCE(t.configuration->'field_mapping','{}'::jsonb),
			    custom_api_url=NULLIF(t.configuration->>'custom_api_url',''),
			    poll_interval_seconds=COALESCE((t.configuration->>'poll_interval_seconds')::int,600),
			    expected_interval_seconds=COALESCE((t.configuration->>'expected_interval_seconds')::int,600),
			    api_token_encrypted=t.api_token_encrypted,
			    config_version=s.config_version+1,
			    last_dry_run_at=NULL,last_dry_run_valid=NULL,last_dry_run_config_version=NULL,
			    updated_by=$3,updated_at=now()
			  FROM target t WHERE s.source_name=$1 RETURNING s.*
			)
			INSERT INTO official_source_setting_versions
			  (source_name,version,configuration,api_token_encrypted,changed_by,change_reason)
			SELECT source_name,config_version,
			  jsonb_build_object(
			    'enabled',enabled,'run_mode',run_mode,'mode',mode,
			    'adapter_version',adapter_version,'field_mapping',field_mapping,
			    'custom_api_url',custom_api_url,'poll_interval_seconds',poll_interval_seconds,
			    'expected_interval_seconds',expected_interval_seconds
			  ),
			  api_token_encrypted,$3,$4
			FROM updated RETURNING version`,
			source, body.Version, AuthEmail(c), strings.TrimSpace(body.Reason)).Scan(&version)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "version_not_found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "rollback_failed", "message": err.Error()})
			return
		}
		_, err = tx.ExecContext(c.Request.Context(), `
			INSERT INTO official_source_setting_audit
			  (source_name,action,actor_email,config_version,success,metadata)
			VALUES ($1,'rollback',$2,$3,TRUE,
			  jsonb_build_object('target_version',$4::int,'reason',$5::text))`,
			source, AuthEmail(c), version, body.Version, strings.TrimSpace(body.Reason))
		if err != nil || tx.Commit() != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "rollback_audit_failed"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"source_name": source, "config_version": version}})
	}
}

func OfficialSourceHistory(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil || !requireSettingsAdmin(c, db) {
			if db == nil {
				dbUnavailable(c)
			}
			return
		}
		source := strings.TrimSpace(c.Param("source"))
		rows, err := db.QueryContext(c.Request.Context(), `
			SELECT version,configuration,changed_by,change_reason,created_at
			FROM official_source_setting_versions
			WHERE source_name=$1 ORDER BY version DESC LIMIT 20`, source)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "history_query_failed"})
			return
		}
		defer rows.Close()
		versions := make([]gin.H, 0)
		for rows.Next() {
			var version int
			var configuration []byte
			var actor string
			var reason sql.NullString
			var created time.Time
			if rows.Scan(&version, &configuration, &actor, &reason, &created) != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "history_scan_failed"})
				return
			}
			var config any
			_ = json.Unmarshal(configuration, &config)
			versions = append(versions, gin.H{
				"version": version, "configuration": config, "changed_by": actor,
				"change_reason": nullStringPtr(reason), "created_at": created,
			})
		}
		auditRows, err := db.QueryContext(c.Request.Context(), `
			SELECT action,actor_email,config_version,success,metadata,created_at
			FROM official_source_setting_audit
			WHERE source_name=$1 ORDER BY created_at DESC LIMIT 50`, source)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "audit_query_failed"})
			return
		}
		defer auditRows.Close()
		audit := make([]gin.H, 0)
		for auditRows.Next() {
			var action, actor string
			var version sql.NullInt64
			var success bool
			var metadata []byte
			var created time.Time
			if auditRows.Scan(&action, &actor, &version, &success, &metadata, &created) != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "audit_scan_failed"})
				return
			}
			var meta any
			_ = json.Unmarshal(metadata, &meta)
			audit = append(audit, gin.H{
				"action": action, "actor_email": actor, "config_version": nullInt64Ptr(version),
				"success": success, "metadata": meta, "created_at": created,
			})
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"versions": versions, "audit": audit}})
	}
}
